// Blob storage: AWS S3 (presigned multipart uploads straight from the browser) with a local-disk
// fallback that mimics the same flow, so recording/replay works with zero configuration.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Express, Request, Response } from 'express';
import express from 'express';
import { config } from './config.ts';

export interface BlobStore {
  kind: 's3' | 'local';
  put(key: string, body: Buffer | string, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  createMultipart(key: string, contentType: string): Promise<string>;
  partUrl(key: string, uploadId: string, partNumber: number): Promise<string>;
  completeMultipart(key: string, uploadId: string, parts: { PartNumber: number; ETag: string }[]): Promise<void>;
  abortMultipart(key: string, uploadId: string): Promise<void>;
  getUrl(key: string, expiresSec?: number): Promise<string>;
}

// ---------------------------------------------------------------------------- S3

export class S3Blobs implements BlobStore {
  kind = 's3' as const;
  private client: import('@aws-sdk/client-s3').S3Client | null = null;
  private mod!: typeof import('@aws-sdk/client-s3');
  private presign!: typeof import('@aws-sdk/s3-request-presigner').getSignedUrl;

  constructor(private bucket: string) {}

  async init() {
    this.mod = await import('@aws-sdk/client-s3');
    this.presign = (await import('@aws-sdk/s3-request-presigner')).getSignedUrl;
    this.client = new this.mod.S3Client({ region: config.aws.region });
    await this.client.send(new this.mod.HeadBucketCommand({ Bucket: this.bucket }));
  }

  private get c() {
    return this.client!;
  }

  async put(key: string, body: Buffer | string, contentType: string) {
    await this.c.send(new this.mod.PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
  }

  async get(key: string) {
    try {
      const r = await this.c.send(new this.mod.GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return Buffer.from(await r.Body!.transformToByteArray());
    } catch {
      return null;
    }
  }

  async createMultipart(key: string, contentType: string) {
    const r = await this.c.send(new this.mod.CreateMultipartUploadCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }));
    return r.UploadId!;
  }

  partUrl(key: string, uploadId: string, partNumber: number) {
    return this.presign(this.c, new this.mod.UploadPartCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId, PartNumber: partNumber }), {
      expiresIn: 3600,
    });
  }

  async completeMultipart(key: string, uploadId: string, parts: { PartNumber: number; ETag: string }[]) {
    await this.c.send(
      new this.mod.CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: { Parts: [...parts].sort((a, b) => a.PartNumber - b.PartNumber) },
      }),
    );
  }

  async abortMultipart(key: string, uploadId: string) {
    await this.c.send(new this.mod.AbortMultipartUploadCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId })).catch(() => {});
  }

  getUrl(key: string, expiresSec = 3600) {
    return this.presign(this.c, new this.mod.GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn: expiresSec });
  }

  /** Browsers need CORS on the bucket to PUT parts and read the ETag header. */
  async ensureCors(origins: string[]) {
    await this.c.send(
      new this.mod.PutBucketCorsCommand({
        Bucket: this.bucket,
        CORSConfiguration: {
          CORSRules: [{ AllowedMethods: ['GET', 'PUT', 'HEAD'], AllowedOrigins: origins, AllowedHeaders: ['*'], ExposeHeaders: ['ETag'], MaxAgeSeconds: 3600 }],
        },
      }),
    );
  }
}

// ---------------------------------------------------------------------------- Local

const SECRET = crypto.randomBytes(32);
const sign = (s: string) => crypto.createHmac('sha256', SECRET).update(s).digest('base64url').slice(0, 32);
const safeKey = (k: string) => /^[\w./-]+$/.test(k) && !k.includes('..');

export class LocalBlobs implements BlobStore {
  kind = 'local' as const;
  readonly dir: string;

  constructor(dataDir: string) {
    this.dir = path.resolve(dataDir, 'blobs');
    fs.mkdirSync(this.dir, { recursive: true });
  }

  file(key: string) {
    if (!safeKey(key)) throw new Error('bad key');
    return path.join(this.dir, key);
  }

  async put(key: string, body: Buffer | string) {
    fs.mkdirSync(path.dirname(this.file(key)), { recursive: true });
    await fs.promises.writeFile(this.file(key), body);
  }

  async get(key: string) {
    try {
      return await fs.promises.readFile(this.file(key));
    } catch {
      return null;
    }
  }

  async createMultipart(key: string) {
    const id = crypto.randomUUID();
    fs.mkdirSync(path.join(this.dir, '.parts', id), { recursive: true });
    void key;
    return id;
  }

  async partUrl(key: string, uploadId: string, part: number) {
    const q = new URLSearchParams({ key, uploadId, part: String(part) });
    q.set('sig', sign(q.toString()));
    return `/api/blobs/part?${q}`;
  }

  async completeMultipart(key: string, uploadId: string, parts: { PartNumber: number }[]) {
    const dir = path.join(this.dir, '.parts', uploadId);
    fs.mkdirSync(path.dirname(this.file(key)), { recursive: true });
    const out = fs.createWriteStream(this.file(key));
    for (const p of [...parts].sort((a, b) => a.PartNumber - b.PartNumber)) {
      await new Promise<void>((res, rej) => {
        const rs = fs.createReadStream(path.join(dir, String(p.PartNumber)));
        rs.on('error', rej);
        rs.on('end', () => res());
        rs.pipe(out, { end: false });
      });
    }
    await new Promise<void>((res) => out.end(res));
    fs.rmSync(dir, { recursive: true, force: true });
  }

  async abortMultipart(_key: string, uploadId: string) {
    fs.rmSync(path.join(this.dir, '.parts', uploadId), { recursive: true, force: true });
  }

  async getUrl(key: string) {
    const q = new URLSearchParams({ key });
    q.set('sig', sign(q.toString()));
    return `/api/blobs/get?${q}`;
  }

  /** Routes that stand in for S3's presigned PUT/GET. */
  mount(app: Express) {
    const verify = (req: Request, res: Response, fields: string[]) => {
      const q = new URLSearchParams();
      for (const f of fields) q.set(f, String(req.query[f] ?? ''));
      if (sign(q.toString()) !== req.query.sig) {
        res.sendStatus(403);
        return null;
      }
      return Object.fromEntries(q) as Record<string, string>;
    };
    app.put('/api/blobs/part', express.raw({ type: () => true, limit: '64mb' }), async (req, res) => {
      const p = verify(req, res, ['key', 'uploadId', 'part']);
      if (!p) return;
      const dir = path.join(this.dir, '.parts', p.uploadId);
      if (!/^[\w-]+$/.test(p.uploadId) || !fs.existsSync(dir)) return res.sendStatus(404);
      const body = req.body as Buffer;
      await fs.promises.writeFile(path.join(dir, String(Number(p.part))), body);
      res.setHeader('ETag', `"${crypto.createHash('md5').update(body).digest('hex')}"`);
      res.sendStatus(200);
    });
    app.get('/api/blobs/get', (req, res) => {
      const p = verify(req, res, ['key']);
      if (!p) return;
      // sendFile handles Range requests, which <video> seeking needs.
      res.sendFile(this.file(p.key), { dotfiles: 'allow' }, (err) => err && !res.headersSent && res.sendStatus(404));
    });
  }
}

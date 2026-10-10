// One-time: allow browsers to PUT recording parts to the bucket and read the ETag header.
// Usage: npm run s3:setup -- https://your-tunnel.example.com  (defaults allow localhost + LAN)
import 'dotenv/config';
import { S3Blobs } from '../server/storage.ts';

const bucket = process.env.S3_BUCKET;
if (!bucket) {
  console.error('Set S3_BUCKET (and AWS credentials) in .env first.');
  process.exit(1);
}
const extra = process.argv.slice(2);
const origins = extra.length ? ['http://localhost:5173', 'https://localhost:5173', ...extra] : ['*'];
const s3 = new S3Blobs(bucket);
await s3.init();
await s3.ensureCors(origins);
console.log(`CORS set on s3://${bucket} for: ${origins.join(', ')}`);

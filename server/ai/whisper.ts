// Server-side Whisper (Hugging Face, open weights) via Transformers.js on ONNX Runtime.
// We prompt the decoder with filler-rich text (<|startofprev|> …) so Whisper keeps "um"/"uh"
// instead of cleaning them up, which is what live filler counts depend on.
import path from 'node:path';
import { hostedTranscribe } from './huggingface.ts';
import { config } from '../config.ts';

export interface Transcriber {
  status: 'ready' | 'loading' | 'off' | 'error';
  transcribe(pcm16k: Float32Array): Promise<string>;
}

const FILLER_PROMPT =
  "Umm, let me think like, hmm... Okay, here's what I'm, like, thinking. Uh, so, you know, basically, um, yeah.";

// Common Whisper hallucinations on near-silence.
const HALLUCINATIONS = [
  /^(thank you|thanks)( for watching| so much)?[.!]?$/i,
  /^you[.!]?$/i,
  /^bye[.!]?$/i,
  /^\[?(music|silence|blank_audio|inaudible)\]?$/i,
  /^\.+$/,
];

class WhisperTranscriber implements Transcriber {
  status: Transcriber['status'] = 'loading';
  private ready: Promise<void>;
  private model: any;
  private processor: any;
  private tokenizer: any;
  private initTokens: number[] = [];
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private modelId: string) {
    this.ready = this.load().catch((e) => {
      this.status = 'error';
      console.warn(`[whisper] failed to load ${modelId}: ${e?.message ?? e}`);
    });
  }

  private async load() {
    const T = await import('@huggingface/transformers');
    T.env.cacheDir = path.resolve('.cache/hf');
    const t0 = Date.now();
    console.log(`[whisper] loading ${this.modelId} (first run downloads ~150 MB)…`);
    this.processor = await T.AutoProcessor.from_pretrained(this.modelId);
    this.tokenizer = await T.AutoTokenizer.from_pretrained(this.modelId);
    this.model = await T.WhisperForConditionalGeneration.from_pretrained(this.modelId, {
      dtype: { encoder_model: 'fp32', decoder_model_merged: 'q8' },
    });
    const tok = (s: string) => this.tokenizer.convert_tokens_to_ids(s) as number;
    const prompt: number[] = this.tokenizer.encode(' ' + FILLER_PROMPT, { add_special_tokens: false });
    const english = this.modelId.endsWith('.en');
    this.initTokens = [
      tok('<|startofprev|>'),
      ...prompt,
      tok('<|startoftranscript|>'),
      ...(english ? [] : [tok('<|en|>'), tok('<|transcribe|>')]),
      tok('<|notimestamps|>'),
    ];
    this.status = 'ready';
    console.log(`[whisper] ready in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }

  transcribe(pcm: Float32Array): Promise<string> {
    // Serialize: one inference at a time keeps latency predictable on a laptop CPU.
    const job = this.queue.then(() => this.run(pcm));
    this.queue = job.catch(() => {});
    return job;
  }

  private async run(pcm: Float32Array): Promise<string> {
    await this.ready;
    if (this.status !== 'ready') return '';
    const inputs = await this.processor(pcm);
    const out = await this.model.generate({
      ...inputs,
      decoder_input_ids: this.initTokens,
      max_new_tokens: 120,
    });
    const ids = Array.from(out.tolist()[0] as ArrayLike<number | bigint>);
    const text: string = this.tokenizer
      .decode(ids.slice(this.initTokens.length).map(Number), { skip_special_tokens: true })
      .trim();
    if (HALLUCINATIONS.some((r) => r.test(text))) return '';
    // Repetition loops ("I'm feeling it. I'm feeling it. …"): more words than anyone can say.
    const seconds = pcm.length / 16000;
    if (text.split(/\s+/).length > seconds * 5 + 6) return '';
    // If the model just parrots the prompt back, drop it.
    if (text.length > 20 && FILLER_PROMPT.toLowerCase().includes(text.toLowerCase())) return '';
    return text;
  }
}

class NoTranscriber implements Transcriber {
  status: Transcriber['status'] = 'off';
  async transcribe() {
    return '';
  }
}

class HostedTranscriber implements Transcriber {
  private retryAfter = 0;
  private inFlight = 0;
  constructor(private fallback: Transcriber) {}
  get status(): Transcriber['status'] {
    return Date.now() < this.retryAfter ? this.fallback.status : 'ready';
  }
  async transcribe(pcm: Float32Array): Promise<string> {
    if (!pcm.length || pcm.length > 16000 * 30) return '';
    if (Date.now() < this.retryAfter || this.inFlight >= 3) return this.fallback.transcribe(pcm);
    this.inFlight++;
    try {
      const text = await hostedTranscribe(pcm);
      if (HALLUCINATIONS.some(r => r.test(text)) || text.split(/\s+/).length > pcm.length / 16000 * 5 + 6) return '';
      return text;
    } catch {
      this.retryAfter = Date.now() + 60000;
      console.warn('[speech] Hosted transcription unavailable; using local fallback for 60 seconds');
      return this.fallback.transcribe(pcm);
    } finally { this.inFlight--; }
  }
}

const localTranscriber: Transcriber = config.whisperEnabled
  ? new WhisperTranscriber(config.whisperModel)
  : new NoTranscriber();

export const transcriber: Transcriber = config.hfToken && config.hfAsrEnabled ? new HostedTranscriber(localTranscriber) : localTranscriber;

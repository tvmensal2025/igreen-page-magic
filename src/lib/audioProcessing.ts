/**
 * Utilitários de processamento de áudio — portado do scanpro-mobile.
 * Funções puras que operam sobre AudioBuffer / Blob.
 * Dependência: @breezystack/lamejs (MP3 encoder)
 */

let _ctx: AudioContext | null = null;

export function getAudioContext(): AudioContext {
  if (!_ctx) {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    _ctx = new Ctx();
  }
  if (_ctx!.state === "suspended") {
    _ctx!.resume().catch(() => {});
  }
  return _ctx!;
}

export async function decodeAudioBlob(blob: Blob): Promise<AudioBuffer> {
  const arr = await blob.arrayBuffer();
  const ctx = getAudioContext();
  return new Promise<AudioBuffer>((resolve, reject) => {
    try {
      const p = ctx.decodeAudioData(
        arr.slice(0),
        (buf) => resolve(buf),
        (err) => reject(err || new Error("decodeAudioData failed")),
      );
      if (p && typeof (p as Promise<AudioBuffer>).then === "function") {
        (p as Promise<AudioBuffer>).then(resolve, reject);
      }
    } catch (e) {
      reject(e);
    }
  });
}

function floatTo16Bit(float32: Float32Array): Int16Array {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return int16;
}

/** Encode AudioBuffer → MP3 Blob (192 kbps by default). */
export async function encodeMp3(buffer: AudioBuffer, kbps = 192): Promise<Blob> {
  const { Mp3Encoder } = await import("@breezystack/lamejs");
  const numCh = buffer.numberOfChannels;
  const encoder = new Mp3Encoder(numCh, buffer.sampleRate, kbps);
  const left = floatTo16Bit(buffer.getChannelData(0));
  const right = numCh > 1 ? floatTo16Bit(buffer.getChannelData(1)) : left;
  const mp3Data: ArrayBuffer[] = [];
  const blockSize = 1152;
  let sinceYield = 0;
  for (let i = 0; i < left.length; i += blockSize) {
    const lc = left.subarray(i, i + blockSize);
    const rc = right.subarray(i, i + blockSize);
    const enc = numCh > 1 ? encoder.encodeBuffer(lc, rc) : encoder.encodeBuffer(lc);
    if (enc.length > 0) {
      const copy = new Uint8Array(enc.length);
      copy.set(new Uint8Array(enc.buffer, enc.byteOffset, enc.byteLength));
      mp3Data.push(copy.buffer);
    }
    sinceYield += blockSize;
    if (sinceYield > buffer.sampleRate * 5) {
      sinceYield = 0;
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  const flushed = encoder.flush();
  if (flushed.length > 0) {
    const copy = new Uint8Array(flushed.length);
    copy.set(new Uint8Array(flushed.buffer, flushed.byteOffset, flushed.byteLength));
    mp3Data.push(copy.buffer);
  }
  return new Blob(mp3Data, { type: "audio/mpeg" });
}

/** Concatenate AudioBuffers in sequence. */
export function concatBuffers(buffers: AudioBuffer[]): AudioBuffer {
  if (!buffers.length) throw new Error("No buffers");
  const ctx = getAudioContext();
  const sr = buffers[0].sampleRate;
  const ch = Math.max(...buffers.map((b) => b.numberOfChannels));
  const totalLen = buffers.reduce((a, b) => a + b.length, 0);
  const out = ctx.createBuffer(ch, totalLen, sr);
  for (let c = 0; c < ch; c++) {
    const data = out.getChannelData(c);
    let offset = 0;
    for (const b of buffers) {
      const src = b.numberOfChannels > c ? b.getChannelData(c) : b.getChannelData(0);
      data.set(src, offset);
      offset += b.length;
    }
  }
  return out;
}

/** Concat with a short crossfade (ms) to avoid clicks. */
export function concatWithCrossfade(buffers: AudioBuffer[], fadeSamples = 100): AudioBuffer {
  if (buffers.length === 0) throw new Error("No buffers");
  if (buffers.length === 1) return buffers[0];
  const ctx = getAudioContext();
  const sr = buffers[0].sampleRate;
  const ch = Math.max(...buffers.map((b) => b.numberOfChannels));
  const fade = Math.min(fadeSamples, ...buffers.map((b) => Math.floor(b.length / 2)));
  const totalLen = buffers.reduce((a, b) => a + b.length, 0) - fade * (buffers.length - 1);
  const out = ctx.createBuffer(ch, Math.max(totalLen, 1), sr);
  for (let c = 0; c < ch; c++) {
    const data = out.getChannelData(c);
    let offset = 0;
    for (let i = 0; i < buffers.length; i++) {
      const b = buffers[i];
      const src = b.numberOfChannels > c ? b.getChannelData(c) : b.getChannelData(0);
      for (let j = 0; j < b.length; j++) {
        const pos = offset + j;
        if (pos < 0 || pos >= data.length) continue;
        if (i > 0 && j < fade) {
          const t = j / fade;
          data[pos] = (data[pos] || 0) * (1 - t) + src[j] * t;
        } else {
          data[pos] = src[j];
        }
      }
      offset += b.length - (i < buffers.length - 1 ? fade : 0);
    }
  }
  return out;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

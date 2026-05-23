// Génère `public/alert.wav` : 2 bips (880 Hz puis 1320 Hz) avec exponential
// decay, mono 22050 Hz 16-bit PCM, durée ≈ 450 ms. Aucune dépendance externe.
//
// Usage : `node scripts/generate-alert-sound.mjs`

import { writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, "..", "public", "alert.wav");

const SAMPLE_RATE = 22050;
const BITS = 16;
const CHANNELS = 1;

function tone(freq, durationSec, decay = 8) {
  const n = Math.floor(SAMPLE_RATE * durationSec);
  const data = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    // Exponential decay : claque sec puis s'éteint vite (notif courte).
    const env = Math.exp(-decay * t);
    data[i] = Math.sin(2 * Math.PI * freq * t) * env * 0.85;
  }
  return data;
}

function silence(durationSec) {
  return new Float32Array(Math.floor(SAMPLE_RATE * durationSec));
}

function concat(...arrs) {
  let total = 0;
  for (const a of arrs) total += a.length;
  const out = new Float32Array(total);
  let off = 0;
  for (const a of arrs) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}

// 880 Hz puis 1320 Hz (rapport 3:2, intervalle de quinte → reconnaissable).
const samples = concat(
  tone(880, 0.18, 9),
  silence(0.03),
  tone(1320, 0.18, 9),
  silence(0.06)
);

function encodeWav(floatSamples) {
  const bytesPerSample = BITS / 8;
  const dataLen = floatSamples.length * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataLen);
  // RIFF header
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataLen, 4);
  buffer.write("WAVE", 8, "ascii");
  // fmt chunk
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(CHANNELS, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * CHANNELS * bytesPerSample, 28);
  buffer.writeUInt16LE(CHANNELS * bytesPerSample, 32);
  buffer.writeUInt16LE(BITS, 34);
  // data chunk
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataLen, 40);
  for (let i = 0; i < floatSamples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, floatSamples[i]));
    buffer.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2);
  }
  return buffer;
}

const wav = encodeWav(samples);
await writeFile(OUT, wav);
console.log(`✓ alert.wav (${samples.length} samples, ${wav.length} bytes)`);

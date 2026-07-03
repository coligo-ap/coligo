// Génère `public/alert.wav` — carillon « nouvelle commande » du commerçant,
// façon Deliveroo / Uber Eats : coup de mallet chaud + arpège majeur ascendant
// (G5 → B5 → D6) et note finale brillante tenue (G6) avec léger scintillement.
// Timbre cloche/glockenspiel (partiels inharmoniques 2.76f / 5.4f + double
// désaccordé pour la chaleur). Mono 44100 Hz 16-bit PCM, ≈ 1,45 s.
// Aucune dépendance externe.
//
// Usage : `node scripts/generate-alert-sound.mjs`

import { writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, "..", "public", "alert.wav");

const SAMPLE_RATE = 44100;
const BITS = 16;
const CHANNELS = 1;

const TOTAL_SEC = 1.45;
const N = Math.floor(SAMPLE_RATE * TOTAL_SEC);
const mix = new Float32Array(N);

/**
 * Note « cloche mallet » : fondamentale + partiels inharmoniques de
 * glockenspiel (2.76f, 5.4f) + double légèrement désaccordé (chorus chaud).
 * Attaque 4 ms (pas de clic), décroissance exponentielle.
 */
function bell(freq, startSec, durSec, gain, decay) {
  const start = Math.floor(startSec * SAMPLE_RATE);
  const n = Math.min(N - start, Math.floor(durSec * SAMPLE_RATE));
  const partials = [
    [1, 1.0],
    [1.0035, 0.55], // double désaccordé (+6 cents) → chaleur
    [2.76, 0.22], // partiel cloche
    [5.4, 0.07], // brillance
    [3, 0.1], // corps
  ];
  const attack = 0.004;
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    const env = (t < attack ? t / attack : 1) * Math.exp(-decay * t) * gain;
    let s = 0;
    for (const [ratio, amp] of partials) {
      s += Math.sin(2 * Math.PI * freq * ratio * t) * amp;
    }
    mix[start + i] += s * env;
  }
}

/** Coup de « corps » grave et bref (mallet marimba) sous la première note. */
function knock(freq, startSec, gain) {
  const start = Math.floor(startSec * SAMPLE_RATE);
  const n = Math.min(N - start, Math.floor(0.12 * SAMPLE_RATE));
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    const env = (t < 0.002 ? t / 0.002 : 1) * Math.exp(-26 * t) * gain;
    mix[start + i] +=
      (Math.sin(2 * Math.PI * freq * t) +
        0.4 * Math.sin(2 * Math.PI * freq * 2.02 * t)) *
      env;
  }
}

// ─── Partition ───────────────────────────────────────────────────────────────
// Coup chaud + G5 · B5 · D6 (arpège de sol majeur, cadence enjouée) puis G6
// tenu (résolution à l'octave = « une commande arrive, c'est une bonne
// nouvelle ») avec un scintillement discret à l'octave au-dessus.
knock(196, 0.0, 0.5); // corps grave (G3)
bell(783.99, 0.0, 0.5, 0.5, 7); // G5
bell(987.77, 0.13, 0.5, 0.5, 7); // B5
bell(1174.66, 0.26, 0.55, 0.52, 6.5); // D6
bell(1567.98, 0.42, 1.0, 0.6, 3.4); // G6 — tenue, décroissance douce
bell(3135.96, 0.47, 0.6, 0.1, 5); // scintillement (G7, très discret)

// Normalisation (marge anti-clip) puis encodage WAV.
let peak = 0;
for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(mix[i]));
const norm = peak > 0 ? 0.88 / peak : 1;

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
    const clamped = Math.max(-1, Math.min(1, floatSamples[i] * norm));
    buffer.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2);
  }
  return buffer;
}

const wav = encodeWav(mix);
await writeFile(OUT, wav);
console.log(
  `✓ alert.wav (${N} samples @ ${SAMPLE_RATE} Hz, ${wav.length} bytes)`
);

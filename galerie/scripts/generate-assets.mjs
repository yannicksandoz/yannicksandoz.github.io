/**
 * Génère les assets de démo (textures PNG + stems audio WAV) sans aucune
 * dépendance externe. Relancer avec : npm run assets
 *
 * Les boucles audio sont "seamless" : toutes les fréquences utilisées ont un
 * nombre entier de cycles sur la durée du fichier.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'content');
mkdirSync(join(ROOT, 'textures'), { recursive: true });
mkdirSync(join(ROOT, 'audio'), { recursive: true });

/* ---------------------------------------------------------------- PNG --- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // profondeur
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 4);
    raw[row] = 0; // filtre none
    rgba.copy(raw, row + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

/* Bruit de valeur 2D déterministe (pour les textures) */
function hash2(x, y) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
const fade = (t) => t * t * (3 - 2 * t);
function valueNoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const a = hash2(xi, yi), b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  const u = fade(xf), v = fade(yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, octaves = 4) {
  let sum = 0, amp = 0.5, f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x * f, y * f);
    amp *= 0.5;
    f *= 2;
  }
  return sum;
}

function makeTexture(name, size, fn) {
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b] = fn(x / size, y / size);
      const i = (y * size + x) * 4;
      rgba[i] = Math.max(0, Math.min(255, Math.round(r * 255)));
      rgba[i + 1] = Math.max(0, Math.min(255, Math.round(g * 255)));
      rgba[i + 2] = Math.max(0, Math.min(255, Math.round(b * 255)));
      rgba[i + 3] = 255;
    }
  }
  writeFileSync(join(ROOT, 'textures', name), encodePNG(size, size, rgba));
  console.log('texture :', name);
}

// Nébuleuse : nuages violets/bleus + étoiles
makeTexture('nebuleuse.png', 512, (u, v) => {
  const n = fbm(u * 6, v * 6, 5);
  const m = fbm(u * 3 + 40, v * 3 + 40, 4);
  const cloud = Math.pow(Math.max(0, n - 0.25) * 1.6, 1.5);
  let r = 0.02 + cloud * (0.45 + m * 0.5);
  let g = 0.02 + cloud * 0.18;
  let b = 0.06 + cloud * (0.7 + (1 - m) * 0.3);
  const star = hash2(Math.floor(u * 512), Math.floor(v * 512));
  if (star > 0.9985) {
    const s = (star - 0.9985) / 0.0015;
    r += s * 2; g += s * 2; b += s * 2;
  }
  return [r, g, b];
});

// Marées : bandes ondulantes turquoise/profondes
makeTexture('marees.png', 512, (u, v) => {
  const w1 = Math.sin((v * 10 + fbm(u * 4, v * 4) * 2.2) * Math.PI * 2);
  const w2 = Math.sin((v * 3 - u * 1.5 + fbm(u * 8 + 9, v * 8 + 9) * 1.1) * Math.PI * 2);
  const t = 0.5 + 0.35 * w1 + 0.15 * w2;
  const deep = [0.01, 0.05, 0.09];
  const foam = [0.25, 0.85, 0.8];
  const k = Math.pow(Math.max(0, t), 2.2);
  return [
    deep[0] + (foam[0] - deep[0]) * k,
    deep[1] + (foam[1] - deep[1]) * k,
    deep[2] + (foam[2] - deep[2]) * k
  ];
});

/* ---------------------------------------------------------------- WAV --- */

const RATE = 22050;
const DUR = 6; // secondes — toutes les fréquences font un nombre entier de cycles sur 6 s
const N = RATE * DUR;
const TAU = Math.PI * 2;

function writeWav(name, samples) {
  let peak = 0;
  for (const s of samples) peak = Math.max(peak, Math.abs(s));
  const norm = peak > 0 ? 0.82 / peak : 1;
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    data.writeInt16LE(Math.round(samples[i] * norm * 32767), i * 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22); h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  writeFileSync(join(ROOT, 'audio', name), Buffer.concat([h, data]));
  console.log('audio   :', name, `(${(data.length / 1024).toFixed(0)} Ko)`);
}

function synth(fn) {
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) out[i] = fn(i / RATE);
  return out;
}

// Nébuleuse : drone d'accord (La) avec battement lent et miroitement
writeWav('nebuleuse-drone.wav', synth((t) => {
  const am = 0.65 + 0.35 * Math.sin(TAU * (1 / 6) * t);
  const beat = Math.sin(TAU * 110 * t) + Math.sin(TAU * (110 + 1 / 3) * t);
  const chord = 0.5 * beat + 0.45 * Math.sin(TAU * 165 * t) + 0.3 * Math.sin(TAU * 220 * t);
  const shimmer = 0.08 * Math.sin(TAU * 440 * t) * (0.5 + 0.5 * Math.sin(TAU * (1 / 3) * t + 1));
  return am * chord + shimmer;
}));

// Marées — stem grave : nappe profonde
writeWav('marees-basse.wav', synth((t) => {
  const am = 0.6 + 0.4 * Math.sin(TAU * (1 / 3) * t);
  return am * (Math.sin(TAU * 55 * t) + 0.6 * Math.sin(TAU * 82.5 * t) + 0.25 * Math.sin(TAU * 110 * t));
}));

// Marées — stem médium : arpège de sinusoïdes pincées (8 notes de 0,75 s)
writeWav('marees-medium.wav', synth((t) => {
  const NOTES = [220, 275, 330, 275, 220, 330, 412.5, 275];
  const step = 0.75;
  const idx = Math.floor(t / step) % NOTES.length;
  const tt = t % step;
  const env = Math.min(1, tt / 0.008) * Math.exp(-tt * 5);
  return env * Math.sin(TAU * NOTES[idx] * tt) * 0.8;
}));

// Marées — stem aigu : scintillements (fenêtres de Hann, silencieux aux bords)
writeWav('marees-aigu.wav', synth((t) => {
  const BLIPS = [
    [0.4, 1320], [1.1, 1760], [1.9, 2200], [2.6, 1320],
    [3.3, 1650], [4.1, 2200], [4.8, 1760], [5.4, 1650]
  ];
  let s = 0;
  for (const [start, freq] of BLIPS) {
    const dur = 0.45;
    if (t >= start && t < start + dur) {
      const p = (t - start) / dur;
      const win = 0.5 - 0.5 * Math.cos(TAU * p);
      s += win * Math.sin(TAU * freq * (t - start)) * 0.5;
    }
  }
  return s;
}));

// Monolithe : pulsation sub-grave (battement toutes les 1,5 s)
writeWav('monolithe-pulse.wav', synth((t) => {
  const tt = t % 1.5;
  const env = Math.min(1, tt / 0.01) * Math.exp(-tt * 3.2);
  const sub = Math.sin(TAU * 55 * tt) + 0.7 * Math.sin(TAU * 36.6667 * tt);
  const air = 0.05 * Math.sin(TAU * 165 * t) * (0.5 + 0.5 * Math.sin(TAU * (1 / 6) * t));
  return env * sub + air;
}));


/* --------------------------------------------- le quatuor des Archives --- */
//
// Quatre stèles, quatre voix d'un même accord de ré : chacune ne s'entend
// qu'auprès de sa stèle (rayon court), et marcher entre elles COMPOSE le
// quatuor — la salle est l'instrument. Toutes les fréquences font un nombre
// entier de cycles sur 6 s (f = k/6) : les boucles sont sans couture, et
// superposées elles restent accordées quelle que soit la position de
// l'écoutant.

// La grave : bourdon de fondation (ré 73,33 Hz et sa quinte), respiration lente
writeWav('stele-voix-grave.wav', synth((t) => {
  const am = 0.62 + 0.38 * Math.sin(TAU * (1 / 6) * t);
  return am * (Math.sin(TAU * (440 / 6) * t)
    + 0.55 * Math.sin(TAU * 110 * t)
    + 0.2 * Math.sin(TAU * (880 / 6) * t));
}));

// L'alto : l'accord tenu (ré–fa#–la), battement lent entre deux ré voisins
writeWav('stele-voix-alto.wav', synth((t) => {
  const am = 0.7 + 0.3 * Math.sin(TAU * (1 / 3) * t + 1.2);
  const battement = Math.sin(TAU * (880 / 6) * t)
    + Math.sin(TAU * (880 / 6 + 1 / 3) * t);
  return am * (0.5 * battement
    + 0.4 * Math.sin(TAU * (1100 / 6) * t)
    + 0.3 * Math.sin(TAU * 220 * t));
}));

// Le ténor : notes égrenées, cloches lointaines de l'accord (8 pas de 0,75 s)
writeWav('stele-voix-tenor.wav', synth((t) => {
  const NOTES = [880 / 3, 220, 1100 / 3, 880 / 3, 440, 1100 / 3, 220, 880 / 3];
  const pas = 0.75;
  const idx = Math.floor(t / pas) % NOTES.length;
  const tt = t % pas;
  const env = Math.min(1, tt / 0.01) * Math.exp(-tt * 4);
  return env * (Math.sin(TAU * NOTES[idx] * tt)
    + 0.3 * Math.sin(TAU * NOTES[idx] * 2 * tt)) * 0.8;
}));

// Le souffle : l'air des rayonnages — un chœur de partiels hauts et détunés
// sous fenêtres lentes, ni note ni bruit, la poussière sonore d'une archive
writeWav('stele-voix-souffle.wav', synth((t) => {
  let s = 0;
  for (let k = 0; k < 9; k++) {
    const f = (5280 + (k * 754)) / 6;              // partiels inharmoniques, k/6
    const fen = 0.5 + 0.5 * Math.sin(TAU * ((k % 3) + 1) / 6 * t + k * 2.1);
    s += Math.sin(TAU * f * t + k) * fen * (0.12 / (1 + k * 0.35));
  }
  const am = 0.55 + 0.45 * Math.sin(TAU * (1 / 6) * t + 4);
  return s * am;
}));


/* ------------------------------------- la bibliothèque et le couloir ----- */

// Les rayonnages murmurent : un feuilletage — partiels inharmoniques médians
// sous tremblement rapide et fenêtres lentes, comme des pages qu'on tourne
// à plusieurs, jamais une note. Trois rayonnages le portent, décalés dans la
// salle : le murmure n'a pas de source, il a un lieu.
writeWav('rayonnage-murmure.wav', synth((t) => {
  let s = 0;
  for (let k = 0; k < 7; k++) {
    const f = (2640 + (k * 1122)) / 6;           // inharmonique, k/6 : sans couture
    const trem = 0.6 + 0.4 * Math.sin(TAU * (7 + k) * t + k * 1.7);
    const fen = 0.5 + 0.5 * Math.sin(TAU * ((k % 2) + 1) / 6 * t + k * 2.4);
    s += Math.sin(TAU * f * t + k * 0.9) * trem * fen * (0.14 / (1 + k * 0.4));
  }
  return s * (0.5 + 0.5 * Math.sin(TAU * (1 / 6) * t + 2));
}));

// Le carillon des fenêtres : des tintements épars sur l'accord de ré, aigus
// et brefs, chacun avec sa seconde partielle légèrement fausse — c'est elle
// qui fait le métal. Sept coups sur six secondes : le vent, pas la mélodie.
writeWav('carillon-fenetres.wav', synth((t) => {
  const COUPS = [
    [0.3, 3520 / 6], [1.2, 4440 / 6], [2.0, 880], [2.9, 3520 / 6],
    [3.7, 7040 / 6], [4.4, 4440 / 6], [5.2, 880]
  ];
  let s = 0;
  for (const [debut, f] of COUPS) {
    if (t >= debut && t < debut + 0.7) {
      const tt = t - debut;
      const env = Math.min(1, tt / 0.004) * Math.exp(-tt * 6);
      s += env * (Math.sin(TAU * f * tt)
        + 0.35 * Math.sin(TAU * f * 2.76 * tt)) * 0.5;
    }
  }
  return s;
}));

console.log('\nAssets générés dans content/textures et content/audio.');

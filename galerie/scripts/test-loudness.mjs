/**
 * LE SONOMÈTRE (core/loudness.js) contre ffmpeg, sur les fichiers RÉELS.
 *
 * Les onze WAV de content/audio (mono 16 bits 22 050 Hz, 6 s) ont été
 * mesurés par `ffmpeg -af ebur128` (sonie intégrée, résumé) ; le module
 * doit tomber à 0,3 LU près. Puis les fonctions pures : signaux de
 * synthèse (un sinus à −20 dBFS, le silence), niveau effectif, gain pour
 * une cible.
 *
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { sonie, filtreK, niveauEffectif, gainPourCible } from '../engine/src/core/loudness.js';

const ici = dirname(fileURLToPath(import.meta.url));
const AUDIO = join(ici, '..', 'content', 'audio');

let ok = 0;
let ko = 0;
const test = (nom, fn) => {
  try { fn(); ok++; console.log(`  ✓ ${nom}`); }
  catch (e) { ko++; console.log(`  ✗ ${nom}\n      ${e.message}`); }
};

/** Un lecteur WAV minimal : PCM 16 bits, n voies, en Float32Array par voie. */
function lireWav(chemin) {
  const b = readFileSync(chemin);
  assert.equal(b.toString('ascii', 0, 4), 'RIFF');
  let p = 12; let fmt = null; let data = null;
  while (p + 8 <= b.length) {
    const id = b.toString('ascii', p, p + 4); const taille = b.readUInt32LE(p + 4);
    if (id === 'fmt ') fmt = { voies: b.readUInt16LE(p + 10), fs: b.readUInt32LE(p + 12), bits: b.readUInt16LE(p + 22) };
    if (id === 'data') data = b.subarray(p + 8, p + 8 + taille);
    p += 8 + taille + (taille & 1);
  }
  assert.ok(fmt && data && fmt.bits === 16, 'WAV PCM 16 bits attendu');
  const n = data.length / 2 / fmt.voies;
  const voies = Array.from({ length: fmt.voies }, () => new Float32Array(n));
  for (let i = 0; i < n; i++) for (let c = 0; c < fmt.voies; c++) voies[c][i] = data.readInt16LE((i * fmt.voies + c) * 2) / 32768;
  return { voies, fs: fmt.fs };
}

// ffmpeg 7.0.2, `-af ebur128`, « Integrated loudness: I: » du résumé
const FFMPEG = {
  'nebuleuse-drone.wav': -12.5, 'marees-basse.wav': -14.7, 'marees-medium.wav': -13.8,
  'marees-aigu.wav': -8.3, 'monolithe-pulse.wav': -19.3, 'stele-voix-grave.wav': -13.3,
  'stele-voix-alto.wav': -13.6, 'stele-voix-tenor.wav': -13.9, 'stele-voix-souffle.wav': -17.6,
  'rayonnage-murmure.wav': -18.6, 'carillon-fenetres.wav': -15.0
};

console.log('\nle sonomètre contre ffmpeg, sur les fichiers de la galerie');
for (const [nom, attendu] of Object.entries(FFMPEG)) {
  const chemin = join(AUDIO, nom);
  test(`${nom} : ${attendu} LUFS`, () => {
    if (!existsSync(chemin)) throw new Error('fichier absent');
    const { voies, fs } = lireWav(chemin);
    const { lufs } = sonie(voies, fs);
    assert.ok(Math.abs(lufs - attendu) <= 0.3, `mesuré ${lufs.toFixed(2)}`);
  });
}

console.log('\nles signaux de synthèse et les fonctions pures');

test('un sinus à 1 kHz, −20 dBFS, à 48 kHz : −23,0 LUFS (BS.1770 : 0 dBFS lit −3,01)', () => {
  const fs = 48000; const n = fs * 3; const v = new Float32Array(n);
  const amp = Math.pow(10, -20 / 20);
  for (let i = 0; i < n; i++) v[i] = amp * Math.sin(2 * Math.PI * 1000 * i / fs);
  const r = sonie([v], fs);
  // puissance d'un sinus = amp²/2 → −23,01 dB ; le −0,691 de la formule
  // compense le +0,69 dB du filtre K à 1 kHz : la norme veut −3,01 à 0 dBFS
  assert.ok(Math.abs(r.lufs - (-23.0)) < 0.1, `mesuré ${r.lufs.toFixed(2)}`);
  assert.ok(Math.abs(r.crete - (-20)) < 0.05, `crête ${r.crete}`);
});

test('le même sinus en stéréo (deux voies identiques) : +3 dB', () => {
  const fs = 44100; const n = fs * 2; const v = new Float32Array(n);
  for (let i = 0; i < n; i++) v[i] = 0.1 * Math.sin(2 * Math.PI * 1000 * i / fs);
  const mono = sonie([v], fs).lufs; const stereo = sonie([v, v], fs).lufs;
  assert.ok(Math.abs(stereo - mono - 3.01) < 0.05, `écart ${(stereo - mono).toFixed(2)}`);
});

test('le silence n\'a pas de sonie (null), ni de crête', () => {
  const r = sonie([new Float32Array(48000)], 48000);
  assert.equal(r.lufs, null); assert.equal(r.blocs, 0);
});

test('la porte relative ignore les creux : un sinus par intermittence garde la sonie du sinus', () => {
  const fs = 48000; const v = new Float32Array(fs * 4);
  for (let i = 0; i < v.length; i++) v[i] = (Math.floor(i / fs) % 2 === 0) ? 0.1 * Math.sin(2 * Math.PI * 500 * i / fs) : 0;
  const plein = new Float32Array(fs * 2);
  for (let i = 0; i < plein.length; i++) plein[i] = 0.1 * Math.sin(2 * Math.PI * 500 * i / fs);
  const a = sonie([v], fs).lufs; const b = sonie([plein], fs).lufs;
  // sans porte, moitié de silence ferait −3 dB ; avec, seuls les blocs à
  // cheval sur une transition pèsent (à 1 s de période : un peu moins d'1 LU)
  assert.ok(b - a > 0 && b - a < 1.5, `intermittent ${a.toFixed(2)} contre plein ${b.toFixed(2)}`);
});

test('les filtres K existent pour 22 050, 44 100 et 48 000 Hz, stables (pôles dans le cercle)', () => {
  for (const fs of [22050, 44100, 48000]) {
    for (const f of filtreK(fs)) {
      const [, a1, a2] = f.a;
      assert.ok(Math.abs(a2) < 1 && Math.abs(a1) < 1 + a2, `instable à ${fs}`);
    }
  }
});

test('niveau effectif et gain pour une cible : l\'un est l\'inverse de l\'autre', () => {
  assert.equal(niveauEffectif(-20, 1, 1), -20);
  assert.ok(Math.abs(niveauEffectif(-20, 0.5, 1) - (-26.02)) < 0.01);
  assert.ok(Math.abs(niveauEffectif(-20, 0.5, 0.5) - (-32.04)) < 0.01);
  assert.equal(niveauEffectif(null, 1, 1), null);
  assert.equal(niveauEffectif(-20, 0, 1), null);
  assert.equal(gainPourCible(-26, -20, 1), 2);           // +6 dB = ×2 (borne 2 atteinte pile)
  assert.equal(gainPourCible(-14, -20, 1), 0.5);         // −6 dB
  assert.equal(gainPourCible(-14, -20, 0.5), 1);         // l'œuvre à 0,5 fait la moitié du travail
  assert.equal(gainPourCible(-50, -20, 1), 2);           // borné : la piste est trop faible pour un gain
  assert.equal(gainPourCible(null, -20), null);
  // au pas d'un curseur (0,05) : le document et le curseur disent le même chiffre
  assert.equal(gainPourCible(-17.2, -18, 0.85, 2, 0.05), 1.05);   // 1,073 → 1,05
  assert.equal(gainPourCible(-17.2, -18, 0.85, 2, 0.01), 1.07);
});

console.log(`\n${ok} ✓ / ${ko} ✗`);
process.exit(ko ? 1 : 0);

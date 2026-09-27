/**
 * LE CONTRÔLE DES BOUCLES ENCODÉES — l'original contre ses formats.
 *
 * Pour chaque piste dont la fiche porte `formats`, on décode l'original et
 * chaque format en PCM (ffmpeg, comme le ferait le navigateur, amorces
 * retirées), puis on mesure (engine/src/core/boucle-regles.js) :
 *   • le DÉCALAGE entre le format et l'original ;
 *   • le SAUT AU RACCORD de la boucle, dans l'original et dans le format.
 * Un format décalé ou qui claque au raccord fait rougir le script : on
 * corrige les bornes (`debut` / `fin`) ou l'on garde l'original.
 *
 * Exige ffmpeg (variable FFMPEG, ou dans le PATH). Manuel : pas dans la
 * suite `npm test`, qui n'a pas ffmpeg en CI.
 *
 *   node scripts/controle-boucles.mjs            toutes les pistes à formats
 *   node scripts/controle-boucles.mjs marees     celles dont le nom contient un mot
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sautRaccord, decalage, jugerFormat } from '../engine/src/core/boucle-regles.js';
import { bornesLecture } from '../engine/src/core/son-bornes.js';

const ICI = dirname(fileURLToPath(import.meta.url));
const CONTENU = join(ICI, '..', 'content');
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FREQ = 48000;
const filtres = process.argv.slice(2);

/** Un fichier son → Float32Array mono à FREQ Hz, amorces du codec retirées. */
function decoder(chemin) {
  const brut = execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-i', chemin, '-f', 'f32le', '-ac', '1', '-ar', String(FREQ), '-'],
    { maxBuffer: 512 * 1024 * 1024 });
  return new Float32Array(brut.buffer, brut.byteOffset, Math.floor(brut.byteLength / 4));
}

const oeuvres = readdirSync(join(CONTENU, 'works')).filter((f) => f.endsWith('.json') && f !== 'index.json');
const vus = new Set();
let ko = 0, n = 0;
for (const nom of oeuvres) {
  if (filtres.length && !filtres.some((m) => nom.includes(m))) continue;
  const oeuvre = JSON.parse(readFileSync(join(CONTENU, 'works', nom), 'utf8'));
  for (const stem of oeuvre.stems ?? []) {
    if (!stem.formats || vus.has(stem.file)) continue;
    vus.add(stem.file);
    const original = decoder(join(CONTENU, stem.file));
    const bornes = bornesLecture(stem, original.length / FREQ);
    const d = Math.round(bornes.debut * FREQ), f = Math.round(bornes.fin * FREQ);
    const rO = sautRaccord(original, d, f);
    console.log(`\n${stem.file} — ${(original.length / FREQ).toFixed(2)} s, boucle [${bornes.debut}, ${bornes.fin.toFixed(2)}] s, raccord ${rO.rapport.toFixed(1)}× le pas`);
    for (const [cle, rel] of Object.entries(stem.formats)) {
      n++;
      const chemin = join(CONTENU, rel);
      if (!existsSync(chemin)) { ko++; console.log(`   ✗ ${cle} : ${rel} absent`); continue; }
      const enc = decoder(chemin);
      const { lag, correlation } = decalage(original, enc);
      const fE = Math.min(enc.length, f);
      const rF = sautRaccord(enc, d, fE);
      const verdict = jugerFormat({ lag, rapportOriginal: rO.rapport, rapportFormat: rF.rapport });
      const duree = ((enc.length - original.length) / FREQ * 1000).toFixed(1);
      console.log(`   ${verdict.ok ? '✓' : '✗'} ${cle.padEnd(4)} décalage ${String(lag).padStart(5)} éch. (corr. ${correlation.toFixed(3)}), durée ${duree >= 0 ? '+' : ''}${duree} ms, raccord ${rF.rapport.toFixed(1)}×${verdict.ok ? '' : ` — ${verdict.raisons.join(' ; ')}`}`);
      if (!verdict.ok) ko++;
    }
  }
}
console.log(`\n${n - ko} ✓  ${ko} ✗  (${n} formats)`);
process.exit(ko ? 1 : 0);

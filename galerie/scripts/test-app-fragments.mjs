/**
 * LA FRAGMENTATION AUTOMATIQUE de l'application (app/fragments-auto.cjs) :
 * le plan de découpe (le même que fragments.js et fragmente-sons.py), le
 * choix des pistes longues, les chemins et le manifeste, la recherche de
 * ffmpeg sur ses candidats, puis une fragmentation complète sur un dossier
 * temporaire avec un encodeur factice — segments écrits, manifeste, et
 * l'idempotence (rien n'est refait quand tout est plus récent que la source).
 *
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, existsSync, readFileSync, readdirSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep, delimiter } from 'node:path';

const require = createRequire(import.meta.url);
const F = require('../app/fragments-auto.cjs');

let ok = 0; let ko = 0;
async function test(nom, fn) {
  try { await fn(); ok++; console.log(`  ✓ ${nom}`); } catch (e) { ko++; console.log(`  ✗ ${nom}\n    ${e.message}`); }
}

console.log('\nle plan de découpe');
await test('dix secondes plus le chevauchement, le dernier segment tronqué — comme le script Python', () => {
  const p = F.planFragments(25, 10, 0.1);
  assert.deepEqual(p, [{ i: 0, debut: 0, longueur: 10.1 }, { i: 1, debut: 10, longueur: 10.1 }, { i: 2, debut: 20, longueur: 5 }]);
  assert.equal(F.planFragments(30, 10, 0.1).length, 3, 'une durée multiple exacte : pas de segment vide');
  assert.deepEqual(F.planFragments(0), []);
  assert.deepEqual(F.planFragments(NaN), []);
});

console.log('\nquelles pistes fragmenter');
await test('un mégaoctet ou une minute ; jamais une piste déjà fragmentée ni un format inconnu', () => {
  assert.equal(F.aFragmenter({ file: 'assets/a.mp3', octets: 3 * 1048576, duree: 30 }), '3.0 Mo');
  assert.equal(F.aFragmenter({ file: 'assets/a.wav', octets: 100, duree: 90 }), '90 s');
  assert.equal(F.aFragmenter({ file: 'assets/a.mp3', octets: 100, duree: 20 }), null);
  assert.equal(F.aFragmenter({ file: 'assets/a.mp3', fragments: 'assets/a.fragments.json', octets: 9e6, duree: 900 }), null);
  assert.equal(F.aFragmenter({ file: 'assets/a.mid', octets: 9e6, duree: 900 }), null);
  // un chemin de piste reste SOUS le dossier de contenu : la seule porte
  // d'écriture qui ne passe pas par dossiers.cjs
  const contenu = '/galerie/content';
  assert.equal(F.sousLeContenu(contenu, 'assets/a.mp3'), '/galerie/content/assets/a.mp3');
  for (const mauvais of ['../../Music/perso.mp3', 'assets/../../x.mp3', '/etc/passwd', 'assets/a\0.mp3', '', 'assets\\..\\..\\x.mp3']) {
    assert.equal(F.sousLeContenu(contenu, mauvais), null, `refusé : ${JSON.stringify(mauvais)}`);
  }
});

await test('les chemins et le manifeste : à côté de la source, le motif {i}', () => {
  assert.deepEqual(F.cheminsDe('assets/freesound/x.mp3'), { dossier: 'assets/freesound/x.frag', manifeste: 'assets/freesound/x.fragments.json' });
  const m = F.manifeste(342.5004, 35, 'assets/x.frag');
  assert.deepEqual(m, { version: 1, duree: 342.5, segment: 10, chevauchement: 0.1, n: 35, formats: { webm: 'assets/x.frag/{i}.webm', m4a: 'assets/x.frag/{i}.m4a' } });
});

console.log('\ntrouver ffmpeg');
await test('FFMPEG d’abord, puis le PATH, puis Homebrew — une application du Finder n’a pas le PATH du terminal', () => {
  // les candidats du PATH se composent avec le séparateur de la machine qui teste (Windows : « \\ » et « ; »)
  const outils = join('/usr/bin', 'tools');
  const dansOutils = join(outils, 'ffmpeg');
  const existe = (p) => ['/opt/homebrew/bin/ffmpeg', dansOutils, '/x/ff'].includes(p);
  assert.equal(F.trouverBinaire({ env: { FFMPEG: '/x/ff', PATH: outils }, existe, plateforme: 'darwin' }), '/x/ff');
  assert.equal(F.trouverBinaire({ env: { PATH: [outils, '/nulle/part'].join(delimiter) }, existe, plateforme: 'darwin' }), dansOutils);
  assert.equal(F.trouverBinaire({ env: { PATH: '/nulle/part' }, existe, plateforme: 'darwin' }), '/opt/homebrew/bin/ffmpeg');
  assert.equal(F.trouverBinaire({ env: { PATH: '' }, existe: () => false, plateforme: 'linux' }), null);
  assert.match(F.CONSEIL, /brew install ffmpeg/);
});

console.log('\nfragmenter, avec un encodeur factice');
await test('segments et manifeste écrits, la piste renvoyée ; puis rien n’est refait', async () => {
  const contenu = mkdtempSync(join(tmpdir(), 'galerie-frag-'));
  writeFileSync(join(contenu, 'assets'), '');   // un fichier « assets » ferait échouer mkdir : on le retire
  const { rmSync, mkdirSync } = await import('node:fs');
  rmSync(join(contenu, 'assets'));
  mkdirSync(join(contenu, 'assets'));
  writeFileSync(join(contenu, 'assets', 'nappe.mp3'), Buffer.alloc(2 * 1048576));
  const appels = [];
  // les chemins relatifs sont comparés avec des barres obliques : Windows sépare par des barres inverses
  const encoder = async (ff, source, debut, longueur, cible) => { appels.push({ debut, longueur, cible: cible.slice(contenu.length + 1).split(sep).join('/') }); writeFileSync(cible, 'x'); };
  const progres = [];
  const r = await F.fragmenterLot({ contenu, pistes: [{ file: 'assets/nappe.mp3', duree: 25 }, { file: 'assets/court.mp3', duree: 3 }],
    ff: '/faux/ffmpeg', encoder, surProgres: (p) => progres.push(p) });
  assert.equal(r.faits.length, 1);
  assert.deepEqual(r.faits[0], { file: 'assets/nappe.mp3', manifeste: 'assets/nappe.fragments.json', n: 3, duree: 25, refait: true });
  assert.equal(r.ignorees, 1, 'la piste absente du disque est ignorée');
  assert.equal(appels.length, 6, 'trois segments, deux formats');
  assert.deepEqual(appels.slice(0, 2).map((a) => a.cible), ['assets/nappe.frag/000.webm', 'assets/nappe.frag/000.m4a']);
  assert.equal(appels[4].longueur, 5);
  assert.deepEqual(readdirSync(join(contenu, 'assets', 'nappe.frag')).sort(), ['000.m4a', '000.webm', '001.m4a', '001.webm', '002.m4a', '002.webm']);
  const m = JSON.parse(readFileSync(join(contenu, 'assets', 'nappe.fragments.json'), 'utf8'));
  assert.equal(m.n, 3);
  assert.equal(m.formats.webm, 'assets/nappe.frag/{i}.webm');
  assert.equal(progres.at(-1).fait, 3);
  // idempotent : segments et manifeste plus récents que la source
  const r2 = await F.fragmenterLot({ contenu, pistes: [{ file: 'assets/nappe.mp3', duree: 25 }], ff: '/faux/ffmpeg', encoder });
  assert.equal(r2.faits[0].refait, false);
  assert.equal(appels.length, 6, 'rien n’a été réencodé');
  // la source rajeunie : tout est refait
  const t = new Date(Date.now() + 5000);
  utimesSync(join(contenu, 'assets', 'nappe.mp3'), t, t);
  const r3 = await F.fragmenterLot({ contenu, pistes: [{ file: 'assets/nappe.mp3', duree: 25 }], ff: '/faux/ffmpeg', encoder });
  assert.equal(r3.faits[0].refait, true);
  assert.equal(appels.length, 12);
  assert.ok(existsSync(join(contenu, 'assets', 'nappe.fragments.json')));
});

await test('sans ffmpeg : rien n’est fait, les pistes à faire sont nommées avec le conseil', async () => {
  const contenu = mkdtempSync(join(tmpdir(), 'galerie-frag-'));
  const { mkdirSync } = await import('node:fs');
  mkdirSync(join(contenu, 'assets'));
  writeFileSync(join(contenu, 'assets', 'longue.wav'), Buffer.alloc(1048576));
  const r = await F.fragmenterLot({ contenu, pistes: [{ file: 'assets/longue.wav', duree: 10 }], ff: null });
  assert.equal(r.ffmpeg, false);
  assert.deepEqual(r.aFaire, ['assets/longue.wav']);
  assert.match(r.conseil, /ffmpeg/);
  assert.equal(r.faits.length, 0);
});

console.log(`\n${ok} ✓ / ${ko} ✗`);
process.exit(ko ? 1 : 0);

/**
 * LES MATIÈRES ET LES ENVIRONNEMENTS — la provenance, éprouvée.
 *
 * Les fichiers de `engine/assets/` sont RAPATRIÉS (three.js r166 en MIT,
 * `@pmndrs/assets` en CC0) puis transformés — et un fichier rapatrié est un
 * fichier qu'on peut corrompre sans s'en apercevoir : remplacé à la main,
 * régénéré depuis une autre source, tronqué par un mauvais commit. Ce test
 * compare donc chaque fichier à l'empreinte SHA-256 relevée au moment du
 * rapatriement (`provenance.json`), et vérifie que ce que le moteur déclare
 * (styles, pièces du contenu) pointe vers des fichiers qui existent.
 *
 * Il ne teste PAS le rendu — le relief d'un parquet se juge au navigateur
 * et à l'œil ; ici on garantit seulement que ce qui est branché est bien ce
 * qui a été vérifié, licence comprise.
 *
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let ok = 0, ko = 0;
const test = (nom, fn) => {
  try { fn(); ok++; console.log(`  ✓ ${nom}`); }
  catch (e) { ko++; console.log(`  ✗ ${nom}\n    ${e.message}`); }
};
const titre = (t) => console.log(`\n${t}`);

const ici = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(ici, '..', 'engine', 'assets');
const provenance = JSON.parse(readFileSync(join(ASSETS, 'provenance.json'), 'utf8'));

titre('chaque fichier rapatrié est exactement celui qui a été vérifié');
for (const [chemin, attendu] of Object.entries(provenance)) {
  test(chemin, () => {
    const fichier = join(ASSETS, chemin);
    assert.ok(existsSync(fichier), 'fichier absent');
    const octets = readFileSync(fichier);
    assert.equal(octets.length, attendu.octets, 'taille différente');
    assert.equal(createHash('sha256').update(octets).digest('hex'),
      attendu.sha256, 'empreinte différente : relancer rapatrie-matieres.mjs'
      + ' ou expliquer le changement');
  });
}
test('et la provenance dit d’où vient chaque fichier', () => {
  for (const [chemin, e] of Object.entries(provenance)) {
    assert.ok(/^https:\/\/raw\.githubusercontent\.com\/mrdoob\/three\.js\/r166\//
      .test(e.source) || /^npm:@pmndrs\/assets\//.test(e.source),
    `source inattendue pour ${chemin} : ${e.source}`);
  }
});
test('aucun fichier orphelin dans les assets', () => {
  // un binaire qui n'est pas dans la provenance est un binaire sans licence
  // tracée — il n'a rien à faire dans le dépôt
  const listes = new Set(Object.keys(provenance));
  for (const dossier of ['matieres', 'environnements']) {
    for (const f of readdirSync(join(ASSETS, dossier))) {
      assert.ok(listes.has(`${dossier}/${f}`), `orphelin : ${dossier}/${f}`);
    }
  }
});

titre('ce que le moteur déclare existe');
test('les deux matières ont leurs trois cartes', () => {
  const src = readFileSync(join(ici, '..', 'engine', 'src', 'core', 'textures.js'), 'utf8');
  for (const style of ['bois', "'brique-vraie'"]) {
    assert.ok(src.includes(style), `style ${style} absent de textures.js`);
  }
  for (const carte of ['matiere', 'relief', 'rugosite']) {
    for (const m of ['bois', 'brique']) {
      assert.ok(existsSync(join(ASSETS, 'matieres', `${m}-${carte}.jpg`)),
        `${m}-${carte}.jpg manquant`);
    }
  }
});
test('RoomManager branche bien les matières, sol et murs', () => {
  const src = readFileSync(join(ici, '..', 'engine', 'src', 'core', 'RoomManager.js'), 'utf8');
  assert.ok((src.match(/styleMatiere\(/g) ?? []).length >= 2,
    'styleMatiere doit servir au sol ET aux murs');
  assert.ok(src.includes('bumpMap'), 'le relief n’est pas branché');
  assert.ok(src.includes('roughnessMap'), 'la rugosité n’est pas branchée');
});
test('les environnements déclarés pointent vers des fichiers du dépôt', () => {
  const src = readFileSync(join(ici, '..', 'engine', 'src', 'core',
    'environnements.js'), 'utf8');
  for (const nom of ['aube', 'appartement']) {
    assert.ok(src.includes(`${nom}.exr`), `${nom} absent`);
    assert.ok(existsSync(join(ASSETS, 'environnements', `${nom}.exr`)));
  }
  assert.ok(src.includes("studio: null"), 'le studio doit rester le défaut');
});
test('les pièces du contenu n’utilisent que des styles connus', () => {
  const connus = new Set(['pierre', 'brique', 'planches', 'dalles', 'herbe',
    'sable', 'ratisse', 'eau', 'bois', 'brique-vraie']);
  const salles = join(ici, '..', 'content', 'rooms');
  if (!existsSync(salles)) { console.log('    (pas de contenu — sauté)'); return; }
  for (const f of readdirSync(salles).filter((n) => n.endsWith('.json'))) {
    const j = JSON.parse(readFileSync(join(salles, f), 'utf8'));
    for (const t of [j.floor?.texture, j.shell?.texture]) {
      if (t) assert.ok(connus.has(t), `${f} : style inconnu « ${t} »`);
    }
  }
});
test('le poids total des assets reste sous le mégot', () => {
  // un demi-mégaoctet d'assets pour deux matières et deux panoramas : c'est
  // le budget. Si un rapatriement le crève, il doit se justifier ici.
  let total = 0;
  for (const e of Object.values(provenance)) total += e.octets;
  assert.ok(total < 800 * 1024, `${(total / 1024).toFixed(0)} ko`);
});

console.log(`\n${ok} ✓ / ${ko} ✗`);
process.exit(ko ? 1 : 0);

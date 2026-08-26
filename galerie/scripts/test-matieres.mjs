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
const SRC_TEXTURES = readFileSync(
  join(ici, '..', 'engine', 'src', 'core', 'textures.js'), 'utf8');
const SRC_MATIERES = readFileSync(
  join(ici, '..', 'engine', 'src', 'core', 'matieres.js'), 'utf8');
// les deux modules ensemble : les tests qui parlent « du moteur des
// matières » cherchent dans l'un OU l'autre
const SRC_MAT2 = SRC_TEXTURES + SRC_MATIERES;
const SRC_ROOMS = readFileSync(
  join(ici, '..', 'engine', 'src', 'core', 'RoomManager.js'), 'utf8');

test('les quatre matières ont leurs cartes', () => {
  for (const style of ['bois', "'brique-vraie'", 'damier', "'herbe-vraie'"]) {
    assert.ok(SRC_MAT2.includes(style), `style ${style} absent`);
  }
  // bois et brique : albédo + relief + rugosité ; damier et herbe : albédo +
  // carte NORMALE (elles n'ont pas de jeu de rugosité en amont)
  for (const m of ['bois', 'brique']) {
    for (const carte of ['matiere', 'relief', 'rugosite']) {
      assert.ok(existsSync(join(ASSETS, 'matieres', `${m}-${carte}.jpg`)),
        `${m}-${carte}.jpg manquant`);
    }
  }
  for (const m of ['damier', 'herbe']) {
    for (const carte of ['matiere', 'normale']) {
      assert.ok(existsSync(join(ASSETS, 'matieres', `${m}-${carte}.jpg`)),
        `${m}-${carte}.jpg manquant`);
    }
  }
});
test('l’albédo est lu en sRGB, les cartes de données non', () => {
  // LA LEÇON QUI A DÉLAVÉ LES PARQUETS. Une photographie est encodée en
  // sRGB ; la lire comme linéaire l'éclaircit d'environ 1,8 et la couleur
  // déclarée par la pièce perd toute autorité — un brun sombre ressortait
  // en ciment. Relief, rugosité et normale sont des DONNÉES : elles
  // restent hors de tout espace colorimétrique.
  assert.ok(SRC_MATIERES.includes('SRGBColorSpace'),
    'l’albédo d’une matière doit être déclaré en sRGB');
  assert.match(SRC_MATIERES, /map: chargerCarte\(m\.matiere, m\.metres, true\)/,
    'seul l’albédo passe `true` à chargerCarte');
  for (const carte of ['m.relief', 'm.rugosite', 'm.normale']) {
    assert.ok(!new RegExp(`chargerCarte\\(${carte.replace('.', '\\.')}[^)]*true`)
      .test(SRC_MATIERES), `${carte} ne doit pas être traitée comme une couleur`);
  }
});
test('RoomManager branche bien les matières, sol et murs', () => {
  assert.ok((SRC_ROOMS.match(/styleMatiere\(/g) ?? []).length >= 2,
    'styleMatiere doit servir au sol ET aux murs');
  assert.ok(SRC_ROOMS.includes('bumpMap'), 'le relief n’est pas branché');
  assert.ok(SRC_ROOMS.includes('roughnessMap'), 'la rugosité n’est pas branchée');
  assert.ok(SRC_ROOMS.includes('normalMap'), 'les cartes normales ne sont pas branchées');
});
test('une tuile procédurale sert de relief à elle-même', () => {
  // sans cela, un mur « planches » restait une couleur plate à côté d'un sol
  // photographique : c'est l'incohérence qui se voyait à la jonction
  assert.match(SRC_ROOMS, /bumpMap: matiere \? matiere\.bumpMap : map/,
    'le sol doit se servir de sa tuile comme bump');
  assert.match(SRC_ROOMS, /bumpMap: wallMatiere \? wallMatiere\.bumpMap : wallMap/,
    'les murs doivent se servir de leur tuile comme bump');
});
test('la grille ne se pose pas d’elle-même sur une matière', () => {
  // deux trames sans rapport se croisaient sur le parquet : la grille est un
  // repère de plan VIDE. Une pièce peut toujours la demander explicitement.
  assert.ok(SRC_ROOMS.includes('grilleVoulue'), 'la règle a disparu');
  assert.match(SRC_ROOMS, /opt\.grid && !matiere/,
    'le défaut « grille » ne doit plus valoir en présence d’une matière');
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
    'sable', 'ratisse', 'eau', 'bois', 'brique-vraie', 'damier', 'herbe-vraie']);
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
  // Le budget : quatre matières et deux panoramas, un mégaoctet. Il est
  // passé de 800 ko à ce chiffre quand le damier et l'herbe sont arrivés —
  // et les cartes NORMALES ont été ramenées à 256 texels pour tenir : à
  // 512, l'herbe pesait 261 ko à elle seule, plus que la photo qu'elle
  // accompagne. Rien de tout cela ne pèse au démarrage : une matière n'est
  // téléchargée que par la pièce qui la demande.
  let total = 0;
  for (const e of Object.values(provenance)) total += e.octets;
  assert.ok(total < 1024 * 1024, `${(total / 1024).toFixed(0)} ko`);
});
test('une carte normale ne pèse pas plus que son albédo', () => {
  for (const m of ['damier', 'herbe']) {
    const alb = provenance[`matieres/${m}-matiere.jpg`].octets;
    const nor = provenance[`matieres/${m}-normale.jpg`].octets;
    assert.ok(nor <= alb, `${m} : normale ${nor} > albédo ${alb}`);
  }
});


titre('les objets ont une surface, pas un aplat');
const SRC_PRIM = readFileSync(
  join(ici, '..', 'engine', 'src', 'core', 'primitives.js'), 'utf8');
const SRC_VOX = readFileSync(
  join(ici, '..', 'engine', 'src', 'core', 'voxel.js'), 'utf8');
const SRC_ART = readFileSync(
  join(ici, '..', 'engine', 'src', 'core', 'Artwork.js'), 'utf8');

test('les trois styles d’objet existent, avec leur surface', () => {
  for (const style of ['metal', 'poli', "'bois-use'"]) {
    assert.ok(SRC_TEXTURES.includes(style), `style ${style} absent`);
  }
  assert.ok(SRC_TEXTURES.includes('export const SURFACES'),
    'SURFACES dit ce qu’une matière fait à la LUMIÈRE — relief, rugosité, métal');
});
test('un seul robinet sert le sol, les murs ET les objets', () => {
  assert.ok(SRC_MATIERES.includes('export function jeuDeSurface'));
  assert.ok(SRC_PRIM.includes('jeuDeSurface('),
    'les primitives doivent passer par le même robinet que les murs');
  assert.ok(!SRC_PRIM.includes('styleTexture('),
    'plus d’albédo seul : une primitive reçoit son relief avec sa carte');
});
test('les UV d’une primitive sont à l’échelle du MONDE, échelle comprise', () => {
  // sans cela, les briques d'une stèle de quatre mètres étaient quatre fois
  // plus grosses que celles du mur derrière elle — et un rayonnage étiré
  // sept fois en hauteur portait des veines sept fois trop longues
  assert.ok(SRC_TEXTURES.includes('export function scaleObjetUV'));
  assert.ok(SRC_PRIM.includes('scaleObjetUV(geometry, jeu.metres, echelleObjet)'),
    'l’échelle de l’œuvre doit entrer dans le calcul des UV');
  assert.ok(SRC_ART.includes('buildPrimitive(cfg.model, cfg.scale)'),
    'Artwork doit transmettre l’échelle à la primitive');
});
test('sans style déclaré, une primitive reçoit tout de même un grain', () => {
  assert.ok(/model\.texture \?\? 'poli'/.test(SRC_PRIM),
    'quatre-vingts objets du contenu n’ont pas de texture : l’aplat parfait '
    + 'est précisément ce qui les faisait lire comme du plastique');
  assert.ok(SRC_PRIM.includes("=== 'aucune'"),
    '« aucune » doit rendre l’aplat à qui le veut');
});
test('le voxel reçoit son grain en espace MONDE (triplanaire)', () => {
  // une construction voxel est faite de pavés instanciés : leurs UV vont de
  // zéro à un quelle que soit leur taille, donc aucune texture ordinaire
  // n’y garde une échelle physique — c’est ce qui laissait tout le
  // belvédère en aplats
  assert.ok(SRC_TEXTURES.includes('export function patcherGrain'));
  assert.ok(SRC_VOX.includes('patcherGrain(material'), 'le voxel n’a pas de grain');
});
test('le relief du grain passe par les DÉRIVÉES, pas par des échantillons', () => {
  // quatre échantillonnages décalés coûtaient douze lectures de texture par
  // pixel ; la méthode de Mikkelsen (celle du bump de three.js) n’en coûte
  // aucune de plus
  assert.ok(SRC_TEXTURES.includes('dFdx(grainH)'));
  assert.ok(!SRC_TEXTURES.includes('grainEn(vGrainPos + vec3('),
    'les échantillons décalés ne doivent pas revenir');
});
test('l’huisserie est d’une seule main : portails, baies, cadres', () => {
  assert.ok((SRC_ROOMS.match(/jeuDeSurface\('metal'\)/g) ?? []).length >= 2,
    'chambranles de portail ET dormants de baie');
  assert.ok(SRC_ART.includes("jeuDeSurface('metal')"), 'cadres d’œuvre');
});
test('le contenu nomme la matière de son mobilier', () => {
  // le moteur donne un grain par défaut ; c'est le CONTENU qui dit qu'un
  // rayonnage est en bois et une lanterne en métal
  const dossier = join(ici, '..', 'content', 'works');
  if (!existsSync(dossier)) { console.log('    (pas de contenu — sauté)'); return; }
  let bois = 0, metal = 0;
  for (const f of readdirSync(dossier).filter((n) => n.endsWith('.json'))) {
    if (f === 'index.json') continue;
    const w = JSON.parse(readFileSync(join(dossier, f), 'utf8'));
    const t = w.model?.texture;
    if (t === 'bois-use') bois++;
    if (t === 'metal') metal++;
  }
  assert.ok(bois >= 5, `${bois} objets en bois`);
  assert.ok(metal >= 20, `${metal} objets en métal`);
});


titre('le montage reste éprouvable au nœud');
test('textures.js ne dépend d’AUCUN fichier d’asset', () => {
  // les imports .jpg ne se résolvent qu'au bundler : les laisser dans
  // textures.js rendait voxel.js — et donc test-voxel — inexécutable par
  // node. La leçon est la même que celle du `?raw` qui avait fait taire
  // treize suites sans que rien ne rougisse.
  assert.ok(!/from '\.\.\/\.\.\/assets\//.test(SRC_TEXTURES),
    'textures.js doit rester du code pur');
  assert.ok(/from '\.\.\/\.\.\/assets\//.test(SRC_MATIERES),
    'les photographies vivent dans matieres.js');
});
test('les modules du cœur testés au nœud restent importables', async () => {
  // le test est le contrat : si un import bundler-only revient dans
  // voxel.js, cette ligne échoue avant que la suite voxel ne se taise
  const vox = readFileSync(join(ici, '..', 'engine', 'src', 'core',
    'voxel.js'), 'utf8');
  for (const m of vox.matchAll(/from '(\.[^']+)'/g)) {
    assert.ok(!m[1].includes('/assets/') && !m[1].includes('matieres'),
      `voxel.js ne doit pas dépendre de ${m[1]}`);
  }
});

console.log(`\n${ok} ✓ / ${ko} ✗`);
process.exit(ko ? 1 : 0);

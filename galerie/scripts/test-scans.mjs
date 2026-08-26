/**
 * LES SCANS — le type d'œuvre « splat gaussien », éprouvé au nœud.
 *
 * Le rendu (tri des taches, shaders de la bibliothèque) se juge au
 * navigateur ; ce qui s'éprouve ici est ce qui NE DOIT PAS dériver :
 *
 *   1. le fichier de démonstration est EXACTEMENT ce que son générateur
 *      produit — régénéré et comparé octet à octet, comme le lettrage ;
 *   2. son format est sain : 32 octets par tache, positions bornées,
 *      quaternions identité (nos taches sont isotropes), alphas doux —
 *      c'est le contrat de lecture de GaussianSplats3D ;
 *   3. le contenu qui le référence est cohérent : l'œuvre existe, la pièce
 *      la liste, l'index du combineur la connaît (l'oubli de CET index a
 *      déjà fait une œuvre fantôme — présente dans le dossier, absente du
 *      build) ;
 *   4. le moteur a bien sa branche : Artwork traite `scan` AVANT tout le
 *      reste, et par un import DYNAMIQUE (la bibliothèque reste dans son
 *      propre morceau).
 *
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { genererOnde } from './genere-scan-demo.mjs';

let ok = 0, ko = 0;
const test = (nom, fn) => {
  try { fn(); ok++; console.log(`  ✓ ${nom}`); }
  catch (e) { ko++; console.log(`  ✗ ${nom}\n    ${e.message}`); }
};
const titre = (t) => console.log(`\n${t}`);

const ici = dirname(fileURLToPath(import.meta.url));
const SPLAT = join(ici, '..', 'content', 'assets', 'scans', 'onde-stationnaire.splat');

titre('le fichier de démonstration dit la vérité');
test('régénérer rend EXACTEMENT le fichier commité', () => {
  const commite = readFileSync(SPLAT);
  const regenere = genererOnde();
  assert.equal(commite.length, regenere.length, 'taille différente');
  assert.ok(commite.equals(regenere),
    'onde-stationnaire.splat diverge : relancer genere-scan-demo.mjs');
});
test('le format est celui que la bibliothèque lit', () => {
  const b = readFileSync(SPLAT);
  assert.equal(b.length % 32, 0, 'pas un multiple de 32 octets');
  const n = b.length / 32;
  assert.ok(n > 10000 && n < 50000, `${n} taches`);
  for (let i = 0; i < n; i += 997) {          // un échantillon suffit
    const o = i * 32;
    for (let k = 0; k < 3; k++) {
      const p = b.readFloatLE(o + (k * 4));
      assert.ok(Number.isFinite(p) && Math.abs(p) < 5, `position ${p}`);
      const s = b.readFloatLE(o + 12 + (k * 4));
      assert.ok(s > 0 && s < 0.2, `échelle ${s}`);
    }
    // isotrope → quaternion identité recentré : (255, 128, 128, 128)
    assert.equal(b.readUInt8(o + 28), 255);
    assert.equal(b.readUInt8(o + 29), 128);
  }
});
test('les taches restent SOMBRES — leur couleur est de la lumière', () => {
  // une première version rendait un dôme blanc : des milliers de taches
  // émissives s'accumulent, et le bloom fait le reste. On borne la
  // luminance moyenne pour que la leçon soit un test, pas un souvenir.
  const b = readFileSync(SPLAT);
  const n = b.length / 32;
  let somme = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 32;
    somme += ((0.2126 * b.readUInt8(o + 24)) + (0.7152 * b.readUInt8(o + 25))
      + (0.0722 * b.readUInt8(o + 26))) / 255;
  }
  const moyenne = somme / n;
  assert.ok(moyenne < 0.45, `luminance moyenne ${moyenne.toFixed(3)}`);
});

titre('le contenu est cohérent');
test('l’œuvre existe, avec son scan et son pavé de préhension', () => {
  const w = JSON.parse(readFileSync(join(ici, '..', 'content', 'works',
    'onde-stationnaire.json'), 'utf8'));
  assert.equal(w.scan, 'assets/scans/onde-stationnaire.splat');
  assert.ok(existsSync(join(ici, '..', 'content', w.scan)));
  assert.ok(Array.isArray(w.scanTaille) && w.scanTaille.length === 3);
  assert.equal(w.solid, false, 'un nuage de taches ne bloque pas la marche');
});
test('la pièce la liste, et l’index du combineur la connaît', () => {
  const labo = JSON.parse(readFileSync(join(ici, '..', 'content', 'rooms',
    'labo.json'), 'utf8'));
  assert.ok(labo.works.includes('onde-stationnaire'), 'absente du labo');
  const index = JSON.parse(readFileSync(join(ici, '..', 'content', 'works',
    'index.json'), 'utf8'));
  const noms = (Array.isArray(index) ? index : index.works)
    .map((x) => String(x).replace(/\.json$/, ''));
  assert.ok(noms.includes('onde-stationnaire'),
    'absente de works/index.json : le build combiné ne la verrait pas');
});

titre('le moteur a sa branche');
test('Artwork traite « scan », en premier et dynamiquement', () => {
  const src = readFileSync(join(ici, '..', 'engine', 'src', 'core',
    'Artwork.js'), 'utf8');
  assert.ok(src.includes('cfg.scan'), 'pas de branche scan');
  assert.ok(src.includes("import('./scans.js')"),
    'l’import doit rester dynamique — la bibliothèque dans son morceau');
  // on compare les BRANCHES du dispatch, pas les positions globales des
  // chaînes : le cartel d'œuvre mentionne aussi cfg.image, plus haut
  assert.ok(src.indexOf('if (cfg.scan') < src.indexOf('} else if (cfg.image'),
    'scan doit passer avant image');
});
test('scans.js garde les deux choix qui ne se voient pas', () => {
  const src = readFileSync(join(ici, '..', 'engine', 'src', 'core',
    'scans.js'), 'utf8');
  assert.ok(src.includes('sharedMemoryForWorkers: false'),
    'GitHub Pages n’envoie pas les en-têtes COOP/COEP');
  assert.ok(src.includes('prise-scan'), 'le pavé de préhension a disparu');
});
test('rien de ce groupe ne projette d’ombre', () => {
  const src = readFileSync(join(ici, '..', 'engine', 'src', 'core',
    'scans.js'), 'utf8');
  // La passe d’ombre ne lit que `position` : les 21 000 taches s’y écrasent
  // sur le quad d’origine, et le pavé de préhension — invisible — porterait
  // pourtant une ombre carrée bien nette.
  assert.ok(/visionneuse\.traverse\(\(o\) => \{ o\.userData\.sansOmbre = true; \}\)/
    .test(src), 'le nuage doit être exclu du calcul d’ombre');
  assert.ok(src.includes('prise.userData.sansOmbre = true'),
    'le pavé de préhension doit être exclu du calcul d’ombre');
});
test('un scan qui ÉCHOUE redevient visible', () => {
  const src = readFileSync(join(ici, '..', 'engine', 'src', 'core',
    'Artwork.js'), 'utf8');
  // Le scan cache sa silhouette d’attente (le splat arrive sans écran
  // devant). S’il n’arrive jamais, la cacher efface l’œuvre : plus rien à
  // voir, rien à cliquer, aucun signe d’échec.
  // borne de fin cherchée À PARTIR du début du bloc : `_clearMediaError`
  // est aussi APPELÉ plus haut, et un indexOf global rendait une tranche vide
  const debut = src.indexOf('setMediaError(message)');
  const bloc = src.slice(debut, src.indexOf('_clearMediaError()', debut));
  assert.ok(bloc.length > 0, 'bloc setMediaError introuvable');
  assert.ok(bloc.includes('material.visible = true'),
    'l’échec doit rallumer la silhouette');
  assert.ok(src.includes('cfg.scan ?? cfg.image'),
    'le message d’erreur doit nommer le fichier du scan');
});
test('une œuvre de salle VOISINE ne retient pas l’écran d’accueil', () => {
  const src = readFileSync(join(ici, '..', 'engine', 'src', 'core',
    'Artwork.js'), 'utf8');
  assert.ok(src.includes('const essentiel = this.room ? this.room.isCurrent : true'),
    'le préchargement doit se distinguer de la salle d’arrivée');
  // les quatre chargements suivis passent le drapeau
  for (const appel of ['taille: cfg.scanTaille }), essentiel',
    'this._resolve(cfg.image)), essentiel',
    'this._loadModelMesh(cfg.model, essentiel)',
    'engine.load(this._resolve(s.file)), essentiel']) {
    assert.ok(src.includes(appel), `chargement non marqué : ${appel}`);
  }
});
test('la bibliothèque est déclarée, en MIT', () => {
  const p = JSON.parse(readFileSync(join(ici, '..', 'package.json'), 'utf8'));
  assert.ok(p.dependencies['@mkkellogg/gaussian-splats-3d']);
  const lib = JSON.parse(readFileSync(join(ici, '..', 'node_modules',
    '@mkkellogg', 'gaussian-splats-3d', 'package.json'), 'utf8'));
  assert.equal(lib.license, 'MIT');
});

console.log(`\n${ok} ✓ / ${ko} ✗`);
process.exit(ko ? 1 : 0);

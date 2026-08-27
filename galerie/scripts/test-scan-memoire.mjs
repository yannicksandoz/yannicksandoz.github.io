/**
 * LE CONTOURNEMENT DU TRIEUR DE TACHES, ÉPROUVÉ.
 *
 * Un contournement est une dette : il vaut tant que le défaut d'en face
 * existe, et il ment dès que celui-ci est réparé. Ces assertions tiennent
 * les deux bouts — la substitution mord vraiment, ET le paquet installé
 * porte encore le défaut qui la justifie.
 *
 * La première version a payé pour apprendre : elle cherchait
 * « shared: true, » et la production sert « shared:!0 » — le texte du
 * worker vient du bundle MINIFIÉ. D'où deux exigences ici : le motif est
 * confronté à l'orthographe minifiée RELEVÉE dans dist/, et au vrai
 * minifieur (esbuild, celui de Vite) appliqué au vrai code — pas à une
 * imitation écrite à la main.
 *
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';
import { sourceSansPartage, poserContournementScan, SIGNATURE_TRIEUR,
  MOTIF_PARTAGE, UA_FEINTE }
  from '../engine/src/core/scan-memoire.js';

let ok = 0, ko = 0;
const test = (nom, fn) => {
  try { fn(); ok++; console.log(`  ✓ ${nom}`); }
  catch (e) { ko++; console.log(`  ✗ ${nom}\n    ${e.message}`); }
};
const titre = (t) => console.log(`\n${t}`);

const ici = dirname(fileURLToPath(import.meta.url));
const PAQUET = join(ici, '..', 'node_modules', '@mkkellogg', 'gaussian-splats-3d');
const lire = (f) => readFileSync(join(PAQUET, f), 'utf8');

/** Le worker tel que la bibliothèque l'écrit, en réduction fidèle. */
const SOURCE_TRIEUR = `(function (self) { self.onmessage = (e) => {
  if (e.data.init) {
    const imp = { module: {}, env: {
      memory: new WebAssembly.Memory({ initial: 4, maximum: 4, shared: true, })
    } };
    WebAssembly.compile(new Uint8Array(0)).then(() => {
      self.postMessage({ '${SIGNATURE_TRIEUR}': true });
    });
  }
}; })(self)`;

titre('la réécriture du source du worker');
test('l’orthographe du source est réécrite', () => {
  const reecrit = sourceSansPartage(SOURCE_TRIEUR);
  assert.ok(reecrit, 'le trieur doit être reconnu');
  assert.ok(/shared\s*:\s*false/.test(reecrit), 'l’allocation devient non partagée');
  assert.ok(!/shared\s*:\s*true/.test(reecrit));
});
test('l’orthographe MINIFIÉE — celle relevée dans dist/ — est réécrite', () => {
  // le texte exact servi aux visiteurs, copié du bundle construit
  const production = `${SIGNATURE_TRIEUR};`
    + 'ce={module:{},env:{memory:new WebAssembly.Memory({initial:J,maximum:J,shared:!0})}};'
    + 'WebAssembly.compile(B)';
  const reecrit = sourceSansPartage(production);
  assert.ok(reecrit, 'le trieur minifié doit être reconnu');
  assert.ok(reecrit.includes('shared:false'));
  assert.ok(!reecrit.includes('shared:!0'));
});
test('le VRAI minifieur ne fait pas mentir le motif', () => {
  // on minifie le vrai source avec l'esbuild de Vite : quelle que soit
  // l'orthographe qu'il choisit, le motif doit la couvrir
  const { code } = transformSync(SOURCE_TRIEUR, { minify: true });
  assert.ok(code.includes(SIGNATURE_TRIEUR), 'la signature survit à la minification');
  const reecrit = sourceSansPartage(code);
  assert.ok(reecrit, `le motif ne couvre pas l'orthographe d'esbuild : ${
    (code.match(/.{0,24}shared.{0,12}/) ?? ['?'])[0]}`);
  assert.ok(!/([{,(]\s*shared\s*:\s*)(!0|true)\b/.test(reecrit));
});
test('un autre worker n’est jamais touché', () => {
  assert.equal(sourceSansPartage('self.onmessage = () => {};'), null);
  // même une mémoire partagée, si ce n'est pas le trieur : ce n'est pas
  // notre affaire, et réécrire au hasard casserait un jour autre chose
  assert.equal(sourceSansPartage(
    'new WebAssembly.Memory({ shared: true })'), null);
});
test('un trieur déjà réparé n’est pas réécrit', () => {
  // le jour où l'amont alloue correctement, la substitution ne mord plus
  // et doit le dire en rendant null, pas en réécrivant dans le vide
  assert.equal(sourceSansPartage(
    `${SIGNATURE_TRIEUR} ; new WebAssembly.Memory({ shared: false })`), null);
});
test('« useSharedMemory » et consorts restent intacts', () => {
  const source = `${SIGNATURE_TRIEUR} ; useSharedMemory:true ;`
    + ' new WebAssembly.Memory({initial:1,shared:!0})';
  const reecrit = sourceSansPartage(source);
  assert.ok(reecrit.includes('useSharedMemory:true'), 'seul « shared: » est visé');
});
test('rien qui ne soit une chaîne', () => {
  assert.equal(sourceSansPartage(null), null);
  assert.equal(sourceSansPartage(undefined), null);
  assert.equal(sourceSansPartage(42), null);
});

titre('la pose du contournement');
const fausseFenetre = (isole) => {
  const nav = Object.create(
    Object.defineProperty({}, 'userAgent', {
      configurable: true, get: () => 'Faux/1.0'
    }));
  return { crossOriginIsolated: isole, navigator: nav,
    Blob: class FauxBlob { constructor(p, o) { this.parties = p; this.options = o; } } };
};
const TRIEUR_MINIFIE = `${SIGNATURE_TRIEUR};`
  + 'm=new WebAssembly.Memory({initial:1,maximum:1,shared:!0})';

test('un contexte isolé n’est pas touché — et se dit sain', () => {
  const f = fausseFenetre(true);
  const Avant = f.Blob;
  const { retirer, applique } = poserContournementScan(f);
  assert.equal(f.Blob, Avant, 'rien ne doit être remplacé');
  assert.equal(applique(), true, 'isolé = rien à faire = sain');
  retirer();
  assert.equal(f.Blob, Avant);
});
test('hors isolation, le trieur passe par la réécriture — et rien d’autre', () => {
  const f = fausseFenetre(false);
  const Avant = f.Blob;
  const { retirer, applique } = poserContournementScan(f);
  assert.notEqual(f.Blob, Avant, 'Blob doit être encadré');
  assert.equal(applique(), false, 'rien n’a encore mordu');

  const trieur = new f.Blob([TRIEUR_MINIFIE], { type: 'application/javascript' });
  assert.ok(trieur.parties[0].includes('shared:false'));
  assert.equal(applique(), true, 'la réécriture est actée');

  const autre = new f.Blob(['bonjour'], { type: 'text/plain' });
  assert.deepEqual(autre.parties, ['bonjour'], 'un blob ordinaire passe intact');

  retirer();
  assert.equal(f.Blob, Avant, 'le contournement se retire entièrement');
});
test('un trieur qui échappe au motif laisse « applique » à faux', () => {
  // c'est le mouchard : la régression muette de la première version
  // devient un avertissement en console (voir scans.js)
  const f = fausseFenetre(false);
  const { retirer, applique } = poserContournementScan(f);
  new f.Blob([`${SIGNATURE_TRIEUR}; new WebAssembly.Memory({shared:UNE_VARIABLE})`],
    { type: 'application/javascript' });
  assert.equal(applique(), false);
  retirer();
});
test('un worker qui meurt est relayé, jamais tu', () => {
  // la panne d'origine était SILENCIEUSE : le worker levait, la page
  // n'en savait rien, et l'œuvre restait invisible sans un mot
  const f = fausseFenetre(false);
  const morts = [];
  class FauxWorker {
    constructor(url) { this.url = url; this._ecoutes = []; }
    addEventListener(type, fn) { if (type === 'error') this._ecoutes.push(fn); }
    crever(msg) { this._ecoutes.forEach((fn) => fn({ message: msg })); }
  }
  f.Worker = FauxWorker;
  const { retirer } = poserContournementScan(f, (m) => morts.push(m));
  const w = new f.Worker('blob:faux');
  w.crever('SharedArrayBuffer indisponible');
  assert.deepEqual(morts, ['SharedArrayBuffer indisponible']);
  retirer();
  assert.equal(f.Worker, FauxWorker, 'Worker est rendu comme Blob');
});
test('sans rappel d’erreur, Worker n’est même pas encadré', () => {
  const f = fausseFenetre(false);
  class FauxWorker {}
  f.Worker = FauxWorker;
  const { retirer } = poserContournementScan(f);
  assert.equal(f.Worker, FauxWorker, 'on n’encadre que ce qu’on écoute');
  retirer();
});
test('l’agent feint est rendu dès la microtâche suivante', async () => {
  const f = fausseFenetre(false);
  const { retirer } = poserContournementScan(f);
  new f.Blob([TRIEUR_MINIFIE], { type: 'application/javascript' });
  assert.equal(f.navigator.userAgent, UA_FEINTE, 'iOS 16.3 le temps du choix');
  await new Promise((r) => queueMicrotask(r));
  assert.equal(f.navigator.userAgent, 'Faux/1.0', 'et plus après');
  retirer();
});

titre('le défaut d’en face existe toujours');
test('le paquet installé alloue encore une mémoire partagée', () => {
  // C'EST la raison d'être du contournement. Si cette assertion tombe,
  // l'amont a réparé : supprimez `scan-memoire.js` et ce fichier.
  const bundle = lire('build/gaussian-splats-3d.module.js');
  assert.ok(bundle.includes(SIGNATURE_TRIEUR), 'le trieur ne se reconnaît plus');
  assert.ok(/[{,]\s*shared\s*:\s*true/.test(bundle),
    'l’amont n’alloue plus « shared: true » — le contournement est périmé');
  assert.ok(/sourceWasm = SorterWasmNonShared/.test(bundle),
    'la variante à mémoire non partagée a disparu du paquet');
  assert.ok(/SorterWasmNoSIMDNonShared/.test(bundle),
    'la variante sans SIMD ni partage a disparu du paquet');
  assert.ok(/ua\.indexOf\('iPhone'\)/.test(bundle),
    'le choix de la variante ne passe plus par navigator.userAgent');
});
test('la version épinglée est celle qu’on a diagnostiquée', () => {
  const v = JSON.parse(lire('package.json')).version;
  const [maj, min, corr] = v.split('.').map(Number);
  // une version PLUS RÉCENTE peut avoir réparé : le test au-dessus le dira.
  // Ici on garde la trace de ce qui a été mesuré, pour que la relecture
  // sache sur quoi le diagnostic portait.
  assert.ok(maj === 0 && min === 4 && corr >= 7, `version ${v} inattendue`);
});
test('le motif exporté est bien global — chaque allocation, pas la première', () => {
  assert.ok(MOTIF_PARTAGE.global, 'sans /g, seule la première occurrence serait réécrite');
});

console.log(`\n${ok} ✓ / ${ko} ✗`);
if (ko) process.exitCode = 1;

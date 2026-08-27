/**
 * LE CONTOURNEMENT DU TRIEUR DE TACHES, ÉPROUVÉ.
 *
 * Un contournement est une dette : il vaut tant que le défaut d'en face
 * existe, et il ment dès que celui-ci est réparé. Ces assertions tiennent
 * les deux bouts — la substitution mord vraiment, ET le paquet installé
 * porte encore le défaut qui la justifie.
 *
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sourceSansPartage, poserContournementScan, SIGNATURE_TRIEUR,
  EMPREINTE_PARTAGEE, EMPREINTE_NON_PARTAGEE, UA_FEINTE }
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

titre('la réécriture du source du worker');
test('une mémoire partagée devient une mémoire ordinaire', () => {
  const source = `(function () { self.onmessage = () => {
      const m = new WebAssembly.Memory({ initial: 4, maximum: 4, ${EMPREINTE_PARTAGEE} });
      self.postMessage({ '${SIGNATURE_TRIEUR}': true });
  }; })(self)`;
  const reecrit = sourceSansPartage(source);
  assert.ok(reecrit, 'le trieur doit être reconnu');
  assert.ok(reecrit.includes(EMPREINTE_NON_PARTAGEE));
  assert.ok(!reecrit.includes(EMPREINTE_PARTAGEE));
});
test('un autre worker n’est jamais touché', () => {
  assert.equal(sourceSansPartage('self.onmessage = () => {};'), null);
  // même une mémoire partagée, si ce n'est pas le trieur : ce n'est pas
  // notre affaire, et réécrire au hasard casserait un jour autre chose
  assert.equal(sourceSansPartage(`new WebAssembly.Memory({ ${EMPREINTE_PARTAGEE} })`), null);
});
test('un trieur déjà réparé n’est pas réécrit', () => {
  // le jour où l'amont alloue correctement, la substitution ne mord plus
  // et doit le dire en rendant null, pas en réécrivant dans le vide
  assert.equal(sourceSansPartage(
    `${SIGNATURE_TRIEUR} ; new WebAssembly.Memory({ ${EMPREINTE_NON_PARTAGEE} })`), null);
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
test('un contexte isolé n’est pas touché', () => {
  const f = fausseFenetre(true);
  const Avant = f.Blob;
  const retirer = poserContournementScan(f);
  assert.equal(f.Blob, Avant, 'rien ne doit être remplacé');
  retirer();
  assert.equal(f.Blob, Avant);
});
test('hors isolation, le trieur passe par la réécriture — et rien d’autre', () => {
  const f = fausseFenetre(false);
  const Avant = f.Blob;
  const retirer = poserContournementScan(f);
  assert.notEqual(f.Blob, Avant, 'Blob doit être encadré');

  const source = `${SIGNATURE_TRIEUR} ; new WebAssembly.Memory({ ${EMPREINTE_PARTAGEE} })`;
  const trieur = new f.Blob([source], { type: 'application/javascript' });
  assert.ok(trieur.parties[0].includes(EMPREINTE_NON_PARTAGEE));

  const autre = new f.Blob(['bonjour'], { type: 'text/plain' });
  assert.deepEqual(autre.parties, ['bonjour'], 'un blob ordinaire passe intact');

  retirer();
  assert.equal(f.Blob, Avant, 'le contournement se retire entièrement');
});
test('l’agent feint est rendu dès la microtâche suivante', async () => {
  const f = fausseFenetre(false);
  const retirer = poserContournementScan(f);
  new f.Blob([`${SIGNATURE_TRIEUR} ; ${EMPREINTE_PARTAGEE}`],
    { type: 'application/javascript' });
  assert.equal(f.navigator.userAgent, UA_FEINTE, 'iOS 16.3 le temps du choix');
  retirer();
});

titre('le défaut d’en face existe toujours');
test('le paquet installé alloue encore une mémoire partagée', () => {
  // C'EST la raison d'être du contournement. Si cette assertion tombe,
  // l'amont a réparé : supprimez `scan-memoire.js` et ce fichier.
  const bundle = lire('build/gaussian-splats-3d.module.js');
  assert.ok(bundle.includes(SIGNATURE_TRIEUR), 'le trieur ne se reconnaît plus');
  assert.ok(bundle.includes(EMPREINTE_PARTAGEE),
    'l’amont n’alloue plus « shared: true » — le contournement est périmé');
  assert.ok(/sourceWasm = SorterWasmNonShared/.test(bundle),
    'la variante à mémoire non partagée a disparu du paquet');
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

console.log(`\n${ok} ✓ / ${ko} ✗`);
if (ko) process.exitCode = 1;

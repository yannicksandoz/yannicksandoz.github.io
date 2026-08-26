/**
 * LA BARRE DE L'ACCUEIL — éprouvée au nœud, pour de vrai.
 *
 * Elle a menti de deux façons opposées, et les deux se lisaient comme une
 * panne :
 *
 *   • D'ABORD elle reculait : le total du tracker grandit à mesure que les
 *     chargements s'ajoutent, donc `fait / attendu` redescend. La règle
 *     monotone a réglé ça ;
 *   • ENSUITE elle était pleine trop tôt : le premier fichier suivi vaut
 *     1/1, soit 100 %. La barre se remplissait en une seconde, puis restait
 *     pleine et grise pendant tout le vrai chargement — et l'on attendait
 *     devant une barre finie qui ne verdissait pas.
 *
 * Et elle attendait ce qu'elle n'avait pas à attendre : à l'entrée, les
 * œuvres des salles VOISINES sont déjà à portée et se chargent aussi. Un
 * scan gaussien voisin, c'est 1,3 Mo — une dizaine de secondes ajoutées à
 * un écran que le visiteur peut déjà quitter.
 *
 * Ces tests EXÉCUTENT le tracker et la peinture de la barre (aucun DOM
 * n'est nécessaire : `bindLoading` ne touche que deux éléments, qu'on
 * simule) — ils décrivent donc le comportement, pas le texte du code.
 *
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import { LoadingTracker } from '../engine/src/core/utils.js';
import { UI } from '../engine/src/ui/UI.js';

// `setReady` va chercher UN élément du DOM (le bouton de visite audio) pour
// le réveiller. C'est tout ce dont ces tests ont besoin du navigateur : on
// le simule plutôt que de monter un DOM entier, et l'absence de l'élément
// est un cas réel (le build Visiteur sans visite audio ne l'a pas).
globalThis.document ??= { getElementById: () => null };

let ok = 0, ko = 0;
// Exécuteur ASYNCHRONE, et il le faut : ces tests attendent des promesses.
// Un exécuteur synchrone appellerait `fn()`, jetterait la promesse et
// compterait ✓ avant même la première assertion — une suite entièrement
// verte qui ne vérifie rien. Les cas s'enchaînent donc un par un, attendus.
const cas = [];
const test = (nom, fn) => cas.push([nom, fn]);
const titre = (t) => cas.push([t, null]);

async function jouer() {
  for (const [nom, fn] of cas) {
    if (!fn) { console.log(`\n${nom}`); continue; }
    try { await fn(); ok++; console.log(`  ✓ ${nom}`); }
    catch (e) { ko++; console.log(`  ✗ ${nom}\n    ${e.message}`); }
  }
}

/** Une barre d'accueil simulée : deux éléments, comme dans le vrai HTML. */
function barreSimulee() {
  const classes = new Set();
  const faux = {
    loadBarFill: { style: { width: '0%' } },
    loadBar: { classList: { add: (c) => classes.add(c), contains: (c) => classes.has(c) } },
    get largeur() { return Number.parseFloat(faux.loadBarFill.style.width); },
    get verte() { return classes.has('complete'); },
    // `setReady` touche au bouton Entrer : on lui en donne un
    enterBtn: { disabled: true, textContent: '' }
  };
  return faux;
}

/** Déroule des chargements et rend l'historique des largeurs peintes. */
function derouler(scenario) {
  const tracker = new LoadingTracker();
  const ui = barreSimulee();
  UI.prototype.bindLoading.call(ui, tracker);
  const largeurs = [];
  const suivre = () => largeurs.push(ui.largeur);
  scenario({ tracker, ui, suivre, lire: () => ui.largeur });
  return { largeurs, ui, tracker };
}

/** Résout une promesse suivie et laisse tourner les microtâches. */
const laisserPasser = () => new Promise((r) => setTimeout(r, 0));

titre('le tracker sépare l’essentiel du préchargement');
test('deux comptes distincts, et `track` rend bien la promesse', async () => {
  const t = new LoadingTracker();
  const a = t.track(Promise.resolve('salle'), true);
  const b = t.track(Promise.resolve('voisine'), false);
  assert.equal(t.total, 2);
  assert.equal(t.essentiels, 1, 'le préchargement ne doit pas être essentiel');
  assert.equal(await a, 'salle', 'track doit rendre la promesse telle quelle');
  await b; await laisserPasser();
  assert.equal(t.done, 2);
  assert.equal(t.faits, 1);
});
test('essentiel par défaut : un appel sans drapeau reste bloquant', () => {
  const t = new LoadingTracker();
  t.track(Promise.resolve());
  assert.equal(t.essentiels, 1);
});
test('un échec compte comme terminé (sinon la barre attend un mort)', async () => {
  const t = new LoadingTracker();
  t.track(Promise.reject(new Error('404'))).catch(() => {});
  await laisserPasser(); await laisserPasser();
  assert.equal(t.faits, 1, 'une promesse rejetée doit débloquer la barre');
});
test('les abonnés reçoivent les quatre compteurs', () => {
  const t = new LoadingTracker();
  let vu = null;
  t.onChange((...args) => { vu = args; });
  t.track(Promise.resolve(), false);
  assert.deepEqual(vu, [0, 1, 0, 0], 'done, total, faits, essentiels');
});

titre('la barre ne se remplit pas avant la fin');
test('le PREMIER fichier ne remplit pas la barre', async () => {
  const { ui, tracker } = derouler(({ tracker }) => {
    tracker.track(Promise.resolve());
  });
  await laisserPasser();
  assert.ok(ui.largeur <= 45,
    `la lecture de la galerie ne vaut pas la visite entière (${ui.largeur} %)`);
  assert.equal(ui.verte, false);
});
test('elle progresse pendant la salle d’arrivée, sans atteindre le bout', async () => {
  const tracker = new LoadingTracker();
  const ui = barreSimulee();
  UI.prototype.bindLoading.call(ui, tracker);
  tracker.track(Promise.resolve());          // works.json
  await laisserPasser();
  UI.prototype.setReady.call(ui);            // galerie lue → phase 2
  const apresLecture = ui.largeur;
  // trois œuvres de la salle d’arrivée, une par une
  const trois = [];
  let resoudre = [];
  for (let i = 0; i < 3; i++) {
    trois.push(tracker.track(new Promise((r) => resoudre.push(r))));
  }
  const etapes = [];
  for (const r of resoudre) {
    r(); await laisserPasser();
    etapes.push(ui.largeur);
  }
  assert.ok(etapes[0] > apresLecture, 'la barre doit avancer avec la salle');
  assert.ok(etapes[0] < etapes[1] && etapes[1] < etapes[2], 'elle doit monter');
  assert.ok(etapes[2] <= 92, `le bout appartient à la fin (${etapes[2]} %)`);
  await Promise.all(trois);
});
test('elle ne recule JAMAIS, même quand la cible grandit', async () => {
  const tracker = new LoadingTracker();
  const ui = barreSimulee();
  UI.prototype.bindLoading.call(ui, tracker);
  tracker.track(Promise.resolve());
  await laisserPasser();
  UI.prototype.setReady.call(ui);
  const vues = [];
  const attentes = [];
  for (let tour = 0; tour < 4; tour++) {
    // une salle qui découvre de nouveaux fichiers à chaque tour : la cible
    // s'éloigne pendant qu'on avance — c'est le cas réel
    let r; attentes.push(new Promise((res) => { r = res; }));
    tracker.track(attentes[attentes.length - 1]);
    tracker.track(Promise.resolve());
    await laisserPasser();
    vues.push(ui.largeur);
    r();
    await laisserPasser();
    vues.push(ui.largeur);
  }
  for (let i = 1; i < vues.length; i++) {
    assert.ok(vues[i] >= vues[i - 1],
      `recul à l’étape ${i} : ${vues[i - 1]} % → ${vues[i]} %`);
  }
});
test('le préchargement d’une salle voisine ne retient rien', async () => {
  const tracker = new LoadingTracker();
  const ui = barreSimulee();
  UI.prototype.bindLoading.call(ui, tracker);
  tracker.track(Promise.resolve());
  await laisserPasser();
  UI.prototype.setReady.call(ui);
  tracker.track(Promise.resolve());                       // la salle d’arrivée
  let jamais;                                             // le scan d’à côté
  tracker.track(new Promise((r) => { jamais = r; }), false);
  await laisserPasser();
  await new Promise((r) => setTimeout(r, 600));           // le verrou de 400 ms
  assert.equal(ui.verte, true,
    'la barre doit finir sans attendre la salle voisine');
  assert.equal(ui.largeur, 100);
  jamais();
});
test('finie, elle reste finie : les chargements d’après sont la visite', async () => {
  const tracker = new LoadingTracker();
  const ui = barreSimulee();
  UI.prototype.bindLoading.call(ui, tracker);
  tracker.track(Promise.resolve());
  await laisserPasser();
  UI.prototype.setReady.call(ui);
  tracker.track(Promise.resolve());
  await laisserPasser();
  await new Promise((r) => setTimeout(r, 600));
  assert.equal(ui.largeur, 100);
  // une œuvre chargée plus tard, en pleine visite
  tracker.track(new Promise(() => {}));
  await laisserPasser();
  assert.equal(ui.largeur, 100, 'la barre ne doit pas repartir en arrière');
  assert.equal(ui.verte, true);
});

await jouer();
console.log(`\n${ok} ✓ / ${ko} ✗`);
process.exit(ko ? 1 : 0);

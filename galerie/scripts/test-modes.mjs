/**
 * LES DEUX FAÇONS D'ENTRER — la mémoire ouverte de la visite guidée.
 *
 * L'accueil ne propose plus « Entrer » mais un choix : la visite GUIDÉE
 * (tout est ouvert, on se laisse porter) ou la visite LIBRE (le jeu
 * d'avant : les pièces se dessinent sous les pas, les œuvres entrent au
 * catalogue quand on les rencontre, les jetons ◈ s'attrapent). Plutôt que
 * d'apprendre « tout ouvert » à chaque module, la visite guidée reçoit une
 * MÉMOIRE QUI A TOUT VU (`MemoireOuverte`) — et qui n'écrit rien : celle
 * de la visite libre reste intacte à côté. Trois choses à protéger :
 *
 *   1. ELLE RÉPOND OUI À TOUT : pièces, portes, œuvres, jetons pris.
 *   2. ELLE N'APPREND RIEN : noter() rend false, ses ensembles ne
 *      grandissent pas, le stockage n'est pas touché.
 *   3. LA PROGRESSION LA SUIT : avec elle, toute œuvre est découverte, aucune
 *      pièce n'est inconnue, la visite guidée a tout à rejouer et rien à
 *      payer — sans qu'un seul module ait à connaître le mode.
 *
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';

// un localStorage de carton : la mémoire de la visite libre doit y rester
// intacte quand celle de la visite guidée est en service
const magasin = new Map();
globalThis.localStorage = {
  getItem: (k) => magasin.get(k) ?? null,
  setItem: (k, v) => magasin.set(k, String(v)),
  removeItem: (k) => magasin.delete(k)
};
globalThis.performance ??= { now: () => Date.now() };

const { Memoire, MemoireOuverte } = await import('../engine/src/core/Memoire.js');
const { Progression } = await import('../engine/src/core/Progression.js');

let ok = 0;
let ko = 0;
const groupe = (titre) => console.log(`\n${titre}`);
const test = (nom, fn) => {
  try { fn(); ok++; console.log(`  ✓ ${nom}`); }
  catch (e) { ko++; console.log(`  ✗ ${nom}\n      ${e.message}`); }
};

/* ------------------------------------------------------ 1. elle dit oui --- */

groupe('la mémoire ouverte répond oui à tout');

test('pièces, portes, œuvres, jetons : tout est déjà vu, pris, franchi', () => {
  const m = new MemoireOuverte();
  assert.equal(m.pieces.has('belvedere'), true);
  assert.equal(m.oeuvres.has('n-importe-quoi'), true);
  assert.equal(m.revelees.has('x'), true);
  assert.equal(m.jetonsPris.has('entree:0'), true);
  assert.equal(m.aVu('jardin'), true);
  assert.equal(m.aPris('a', 'b'), true);
  assert.equal(m.jetonsSolde, 0, 'aucun jeton en poche : il n\'y a rien à payer');
  assert.equal(m.ouverte, true);
});

/* -------------------------------------------------- 2. elle n'apprend pas --- */

groupe('la mémoire ouverte n\'apprend rien et n\'écrit rien');

test('noter() rend false, les ensembles ne grandissent pas', () => {
  const m = new MemoireOuverte();
  assert.equal(m.noter('pieces', 'labo'), false);
  assert.equal(m.noterPorte('a', 'b'), false);
  assert.equal(m.pieces.size, 0);
  m.setSolde(5);
  assert.equal(m.jetonsSolde, 0);
});

test('la mémoire de la visite LIBRE reste intacte à côté', () => {
  magasin.clear();
  const libre = new Memoire();
  libre.noter('pieces', 'entree');
  libre.noter('oeuvres', 'marees');
  libre.setSolde(2);
  const avant = magasin.get('galerie-visite');
  assert.ok(avant && avant.includes('marees'), 'la visite libre a bien écrit');
  const guidee = new MemoireOuverte();
  guidee.noter('oeuvres', 'nebuleuse');
  guidee.oublier();
  guidee.setSolde(0);
  assert.equal(magasin.get('galerie-visite'), avant, 'rien n\'a bougé dans le stockage');
  const relue = new Memoire();
  assert.equal(relue.oeuvres.has('marees'), true);
  assert.equal(relue.oeuvres.has('nebuleuse'), false);
  assert.equal(relue.jetonsSolde, 2);
});

/* -------------------------------------------- 3. la progression la suit --- */

groupe('la progression suit la mémoire qu\'on lui donne');

/** Une App de carton : deux pièces, trois œuvres, une de décor. */
const appFactice = (memoire) => {
  const rooms = new Map([
    ['entree', { config: { id: 'entree' } }],
    ['labo', { config: { id: 'labo' } }]
  ]);
  const oeuvre = (id, room, role) => ({
    config: { id, title: id.toUpperCase(), role, type: 'sound' },
    room: rooms.get(room), distance: 99
  });
  return {
    memoire,
    rooms: { rooms },
    artworks: [oeuvre('marees', 'labo'), oeuvre('voxel', 'labo'), oeuvre('banc', 'entree', 'decor')],
    onUpdate() {}
  };
};

test('visite libre : rien n\'est découvert, deux pièces inconnues', () => {
  magasin.clear();
  const app = appFactice(new Memoire());
  const p = new Progression(app);
  assert.equal(p.compte, 0);
  assert.equal(p.total, 2, 'le banc de décor ne compte pas');
  assert.equal(p.piecesInconnues, 2);
  assert.deepEqual(p.bilanDe('labo'), { total: 2, vues: 0 });
});

test('visite guidée : tout est découvert, aucune pièce inconnue, rien à dévoiler', () => {
  const app = appFactice(new MemoireOuverte());
  const p = new Progression(app);
  assert.equal(p.compte, 2);
  assert.equal(p.complet, true);
  assert.equal(p.piecesInconnues, 0);
  assert.deepEqual(p.bilanDe('labo'), { total: 2, vues: 2 });
  assert.equal(p.indexees.length, 2, 'la visite guidée a tout à rejouer');
  // dévoiler contre un jeton n'a plus de sens : tout est déjà connu
  assert.equal(p.reveler(app.artworks[0]), false);
});

test('marquer() en visite guidée ne compte pas de nouveauté (rien n\'est nouveau)', () => {
  const app = appFactice(new MemoireOuverte());
  const p = new Progression(app);
  p.marquer(app.artworks[0]);
  assert.equal(p.nouvelles, 0);
});

console.log(`\n${ok} ✓ / ${ko} ✗`);
process.exit(ko ? 1 : 0);

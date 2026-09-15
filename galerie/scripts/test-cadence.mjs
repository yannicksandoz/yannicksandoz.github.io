/**
 * LA DENSITÉ ADAPTATIVE — le gouverneur vise la cadence de l'écran.
 *
 * Sur un portable Retina à 120 Hz, l'image tenait à 60-80 : au-dessus des
 * 50 images où le gouverneur agissait, en dessous de ce que l'écran sait
 * montrer. Il lit désormais le taux de l'écran dans l'intervalle minimal
 * entre deux images, vise 85 % de ce taux, et sous cette cible pendant
 * six secondes descend la densité de la native à 1,5 affûtée — une fois,
 * jamais l'inverse. Trois choses à protéger :
 *
 *   1. LA LECTURE DU TAUX. Les intervalles sont des multiples de la période
 *      de l'écran : le minimum la révèle, à condition qu'une image tienne.
 *   2. LA CIBLE. 51 sur un 60 Hz (le seuil d'avant, à une image près),
 *      102 sur un 120 Hz.
 *   3. LE CRAN. Il ne se prend qu'avec des pixels à rendre (densité > 1,5),
 *      après six secondes, une seule fois — et il ne remonte pas.
 *
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';

// le gestionnaire lit l'écran à sa construction : on lui en donne un
globalThis.window = {
  devicePixelRatio: 2,
  matchMedia: () => ({ matches: false })
};
// …et un navigateur : Node 20 (la CI) n'a pas de `navigator` global, Node 22 si
globalThis.navigator ??= { userAgent: 'node', maxTouchPoints: 0 };
const { QualityManager, estimerHz, cibleImages } = await import('../engine/src/core/Quality.js');

let ok = 0;
let ko = 0;
const groupe = (titre) => console.log(`\n${titre}`);
const test = (nom, fn) => {
  try { fn(); ok++; console.log(`  ✓ ${nom}`); }
  catch (e) { ko++; console.log(`  ✗ ${nom}\n      ${e.message}`); }
};

/* ------------------------------------------------ 1. la lecture du taux --- */

groupe('le taux de l\'écran se lit dans l\'intervalle minimal');

test('8,3 ms → 120 Hz, 16,7 ms → 60 Hz, 6,9 ms → 144 Hz', () => {
  assert.equal(estimerHz(1 / 120), 120);
  assert.equal(estimerHz(0.0167), 60);
  assert.equal(estimerHz(1 / 144), 144);
});

test('une mesure approchée s\'accroche au taux connu le plus proche (12 %)', () => {
  assert.equal(estimerHz(0.0089), 120);   // 112 mesurés → 120
  assert.equal(estimerHz(0.0175), 60);    // 57 → 60
});

test('sans mesure, ou hors de tout taux connu, on répond 60 (le comportement d\'avant)', () => {
  assert.equal(estimerHz(Infinity), 60);
  assert.equal(estimerHz(undefined), 60);
  assert.equal(estimerHz(0), 60);
  assert.equal(estimerHz(1 / 33), 60);    // 33 Hz n'existe pas : 60
});

/* ------------------------------------------------------------ 2. la cible --- */

groupe('la cadence visée : 85 % de l\'écran, jamais moins de 50');

test('60 Hz → 51, 120 Hz → 102, 144 Hz → 122', () => {
  assert.equal(cibleImages(60), 51);
  assert.equal(cibleImages(120), 102);
  assert.equal(cibleImages(144), 122);
});

test('un taux absurde retombe sur 60 Hz', () => {
  assert.equal(cibleImages(undefined), 51);
  assert.equal(cibleImages(0), 51);
});

/* ------------------------------------------------------------- 3. le cran --- */

groupe('le cran de densité : une fois, après six secondes, avec des pixels à rendre');

/** Une App de carton : ce que le gouverneur touche, et rien d'autre. */
const appFactice = () => {
  const journal = [];
  return {
    journal,
    renderer: { setPixelRatio: (d) => journal.push(['renderer', d]) },
    composer: { setPixelRatio: (d) => journal.push(['composer', d]) },
    sortie: { nettete: 0, bloomActif: true, grainActif: true },
    gtao: { enabled: true },
    setMsaa: (n) => journal.push(['msaa', n]),
    setShadowsEnabled: () => {}
  };
};

/**
 * Fait tourner le gouverneur `secondes` durant, à `fps` images par seconde
 * sur un écran à `hz` : les intervalles alternent entre une et deux
 * périodes, comme le fait un navigateur calé sur le balayage.
 */
const tourner = (q, app, { fps, hz, secondes }) => {
  const periode = 1 / hz;
  const moyen = 1 / fps;
  // deux intervalles qui se moyennent à 1/fps : une période, puis le reste
  const long = 2 * moyen - periode;
  let t = 0, i = 0;
  while (t < secondes) {
    const dt = (i++ % 2 === 0) ? periode : long;
    q.tick(dt, app);
    t += dt;
  }
};

const silence = () => { const c = console.info; console.info = () => {}; return () => { console.info = c; }; };

test('70 images sur un écran à 120 Hz : la densité descend à 1,5 affûtée après six secondes', () => {
  const fin = silence();
  const q = new QualityManager();
  assert.equal(q.profile.tier, 'unique');
  assert.equal(q.profile.pixelRatio, 2);
  const app = appFactice();
  q._fps = 70;   // la moyenne glissante part de 60 ; on la pose
  tourner(q, app, { fps: 70, hz: 120, secondes: 4 });
  assert.equal(q.profile.pixelRatio, 2, 'à 3 s, une seule décision : on attend');
  tourner(q, app, { fps: 70, hz: 120, secondes: 4 });
  assert.equal(q._hz, 120, 'le taux lu');
  assert.equal(q.profile.pixelRatio, 1.5);
  assert.equal(q.profile.nettete, 0.5);
  assert.equal(app.sortie.nettete, 0.5);
  assert.deepEqual(app.journal.filter((j) => j[0] !== 'msaa'), [['renderer', 1.5], ['composer', 1.5]]);
  assert.ok(!app.journal.some((j) => j[0] === 'msaa'), 'l\'anticrénelage n\'a pas bougé');
  fin();
});

test('…et ne remonte jamais, même une minute à la cible', () => {
  const fin = silence();
  const q = new QualityManager();
  const app = appFactice();
  q._fps = 70;
  tourner(q, app, { fps: 70, hz: 120, secondes: 8 });
  assert.equal(q.profile.pixelRatio, 1.5);
  q._fps = 119;
  tourner(q, app, { fps: 119, hz: 120, secondes: 60 });
  assert.equal(q.profile.pixelRatio, 1.5);
  assert.equal(app.journal.length, 2, 'aucun autre réglage touché');
  fin();
});

test('55 images sur un écran à 60 Hz : au-dessus de la cible, rien ne bouge', () => {
  const q = new QualityManager();
  const app = appFactice();
  q._fps = 55;
  tourner(q, app, { fps: 55, hz: 60, secondes: 20 });
  assert.equal(q.profile.pixelRatio, 2);
  assert.equal(app.journal.length, 0);
});

test('un écran à densité 1 n\'a rien à donner : sous la cible, la densité reste', () => {
  const fin = silence();
  window.devicePixelRatio = 1;
  const q = new QualityManager();
  window.devicePixelRatio = 2;
  const app = appFactice();
  q._fps = 70;
  tourner(q, app, { fps: 70, hz: 120, secondes: 20 });
  assert.equal(q.profile.pixelRatio, 1);
  assert.ok(!app.journal.some((j) => j[0] === 'renderer'), 'la densité n\'est pas touchée');
  fin();
});

test('sous 50 images sur un 60 Hz Retina : la densité 1,5, puis la densité 1 — jamais l\'anticrénelage', () => {
  // le gouverneur n'est plus qu'un filet sur la densité (crans.js) : l'image
  // reste la même partout, en un peu plus doux là où la machine manque
  const fin = silence();
  const q = new QualityManager();
  const app = appFactice();
  q._fps = 40;
  tourner(q, app, { fps: 40, hz: 60, secondes: 20 });
  assert.deepEqual(app.journal.slice(0, 4),
    [['renderer', 1.5], ['composer', 1.5], ['renderer', 1], ['composer', 1]]);
  assert.ok(!app.journal.some(([quoi]) => quoi === 'msaa'), 'l\'anticrénelage ne bouge pas');
  fin();
});

groupe('le profil forcé par l\'adresse');

test('par défaut, l\'image UNIQUE pour tous : la densité seule suit l\'écran', () => {
  const fin = silence();
  const avant = globalThis.location;
  globalThis.location = { search: '' };
  globalThis.window.devicePixelRatio = 2;
  const q = new QualityManager();
  assert.equal(q.profile.tier, 'unique');
  assert.equal(q.riche, false);
  assert.equal(q.isMobile, false);            // pointeur fin : un bureau
  assert.equal(q.profile.pixelRatio, 2);      // à la souris, pleine densité
  assert.equal(q.profile.nettete, 0);
  assert.equal(q.profile.shadows, false);     // l'image du téléphone
  assert.equal(q.profile.gtao, false);
  assert.equal(q.profile.msaa, 2);
  assert.equal(q.profile.isfResolution, 512); // ce qui ne coûte pas de pixels
  assert.equal(q.profile.anisotropy, 16);
  assert.equal(q.profile.maxStems, 6);        // le même son partout
  assert.equal(q.profile.survolEchantillons, 4);
  // un téléphone : la même image, à densité 1,25 affûtée
  globalThis.window.devicePixelRatio = 3;
  globalThis.window.matchMedia = (m) => ({ matches: m === '(pointer: coarse)' });
  const tel = new QualityManager();
  assert.equal(tel.profile.tier, 'unique');
  assert.equal(tel.isMobile, true);
  assert.equal(tel.profile.pixelRatio, 1.25);
  assert.equal(tel.profile.nettete, 0.5);
  assert.equal(tel.profile.shadows, false);
  globalThis.window.matchMedia = () => ({ matches: false });
  globalThis.window.devicePixelRatio = 2;
  globalThis.location = avant;
  fin();
});

test('l\'image ENRICHIE : par la mémoire ou par l\'adresse, même son, même densité', () => {
  const fin = silence();
  const avant = globalThis.location; const stockageAvant = globalThis.localStorage;
  const memoire = new Map();
  globalThis.localStorage = { getItem: (k) => memoire.get(k) ?? null, setItem: (k, v) => memoire.set(k, v), removeItem: (k) => memoire.delete(k) };
  globalThis.location = { search: '' };
  memoire.set('galerie-riche', '1');
  const r = new QualityManager();
  assert.equal(r.profile.tier, 'riche');
  assert.equal(r.riche, true);
  assert.equal(r.profile.shadows, true);
  assert.equal(r.profile.gtao, true);
  assert.equal(r.profile.msaa, 4);
  assert.equal(r.profile.sourcesEtendues, 8);
  assert.equal(r.profile.maxStems, 6);
  assert.equal(r.profile.pixelRatio, 2);
  // l'adresse impose, quelle que soit la mémoire
  globalThis.location = { search: '?profil=unique' };
  assert.equal(new QualityManager().profile.tier, 'unique');
  memoire.clear();
  globalThis.location = { search: '?profil=desktop' };
  const d = new QualityManager();
  assert.equal(d.profile.tier, 'riche');
  assert.equal(d.force, 'riche');
  globalThis.location = { search: '?riche' };
  assert.equal(new QualityManager().profile.tier, 'riche');
  globalThis.localStorage = stockageAvant; globalThis.location = avant;
  fin();
});

test('à l\'aise : six secondes de suite au-dessus de la cadence visée, et rien de moins', () => {
  const fin = silence();
  const q = new QualityManager();
  const app = appFactice();
  assert.equal(q.aLaMarge(), false);
  q._fps = 60;
  tourner(q, app, { fps: 60, hz: 60, secondes: 7 });
  assert.equal(q.aLaMarge(6), true);
  tourner(q, app, { fps: 30, hz: 60, secondes: 4 });
  assert.equal(q.aLaMarge(6), false);      // une chute remet le compteur à zéro
  fin();
});

console.log(`\n${ok} ✓ / ${ko} ✗`);
process.exit(ko ? 1 : 0);

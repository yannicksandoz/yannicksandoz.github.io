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
  assert.equal(q.profile.tier, 'desktop');
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

test('sous 50 images sur un 60 Hz Retina : la densité d\'abord, PUIS la finition (×2, puis 0)', () => {
  // la densité affûtée coûte moins à l'œil que l'anticrénelage perdu, et
  // rapporte deux fois plus : elle passe en premier, quel que soit l'écran
  const fin = silence();
  const q = new QualityManager();
  const app = appFactice();
  q._fps = 40;
  tourner(q, app, { fps: 40, hz: 60, secondes: 20 });
  assert.deepEqual(app.journal.slice(0, 4),
    [['renderer', 1.5], ['composer', 1.5], ['msaa', 2], ['msaa', 0]]);
  fin();
});

console.log(`\n${ok} ✓ / ${ko} ✗`);
process.exit(ko ? 1 : 0);

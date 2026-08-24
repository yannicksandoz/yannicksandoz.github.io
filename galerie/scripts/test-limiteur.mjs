/**
 * Test du limiteur : le portage Airwindows, éprouvé hors navigateur.
 *
 * Un limiteur qui déborde ne s'entend pas — il se mesure. On lui envoie des
 * signaux dont on connaît la réponse attendue, et l'on vérifie le plafond,
 * la réduction, et l'absence de NaN (un seul suffit à rendre TOUTE la sortie
 * muette pour le reste de la session).
 *
 * Lancer avec : npm test
 */

// Le module est un worklet : on lui pose son décor avant de l'importer.
globalThis.sampleRate = 48000;
globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage() {} }; } };
globalThis.registerProcessor = () => {};

const { Pressure4, ClipOnly2 } = await import('../engine/src/core/limiteur-worklet.js');
const { normaliserLimiteur, reductionEnDb, LIMITEUR_DEFAUTS } =
  await import('../engine/src/core/limiteur-reglages.js');

let passed = 0, failed = 0;
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function check(name, actual, expected) {
  if (eq(actual, expected)) { passed++; console.log(`  ✓ ${name}`); }
  else {
    failed++;
    console.error(`  ✗ ${name}\n      attendu : ${JSON.stringify(expected)}`
      + `\n      obtenu  : ${JSON.stringify(actual)}`);
  }
}

/** Assertion booléenne : la condition, et ce qu'on a mesuré si elle tombe. */
function vrai(name, condition, detail = '') {
  if (condition) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}

const TAUX = 48000;
const N = 128;

/** La CHAÎNE complète, comme dans le fil audio : vari-µ puis écrêteur. */
function chaine(A, caractere = 0, compenser = true, C = 0.5) {
  const p = new Pressure4(TAUX);
  const c = new ClipOnly2(TAUX);
  return (g, d) => {
    p.traiter(g, d, A, 0.5, C, 1, compenser, caractere);
    c.traiter(g, 0); c.traiter(d, 1);
    return p;
  };
}

/**
 * Gain linéaire (dB) et distorsion résiduelle (%) sur un sinus entretenu.
 *
 * `retard` : ClipOnly2 rend le signal avec UN échantillon de retard. Sans
 * en tenir compte, le résidu mesuré vaut sin(2π·220/48000) ≈ 2,9 % — un
 * déphasage pris pour de la distorsion, et l'on « corrigerait » un défaut
 * qui n'existe pas.
 */
function mesurer(traiter, amplitude, { blocs = 400, retard = 0 } = {}) {
  let phase = 0;
  const pas = (2 * Math.PI * 220) / TAUX;
  const g = new Float32Array(N);
  const d = new Float32Array(N);
  const entree = [], sortie = [];
  let crete = 0, nan = false;
  for (let b = 0; b < blocs; b++) {
    for (let i = 0; i < N; i++) {
      const v = Math.sin(phase) * amplitude;
      phase += pas;
      g[i] = v; d[i] = v;
    }
    const copie = Float32Array.from(g);
    traiter(g, d);
    if (b < blocs / 2) continue;   // le limiteur s'installe
    for (let i = 0; i < N; i++) {
      if (!Number.isFinite(g[i]) || !Number.isFinite(d[i])) nan = true;
      crete = Math.max(crete, Math.abs(g[i]));
      entree.push(copie[i]); sortie.push(g[i]);
    }
  }
  // le meilleur gain linéaire, puis ce qui reste : la distorsion
  let num = 0, den = 0;
  for (let i = retard; i < entree.length; i++) {
    num += entree[i - retard] * sortie[i];
    den += entree[i - retard] * entree[i - retard];
  }
  const k = den ? num / den : 0;
  let residu = 0, puissance = 0;
  for (let i = retard; i < entree.length; i++) {
    const e = sortie[i] - k * entree[i - retard];
    residu += e * e; puissance += sortie[i] * sortie[i];
  }
  return { db: 20 * Math.log10(k || 1e-9), crete, nan,
    distorsion: puissance ? 100 * Math.sqrt(residu / puissance) : 0 };
}

console.log('\nbrancher le limiteur ne doit rien changer tant qu’il ne travaille pas');
{
  // C'était le défaut entendu : Pressure4 multiplie tout par 1/seuil, et la
  // galerie entière prenait +3,5 dB — donc une saturation douce permanente
  // dans la sinusoïde du second étage.
  const nu = mesurer(chaine(0.25, 1, false), 0.3, { retard: 1 });
  vrai('sans compensation, le limiteur MONTE le niveau', nu.db > 2, `${nu.db.toFixed(2)} dB`);

  const propre = mesurer(chaine(0.25), 0.3, { retard: 1 });
  vrai('compensé, un signal discret ressort au même niveau',
    Math.abs(propre.db) < 0.05, `${propre.db.toFixed(3)} dB`);
  vrai('…et sans distorsion mesurable',
    propre.distorsion < 0.01, `${propre.distorsion.toFixed(3)} %`);

  const mi = mesurer(chaine(0.25), 0.5, { retard: 1 });
  vrai('à mi-échelle non plus', mi.distorsion < 0.05 && Math.abs(mi.db) < 0.05,
    JSON.stringify({ db: mi.db.toFixed(3), dist: mi.distorsion.toFixed(3) }));
}

console.log('\nle plafond tient quand même');
{
  for (const amplitude of [0.8, 2, 4, 12]) {
    const r = mesurer(chaine(0.25), amplitude, { retard: 1 });
    vrai(`amplitude ${amplitude} : rien ne dépasse 1`, r.crete <= 1.0001,
      r.crete.toFixed(4));
    check(`amplitude ${amplitude} : aucun NaN`, r.nan, false);
  }
  const fort = mesurer(chaine(0.25), 4, { retard: 1 });
  vrai('…et le limiteur retient', fort.db < -1, `${fort.db.toFixed(2)} dB`);
}

console.log('\nPressure4 — la réduction, et le proche qui prend la place');
{
  const reduction = (A, amplitude) => {
    const p = new Pressure4(TAUX);
    let moindre = 1;
    const t = (g, d) => { p.traiter(g, d, A, 0.5, 0.5, 1, true, 0);
      if (p.moindre < moindre) moindre = p.moindre; return p; };
    mesurer(t, amplitude, { blocs: 200 });
    return moindre;
  };
  const loin = reduction(0.5, 0.5);
  const pres = reduction(0.5, 3.0);
  vrai('plus la source est proche, plus le bus est tenu', pres < loin,
    `${pres.toFixed(3)} vs ${loin.toFixed(3)}`);
  vrai('plus on met de pression, plus il serre',
    reduction(0.8, 3.0) < reduction(0.3, 3.0));
  vrai('pression à zéro : le limiteur dort', reduction(0, 0.2) > 0.99);
}

console.log('\nle caractère se dose');
{
  const propre = mesurer(chaine(0.25, 0), 0.5, { retard: 1 });
  const chris = mesurer(chaine(0.25, 1), 0.5, { retard: 1 });
  vrai('à 0, le second étage de Chris est absent', propre.distorsion < 0.01,
    `${propre.distorsion.toFixed(3)} %`);
  vrai('à 1, on retrouve son grain', chris.distorsion > 0.5,
    `${chris.distorsion.toFixed(2)} %`);
  check('…et le plafond tient dans les deux cas',
    [propre.crete <= 1.0001, chris.crete <= 1.0001], [true, true]);
}

console.log('\nla douceur change le grain, pas le plafond');
{
  for (const C of [0, 0.5, 1]) {
    const r = mesurer(chaine(0.6, 0, true, C), 3.0, { retard: 1 });
    check(`douceur ${C} : plafond tenu, aucun NaN`,
      [r.crete <= 1.0001, r.nan], [true, false]);
  }
}

console.log('\nClipOnly2 — transparent tant que rien ne dépasse');
{
  const c = new ClipOnly2(TAUX);
  const entree = new Float32Array(N);
  for (let i = 0; i < N; i++) entree[i] = Math.sin((i / N) * 6.28) * 0.5;
  const sortie = Float32Array.from(entree);
  c.traiter(sortie, 0);
  // Il y a UNE latence d'échantillon : on compare décalé.
  const espace = Math.max(1, Math.floor(TAUX / 44100));
  let ecart = 0;
  for (let i = espace + 1; i < N; i++) {
    ecart = Math.max(ecart, Math.abs(sortie[i] - entree[i - espace]));
  }
  check('sous le plafond, le signal ressort tel quel', ecart < 1e-6, true);

  const dur = new ClipOnly2(TAUX);
  const carre = new Float32Array(N);
  for (let i = 0; i < N; i++) carre[i] = i % 8 < 4 ? 3.5 : -3.5;
  dur.traiter(carre, 0);
  let max = 0, nan = false;
  for (let i = 0; i < N; i++) {
    if (!Number.isFinite(carre[i])) nan = true;
    max = Math.max(max, Math.abs(carre[i]));
  }
  check('un carré à 3,5 ressort sous 1', max <= 1.0001, true);
  check('…sans NaN', nan, false);

  // Le silence doit rester le silence : un écrêteur qui « respire » à vide
  // s'entendrait comme un souffle.
  const muet = new ClipOnly2(TAUX);
  const zero = new Float32Array(N);
  muet.traiter(zero, 0);
  check('le silence reste le silence', zero.every((v) => v === 0), true);
}

console.log('\nréglages');
{
  const trie = (o) => Object.fromEntries(Object.entries(o).sort());
  check('les défauts se relisent',
    trie(normaliserLimiteur(undefined)), trie(LIMITEUR_DEFAUTS));
  check('une valeur absurde retombe sur le défaut',
    normaliserLimiteur({ pression: 'beaucoup' }).pression, LIMITEUR_DEFAUTS.pression);
  check('une valeur hors bornes est ramenée',
    [normaliserLimiteur({ pression: 5 }).pression,
      normaliserLimiteur({ sortie: -3 }).sortie], [1, 0]);
  check('l’arrêt se demande explicitement',
    [normaliserLimiteur({ actif: false }).actif, normaliserLimiteur({}).actif],
    [false, true]);

  // LA MARGE. Elle décide de tout ce qui suit : le limiteur ne peut que
  // raboter ce qui lui arrive déjà au-dessus de un. Elle doit laisser de la
  // marge par défaut, se régler des deux côtés, et ne JAMAIS pouvoir
  // atteindre zéro — un champ mal orthographié ne doit pas rendre une
  // galerie muette.
  vrai('par défaut, il reste de la marge',
    LIMITEUR_DEFAUTS.marge > 0.5 && LIMITEUR_DEFAUTS.marge < 1,
    String(LIMITEUR_DEFAUTS.marge));
  check('elle se borne sans jamais couper le son',
    [normaliserLimiteur({ marge: 0 }).marge, normaliserLimiteur({ marge: -4 }).marge,
      normaliserLimiteur({ marge: 99 }).marge], [0.05, 0.05, 2]);
  check('une marge illisible retombe sur le défaut',
    normaliserLimiteur({ marge: 'fort' }).marge, LIMITEUR_DEFAUTS.marge);
  check('et on peut la remonter au-delà de l’unité',
    normaliserLimiteur({ marge: 1.2 }).marge, 1.2);
}

console.log('\nréduction en décibels');
{
  check('coefficient 1 → 0 dB', reductionEnDb(1), 0);
  check('coefficient 0,5 → environ -6 dB',
    Math.round(reductionEnDb(0.5) * 10) / 10, -6);
  check('un coefficient impossible ne casse pas l’affichage',
    [reductionEnDb(0), reductionEnDb(NaN), reductionEnDb(2)], [0, 0, 0]);
}

console.log(`\n${passed} ✓ / ${failed} ✗`);
process.exit(failed ? 1 : 0);

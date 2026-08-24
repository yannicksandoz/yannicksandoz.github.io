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

const TAUX = 48000;
const N = 128;

/** Un sinus d'amplitude donnée, joué pendant `blocs` blocs de 128. */
function jouer(traiter, amplitude, blocs = 200, frequence = 220) {
  let phase = 0;
  const pas = (2 * Math.PI * frequence) / TAUX;
  let crete = 0, nan = false, moindre = 1;
  const g = new Float32Array(N);
  const d = new Float32Array(N);
  for (let b = 0; b < blocs; b++) {
    for (let i = 0; i < N; i++) {
      const v = Math.sin(phase) * amplitude;
      phase += pas;
      g[i] = v; d[i] = v;
    }
    const info = traiter(g, d);
    if (info?.moindre < moindre) moindre = info.moindre;
    // on laisse passer les vingt premiers blocs : le limiteur s'installe
    if (b < 20) continue;
    for (let i = 0; i < N; i++) {
      if (!Number.isFinite(g[i]) || !Number.isFinite(d[i])) nan = true;
      const a = Math.abs(g[i]);
      if (a > crete) crete = a;
    }
  }
  return { crete, nan, moindre };
}

console.log('\nPressure4 — le plafond tient');
{
  const chaine = (A) => {
    const p = new Pressure4(TAUX);
    return (g, d) => { p.traiter(g, d, A, 0.5, 0.5, 1); return p; };
  };

  const doux = jouer(chaine(0.35), 0.3);
  check('un signal discret ressort sans NaN', doux.nan, false);
  check('…et sous le plafond', doux.crete <= 1.0001, true);

  // quatre fois trop fort : c'est le cas « quinze œuvres qui s'additionnent »
  const fort = jouer(chaine(0.35), 4.0);
  check('un signal quatre fois trop fort ne dépasse jamais 1', fort.crete <= 1.0001,
    true);
  check('…sans jamais produire de NaN', fort.nan, false);
  // −3,5 dB de réduction sur un signal quatre fois trop fort : le vari-µ
  // rattrape, et l'étage sinus de Chris finit le travail. C'est ce partage
  // qui fait que la surcharge s'entend comme une densité, pas comme un mur.
  check('…et la réduction se voit', fort.moindre < 0.75, true);
  const serre = jouer(chaine(0.8), 4.0);
  check('plus on met de pression, plus il serre', serre.moindre < fort.moindre, true);

  // Le cœur de la demande : APPROCHER doit faire reculer le reste. Plus le
  // signal est fort, plus la réduction est profonde — c'est cette réduction
  // que subissent aussi toutes les autres sources du bus.
  const loin = jouer(chaine(0.5), 0.5);
  const pres = jouer(chaine(0.5), 3.0);
  check('plus la source est proche, plus le bus est tenu',
    pres.moindre < loin.moindre, true);

  // pression à 0 : le seuil vaut 1, rien ne se passe (ou presque)
  const dormant = jouer(chaine(0), 0.2);
  check('pression à zéro : le limiteur dort', dormant.moindre > 0.99, true);
}

console.log('\nPressure4 — la douceur change le grain, pas le plafond');
{
  for (const C of [0, 0.5, 1]) {
    const p = new Pressure4(TAUX);
    const r = jouer((g, d) => { p.traiter(g, d, 0.6, 0.5, C, 1); return p; }, 3.0);
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
  check('les défauts se relisent', normaliserLimiteur(undefined), LIMITEUR_DEFAUTS);
  check('une valeur absurde retombe sur le défaut',
    normaliserLimiteur({ pression: 'beaucoup' }).pression, LIMITEUR_DEFAUTS.pression);
  check('une valeur hors bornes est ramenée',
    [normaliserLimiteur({ pression: 5 }).pression,
      normaliserLimiteur({ sortie: -3 }).sortie], [1, 0]);
  check('l’arrêt se demande explicitement',
    [normaliserLimiteur({ actif: false }).actif, normaliserLimiteur({}).actif],
    [false, true]);
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

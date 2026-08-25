/**
 * Test des premières réflexions : ClearCoat, porté d'Airwindows.
 *
 * Ce qu'on mesure, et pourquoi c'est CELA :
 *
 *  1. ÇA RÉPOND TÔT. C'est toute la raison d'être de cet étage — une queue
 *     de réverbe ne s'entend pas quand on est collé à la source. L'énergie
 *     doit donc arriver dans les premières dizaines de millisecondes, pas
 *     après.
 *  2. ÇA MEURT VITE. La contre-réaction de Chris vaut 1/24, « à mi-chemin
 *     entre le maintien infini et six décibels plus bas » : une frappe doit
 *     s'éteindre en une fraction de seconde. Si elle s'attarde, ce n'est
 *     plus une première réflexion, c'est une deuxième réverbe qui double la
 *     première.
 *  3. PLUS LA SALLE EST GRANDE, PLUS ÇA S'ÉTALE. Les dix-sept jeux de
 *     longueurs vont de 96 à 1541 places ; la mesure doit retrouver cet
 *     ordre, sinon le curseur d'ampleur ment.
 *  4. LES DEUX CANAUX DIFFÈRENT. Ils parcourent les mêmes longueurs dans un
 *     ordre différent : c'est de là que vient la largeur. Deux canaux
 *     identiques seraient une pièce monophonique.
 *  5. RIEN NE DIVERGE, RIEN N'EST NaN. Quatre étages bouclés sur eux-mêmes,
 *     c'est exactement l'endroit où l'on en fabrique.
 *
 * Lancer avec : npm test
 */
globalThis.sampleRate = 48000;
globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage() {} }; } };
globalThis.registerProcessor = () => {};

const { ClearCoat, SALLES } = await import('../engine/src/core/premieres-worklet.js');
const { PLACES, salleDeTaille, nomDeSalle, normaliserPremieres, PREMIERES_DEFAUT } =
  await import('../engine/src/core/premieres-reglages.js');
const { normaliserReverb, REVERB_DEFAUTS, LIEUX } =
  await import('../engine/src/core/reverb-reglages.js');

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
function vrai(name, condition, detail = '') {
  if (condition) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}

const TAUX = 48000;
const N = 128;

/**
 * Frappe une fois, puis écoute. Rend l'énergie par tranche de 128
 * échantillons (2,67 ms) — c'est la forme de la réponse dans le temps.
 */
function frapper(salle, { blocs = 400 } = {}) {
  const moteur = new ClearCoat(TAUX);
  const g = new Float32Array(N);
  const d = new Float32Array(N);
  let nan = false, crete = 0;
  g[0] = 1; d[0] = 1;
  moteur.traiter(g, d, salle);
  const tranches = [];
  const relever = () => {
    let e = 0;
    for (let i = 0; i < N; i++) {
      if (!Number.isFinite(g[i]) || !Number.isFinite(d[i])) nan = true;
      crete = Math.max(crete, Math.abs(g[i]), Math.abs(d[i]));
      e += (g[i] * g[i]) + (d[i] * d[i]);
    }
    tranches.push(e);
  };
  relever();
  for (let b = 1; b < blocs; b++) {
    g.fill(0); d.fill(0);
    moteur.traiter(g, d, salle);
    relever();
  }
  return { tranches, nan, crete };
}

/** Le rang de la dernière tranche qui porte encore `part` de la crête. */
function finDe(tranches, part) {
  const max = Math.max(...tranches);
  let dernier = 0;
  for (let i = 0; i < tranches.length; i++) if (tranches[i] > max * part) dernier = i;
  return dernier;
}
/** Le centre de gravité temporel de la réponse, en millisecondes. */
function centreMs(tranches) {
  let somme = 0, pondere = 0;
  for (let i = 0; i < tranches.length; i++) {
    somme += tranches[i];
    pondere += tranches[i] * i;
  }
  return somme > 0 ? (pondere / somme) * (N / TAUX) * 1000 : 0;
}

console.log('\nles dix-sept salles');
{
  check('elles sont dix-sept', SALLES.length, 17);
  check('chacune a ses seize longueurs',
    SALLES.every((s) => s.taps.length === 16), true);
  // La liste des places est écrite DEUX FOIS (voir premieres-reglages.js) :
  // c'est ce test qui empêche les deux de diverger.
  check('les places de l’inspecteur sont celles du worklet',
    PLACES, SALLES.map((s) => s.places));
  vrai('elles vont de la petite salle au grand hall',
    SALLES[0].places === 96 && SALLES[16].places === 1541,
    `${SALLES[0].places} → ${SALLES[16].places}`);
  let desordre = 0;
  for (let i = 1; i < SALLES.length; i++) {
    if (SALLES[i].places <= SALLES[i - 1].places) desordre++;
  }
  check('et elles sont rangées de la plus petite à la plus grande', desordre, 0);
}

console.log('\nça répond tôt, et ça meurt vite');
{
  const { tranches, nan, crete } = frapper(6);   // 225 places
  const msParTranche = (N / TAUX) * 1000;
  const centre = centreMs(tranches);
  const fin = finDe(tranches, 0.001) * msParTranche;
  console.log(`      centre de gravité ${centre.toFixed(0)} ms · fin (−60 dB)`
    + ` ${fin.toFixed(0)} ms · crête ${crete.toFixed(3)}`);
  check('aucun NaN', nan, false);
  vrai('l’énergie arrive tôt', centre < 120, `${centre.toFixed(0)} ms`);
  vrai('…et pas dans le premier bloc seulement', centre > 3,
    `${centre.toFixed(0)} ms`);
  vrai('tout est éteint en moins d’une seconde', fin < 1000, `${fin.toFixed(0)} ms`);
  vrai('et rien ne s’emballe', crete <= 1.001, String(crete));
}

console.log('\nplus la salle est grande, plus ça s’étale');
{
  const centres = [0, 4, 8, 12, 16].map((i) => ({
    i, places: SALLES[i].places, centre: centreMs(frapper(i).tranches)
  }));
  for (const c of centres) {
    console.log(`      ${String(c.places).padStart(4)} places → ${c.centre.toFixed(0)} ms`);
  }
  let replis = 0;
  for (let k = 1; k < centres.length; k++) {
    if (centres[k].centre < centres[k - 1].centre) replis++;
  }
  check('le centre de gravité recule à chaque salle', replis, 0);
  vrai('et l’écart s’entend', centres[4].centre > centres[0].centre * 1.5,
    `${centres[0].centre.toFixed(0)} ms → ${centres[4].centre.toFixed(0)} ms`);
}

console.log('\nles deux canaux ne sont pas le même');
{
  const moteur = new ClearCoat(TAUX);
  const g = new Float32Array(N);
  const d = new Float32Array(N);
  g[0] = 1; d[0] = 1;   // MÊME entrée des deux côtés
  let ecart = 0;
  for (let b = 0; b < 40; b++) {
    moteur.traiter(g, d, 6);
    for (let i = 0; i < N; i++) ecart = Math.max(ecart, Math.abs(g[i] - d[i]));
    g.fill(0); d.fill(0);
  }
  vrai('une entrée identique ressort en stéréo', ecart > 0.001,
    `écart ${ecart.toFixed(4)}`);
}

console.log('\nchanger de salle ne traîne pas l’ancienne');
{
  const moteur = new ClearCoat(TAUX);
  const g = new Float32Array(N).fill(0.5);
  const d = new Float32Array(N).fill(0.5);
  moteur.traiter(g, d, 2);
  for (let b = 0; b < 5; b++) { g.fill(0.5); d.fill(0.5); moteur.traiter(g, d, 2); }
  moteur.choisir(14);              // grande salle, longueurs toutes autres
  g.fill(0); d.fill(0);
  moteur.traiter(g, d, 14);
  let reste = 0;
  for (let i = 0; i < N; i++) reste = Math.max(reste, Math.abs(g[i]), Math.abs(d[i]));
  vrai('les lignes sont vidées au changement', reste < 1e-9,
    `reste ${reste}`);
  check('…et la salle est bien celle demandée', moteur.salle, 14);
}

console.log('\nrien ne diverge, même longtemps');
{
  const moteur = new ClearCoat(TAUX);
  const g = new Float32Array(N);
  const d = new Float32Array(N);
  let nan = false, crete = 0, debut = 0, fin = 0;
  for (let b = 0; b < 400; b++) {
    // une onde à plein niveau, en opposition de phase : le pire cas pour
    // quatre étages bouclés l'un sur l'autre
    for (let i = 0; i < N; i++) {
      const v = Math.sin((b * N + i) * 0.07) * 0.9;
      g[i] = v; d[i] = -v;
    }
    moteur.traiter(g, d, 16);
    for (let i = 0; i < N; i++) {
      if (!Number.isFinite(g[i]) || !Number.isFinite(d[i])) nan = true;
      const v = Math.max(Math.abs(g[i]), Math.abs(d[i]));
      crete = Math.max(crete, v);
      if (b >= 50 && b < 150) debut = Math.max(debut, v);
      if (b >= 300) fin = Math.max(fin, v);
    }
  }
  check('pas de NaN sur quatre cents blocs', nan, false);
  // La sortie de réverbe est écrêtée à ±1 par Chris, mais l'étage SubTight
  // passe APRÈS et peut la repousser un peu au-delà. Ce qui compte n'est
  // donc pas un plafond à un : c'est que ça n'ENFLE pas. Le retour est de
  // toute façon dosé bien en dessous (départ × premières).
  vrai('la sortie reste bornée', crete < 2, `crête ${crete.toFixed(3)}`);
  vrai('…et elle n’enfle pas avec le temps', fin <= debut * 1.05,
    `${debut.toFixed(3)} au début, ${fin.toFixed(3)} à la fin`);
}

console.log('\nréglages');
{
  check('l’ampleur choisit une salle',
    [salleDeTaille(0), salleDeTaille(0.5), salleDeTaille(1)], [0, 8, 16]);
  check('une ampleur illisible retombe au milieu', salleDeTaille('grand'), 6);
  check('elle se borne', [salleDeTaille(-3), salleDeTaille(9)], [0, 16]);
  check('la salle se nomme en places', nomDeSalle(6), '225 places');
  check('le niveau se borne',
    [normaliserPremieres(-1), normaliserPremieres(2), normaliserPremieres(0.4)],
    [0, 1, 0.4]);
  check('un niveau illisible retombe sur le défaut',
    normaliserPremieres('beaucoup'), PREMIERES_DEFAUT);

  // le bloc `reverb` d'une pièce porte les deux étages
  check('les défauts de pièce portent les premières réflexions',
    normaliserReverb(undefined).premieres, REVERB_DEFAUTS.premieres);
  vrai('un couloir en a plus qu’un jardin',
    normaliserReverb('couloir').premieres > normaliserReverb('jardin').premieres,
    `${LIEUX.couloir.premieres} contre ${LIEUX.jardin.premieres}`);
  check('on peut les éteindre sans toucher à la queue',
    normaliserReverb({ premieres: 0, duree: 0.7 }),
    { ...REVERB_DEFAUTS, duree: 0.7, premieres: 0 });
}

console.log(`\n${passed} ✓ / ${failed} ✗`);
process.exit(failed ? 1 : 0);

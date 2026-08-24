/**
 * Test de l'écoute de contrôle : Monitoring, porté d'Airwindows.
 *
 * Une loupe qui ment est pire que pas de loupe : on prendrait pour un
 * défaut du mixage ce qui serait un défaut de l'outil. On vérifie donc que
 * chaque mode fait EXACTEMENT ce qu'il annonce, sur des signaux dont on
 * connaît la réponse.
 *
 * Lancer avec : npm test
 */
globalThis.sampleRate = 48000;
globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage() {} }; } };
globalThis.registerProcessor = () => {};

const { Monitoring, MODES } = await import('../engine/src/core/monitoring-worklet.js');
const { modeEcouteValide, MODES_ECOUTE } =
  await import('../engine/src/core/ecoute-modes.js');

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

/** Joue un signal stéréo à travers un mode et rend ce qui en sort. */
function passer(mode, faire, blocs = 200) {
  const m = new Monitoring(TAUX);
  const g = new Float32Array(N);
  const d = new Float32Array(N);
  let creteG = 0, creteD = 0, nan = false;
  let sommeG = 0, sommeD = 0, echantillons = 0;
  for (let b = 0; b < blocs; b++) {
    faire(g, d, b);
    m.traiter(g, d, mode);
    if (b < blocs / 2) continue;   // les cascades ont une mémoire longue
    for (let i = 0; i < N; i++) {
      if (!Number.isFinite(g[i]) || !Number.isFinite(d[i])) nan = true;
      creteG = Math.max(creteG, Math.abs(g[i]));
      creteD = Math.max(creteD, Math.abs(d[i]));
      sommeG += g[i] * g[i]; sommeD += d[i] * d[i];
      echantillons++;
    }
  }
  return { creteG, creteD, nan,
    rmsG: Math.sqrt(sommeG / echantillons), rmsD: Math.sqrt(sommeD / echantillons) };
}

/** Un sinus, à la fréquence et aux amplitudes voulues par canal. */
const sinus = (frequence, ampG, ampD) => {
  let phase = 0;
  const pas = (2 * Math.PI * frequence) / TAUX;
  return (g, d) => {
    for (let i = 0; i < N; i++) {
      const v = Math.sin(phase);
      phase += pas;
      g[i] = v * ampG; d[i] = v * ampD;
    }
  };
};

console.log('\nnormal : la loupe est un passe-plat');
{
  const m = new Monitoring(TAUX);
  const g = new Float32Array(N);
  const d = new Float32Array(N);
  for (let i = 0; i < N; i++) { g[i] = Math.sin(i / 7) * 0.6; d[i] = Math.cos(i / 5) * 0.4; }
  const avantG = Float32Array.from(g);
  const avantD = Float32Array.from(d);
  m.traiter(g, d, 'normal');
  check('rien n’est touché en mode normal',
    [g.every((v, i) => v === avantG[i]), d.every((v, i) => v === avantD[i])],
    [true, true]);
  // un mode inconnu doit se comporter comme « normal », pas comme n'importe quoi
  m.traiter(g, d, 'trompette');
  check('un mode inconnu passe aussi tout droit',
    g.every((v, i) => v === avantG[i]), true);
}

console.log('\nmono : le test de phase');
{
  // deux canaux OPPOSÉS : en mono ils s'annulent, c'est tout l'intérêt
  const opposes = passer('mono', sinus(440, 0.5, -0.5));
  vrai('deux canaux en opposition disparaissent en mono',
    opposes.creteG < 1e-6 && opposes.creteD < 1e-6,
    `${opposes.creteG.toExponential(2)}`);

  // deux canaux identiques : rien ne change
  const memes = passer('mono', sinus(440, 0.5, 0.5));
  vrai('deux canaux identiques traversent le mono intacts',
    Math.abs(memes.creteG - 0.5) < 0.01 && Math.abs(memes.creteD - 0.5) < 0.01,
    `${memes.creteG.toFixed(4)}`);

  // une source à gauche seulement : elle se répartit sur les deux
  const gauche = passer('mono', sinus(440, 0.6, 0));
  vrai('une source d’un seul côté revient au centre',
    Math.abs(gauche.creteG - gauche.creteD) < 1e-6
    && Math.abs(gauche.creteG - 0.3) < 0.01,
    `${gauche.creteG.toFixed(4)} / ${gauche.creteD.toFixed(4)}`);
}

console.log('\ncôté : ce que la spatialisation a fabriqué');
{
  // du mid pur (les deux canaux identiques) : il ne doit RIEN rester
  const centre = passer('cote', sinus(440, 0.5, 0.5));
  vrai('un signal parfaitement centré disparaît du côté',
    centre.creteG < 1e-6, centre.creteG.toExponential(2));

  // du side pur : il reste tel quel
  const large = passer('cote', sinus(440, 0.5, -0.5));
  vrai('un signal en opposition reste entier',
    Math.abs(large.creteG - 0.5) < 0.01, large.creteG.toFixed(4));
}

console.log('\ngraves : vingt-six passe-bas en cascade');
{
  const bas = passer('graves', sinus(45, 0.5, 0.5), 600);
  const haut = passer('graves', sinus(4000, 0.5, 0.5), 600);
  vrai('le très bas passe', bas.rmsG > 0.02, bas.rmsG.toExponential(2));
  vrai('l’aigu est écrasé', haut.rmsG < bas.rmsG / 1000,
    `${haut.rmsG.toExponential(2)} contre ${bas.rmsG.toExponential(2)}`);
  vrai('aucun NaN dans la cascade', !bas.nan && !haut.nan);
}

console.log('\ncrêtes et casque : bornés, et sans NaN');
{
  for (const mode of ['cretes', 'casque']) {
    const r = passer(mode, sinus(440, 0.6, 0.4), 300);
    vrai(`${mode} : rien ne dépasse le raisonnable`,
      r.creteG < 2 && r.creteD < 2, `${r.creteG.toFixed(3)} / ${r.creteD.toFixed(3)}`);
    vrai(`${mode} : aucun NaN`, !r.nan);
    vrai(`${mode} : le signal passe`, r.rmsG > 0.001, r.rmsG.toExponential(2));
  }
}

console.log('\ncasque : la diaphonie existe vraiment');
{
  // Une source à GAUCHE seulement. Sans diaphonie, la droite reste muette ;
  // avec, elle reçoit une part retardée et assombrie. C'est LE test.
  const seul = passer('casque', sinus(440, 0.6, 0), 400);
  vrai('l’oreille droite reçoit une part de la gauche',
    seul.rmsD > seul.rmsG * 0.05,
    `droite ${seul.rmsD.toExponential(2)} contre gauche ${seul.rmsG.toExponential(2)}`);
  vrai('…mais nettement moins qu’elle', seul.rmsD < seul.rmsG,
    `${(seul.rmsD / seul.rmsG).toFixed(3)}`);
}

console.log('\nchanger de loupe ne laisse pas de traîne');
{
  const m = new Monitoring(TAUX);
  const g = new Float32Array(N);
  const d = new Float32Array(N);
  // on charge la cascade de graves, longue mémoire
  for (let b = 0; b < 400; b++) {
    for (let i = 0; i < N; i++) { g[i] = 0.8; d[i] = 0.8; }
    m.traiter(g, d, 'graves');
  }
  m.vider();
  g.fill(0); d.fill(0);
  m.traiter(g, d, 'graves');
  vrai('après vidage, le silence donne le silence',
    g.every((v) => Math.abs(v) < 1e-12), `${g[0]}`);
}

console.log('\nles modes annoncés');
{
  check('le worklet et l’interface parlent des mêmes',
    MODES_ECOUTE.map((m) => m.cle), MODES);
  check('un mode inconnu retombe sur normal',
    [modeEcouteValide('trompette'), modeEcouteValide(undefined),
      modeEcouteValide('casque')], ['normal', 'normal', 'casque']);
  vrai('chaque mode explique ce qu’il apprend',
    MODES_ECOUTE.every((m) => m.nom && m.aide && m.aide.length > 20));
}

console.log(`\n${passed} ✓ / ${failed} ✗`);
process.exit(failed ? 1 : 0);

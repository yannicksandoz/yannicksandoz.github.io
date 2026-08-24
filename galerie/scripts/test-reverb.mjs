/**
 * Test de la réverbération : Verbity, porté d'Airwindows.
 *
 * Une réverbe se juge sur trois choses qu'on peut MESURER : elle sonne
 * après la fin du son (sinon ce n'est pas une queue), elle finit par se
 * taire (sinon c'est un larsen), et elle ne fabrique jamais de NaN — un
 * seul rendrait toute la session muette, et une boucle de contre-réaction
 * est exactement l'endroit où l'on en fabrique.
 *
 * Lancer avec : npm test
 */
globalThis.sampleRate = 48000;
globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage() {} }; } };
globalThis.registerProcessor = () => {};

const { Verbity } = await import('../engine/src/core/reverb-worklet.js');
const { normaliserReverb, reverbDePiece, REVERB_DEFAUTS, LIEUX } =
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
 * Frappe une fois, puis écoute le silence. Rend l'énergie par tranche de
 * temps — c'est la queue, mesurée.
 */
function frapper(A, B, C, { blocsSilence = 400 } = {}) {
  const v = new Verbity(TAUX);
  const g = new Float32Array(N);
  const d = new Float32Array(N);
  let nan = false;
  let crete = 0;

  // l'impulsion : un seul échantillon à plein
  g.fill(0); d.fill(0);
  g[0] = 1; d[0] = 1;
  v.traiter(g, d, A, B, C);

  const tranches = [];
  for (let b = 0; b < blocsSilence; b++) {
    g.fill(0); d.fill(0);
    v.traiter(g, d, A, B, C);
    let energie = 0;
    for (let i = 0; i < N; i++) {
      if (!Number.isFinite(g[i]) || !Number.isFinite(d[i])) nan = true;
      energie += g[i] * g[i] + d[i] * d[i];
      crete = Math.max(crete, Math.abs(g[i]), Math.abs(d[i]));
    }
    tranches.push(Math.sqrt(energie / (N * 2)));
  }
  return { tranches, nan, crete,
    // l'énergie du premier dixième de seconde, et celle d'une seconde après
    tot: (a, b2) => tranches.slice(a, b2).reduce((t, x) => t + x, 0) };
}

console.log('\nune frappe, puis le silence : il reste une queue');
{
  const r = frapper(0.5, 0.5, 0.5);
  vrai('la queue sonne après la frappe', r.tot(0, 40) > 1e-4,
    r.tot(0, 40).toExponential(2));
  vrai('aucun NaN dans la boucle', !r.nan);
  vrai('rien n’explose', r.crete < 4, r.crete.toFixed(3));
}

console.log('\nla queue finit par se taire');
{
  for (const [nom, B] of [['durée courte', 0.2], ['durée moyenne', 0.5],
    ['durée longue', 1]]) {
    const r = frapper(0.5, B, 0.5, { blocsSilence: 1200 });
    const debut = r.tot(0, 100);
    const fin = r.tot(1100, 1200);
    vrai(`${nom} : elle décroît`, fin < debut / 10,
      `${debut.toExponential(2)} → ${fin.toExponential(2)}`);
    vrai(`${nom} : aucun NaN`, !r.nan);
  }
}

console.log('\nplus la durée est longue, plus la queue s’attarde');
{
  const courte = frapper(0.5, 0.1, 0.5, { blocsSilence: 800 });
  const longue = frapper(0.5, 1.0, 0.5, { blocsSilence: 800 });
  vrai('une durée longue garde plus d’énergie à la fin',
    longue.tot(600, 800) > courte.tot(600, 800),
    `${longue.tot(600, 800).toExponential(2)} contre ${courte.tot(600, 800).toExponential(2)}`);
}

console.log('\nle sombre amortit vraiment les aigus');
{
  // On envoie un sifflement entretenu et l'on compare l'énergie qui sort.
  const passer = (C) => {
    const v = new Verbity(TAUX);
    const g = new Float32Array(N);
    const d = new Float32Array(N);
    let phase = 0;
    const pas = (2 * Math.PI * 6000) / TAUX;
    let energie = 0, blocs = 0;
    for (let b = 0; b < 400; b++) {
      for (let i = 0; i < N; i++) {
        const x = Math.sin(phase) * 0.5;
        phase += pas;
        g[i] = x; d[i] = x;
      }
      v.traiter(g, d, 0.5, 0.5, C);
      if (b < 200) continue;
      for (let i = 0; i < N; i++) energie += g[i] * g[i];
      blocs++;
    }
    return Math.sqrt(energie / (blocs * N));
  };
  const clair = passer(0.05);
  const sourd = passer(0.95);
  vrai('un lieu sourd rend moins d’aigu qu’un lieu clair', sourd < clair / 2,
    `${sourd.toExponential(2)} contre ${clair.toExponential(2)}`);
}

console.log('\ntoutes les tailles tiennent');
{
  let fautes = 0;
  for (const A of [0, 0.25, 0.5, 0.75, 1]) {
    const r = frapper(A, 0.8, 0.4, { blocsSilence: 300 });
    if (r.nan || r.crete > 4) fautes++;
  }
  check('aucune taille ne produit de NaN ni d’explosion', fautes, 0);

  // Changer de taille EN MARCHE (passer une porte) : les compteurs doivent
  // rester dans les tampons, sinon on lit à côté et l'on entend un craquement.
  const v = new Verbity(TAUX);
  const g = new Float32Array(N);
  const d = new Float32Array(N);
  let nan = false, crete = 0;
  for (let b = 0; b < 600; b++) {
    for (let i = 0; i < N; i++) { g[i] = Math.sin(i / 3) * 0.4; d[i] = g[i]; }
    // la taille change à chaque bloc, du plus petit au plus grand
    v.traiter(g, d, (b % 40) / 40, 0.7, 0.5);
    for (let i = 0; i < N; i++) {
      if (!Number.isFinite(g[i])) nan = true;
      crete = Math.max(crete, Math.abs(g[i]));
    }
  }
  vrai('changer de taille en marche ne casse rien', !nan && crete < 4,
    `crête ${crete.toFixed(3)}`);
}

console.log('\nvider : la pièce d’avant ne suit pas');
{
  const v = new Verbity(TAUX);
  const g = new Float32Array(N);
  const d = new Float32Array(N);
  for (let b = 0; b < 200; b++) {
    for (let i = 0; i < N; i++) { g[i] = 0.8; d[i] = 0.8; }
    v.traiter(g, d, 0.8, 0.9, 0.3);
  }
  v.vider();
  g.fill(0); d.fill(0);
  v.traiter(g, d, 0.8, 0.9, 0.3);
  let reste = 0;
  for (let i = 0; i < N; i++) reste = Math.max(reste, Math.abs(g[i]));
  vrai('après vidage, le silence donne le silence', reste < 1e-12,
    reste.toExponential(2));
}

console.log('\nréglages et lieux');
{
  check('les défauts', normaliserReverb(undefined), REVERB_DEFAUTS);
  check('la galerie est SÈCHE tant qu’on n’a rien demandé',
    REVERB_DEFAUTS.envoi, 0);
  check('un lieu se nomme', normaliserReverb('belvedere').taille,
    LIEUX.belvedere.taille);
  check('un lieu inconnu retombe sur les défauts',
    normaliserReverb('cathedrale'), REVERB_DEFAUTS);
  check('les valeurs sont bornées',
    [normaliserReverb({ taille: 9 }).taille, normaliserReverb({ envoi: 9 }).envoi,
      normaliserReverb({ duree: -1 }).duree], [1, 0.5, 0]);
  check('une valeur illisible retombe sur le défaut',
    normaliserReverb({ sombre: 'humide' }).sombre, REVERB_DEFAUTS.sombre);

  // La pièce l'emporte sur la galerie, la galerie sur les défauts.
  check('la pièce décide la première',
    reverbDePiece({ reverb: 'belvedere' }, { audio: { reverb: 'salle' } }).taille,
    LIEUX.belvedere.taille);
  check('sinon la galerie',
    reverbDePiece({}, { audio: { reverb: 'salle' } }).envoi, LIEUX.salle.envoi);
  check('sinon rien', reverbDePiece({}, {}), REVERB_DEFAUTS);

  vrai('chaque lieu tout fait porte un nom lisible',
    Object.values(LIEUX).every((l) => typeof l.nom === 'string' && l.nom.length > 2));
  vrai('…et reste dans les bornes',
    Object.entries(LIEUX).every(([cle]) => {
      const r = normaliserReverb(cle);
      return r.envoi <= 0.5 && r.taille <= 1 && r.duree <= 1;
    }));
}

console.log(`\n${passed} ✓ / ${failed} ✗`);
process.exit(failed ? 1 : 0);

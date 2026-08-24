/**
 * Test du lointain : Distance2, porté d'Airwindows.
 *
 * Ce que le portage doit tenir, et qui se mesure :
 *
 *  1. À ZÉRO, IL N'EXISTE PAS. Le mélange sec/traité est le troisième
 *     réglage de Chris : à zéro, la sortie doit être l'entrée, ÉCHANTILLON
 *     PAR ÉCHANTILLON. Une œuvre qui ne demande rien ne doit pas être
 *     touchée — c'est le cas de presque toutes.
 *  2. ÇA ÉMOUSSE, ET DE PLUS EN PLUS. C'est tout le propos : la cascade de
 *     limiteurs de pente empêche le signal de monter vite, donc mange
 *     l'aigu. Plus le réglage monte, moins il en reste — sans repli, sinon
 *     « plus loin » sonnerait « plus proche ».
 *  3. LE TAUX D'ÉCHANTILLONNAGE NE CHANGE PAS LE SON. Les seuils sont
 *     divisés par l'échelle et la pente multipliée : à 96 kHz, le même son
 *     doit s'assourdir autant qu'à 44,1. C'est la partie du portage la plus
 *     facile à rater et la plus difficile à entendre.
 *  4. RIEN NE DIVERGE, RIEN N'EST NaN. Il y a un étage IIR à contre-réaction
 *     dans la chaîne ; un seul NaN rendrait l'œuvre muette pour la session.
 *
 * Lancer avec : npm test
 */
globalThis.sampleRate = 48000;
globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage() {} }; } };
globalThis.registerProcessor = () => {};

const { Distance2 } = await import('../engine/src/core/lointain-worklet.js');
const { normaliserLointain, repereLointain, REPERES, SEUIL } =
  await import('../engine/src/core/lointain-reglages.js');

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

const N = 128;

/** Bruit reproductible : un générateur congruentiel, jamais Math.random. */
function bruit(n, graine = 12345) {
  const out = new Float64Array(n);
  let e = graine;
  for (let i = 0; i < n; i++) {
    e = (e * 1103515245 + 12345) & 0x7fffffff;
    out[i] = ((e / 0x7fffffff) * 2 - 1) * 0.5;
  }
  return out;
}

/**
 * Passe le signal entier par blocs de 128, en stéréo (deux copies), comme le
 * fait le worklet : atmosphère et assombrissement à la valeur demandée,
 * mélange au plein.
 */
function passer(signal, valeur, taux = 48000, melange = Math.min(1, valeur * 2)) {
  const moteur = new Distance2(taux);
  const sortie = new Float64Array(signal.length);
  const g = new Float32Array(N);
  const d = new Float32Array(N);
  let nan = false;
  for (let b = 0; b + N <= signal.length; b += N) {
    for (let i = 0; i < N; i++) { g[i] = signal[b + i]; d[i] = signal[b + i]; }
    moteur.traiter(g, d, valeur, valeur, melange);
    for (let i = 0; i < N; i++) {
      if (!Number.isFinite(g[i])) nan = true;
      sortie[b + i] = g[i];
    }
  }
  return { sortie, nan };
}

const rms = (a, depuis = 0) => {
  let s = 0, n = 0;
  for (let i = depuis; i < a.length; i++) { s += a[i] * a[i]; n++; }
  return Math.sqrt(s / Math.max(1, n));
};

/**
 * Part d'aigu dans le signal : l'énergie de la DIFFÉRENCE d'un échantillon
 * au suivant, rapportée à l'énergie totale. Un son sourd a des pentes
 * douces, donc une différence faible — c'est exactement ce que la cascade de
 * limiteurs attaque.
 */
function partAigu(a, depuis = 0) {
  const diff = new Float64Array(a.length - depuis);
  for (let i = depuis + 1; i < a.length; i++) diff[i - depuis] = a[i] - a[i - 1];
  const total = rms(a, depuis);
  return total > 0 ? rms(diff) / total : 0;
}

console.log('\nà zéro, le lointain n’existe pas');
{
  const src = bruit(N * 8);
  const ecartMax = (sortie) => {
    let e = 0;
    for (let i = 0; i < sortie.length; i++) {
      e = Math.max(e, Math.abs(sortie[i] - Math.fround(src[i])));
    }
    return e;
  };
  // À valeur nulle, le mélange l'est aussi : le sec ressort intact, bit pour
  // bit. C'est toute la raison d'être de la course de mélange (voir
  // l'en-tête du worklet) — l'algorithme, lui, n'est PAS transparent à
  // atmosphère nulle, et la ligne suivante le montre.
  const nul = passer(src, 0);
  vrai('à valeur nulle, la sortie EST l’entrée', ecartMax(nul.sortie) < 1e-6,
    `écart ${ecartMax(nul.sortie)}`);
  const sansMelange = passer(src, 0, 48000, 1);
  vrai('…alors que l’algorithme seul, lui, mord déjà',
    ecartMax(sansMelange.sortie) > 0.05,
    `écart ${ecartMax(sansMelange.sortie).toFixed(3)}`);
  check('et rien n’est NaN', [nul.nan, sansMelange.nan], [false, false]);
}

console.log('\nplus on monte, plus ça recule');
{
  // Le réglage tel que la galerie s'en sert. L'œuvre recule à deux titres :
  // elle s'assourdit ET elle baisse — les deux indices que l'oreille
  // additionne pour juger d'une distance. Aucun des deux ne doit se
  // retourner en cours de course.
  const src = bruit(N * 24);
  const brutNiveau = rms(src, N * 4);
  const brutAigu = partAigu(src, N * 4);
  const mesures = [0.25, 0.5, 0.75, 1].map((v) => {
    const { sortie, nan } = passer(src, v);
    return {
      v, nan,
      niveau: rms(sortie, N * 4),
      aigu: partAigu(sortie, N * 4),
      crete: Math.max(...Array.from(sortie).map(Math.abs))
    };
  });
  for (const m of mesures) {
    console.log(`      ${m.v.toFixed(2)} → niveau ${(m.niveau / brutNiveau * 100).toFixed(1)} %`
      + `, aigu ${(m.aigu / brutAigu * 100).toFixed(1)} %, crête ${m.crete.toFixed(2)}`);
  }
  vrai('un quart de lointain éloigne déjà', mesures[0].niveau < brutNiveau * 0.95,
    `${(mesures[0].niveau / brutNiveau * 100).toFixed(1)} %`);
  // L'AIGU est le vrai indice de distance, et lui ne doit jamais se
  // retourner. Le niveau, si : la correction de niveau de Chris le fait
  // légèrement remonter au tout bout de la course (4 % à 0,8 puis 7,6 % à
  // fond) pendant que le son continue de s'éteindre. On exige donc de lui
  // qu'il reste bas, pas qu'il descende à chaque cran.
  let replis = 0;
  for (let i = 1; i < mesures.length; i++) {
    if (mesures[i].aigu > mesures[i - 1].aigu * 1.001) replis++;
  }
  check('l’aigu ne remonte jamais', replis, 0);
  vrai('et le niveau ne repasse jamais au-dessus du premier cran',
    mesures.every((m) => m.niveau <= mesures[0].niveau),
    mesures.map((m) => `${(m.niveau / brutNiveau * 100).toFixed(1)} %`).join(' / '));
  vrai('à fond, il ne reste presque plus d’aigu',
    mesures[3].aigu < brutAigu * 0.5, `${(mesures[3].aigu / brutAigu * 100).toFixed(1)} %`);
  check('aucun NaN nulle part', mesures.map((m) => m.nan), [false, false, false, false]);
  vrai('et rien ne s’emballe', mesures.every((m) => m.crete < 4),
    mesures.map((m) => m.crete.toFixed(2)).join(' / '));
}

console.log('\nle mélange de Chris reste un mélange');
{
  // La galerie le tient au plein (voir l'en-tête du worklet), mais le
  // troisième réglage de Chris est porté et doit se comporter comme tel :
  // à mi-course, on doit entendre exactement la moitié de chaque.
  // Le mélange n'est pas un simple fondu : chez Chris il entre AVANT les
  // limiteurs (« clean up w. dry introduced »), il change donc le traitement
  // autant qu'il le dose. Ce qui doit rester vrai, c'est l'encadrement.
  const src = bruit(N * 12);
  const mesure = (m) => {
    const s = passer(src, 0.8, 48000, m).sortie;
    return { niveau: rms(s, N * 4), aigu: partAigu(s, N * 4) };
  };
  const sec = mesure(0), moitie = mesure(0.5), plein = mesure(1);
  vrai('à mi-mélange, le niveau est entre les deux',
    moitie.niveau < sec.niveau && moitie.niveau > plein.niveau,
    `${plein.niveau.toFixed(3)} < ${moitie.niveau.toFixed(3)} < ${sec.niveau.toFixed(3)}`);
  vrai('…et l’aigu aussi',
    moitie.aigu < sec.aigu && moitie.aigu > plein.aigu,
    `${plein.aigu.toFixed(3)} < ${moitie.aigu.toFixed(3)} < ${sec.aigu.toFixed(3)}`);
}

console.log('\nle taux d’échantillonnage ne change pas le son');
{
  // même onde, en Hz, à deux taux : 2 kHz sur un demi-million d'échantillons
  const onde = (taux, n) => {
    const a = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      a[i] = Math.sin(2 * Math.PI * 2000 * i / taux) * 0.4
        + Math.sin(2 * Math.PI * 7000 * i / taux) * 0.3;
    }
    return a;
  };
  const mesure = (taux, valeur) => {
    const n = N * Math.round(taux / 48000) * 64;
    const src = onde(taux, n);
    const { sortie } = passer(src, valeur, taux);
    return {
      niveau: rms(sortie, n / 4) / rms(src, n / 4),
      aigu: partAigu(sortie, n / 4) / partAigu(src, n / 4)
    };
  };
  const ecart = (x, y) => Math.abs(x - y) / Math.max(x, y);
  for (const v of [0.3, 0.5]) {
    // 44,1 et 48 kHz : les deux taux qu'un navigateur choisit vraiment. Là,
    // tout doit se superposer, niveau compris.
    const a = mesure(44100, v), b = mesure(48000, v);
    console.log(`      ${v} → 44,1 kHz : niveau ${(a.niveau * 100).toFixed(1)} %,`
      + ` aigu ${(a.aigu * 100).toFixed(1)} % · 48 kHz : niveau`
      + ` ${(b.niveau * 100).toFixed(1)} %, aigu ${(b.aigu * 100).toFixed(1)} %`);
    vrai(`à ${v}, 44,1 et 48 kHz assourdissent pareil`,
      ecart(a.aigu, b.aigu) < 0.1, `${a.aigu.toFixed(3)} contre ${b.aigu.toFixed(3)}`);
    vrai('…et baissent pareil', ecart(a.niveau, b.niveau) < 0.15,
      `${a.niveau.toFixed(3)} contre ${b.niveau.toFixed(3)}`);
  }
  {
    // 96 kHz : l'assombrissement suit encore, mais pas le niveau. C'est
    // l'algorithme de Chris, pas le portage : les limiteurs comparent un
    // signal mis à l'échelle du taux à une ligne à retard qui, elle, ne
    // l'est pas — à 96 kHz ils mordent donc plus fort. On le constate, on ne
    // le corrige pas : corriger, ce serait écrire un autre algorithme, et
    // aucun navigateur ne monte là sans qu'on le lui demande.
    const a = mesure(48000, 0.5), b = mesure(96000, 0.5);
    console.log(`      0.5 → 96 kHz : niveau ${(b.niveau * 100).toFixed(1)} %,`
      + ` aigu ${(b.aigu * 100).toFixed(1)} %`);
    vrai('à 96 kHz, l’assombrissement tient encore',
      ecart(a.aigu, b.aigu) < 0.2, `${a.aigu.toFixed(3)} contre ${b.aigu.toFixed(3)}`);
    vrai('…et le son n’y disparaît pas', b.niveau > 0.02,
      `${(b.niveau * 100).toFixed(1)} %`);
  }
}

console.log('\nrien ne diverge, même longtemps');
{
  // du continu à plein niveau : le pire cas pour un étage IIR bouclé
  const src = new Float64Array(N * 200).fill(0.95);
  const { sortie, nan } = passer(src, 1);
  check('pas de NaN sur deux cent blocs', nan, false);
  const fin = Math.max(...Array.from(sortie.slice(-N)).map(Math.abs));
  vrai('et la sortie reste bornée', fin < 4, `crête finale ${fin.toFixed(2)}`);

  // …et le silence redevient le silence. L'étage « offset air compression »
  // pose un continu (voir l'en-tête du worklet) : sans le bloqueur, une
  // œuvre muette enverrait 0,12 de continu dans la console, pour toujours.
  const moteur = new Distance2(48000);
  const g = new Float32Array(N).fill(0.9);
  const d = new Float32Array(N).fill(0.9);
  moteur.traiter(g, d, 1, 1, 1);
  let reste = 0;
  for (let b = 0; b < 40; b++) {
    g.fill(0); d.fill(0);
    moteur.traiter(g, d, 1, 1, 1);
    reste = Math.max(...Array.from(g).map(Math.abs));
  }
  vrai('après une seconde de silence, il ne reste pas de continu',
    reste < 0.001, `reste ${reste.toFixed(5)}`);
}

console.log('\nstéréo');
{
  const gauche = bruit(N * 4, 7);
  const droite = bruit(N * 4, 99);
  const moteur = new Distance2(48000);
  const g = Float32Array.from(gauche.slice(0, N));
  const d = Float32Array.from(droite.slice(0, N));
  moteur.traiter(g, d, 0.6, 0.6, 0.6);
  // le même canal gauche, seul, doit donner exactement la même chose : les
  // deux états sont séparés, aucun ne déteint sur l'autre
  const seul = new Distance2(48000);
  const g2 = Float32Array.from(gauche.slice(0, N));
  seul.traiter(g2, g2, 0.6, 0.6, 0.6);
  let ecart = 0;
  for (let i = 0; i < N; i++) ecart = Math.max(ecart, Math.abs(g[i] - g2[i]));
  vrai('les deux canaux ne se mélangent pas', ecart === 0, `écart ${ecart}`);
  let differe = false;
  for (let i = 0; i < N; i++) if (g[i] !== d[i]) differe = true;
  vrai('…et la droite suit sa propre entrée', differe);
}

console.log('\nréglages');
{
  check('les valeurs se bornent',
    [normaliserLointain(-1), normaliserLointain(2), normaliserLointain(0.4)],
    [0, 1, 0.4]);
  check('une valeur illisible vaut zéro',
    [normaliserLointain(undefined), normaliserLointain('loin'), normaliserLointain(NaN)],
    [0, 0, 0]);
  check('les repères encadrent la course',
    [repereLointain(0), repereLointain(1)],
    [REPERES[0][1], REPERES[REPERES.length - 1][1]]);
  vrai('le seuil laisse la place à un vrai zéro', SEUIL > 0 && SEUIL < 0.05);
}

console.log(`\n${passed} ✓ / ${failed} ✗`);
process.exit(failed ? 1 : 0);

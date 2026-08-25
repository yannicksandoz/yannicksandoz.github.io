/**
 * Test du grand espace : Galactic2, porté d'Airwindows.
 *
 * Ce moteur n'est pas une autre couleur de pièce, c'est autre chose — et
 * c'est cela qu'on mesure, en le comparant à Verbity quand il le faut :
 *
 *  1. LA QUEUE S'INSTALLE. La contre-réaction de Chris se nourrit d'elle-
 *     même : à durée maximale, l'énergie ne doit PAS s'être effondrée après
 *     plusieurs secondes. C'est la propriété qu'aucune réverbe de pièce n'a,
 *     et toute la raison de le porter.
 *  2. …MAIS ELLE OBÉIT. À durée faible, ça s'éteint. Sinon ce n'est plus un
 *     réglage, c'est un accident.
 *  3. ÇA NE S'EMBALLE JAMAIS. Une boucle qui grandit, c'est un larsen à
 *     retardement : l'arc sinus de sortie doit tenir le niveau même quand on
 *     pousse tout au maximum pendant longtemps.
 *  4. ASSOMBRIR ASSOMBRIT. Les cinq étages de lissage s'allument par seuils ;
 *     le centre de gravité du spectre doit descendre, sans repli.
 *  5. LES DEUX OREILLES ENTENDENT LE MÊME DEHORS, mais pas la même chose :
 *     les canaux s'échangent leur premier retour et doivent rester
 *     différents.
 *  6. RIEN N'EST NaN, jamais.
 *
 * Lancer avec : npm test
 */
globalThis.sampleRate = 48000;
globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage() {} }; } };
globalThis.registerProcessor = () => {};

const { Galactic2 } = await import('../engine/src/core/galactique-worklet.js');
const { normaliserReverb, REVERB_DEFAUTS, MOTEURS, LIEUX } =
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
const BLOCS_PAR_SECONDE = TAUX / N;   // 375

/**
 * Excite l'espace pendant `charge` secondes, puis écoute le silence.
 * Rend l'énergie par tranche, la crête, et de quoi juger de la couleur.
 */
function exciter(duree, sombre, { charge = 0.5, ecoute = 4 } = {}) {
  const m = new Galactic2(TAUX);
  const g = new Float32Array(N);
  const d = new Float32Array(N);
  let nan = false, crete = 0;
  const blocsCharge = Math.round(charge * BLOCS_PAR_SECONDE);
  const blocsEcoute = Math.round(ecoute * BLOCS_PAR_SECONDE);
  let graine = 4242;
  for (let b = 0; b < blocsCharge; b++) {
    for (let i = 0; i < N; i++) {
      graine = (graine * 1103515245 + 12345) & 0x7fffffff;
      const v = ((graine / 0x7fffffff) * 2 - 1) * 0.5;
      g[i] = v; d[i] = v;
    }
    m.traiter(g, d, 1, duree, sombre);
    for (let i = 0; i < N; i++) crete = Math.max(crete, Math.abs(g[i]), Math.abs(d[i]));
  }
  const tranches = [];
  let aigu = 0, total = 0;
  for (let b = 0; b < blocsEcoute; b++) {
    g.fill(0); d.fill(0);
    m.traiter(g, d, 1, duree, sombre);
    let e = 0;
    for (let i = 0; i < N; i++) {
      if (!Number.isFinite(g[i]) || !Number.isFinite(d[i])) nan = true;
      crete = Math.max(crete, Math.abs(g[i]), Math.abs(d[i]));
      e += (g[i] * g[i]) + (d[i] * d[i]);
      if (i > 0) { const dif = g[i] - g[i - 1]; aigu += dif * dif; }
      total += g[i] * g[i];
    }
    tranches.push(e);
  }
  return {
    tranches, nan, crete,
    // la part d'aigu : l'énergie des différences, rapportée au total
    couleur: total > 0 ? Math.sqrt(aigu / total) : 0
  };
}

/** L'énergie d'une seconde donnée après la fin de l'excitation. */
const seconde = (tranches, n) => {
  const debut = Math.round(n * BLOCS_PAR_SECONDE);
  const fin = Math.min(tranches.length, Math.round((n + 1) * BLOCS_PAR_SECONDE));
  let e = 0;
  for (let i = debut; i < fin; i++) e += tranches[i];
  return e;
};

console.log('\nla queue s’installe au lieu de mourir');
{
  const longue = exciter(1, 0.5, { ecoute: 6 });
  const e0 = seconde(longue.tranches, 0);
  const db = (n) => 10 * Math.log10(seconde(longue.tranches, n) / e0);
  console.log(`      durée 1 : ${[1, 2, 3, 5].map((n) => `${n} s ${db(n).toFixed(0)} dB`)
    .join(' · ')} · crête ${longue.crete.toFixed(2)}`);
  check('aucun NaN', longue.nan, false);
  // C'est LA propriété du moteur, et elle tenait à une seule ligne : les
  // quatre gains de retour partent de un, pas du plancher du clamp. Mal
  // initialisés, ils démarraient quarante décibels trop bas et la queue
  // mourait comme celle d'une pièce (−39 dB à cinq secondes).
  vrai('à durée maximale, elle tient cinq secondes',
    seconde(longue.tranches, 5) > e0 * 0.1, `${db(5).toFixed(0)} dB`);

  const courte = exciter(0.15, 0.5, { ecoute: 6 });
  const c0 = seconde(courte.tranches, 0);
  const c3 = seconde(courte.tranches, 3);
  console.log(`      durée 0,15 : ${(10 * Math.log10(c3 / c0)).toFixed(1)} dB`
    + ' après trois secondes');
  vrai('à durée faible, elle s’éteint vite', c3 < c0 * 0.05,
    `${(10 * Math.log10(c3 / c0)).toFixed(1)} dB`);
  vrai('…et à durée maximale, elle s’attarde bien plus',
    seconde(longue.tranches, 3) > seconde(courte.tranches, 3) * 10,
    `${db(3).toFixed(0)} dB contre ${(10 * Math.log10(c3 / c0)).toFixed(0)} dB`);

  // La comparaison qui compte : la PIÈCE, poussée autant, ne tient pas
  // aussi longtemps. C'est ce qui justifie de porter un second moteur.
  const { Verbity } = await import('../engine/src/core/reverb-worklet.js');
  const piece = (() => {
    const v = new Verbity(TAUX);
    const g = new Float32Array(N);
    const d = new Float32Array(N);
    let graine = 4242;
    for (let b = 0; b < Math.round(0.5 * BLOCS_PAR_SECONDE); b++) {
      for (let i = 0; i < N; i++) {
        graine = (graine * 1103515245 + 12345) & 0x7fffffff;
        const x = ((graine / 0x7fffffff) * 2 - 1) * 0.5;
        g[i] = x; d[i] = x;
      }
      v.traiter(g, d, 1, 1, 0.5);          // taille et durée au maximum
    }
    const tranches = [];
    for (let b = 0; b < Math.round(6 * BLOCS_PAR_SECONDE); b++) {
      g.fill(0); d.fill(0);
      v.traiter(g, d, 1, 1, 0.5);
      let e = 0;
      for (let i = 0; i < N; i++) e += (g[i] * g[i]) + (d[i] * d[i]);
      tranches.push(e);
    }
    return tranches;
  })();
  const p0 = seconde(piece, 0);
  const rapport = (seconde(longue.tranches, 5) / e0) / (seconde(piece, 5) / p0);
  console.log(`      la pièce, poussée autant : ${(10 * Math.log10(seconde(piece, 5) / p0))
    .toFixed(0)} dB après cinq secondes`);
  vrai('l’espace tient bien plus longtemps que la pièce', rapport > 100,
    `${(10 * Math.log10(rapport)).toFixed(0)} dB d’écart à cinq secondes`);
}

console.log('\nça ne s’emballe jamais');
{
  // tout au maximum, et longtemps : c'est là qu'une boucle qui grandit se
  // trahit. L'arc sinus de sortie est ce qui doit l'en empêcher.
  const m = new Galactic2(TAUX);
  const g = new Float32Array(N);
  const d = new Float32Array(N);
  let nan = false, debut = 0, fin = 0, crete = 0;
  let graine = 99;
  const blocs = Math.round(20 * BLOCS_PAR_SECONDE);
  for (let b = 0; b < blocs; b++) {
    for (let i = 0; i < N; i++) {
      graine = (graine * 1103515245 + 12345) & 0x7fffffff;
      const v = ((graine / 0x7fffffff) * 2 - 1) * 0.9;
      g[i] = v; d[i] = -v;
    }
    m.traiter(g, d, 1, 1, 1);
    for (let i = 0; i < N; i++) {
      if (!Number.isFinite(g[i]) || !Number.isFinite(d[i])) nan = true;
      const v = Math.max(Math.abs(g[i]), Math.abs(d[i]));
      crete = Math.max(crete, v);
      if (b > BLOCS_PAR_SECONDE * 2 && b < BLOCS_PAR_SECONDE * 5) debut = Math.max(debut, v);
      if (b > BLOCS_PAR_SECONDE * 17) fin = Math.max(fin, v);
    }
  }
  console.log(`      vingt secondes à fond : crête ${crete.toFixed(2)}`
    + ` · ${debut.toFixed(2)} au début contre ${fin.toFixed(2)} à la fin`);
  check('pas de NaN sur vingt secondes à fond', nan, false);
  vrai('la sortie reste bornée', crete <= 2.001, `crête ${crete.toFixed(3)}`);
  vrai('…et elle n’enfle pas avec le temps', fin <= debut * 1.1,
    `${debut.toFixed(3)} → ${fin.toFixed(3)}`);
}

console.log('\nassombrir assombrit');
{
  const couleurs = [0, 0.25, 0.5, 0.75, 1].map((s) => ({
    s, c: exciter(0.6, s, { ecoute: 2 }).couleur
  }));
  console.log(`      ${couleurs.map((x) => x.c.toFixed(3)).join(' · ')}`);
  let replis = 0;
  for (let i = 1; i < couleurs.length; i++) {
    if (couleurs[i].c > couleurs[i - 1].c * 1.02) replis++;
  }
  check('la couleur descend sans repli', replis, 0);
  vrai('et l’écart s’entend', couleurs[4].c < couleurs[0].c * 0.8,
    `${couleurs[0].c.toFixed(3)} → ${couleurs[4].c.toFixed(3)}`);
}

console.log('\nun seul dehors, deux oreilles');
{
  const m = new Galactic2(TAUX);
  const g = new Float32Array(N);
  const d = new Float32Array(N);
  g[0] = 1; d[0] = 1;              // MÊME frappe des deux côtés
  let ecart = 0;
  for (let b = 0; b < 200; b++) {
    m.traiter(g, d, 1, 0.6, 0.5);
    for (let i = 0; i < N; i++) ecart = Math.max(ecart, Math.abs(g[i] - d[i]));
    g.fill(0); d.fill(0);
  }
  vrai('les deux canaux ne disent pas la même chose', ecart > 1e-4,
    `écart ${ecart.toFixed(5)}`);
}

console.log('\nvider, c’est vider');
{
  const m = new Galactic2(TAUX);
  const g = new Float32Array(N).fill(0.5);
  const d = new Float32Array(N).fill(0.5);
  for (let b = 0; b < 200; b++) { g.fill(0.5); d.fill(0.5); m.traiter(g, d, 1, 1, 0.5); }
  m.vider();
  g.fill(0); d.fill(0);
  m.traiter(g, d, 1, 1, 0.5);
  let reste = 0;
  for (let i = 0; i < N; i++) reste = Math.max(reste, Math.abs(g[i]), Math.abs(d[i]));
  vrai('après remise à zéro, plus rien ne sort', reste < 1e-9, `reste ${reste}`);
}

console.log('\nréglages');
{
  check('les deux moteurs existent', Object.keys(MOTEURS), ['verbity', 'galactique']);
  check('une pièce est une pièce par défaut', REVERB_DEFAUTS.moteur, 'verbity');
  check('on choisit l’autre par son nom',
    normaliserReverb({ moteur: 'galactique' }).moteur, 'galactique');
  check('un moteur inconnu retombe sur la pièce',
    [normaliserReverb({ moteur: 'plaque' }).moteur,
      normaliserReverb({ moteur: 42 }).moteur], ['verbity', 'verbity']);
  check('le belvédère est le seul lieu tout fait qui change de moteur',
    Object.entries(LIEUX).filter(([, l]) => l.moteur === 'galactique').map(([k]) => k),
    ['belvedere']);
  check('…et le choix survit à la relecture',
    normaliserReverb('belvedere').moteur, 'galactique');
}

console.log(`\n${passed} ✓ / ${failed} ✗`);
process.exit(failed ? 1 : 0);

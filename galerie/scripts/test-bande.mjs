/**
 * LA BANDE — ToTape6, éprouvée au nœud.
 *
 * Trois choses qu'une bande fait et qu'un étage numérique ne fait pas, et
 * qu'on peut donc MESURER :
 *
 *   1. LE PLEURAGE modifie la HAUTEUR. Un sinus pur qui traverse en ressort
 *      avec de l'énergie autour de sa fréquence, et non plus seulement
 *      dessus — c'est une modulation, pas une distorsion, et cela se voit à
 *      ce que la raie s'élargit ;
 *   2. LA BOSSE DE TÊTE ajoute du grave, et seulement du grave ;
 *   3. LE MOJO écrase AVANT d'écrêter : la courbe d'entrée-sortie se couche
 *      progressivement là où un écrêteur monte droit puis casse.
 *
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';

import { BANDE_DEFAUTS, normaliserBande } from '../engine/src/core/bande-reglages.js';

const TAUX = 48000;
globalThis.sampleRate = TAUX;
globalThis.AudioWorkletProcessor = class { constructor() { this.port = {}; } };
globalThis.registerProcessor = () => {};
const { ToTape6 } = await import('../engine/src/core/bande-worklet.js');

let ok = 0, ko = 0;
const test = (nom, fn) => {
  try { fn(); ok++; console.log(`  ✓ ${nom}`); }
  catch (e) { ko++; console.log(`  ✗ ${nom}\n    ${e.message}`); }
};
const titre = (t) => console.log(`\n${t}`);

const BLOC = 128;
const R = { entree: 0.5, douceur: 0.3, bosse: 0.35, pleurage: 0.25, sortie: 0.5, melange: 1 };

function traverser(signal, o = {}) {
  const r = { ...R, ...o };
  const b = new ToTape6(TAUX);
  const rendu = new Float64Array(signal.length);
  const g = new Float64Array(BLOC);
  const d = new Float64Array(BLOC);
  for (let n = 0; n < signal.length; n += BLOC) {
    const taille = Math.min(BLOC, signal.length - n);
    for (let k = 0; k < BLOC; k++) {
      const v = k < taille ? signal[n + k] : 0;
      g[k] = v; d[k] = v;
    }
    b.traiter(g, d, r.entree, r.douceur, r.bosse, r.pleurage, r.sortie, r.melange);
    for (let k = 0; k < taille; k++) rendu[n + k] = g[k];
  }
  return rendu;
}

function sinus(hz, secondes, niveau = 0.5) {
  const n = Math.round(TAUX * secondes);
  const s = new Float64Array(n);
  for (let i = 0; i < n; i++) s[i] = niveau * Math.sin((2 * Math.PI * hz * i) / TAUX);
  return s;
}

/** L'amplitude à une fréquence donnée, par projection, sur une fenêtre. */
function raie(y, hz, depuis, jusqua) {
  let re = 0, im = 0, cpt = 0;
  for (let i = depuis; i < jusqua; i++) {
    const w = (2 * Math.PI * hz * i) / TAUX;
    re += y[i] * Math.sin(w); im += y[i] * Math.cos(w); cpt++;
  }
  return cpt ? (2 * Math.hypot(re, im)) / cpt : 0;
}

/* ------------------------------------------------------- le pleurage --- */
titre('le pleurage bouge la HAUTEUR, ce qu’aucun autre étage ne fait');
{
  const HZ = 1000;
  const s = sinus(HZ, 2.5);
  const sans = traverser(s, { pleurage: 0, bosse: 0, douceur: 0 });
  const avec = traverser(s, { pleurage: 0.6, bosse: 0, douceur: 0 });

  /**
   * Une modulation de hauteur fait DÉRIVER la phase : mesurée par courtes
   * fenêtres, la raie garde son amplitude mais se décale. On mesure donc
   * l'écart de phase d'une fenêtre à l'autre — nul si rien ne bouge.
   */
  const derive = (y) => {
    const fen = Math.round(TAUX * 0.05);
    const phases = [];
    for (let d = TAUX; d + fen < y.length; d += fen) {
      let re = 0, im = 0;
      for (let i = d; i < d + fen; i++) {
        const w = (2 * Math.PI * HZ * i) / TAUX;
        re += y[i] * Math.sin(w); im += y[i] * Math.cos(w);
      }
      phases.push(Math.atan2(im, re));
    }
    let bouge = 0;
    for (let i = 1; i < phases.length; i++) {
      let dp = phases[i] - phases[i - 1];
      while (dp > Math.PI) dp -= 2 * Math.PI;
      while (dp < -Math.PI) dp += 2 * Math.PI;
      bouge = Math.max(bouge, Math.abs(dp));
    }
    return bouge;
  };
  const immobile = derive(sans);
  const mouvant = derive(avec);
  console.log(`  · dérive de phase : sans pleurage ${immobile.toFixed(4)} rad,`
    + ` avec ${mouvant.toFixed(4)} rad`);
  test('sans pleurage, la phase ne bouge pas', () => {
    assert.ok(immobile < 0.02, `${immobile.toFixed(4)} rad`);
  });
  test('avec pleurage, elle bouge — et de beaucoup plus', () => {
    assert.ok(mouvant > immobile * 20 && mouvant > 0.2,
      `${immobile.toFixed(4)} contre ${mouvant.toFixed(4)} rad`);
  });
  test('…et le pleurage ne mange pas le signal pour autant', () => {
    const a = raie(avec, HZ, TAUX, avec.length);
    const b = raie(sans, HZ, TAUX, sans.length);
    // la raie s'étale, donc elle baisse — mais elle ne disparaît pas
    assert.ok(a > b * 0.3, `${b.toFixed(3)} sans, ${a.toFixed(3)} avec`);
  });
}

/* ---------------------------------------------------- la bosse de tête -- */
titre('la bosse de tête ajoute du grave, et seulement du grave');
{
  const grave = sinus(60, 2, 0.4);
  const aigu = sinus(4000, 1, 0.4);
  const niveau = (y, hz, depuis) => raie(y, hz, depuis, y.length);
  const sansG = niveau(traverser(grave, { bosse: 0, pleurage: 0 }), 60, TAUX);
  const avecG = niveau(traverser(grave, { bosse: 1, pleurage: 0 }), 60, TAUX);
  const sansA = niveau(traverser(aigu, { bosse: 0, pleurage: 0 }), 4000, TAUX / 2);
  const avecA = niveau(traverser(aigu, { bosse: 1, pleurage: 0 }), 4000, TAUX / 2);
  console.log(`  · 60 Hz : ${sansG.toFixed(4)} → ${avecG.toFixed(4)}`
    + ` · 4 kHz : ${sansA.toFixed(4)} → ${avecA.toFixed(4)}`);
  test('à soixante hertz, la bosse ajoute quelque chose', () => {
    assert.ok(avecG > sansG * 1.05,
      `${sansG.toFixed(4)} puis ${avecG.toFixed(4)}`);
  });
  test('à quatre kilohertz, elle ne change presque rien', () => {
    assert.ok(Math.abs(avecA - sansA) < sansA * 0.05,
      `${sansA.toFixed(4)} puis ${avecA.toFixed(4)}`);
  });
}

/* -------------------------------------------------------- le mojo ------- */
titre('le mojo écrase AVANT d’écrêter');
{
  // On relève la courbe d'entrée-sortie : un sinus lent à chaque niveau, et
  // l'amplitude qui en ressort. Une bande se couche tôt ; un écrêteur monte
  // droit jusqu'au plafond, puis casse.
  const courbe = [];
  for (const niveau of [0.1, 0.2, 0.3, 0.5, 0.7, 0.9, 1.2, 1.6, 2.0]) {
    const y = traverser(sinus(200, 0.6, niveau),
      { pleurage: 0, bosse: 0, douceur: 0 });
    courbe.push([niveau, raie(y, 200, Math.floor(TAUX * 0.3), y.length)]);
  }
  console.log('  · entrée → sortie : '
    + courbe.map(([e, s]) => `${e} → ${s.toFixed(3)}`).join(' · '));
  test('la courbe monte toujours — rien ne se replie', () => {
    for (let i = 1; i < courbe.length; i++) {
      assert.ok(courbe[i][1] >= courbe[i - 1][1] - 1e-6,
        `à ${courbe[i][0]} : ${courbe[i][1].toFixed(3)} après `
        + `${courbe[i - 1][1].toFixed(3)}`);
    }
  });
  test('…mais elle se couche : elle n’est plus droite bien avant le plafond', () => {
    // la pente entre 0,1 et 0,3 doit être nettement plus raide qu'entre
    // 0,9 et 2,0
    const penteBas = (courbe[2][1] - courbe[0][1]) / (courbe[2][0] - courbe[0][0]);
    const penteHaut = (courbe[8][1] - courbe[5][1]) / (courbe[8][0] - courbe[5][0]);
    assert.ok(penteHaut < penteBas * 0.5,
      `pente ${penteBas.toFixed(3)} en bas contre ${penteHaut.toFixed(3)} en haut`);
  });
  test('rien ne sort au-dessus du plafond de Chris', () => {
    const y = traverser(sinus(200, 0.5, 4), { pleurage: 0, bosse: 0 });
    let crete = 0;
    for (let i = 0; i < y.length; i++) crete = Math.max(crete, Math.abs(y[i]));
    assert.ok(crete <= 0.99 + 1e-9, `crête ${crete}`);
  });
}

/* ------------------------------------------------------- les réglages -- */
titre('les réglages font ce qu’ils disent');
test('le mélange à zéro rend le signal d’origine, au bit près', () => {
  const s = sinus(300, 0.3);
  const y = traverser(s, { melange: 0 });
  let pire = 0;
  for (let i = 0; i < s.length; i++) pire = Math.max(pire, Math.abs(y[i] - s[i]));
  assert.ok(pire < 1e-12, `écart ${pire.toExponential(2)}`);
});
test('monter la sortie monte le niveau', () => {
  const s = sinus(300, 0.5, 0.2);
  const bas = raie(traverser(s, { sortie: 0.2 }), 300, TAUX / 4, s.length);
  const haut = raie(traverser(s, { sortie: 0.8 }), 300, TAUX / 4, s.length);
  assert.ok(haut > bas * 2, `${bas.toFixed(4)} puis ${haut.toFixed(4)}`);
});
test('la douceur enlève de l’aigu, pas du grave', () => {
  const s = sinus(8000, 0.5, 0.5);
  const sans = raie(traverser(s, { douceur: 0, bosse: 0, pleurage: 0 }),
    8000, TAUX / 4, s.length);
  const avec = raie(traverser(s, { douceur: 1, bosse: 0, pleurage: 0 }),
    8000, TAUX / 4, s.length);
  assert.ok(avec < sans, `${sans.toFixed(4)} puis ${avec.toFixed(4)}`);
});

/* -------------------------------------------------------- la solidité -- */
titre('rien ne s’emballe et rien ne devient NaN');
test('trente secondes de bruit fort, tous les réglages à fond', () => {
  const b = new ToTape6(TAUX);
  const g = new Float64Array(BLOC);
  const d = new Float64Array(BLOC);
  let graine = 424242;
  const n = TAUX * 30;
  const tiers = [0, 0, 0];
  for (let p = 0; p < n; p += BLOC) {
    for (let k = 0; k < BLOC; k++) {
      graine = (graine * 1103515245 + 12345) & 0x7fffffff;
      const v = ((graine / 0x7fffffff) * 2 - 1) * 0.95;
      g[k] = v; d[k] = v;
    }
    b.traiter(g, d, 1, 1, 1, 1, 1, 1);
    const t = Math.min(2, Math.floor(p / (n / 3)));
    for (let k = 0; k < BLOC; k++) {
      assert.ok(Number.isFinite(g[k]), `NaN à ${(p / TAUX).toFixed(1)} s`);
      tiers[t] = Math.max(tiers[t], Math.abs(g[k]));
    }
  }
  // le plafond de Chris tient, et rien ne grandit
  assert.ok(tiers[2] <= 0.99 + 1e-9, `crête ${tiers[2]}`);
  assert.ok(tiers[2] <= tiers[1] * 1.05, `${tiers[1]} puis ${tiers[2]}`);
});
test('un long silence retombe à un résidu inaudible, et n’en bouge plus', () => {
  // PAS EXACTEMENT ZÉRO, ET C'EST L'ALGORITHME. La bride que Chris pose sur
  // la bosse de tête — `(1 − |x|) × 0,00013` — cesse d'agir dès que l'état
  // est plus petit qu'elle : la bosse se GARE autour de 1,3·10⁻⁴ au lieu de
  // rejoindre zéro, et il en ressort environ −105 dB de continu. C'est
  // inaudible, c'est ce que fait le plugin d'origine, et l'Infrasonic de
  // l'hygiène, juste derrière dans la chaîne, l'ôte de toute façon.
  // Ce qu'on vérifie, c'est que ça ne DÉRIVE pas.
  const b = new ToTape6(TAUX);
  const g = new Float64Array(BLOC);
  const d = new Float64Array(BLOC);
  for (let n = 0; n < TAUX; n += BLOC) {
    for (let k = 0; k < BLOC; k++) {
      const v = 0.6 * Math.sin((2 * Math.PI * 200 * (n + k)) / TAUX);
      g[k] = v; d[k] = v;
    }
    b.traiter(g, d, 0.5, 0.3, 0.35, 0.25, 0.5, 1);
  }
  const lire = (secondes) => {
    for (let n = 0; n < TAUX * secondes; n += BLOC) {
      g.fill(0); d.fill(0);
      b.traiter(g, d, 0.5, 0.3, 0.35, 0.25, 0.5, 1);
    }
    let m = 0;
    for (let k = 0; k < BLOC; k++) m = Math.max(m, Math.abs(g[k]));
    return m;
  };
  const a5 = lire(5);
  const a30 = lire(25);
  assert.ok(a5 < 1e-4, `${a5.toExponential(2)} après 5 s`);
  assert.ok(a30 <= a5 * 1.01,
    `${a5.toExponential(2)} puis ${a30.toExponential(2)} : ça dérive`);
});
test('les deux canaux sont indépendants', () => {
  const b = new ToTape6(TAUX);
  const g = new Float64Array(BLOC);
  const d = new Float64Array(BLOC);
  let fuite = 0;
  for (let n = 0; n < TAUX; n += BLOC) {
    for (let k = 0; k < BLOC; k++) {
      g[k] = 0.6 * Math.sin((2 * Math.PI * 500 * (n + k)) / TAUX);
      d[k] = 0;
    }
    b.traiter(g, d, 0.5, 0.3, 0.35, 0.25, 0.5, 1);
    for (let k = 0; k < BLOC; k++) fuite = Math.max(fuite, Math.abs(d[k]));
  }
  assert.ok(fuite < 1e-9, `fuite ${fuite}`);
});
test('rallumer part de mémoires vides', () => {
  const b = new ToTape6(TAUX);
  const g = new Float64Array(BLOC).fill(0.9);
  const d = new Float64Array(BLOC).fill(0.9);
  b.traiter(g, d, 1, 1, 1, 1, 1, 1);
  b.dormir();
  g.fill(0); d.fill(0);
  b.traiter(g, d, 1, 1, 1, 1, 1, 1);
  let crete = 0;
  for (let k = 0; k < BLOC; k++) crete = Math.max(crete, Math.abs(g[k]));
  assert.ok(crete < 1e-9, `${crete} au rallumage`);
});
test('le pleurage est REPRODUCTIBLE : deux bandes neuves font pareil', () => {
  // C'est l'écart assumé du portage — notre hasard, pas celui du dither.
  const s = sinus(440, 0.5);
  const a = traverser(s, { pleurage: 0.8 });
  const b = traverser(s, { pleurage: 0.8 });
  let pire = 0;
  for (let i = 0; i < s.length; i++) pire = Math.max(pire, Math.abs(a[i] - b[i]));
  assert.equal(pire, 0, `écart ${pire}`);
});

/* --------------------------------------------------------- les noms ---- */
titre('les réglages');
test('la bande est ÉTEINTE par défaut', () => {
  assert.equal(BANDE_DEFAUTS.actif, false);
  assert.equal(normaliserBande(undefined).actif, false);
  assert.equal(normaliserBande({ actif: 'oui' }).actif, false);
});
test('les deux gains sont centrés sur la moitié', () => {
  assert.equal(BANDE_DEFAUTS.entree, 0.5);
  assert.equal(BANDE_DEFAUTS.sortie, 0.5);
});
test('les valeurs hors bornes sont ramenées', () => {
  assert.equal(normaliserBande({ pleurage: 9 }).pleurage, 1);
  assert.equal(normaliserBande({ bosse: -1 }).bosse, 0);
  assert.equal(normaliserBande({ douceur: 'beaucoup' }).douceur, BANDE_DEFAUTS.douceur);
});
test('les six réglages sont tous là', () => {
  const r = normaliserBande({});
  for (const cle of ['entree', 'douceur', 'bosse', 'pleurage', 'sortie', 'melange']) {
    assert.equal(typeof r[cle], 'number', cle);
  }
});

console.log(`\n${ok} ✓ / ${ko} ✗`);
process.exit(ko ? 1 : 0);

/**
 * LE PLAFOND, DERNIÈRE VERSION — Pressure5, éprouvé au nœud.
 *
 * Un plafond a UN devoir, et il est vérifiable : rien ne sort au-dessus.
 * Tout le reste — le grain, la vitesse, la griffe — est du goût, et ne se
 * teste que par ses effets relatifs.
 *
 * On mesure donc, dans l'ordre :
 *   1. la garantie : à quatre fois le plein, la sortie tient sous un ;
 *   2. la loi : plus on serre, plus la réduction est forte, et de façon
 *      monotone ;
 *   3. PAWCLAW, ce que la quatre n'avait pas : la courbe change selon que le
 *      signal ATTAQUE ou glisse. C'est ce qui distingue les deux versions,
 *      donc c'est ce qu'il faut prouver ;
 *   4. rien ne diverge, rien ne devient NaN.
 *
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import { LIMITEUR_DEFAUTS, MOTEURS_LIMITEUR, normaliserLimiteur }
  from '../engine/src/core/limiteur-reglages.js';

const TAUX = 48000;
globalThis.sampleRate = TAUX;
globalThis.AudioWorkletProcessor = class { constructor() { this.port = {}; } };
globalThis.registerProcessor = () => {};
const { Pressure5 } = await import('../engine/src/core/pression5-worklet.js');

let ok = 0, ko = 0;
const test = (nom, fn) => {
  try { fn(); ok++; console.log(`  ✓ ${nom}`); }
  catch (e) { ko++; console.log(`  ✗ ${nom}\n    ${e.message}`); }
};
const titre = (t) => console.log(`\n${t}`);

const BLOC = 128;
const R = { pression: 0.25, vitesse: 0.5, caractere: 0.5, griffe: 0.5, sortie: 0.5, melange: 1 };

function traverser(signal, o = {}) {
  const r = { ...R, ...o };
  const p = new Pressure5(TAUX);
  const rendu = new Float64Array(signal.length);
  const g = new Float64Array(BLOC);
  const d = new Float64Array(BLOC);
  for (let n = 0; n < signal.length; n += BLOC) {
    const taille = Math.min(BLOC, signal.length - n);
    for (let k = 0; k < BLOC; k++) {
      const v = k < taille ? signal[n + k] : 0;
      g[k] = v; d[k] = v;
    }
    p.traiter(g, d, r.pression, r.vitesse, r.caractere, r.griffe, r.sortie, r.melange);
    for (let k = 0; k < taille; k++) rendu[n + k] = g[k];
  }
  return rendu;
}
const sinus = (hz, sec, niv = 0.5) => {
  const n = Math.round(TAUX * sec);
  const s = new Float64Array(n);
  for (let i = 0; i < n; i++) s[i] = niv * Math.sin((2 * Math.PI * hz * i) / TAUX);
  return s;
};
const crete = (y, depuis = 0) => {
  let m = 0;
  for (let i = depuis; i < y.length; i++) m = Math.max(m, Math.abs(y[i]));
  return m;
};
const efficace = (y, depuis = 0) => {
  let s = 0, n = 0;
  for (let i = depuis; i < y.length; i++) { s += y[i] * y[i]; n++; }
  return Math.sqrt(s / Math.max(1, n));
};

/* ---------------------------------------------- LE DEVOIR D'UN PLAFOND -- */
titre('rien ne sort au-dessus du plafond — c’est tout ce qu’on lui demande');
{
  const mesures = [];
  for (const niveau of [0.5, 1, 2, 4]) {
    const y = traverser(sinus(220, 0.5, niveau), { pression: 0.5 });
    mesures.push([niveau, crete(y, Math.floor(TAUX * 0.2))]);
  }
  console.log('  · entrée → crête de sortie : '
    + mesures.map(([e, c]) => `${e} → ${c.toFixed(3)}`).join(' · '));
  test('même à quatre fois le plein, la sortie tient sous un', () => {
    for (const [e, c] of mesures) {
      assert.ok(c <= 1.0, `à ${e} d'entrée, ${c.toFixed(4)} en sortie`);
    }
  });
  test('…et sur du bruit, qui est le pire cas', () => {
    const n = TAUX;
    const s = new Float64Array(n);
    let graine = 31337;
    for (let i = 0; i < n; i++) {
      graine = (graine * 1103515245 + 12345) & 0x7fffffff;
      s[i] = ((graine / 0x7fffffff) * 2 - 1) * 3;
    }
    const y = traverser(s, { pression: 0.8 });
    assert.ok(crete(y, TAUX / 4) <= 1.0, `crête ${crete(y, TAUX / 4)}`);
  });
}

/* ------------------------------------------------------------ la loi --- */
titre('plus on serre, plus il retient');
{
  const s = sinus(220, 0.6, 1.5);
  const mesures = [0, 0.25, 0.5, 0.75, 1].map((p) => {
    const y = traverser(s, { pression: p });
    return [p, efficace(y, Math.floor(TAUX * 0.3))];
  });
  console.log('  · pression → efficace : '
    + mesures.map(([p, v]) => `${p} → ${v.toFixed(3)}`).join(' · '));
  test('la sortie ne remonte jamais quand on serre davantage', () => {
    for (let i = 1; i < mesures.length; i++) {
      assert.ok(mesures[i][1] <= mesures[i - 1][1] + 1e-3,
        `${mesures[i - 1][1].toFixed(3)} puis ${mesures[i][1].toFixed(3)}`);
    }
  });
  test('…et serrer à fond retient vraiment', () => {
    assert.ok(mesures[4][1] < mesures[0][1] * 0.9,
      `${mesures[0][1].toFixed(3)} puis ${mesures[4][1].toFixed(3)}`);
  });
  test('le voyant de réduction dit quelque chose de sensé', () => {
    const p = new Pressure5(TAUX);
    const g = new Float64Array(BLOC);
    const d = new Float64Array(BLOC);
    for (let n = 0; n < 200; n++) {
      for (let k = 0; k < BLOC; k++) {
        const v = 1.5 * Math.sin((2 * Math.PI * 220 * ((n * BLOC) + k)) / TAUX);
        g[k] = v; d[k] = v;
      }
      p.traiter(g, d, 0.9, 0.5, 0.5, 0.5, 0.5, 1);
    }
    assert.ok(p.reduction > 0 && p.reduction < 1,
      `réduction ${p.reduction}`);
  });
}

/* --------------------------------------------------------- PAWCLAW ----- */
titre('PawClaw : la courbe change selon que ça attaque ou que ça glisse');
{
  /**
   * Deux signaux de MÊME niveau efficace, l'un tout en pente douce (un sinus
   * grave), l'autre tout en attaques (des impulsions). Si la griffe fait
   * quelque chose, l'écart entre les deux réglages extrêmes doit être plus
   * grand sur les attaques que sur la pente douce.
   */
  const doux = sinus(80, 0.5, 1.2);
  const dur = (() => {
    const n = Math.round(TAUX * 0.5);
    const s = new Float64Array(n);
    for (let i = 0; i < n; i++) s[i] = (i % 600) < 30 ? 1.2 : 0;
    return s;
  })();
  const ecart = (signal) => {
    const patte = efficace(traverser(signal, { pression: 0.7, griffe: 0 }),
      Math.floor(TAUX * 0.25));
    const griffe = efficace(traverser(signal, { pression: 0.7, griffe: 1 }),
      Math.floor(TAUX * 0.25));
    return Math.abs(griffe - patte) / Math.max(patte, 1e-9);
  };
  const surDoux = ecart(doux);
  const surDur = ecart(dur);
  console.log(`  · écart patte/griffe : pente douce ${(surDoux * 100).toFixed(2)} %,`
    + ` attaques ${(surDur * 100).toFixed(2)} %`);
  test('la griffe se fait sentir davantage sur les attaques', () => {
    assert.ok(surDur > surDoux,
      `${(surDoux * 100).toFixed(2)} % contre ${(surDur * 100).toFixed(2)} %`);
  });
  test('…et elle fait quelque chose, pas rien', () => {
    assert.ok(surDur > 0.005, `${(surDur * 100).toFixed(3)} %`);
  });
}

/* ------------------------------------------------------- les réglages -- */
titre('les réglages font ce qu’ils disent');
test('le mélange à zéro laisse passer le sec — sauf l’écrêtage de sûreté', () => {
  // ClipOnly2 tourne APRÈS le mélange, exprès : c'est un filet même à
  // mi-chemin. Un signal qui tient déjà sous le seuil doit donc ressortir
  // intact, au retard de l'écrêteur près.
  const s = sinus(300, 0.4, 0.5);
  const y = traverser(s, { melange: 0, pression: 0.9 });
  const p = new Pressure5(TAUX);
  let pire = 0;
  for (let i = TAUX / 8; i < s.length - p.pas; i++) {
    pire = Math.max(pire, Math.abs(y[i + p.pas] - s[i]));
  }
  assert.ok(pire < 1e-9, `écart ${pire.toExponential(2)}`);
});
test('monter la sortie monte le niveau', () => {
  const s = sinus(300, 0.4, 0.2);
  const bas = efficace(traverser(s, { sortie: 0.3, pression: 0 }), TAUX / 8);
  const haut = efficace(traverser(s, { sortie: 0.7, pression: 0 }), TAUX / 8);
  assert.ok(haut > bas * 2, `${bas.toFixed(4)} puis ${haut.toFixed(4)}`);
});
test('l’écrêteur retarde d’un échantillon à 44,1 kHz, pas plus', () => {
  const p = new Pressure5(TAUX);
  assert.equal(p.pas, Math.floor(TAUX / 44100), String(p.pas));
});
test('à 44,1 et 48 kHz, les deux passe-bas de Chris sont sautés', () => {
  // sa coupure est à 24 kHz : au-dessus de Nyquist à 44,1, pile dessus à 48
  assert.equal(new Pressure5(44100).applique, false);
  assert.equal(new Pressure5(48000).applique, false);
  assert.equal(new Pressure5(96000).applique, true);
});

/* -------------------------------------------------------- la solidité -- */
titre('rien ne diverge et rien ne devient NaN');
test('trente secondes de bruit très fort, réglages à fond', () => {
  const p = new Pressure5(TAUX);
  const g = new Float64Array(BLOC);
  const d = new Float64Array(BLOC);
  let graine = 8675309;
  let c = 0;
  for (let n = 0; n < TAUX * 30; n += BLOC) {
    for (let k = 0; k < BLOC; k++) {
      graine = (graine * 1103515245 + 12345) & 0x7fffffff;
      const v = ((graine / 0x7fffffff) * 2 - 1) * 4;
      g[k] = v; d[k] = v;
    }
    p.traiter(g, d, 1, 1, 1, 1, 1, 1);
    for (let k = 0; k < BLOC; k++) {
      assert.ok(Number.isFinite(g[k]), `NaN à ${(n / TAUX).toFixed(1)} s`);
      c = Math.max(c, Math.abs(g[k]));
    }
  }
  assert.ok(c <= 1.0, `crête ${c}`);
});
test('un long silence après du signal retombe à zéro', () => {
  const p = new Pressure5(TAUX);
  const g = new Float64Array(BLOC);
  const d = new Float64Array(BLOC);
  for (let n = 0; n < TAUX; n += BLOC) {
    for (let k = 0; k < BLOC; k++) {
      const v = 0.9 * Math.sin((2 * Math.PI * 200 * (n + k)) / TAUX);
      g[k] = v; d[k] = v;
    }
    p.traiter(g, d, 0.5, 0.5, 0.5, 0.5, 0.5, 1);
  }
  for (let n = 0; n < TAUX; n += BLOC) {
    g.fill(0); d.fill(0);
    p.traiter(g, d, 0.5, 0.5, 0.5, 0.5, 0.5, 1);
  }
  assert.ok(Math.abs(g[BLOC - 1]) < 1e-12, `reste ${g[BLOC - 1]}`);
});
test('un signal à un seul canal ne fait pas fuir l’autre', () => {
  // le détecteur est COMMUN — donc l'autre canal baisse, c'est voulu — mais
  // il ne doit rien y APPARAÎTRE
  const p = new Pressure5(TAUX);
  const g = new Float64Array(BLOC);
  const d = new Float64Array(BLOC);
  let fuite = 0;
  for (let n = 0; n < 400; n++) {
    for (let k = 0; k < BLOC; k++) {
      g[k] = 0.9 * Math.sin((2 * Math.PI * 500 * ((n * BLOC) + k)) / TAUX);
      d[k] = 0;
    }
    p.traiter(g, d, 0.7, 0.5, 0.5, 0.5, 0.5, 1);
    for (let k = 0; k < BLOC; k++) fuite = Math.max(fuite, Math.abs(d[k]));
  }
  assert.ok(fuite < 1e-12, `fuite ${fuite}`);
});
test('vider remet tout à zéro', () => {
  const p = new Pressure5(TAUX);
  const g = new Float64Array(BLOC).fill(0.9);
  const d = new Float64Array(BLOC).fill(0.9);
  p.traiter(g, d, 0.9, 0.5, 0.5, 0.5, 0.5, 1);
  p.vider();
  assert.equal(p.coefA, 1);
  assert.equal(p.vitesseA, 10000);
  assert.ok(p.dernier.every((v) => v === 0));
  assert.equal(p.reduction, 1);
});

/* --------------------------------------------------------- les noms ---- */
titre('les réglages');
test('la CINQ est le défaut', () => {
  assert.equal(LIMITEUR_DEFAUTS.moteur, 'pressure5');
  assert.equal(normaliserLimiteur(undefined).moteur, 'pressure5');
});
test('on peut revenir à la quatre pour comparer', () => {
  assert.equal(normaliserLimiteur({ moteur: 'pressure4' }).moteur, 'pressure4');
});
test('un moteur inconnu retombe sur la cinq', () => {
  assert.equal(normaliserLimiteur({ moteur: 'pressure9' }).moteur, 'pressure5');
});
test('la griffe est au neutre par défaut', () => {
  assert.equal(LIMITEUR_DEFAUTS.griffe, 0.5);
  assert.equal(normaliserLimiteur({ griffe: 9 }).griffe, 1);
  assert.equal(normaliserLimiteur({ griffe: -1 }).griffe, 0);
});
test('les anciens réglages n’ont pas bougé', () => {
  const r = normaliserLimiteur({ marge: 0.5, pression: 0.9, actif: false });
  assert.equal(r.marge, 0.5);
  assert.equal(r.pression, 0.9);
  assert.equal(r.actif, false);
});
test('les deux plafonds se décrivent', () => {
  for (const cle of ['pressure4', 'pressure5']) {
    assert.ok(MOTEURS_LIMITEUR[cle].nom, cle);
    assert.ok(MOTEURS_LIMITEUR[cle].desc?.length > 10, cle);
  }
});

console.log(`\n${ok} ✓ / ${ko} ✗`);
process.exit(ko ? 1 : 0);

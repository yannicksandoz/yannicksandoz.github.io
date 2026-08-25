/**
 * LES COULEURS DU BUS — BussColors4, éprouvé au nœud.
 *
 * Deux choses à prouver ici, et la première compte plus que l'autre.
 *
 * 1. LE TAMPON CIRCULAIRE DONNE EXACTEMENT CE QUE DONNE LE DÉCALAGE DE
 *    CHRIS. C'est le seul écart d'implémentation du portage : lui recopie
 *    trente-quatre cases à chaque échantillon, on garde un index. On
 *    réimplémente donc sa version naïve ici même, on fait passer le même
 *    signal dans les deux, et l'on exige l'égalité au bit près. Un test qui
 *    se contenterait de « à peu près pareil » ne servirait à rien.
 *
 * 2. Les huit couleurs sont bien huit, elles diffèrent, et aucune ne
 *    s'emballe.
 *
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { COULEURS, ORDRE_COULEURS, COULEURS_DEFAUTS, normaliserCouleurs,
  indiceDeCouleur, couleurDIndice } from '../engine/src/core/couleurs-reglages.js';

const ici = dirname(fileURLToPath(import.meta.url));
const TAUX = 48000;

globalThis.sampleRate = TAUX;
globalThis.AudioWorkletProcessor = class { constructor() { this.port = {}; } };
globalThis.registerProcessor = () => {};
const { BussColors4 } = await import('../engine/src/core/couleurs-worklet.js');

let ok = 0, ko = 0;
const test = (nom, fn) => {
  try { fn(); ok++; console.log(`  ✓ ${nom}`); }
  catch (e) { ko++; console.log(`  ✗ ${nom}\n    ${e.message}`); }
};
const titre = (t) => console.log(`\n${t}`);

const BLOC = 128;
function traverser(couleur, signal, o = {}) {
  const { entree = 0.5, sortie = 0.5, melange = 1 } = o;
  const c = new BussColors4(TAUX);
  const i = indiceDeCouleur(couleur);
  const rendu = new Float64Array(signal.length);
  const g = new Float64Array(BLOC);
  const d = new Float64Array(BLOC);
  for (let n = 0; n < signal.length; n += BLOC) {
    const taille = Math.min(BLOC, signal.length - n);
    for (let k = 0; k < BLOC; k++) {
      const v = k < taille ? signal[n + k] : 0;
      g[k] = v; d[k] = v;
    }
    c.traiter(g, d, i, entree, sortie, melange);
    for (let k = 0; k < taille; k++) rendu[n + k] = g[k];
  }
  return rendu;
}

/**
 * LA VERSION NAÏVE DE CHRIS, à la lettre : un tampon qu'on décale d'un cran
 * à chaque échantillon. Elle n'existe que pour être comparée.
 */
function versionDecalee(taps, decalageBrut, gainsDb, signal) {
  let e = TAUX / 44100.0;
  if (e < 1.0) e = 1.0;
  if (e > 4.5) e = 4.5;
  const tampon = Math.floor(34.0 * e);
  const prises = [];
  for (let k = 0; k < 34; k++) prises.push(Math.floor(k * e));
  let decalage = Math.floor(decalageBrut * e);
  if (decalage < 3) decalage = 3;
  const gainE = (10 ** (gainsDb[0] / 14.0)) * (10 ** (((0.5 * 36.0) - 18.0) / 14.0));
  const gainS = (10 ** (gainsDb[1] / 14.0)) * (10 ** ((((0.5 * 36.0) - 18.0) + 3.3) / 14.0));
  const b = new Float64Array(tampon + 1);
  const sag = new Float64Array(99);
  let compteur = 44, controle = 0, lent = 0;
  const rendu = new Float64Array(signal.length);
  for (let n = 0; n < signal.length; n++) {
    let x = signal[n] * gainE;
    let brut = Math.abs(x);
    lent = Math.min(1.5, (lent * 0.999) + brut);
    const dyn = 2.5 + lent;
    const redresse = brut > 1.57079633 ? 1.0 : Math.sin(brut);
    x = x > 0 ? redresse : -redresse;
    if (compteur < 0 || compteur > 44) compteur = 44;
    sag[compteur + 44] = sag[compteur] = Math.abs(x);
    controle += sag[compteur] / decalage;
    controle -= sag[compteur + decalage] / decalage;
    controle -= 0.000001;
    controle = Math.min(100, Math.max(0, controle));
    const applique = (controle / decalage) * dyn;
    compteur--;
    for (let k = tampon; k > 0; --k) b[k] = b[k - 1];
    b[0] = x;
    for (let k = 1; k <= 33; k++) {
      x += b[prises[k]] * (taps[k - 1][0] + (taps[k - 1][1] * applique));
    }
    const creux = 1.0 - Math.cos(Math.abs(x));
    x = x > 0 ? x - creux : x + creux;
    rendu[n] = x * gainS;
  }
  return rendu;
}

/** Les tables telles qu'elles sont écrites dans le worklet, relues au texte. */
function tablesDuWorklet() {
  const source = readFileSync(
    join(ici, '..', 'engine', 'src', 'core', 'couleurs-worklet.js'), 'utf8');
  const bloc = source.match(/const TAPS = \[([\s\S]*?)\n\];/);
  assert.ok(bloc, 'TAPS introuvable');
  const paires = [...bloc[1].matchAll(/\[(-?\d+\.?\d*(?:e-?\d+)?),\s*(-?\d+\.?\d*(?:e-?\d+)?)\]/g)]
    .map((m) => [Number(m[1]), Number(m[2])]);
  const tables = [];
  for (let i = 0; i < paires.length; i += 33) tables.push(paires.slice(i, i + 33));
  return tables;
}

/* ------------------------------------------------- l'écart assumé ------- */
titre('le tampon circulaire donne EXACTEMENT le décalage de Chris');
const tables = tablesDuWorklet();
const DECALAGES = [4, 3, 5, 8, 5, 7, 7, 6];
const ENTREES = [-5.2, -6.2, -2.9, -1.1, -5.1, -3.6, -2.3, -2.9];
const SORTIES = [-0.3, 0.5, -0.7, -0.6, -0.2, 0.3, 0.1, 0.9];

test('les huit tables font bien trente-trois prises', () => {
  assert.equal(tables.length, 8, `${tables.length} tables`);
  for (const t of tables) assert.equal(t.length, 33, `${t.length} prises`);
});

{
  const n = 4096;
  const s = new Float64Array(n);
  let graine = 20260825;
  for (let i = 0; i < n; i++) {
    graine = (graine * 1103515245 + 12345) & 0x7fffffff;
    s[i] = ((graine / 0x7fffffff) * 2 - 1) * 0.7;
  }
  ORDRE_COULEURS.forEach((cle, i) => {
    test(`${COULEURS[cle].nom} : les deux implémentations concordent`, () => {
      const rond = traverser(cle, s);
      const droit = versionDecalee(tables[i], DECALAGES[i], [ENTREES[i], SORTIES[i]], s);
      let pire = 0, ou = -1;
      for (let k = 0; k < n; k++) {
        const e = Math.abs(rond[k] - droit[k]);
        if (e > pire) { pire = e; ou = k; }
      }
      // au bit près, à l'arrondi du double près
      assert.ok(pire < 1e-12,
        `écart ${pire.toExponential(2)} à l'échantillon ${ou}`);
    });
  });
}

/* ------------------------------------------------ les huit diffèrent --- */
titre('les huit couleurs sont vraiment huit couleurs');
const CARRE = (() => {
  const n = Math.round(TAUX * 0.25);
  const s = new Float64Array(n);
  const p = TAUX / 110;
  for (let i = 0; i < n; i++) s[i] = ((i % p) < p / 2 ? 1 : -1) * 0.5;
  return s;
})();
const rendus = {};
for (const cle of ORDRE_COULEURS) rendus[cle] = traverser(cle, CARRE);

test('deux couleurs ne rendent jamais le même signal', () => {
  for (let a = 0; a < ORDRE_COULEURS.length; a++) {
    for (let b = a + 1; b < ORDRE_COULEURS.length; b++) {
      const x = rendus[ORDRE_COULEURS[a]], y = rendus[ORDRE_COULEURS[b]];
      let ecart = 0;
      for (let i = 0; i < x.length; i++) ecart = Math.max(ecart, Math.abs(x[i] - y[i]));
      assert.ok(ecart > 1e-3,
        `${ORDRE_COULEURS[a]} et ${ORDRE_COULEURS[b]} : ${ecart.toExponential(2)}`);
    }
  }
});
test('aucune ne rend le signal intact — elles font toutes quelque chose', () => {
  for (const cle of ORDRE_COULEURS) {
    let ecart = 0;
    const y = rendus[cle];
    for (let i = Math.floor(TAUX * 0.05); i < CARRE.length; i++) {
      ecart = Math.max(ecart, Math.abs(y[i] - CARRE[i]));
    }
    assert.ok(ecart > 0.01, `${cle} : ${ecart.toExponential(2)}`);
  }
});
{
  const aigu = (y) => {
    let haut = 0, tout = 0;
    const depart = Math.floor(TAUX * 0.1);
    for (let h = 1; h <= 90; h++) {
      const f = 110 * h;
      if (f > 20000) break;
      let re = 0, im = 0, cpt = 0;
      for (let i = depart; i < y.length; i++) {
        const w = (2 * Math.PI * f * i) / TAUX;
        re += y[i] * Math.sin(w); im += y[i] * Math.cos(w); cpt++;
      }
      const a = (2 * Math.hypot(re, im)) / cpt;
      tout += a * a;
      if (f > 4000) haut += a * a;
    }
    return Math.sqrt(haut / Math.max(tout, 1e-18));
  };
  const parts = {};
  for (const cle of ORDRE_COULEURS) parts[cle] = aigu(rendus[cle]);
  console.log('  · part au-dessus de 4 kHz : ' + ORDRE_COULEURS
    .map((c) => `${COULEURS[c].nom} ${(parts[c] * 100).toFixed(1)} %`).join(' · '));
  test('« Dark » garde moins d’aigu que « Steel »', () => {
    assert.ok(parts.sombre < parts.acier,
      `Dark ${(parts.sombre * 100).toFixed(2)} % contre Steel ${(parts.acier * 100).toFixed(2)} %`);
  });
}

/* ------------------------------------------------------- les réglages -- */
titre('les réglages font ce qu’ils disent');
test('le mélange à zéro rend le signal d’origine, au bit près', () => {
  const y = traverser('velours', CARRE, { melange: 0 });
  let pire = 0;
  for (let i = 0; i < CARRE.length; i++) pire = Math.max(pire, Math.abs(y[i] - CARRE[i]));
  assert.ok(pire < 1e-12, `écart ${pire.toExponential(2)}`);
});
test('le mélange à moitié est à mi-chemin', () => {
  const plein = traverser('velours', CARRE);
  const demi = traverser('velours', CARRE, { melange: 0.5 });
  let pire = 0;
  for (let i = 0; i < CARRE.length; i++) {
    const attendu = (plein[i] + CARRE[i]) / 2;
    pire = Math.max(pire, Math.abs(demi[i] - attendu));
  }
  assert.ok(pire < 1e-9, `écart ${pire.toExponential(2)}`);
});
test('monter la sortie monte le niveau', () => {
  const bas = traverser('velours', CARRE, { sortie: 0.2 });
  const haut = traverser('velours', CARRE, { sortie: 0.8 });
  const crete = (y) => {
    let m = 0;
    for (let i = Math.floor(TAUX * 0.05); i < y.length; i++) m = Math.max(m, Math.abs(y[i]));
    return m;
  };
  assert.ok(crete(haut) > crete(bas) * 2,
    `${crete(bas).toFixed(3)} puis ${crete(haut).toFixed(3)}`);
});

/* -------------------------------------------------------- la solidité -- */
titre('rien ne s’emballe et rien ne devient NaN');
/** Vingt secondes de bruit, et la crête par tiers — pour voir si ça MONTE. */
function tiersDeBruit(cle, entree, sortie) {
  const c = new BussColors4(TAUX);
  const i = indiceDeCouleur(cle);
  const g = new Float64Array(BLOC);
  const d = new Float64Array(BLOC);
  let graine = 5150;
  const n = TAUX * 20;
  const tiers = [0, 0, 0];
  for (let p = 0; p < n; p += BLOC) {
    for (let k = 0; k < BLOC; k++) {
      graine = (graine * 1103515245 + 12345) & 0x7fffffff;
      const v = ((graine / 0x7fffffff) * 2 - 1) * 0.95;
      g[k] = v; d[k] = v;
    }
    c.traiter(g, d, i, entree, sortie, 1);
    const t = Math.min(2, Math.floor(p / (n / 3)));
    for (let k = 0; k < BLOC; k++) {
      assert.ok(Number.isFinite(g[k]), `${cle} : NaN à ${(p / TAUX).toFixed(1)} s`);
      tiers[t] = Math.max(tiers[t], Math.abs(g[k]));
    }
  }
  return tiers;
}

test('au neutre, les huit couleurs restent à un niveau raisonnable', () => {
  const cretes = {};
  for (const cle of ORDRE_COULEURS) {
    cretes[cle] = tiersDeBruit(cle, 0.5, 0.5)[2];
    assert.ok(cretes[cle] < 3,
      `${cle} : crête ${cretes[cle].toFixed(2)} sur du bruit à ±0,95`);
  }
  console.log('  · crête au neutre : ' + ORDRE_COULEURS
    .map((c) => `${COULEURS[c].nom} ${cretes[c].toFixed(2)}`).join(' · '));
});
test('à fond de course, c’est TRÈS fort — et ce n’est pas un emballement', () => {
  // Les deux gains de Chris valent ±18 dB, et le second est encore relevé de
  // 3,3 dB : à un, la sortie est multipliée par trente et un. Une crête de
  // dix-neuf sur du bruit à ±0,95 est donc le réglage, pas un bogue — c'est
  // un fader poussé au bout. Ce qu'on exige ici, c'est que ça ne GRANDISSE
  // pas : une convolution instable, elle, ne s'arrête jamais de monter.
  for (const cle of ORDRE_COULEURS) {
    const t = tiersDeBruit(cle, 1, 1);
    assert.ok(t[2] <= t[1] * 1.05,
      `${cle} : ${t[1].toFixed(2)} puis ${t[2].toFixed(2)} — ça monte encore`);
  }
});
test('un long silence après du signal retombe à zéro', () => {
  const c = new BussColors4(TAUX);
  const g = new Float64Array(BLOC);
  const d = new Float64Array(BLOC);
  for (let n = 0; n < TAUX; n += BLOC) {
    for (let k = 0; k < BLOC; k++) {
      const v = 0.6 * Math.sin((2 * Math.PI * 200 * (n + k)) / TAUX);
      g[k] = v; d[k] = v;
    }
    c.traiter(g, d, 2, 0.5, 0.5, 1);
  }
  for (let n = 0; n < TAUX * 2; n += BLOC) {
    g.fill(0); d.fill(0);
    c.traiter(g, d, 2, 0.5, 0.5, 1);
  }
  assert.ok(Math.abs(g[BLOC - 1]) < 1e-9, `reste ${g[BLOC - 1]}`);
});
test('les deux canaux sont indépendants', () => {
  const c = new BussColors4(TAUX);
  const g = new Float64Array(BLOC);
  const d = new Float64Array(BLOC);
  let fuite = 0;
  for (let n = 0; n < TAUX; n += BLOC) {
    for (let k = 0; k < BLOC; k++) {
      g[k] = 0.6 * Math.sin((2 * Math.PI * 500 * (n + k)) / TAUX);
      d[k] = 0;
    }
    c.traiter(g, d, 2, 0.5, 0.5, 1);
    for (let k = 0; k < BLOC; k++) fuite = Math.max(fuite, Math.abs(d[k]));
  }
  assert.ok(fuite < 1e-9, `fuite ${fuite}`);
});
test('changer de couleur en marche ne fabrique pas de NaN', () => {
  const c = new BussColors4(TAUX);
  const g = new Float64Array(BLOC);
  const d = new Float64Array(BLOC);
  for (let n = 0, t = 0; n < TAUX * 4; n += BLOC, t++) {
    for (let k = 0; k < BLOC; k++) {
      const v = 0.6 * Math.sin((2 * Math.PI * 300 * (n + k)) / TAUX);
      g[k] = v; d[k] = v;
    }
    c.traiter(g, d, t % 8, 0.5, 0.5, 1);
    for (let k = 0; k < BLOC; k++) assert.ok(Number.isFinite(g[k]), `NaN au tour ${t}`);
  }
});
test('rallumer part de mémoires vides', () => {
  const c = new BussColors4(TAUX);
  const g = new Float64Array(BLOC).fill(0.9);
  const d = new Float64Array(BLOC).fill(0.9);
  c.traiter(g, d, 2, 1, 1, 1);
  c.dormir();
  g.fill(0); d.fill(0);
  c.traiter(g, d, 2, 1, 1, 1);
  let crete = 0;
  for (let k = 0; k < BLOC; k++) crete = Math.max(crete, Math.abs(g[k]));
  assert.ok(crete < 1e-9, `${crete} au rallumage`);
});

/* --------------------------------------------------------- les noms ---- */
titre('les réglages');
test('la couleur est ÉTEINTE par défaut', () => {
  assert.equal(COULEURS_DEFAUTS.actif, false);
  assert.equal(normaliserCouleurs(undefined).actif, false);
  assert.equal(normaliserCouleurs({ actif: 'oui' }).actif, false);
});
test('une couleur inconnue retombe sur le défaut', () => {
  assert.equal(normaliserCouleurs({ couleur: 'harrison' }).couleur,
    COULEURS_DEFAUTS.couleur);
  assert.equal(normaliserCouleurs({ couleur: 'poing' }).couleur, 'poing');
});
test('les huit font l’aller-retour nom ↔ indice', () => {
  ORDRE_COULEURS.forEach((cle, i) => {
    assert.equal(indiceDeCouleur(cle), i);
    assert.equal(couleurDIndice(i), cle);
  });
  assert.equal(indiceDeCouleur('inconnue'), indiceDeCouleur(COULEURS_DEFAUTS.couleur));
  assert.equal(couleurDIndice(99), COULEURS_DEFAUTS.couleur);
});
test('les valeurs hors bornes sont ramenées', () => {
  assert.equal(normaliserCouleurs({ entree: 9 }).entree, 1);
  assert.equal(normaliserCouleurs({ melange: -1 }).melange, 0);
  assert.equal(normaliserCouleurs({ sortie: 'fort' }).sortie, COULEURS_DEFAUTS.sortie);
});
test('les deux gains sont centrés sur la moitié, pas sur zéro', () => {
  assert.equal(COULEURS_DEFAUTS.entree, 0.5);
  assert.equal(COULEURS_DEFAUTS.sortie, 0.5);
});
test('chaque couleur nomme son matériel', () => {
  for (const cle of ORDRE_COULEURS) {
    assert.ok(COULEURS[cle].nom, cle);
    assert.ok(COULEURS[cle].materiel?.length > 2, cle);
    assert.ok(COULEURS[cle].desc?.length > 5, cle);
  }
});

console.log(`\n${ok} ✓ / ${ko} ✗`);
process.exit(ko ? 1 : 0);

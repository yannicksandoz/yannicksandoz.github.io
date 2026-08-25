/**
 * L'HYGIÈNE DU MAÎTRE — Ultrasonic + Infrasonic, éprouvés au nœud.
 *
 * On ne vérifie pas que le code ressemble à celui de Chris : on MESURE la
 * réponse. Un sinus à telle fréquence entre, on regarde ce qui sort, et l'on
 * compare aux décibels qu'un Butterworth d'ordre dix doit donner. C'est la
 * seule façon de savoir qu'un coefficient recopié de travers ne dort pas
 * quelque part.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { HYGIENE_DEFAUTS, AIGUS_HZ, GRAVES_HZ, Q_BUTTERWORTH,
  coupureUtile, coefficientsBiquad, normaliserHygiene }
  from '../engine/src/core/hygiene-reglages.js';

const ici = dirname(fileURLToPath(import.meta.url));
const TAUX = 48000;

globalThis.sampleRate = TAUX;
globalThis.AudioWorkletProcessor = class { constructor() { this.port = {}; } };
globalThis.registerProcessor = () => {};
const { Hygiene } = await import('../engine/src/core/hygiene-worklet.js');

let ok = 0, ko = 0;
const test = (nom, fn) => {
  try { fn(); ok++; console.log(`  ✓ ${nom}`); }
  catch (e) { ko++; console.log(`  ✗ ${nom}\n    ${e.message}`); }
};
const titre = (t) => console.log(`\n${t}`);

/**
 * Fait passer un sinus et rend l'amplitude de sortie, en régime établi.
 *
 * PAR PROJECTION, pas par crête. Relever le plus grand échantillon paraît
 * plus simple et ment dès qu'on monte : à seize kilohertz sur quarante-huit,
 * il n'y a que trois points par période, et le plus haut des trois vaut 0,866
 * — le filtre semblait alors coûter un décibel et quart qu'il ne coûtait pas.
 * On corrèle donc avec un sinus et un cosinus de la même fréquence, ce qui
 * rend l'amplitude vraie quel que soit l'endroit où tombent les points.
 */
function reponse(hz, { aigus = true, graves = true, secondes = 2 } = {}) {
  const h = new Hygiene(TAUX);
  const n = Math.round(TAUX * secondes);
  const bloc = 128;
  const g = new Float64Array(bloc);
  const d = new Float64Array(bloc);
  // on ne relève qu'après les trois cinquièmes : les filtres ont un régime
  // transitoire, et à vingt hertz il dure plusieurs dixièmes de seconde
  const depart = Math.floor(n * 0.6);
  let re = 0, im = 0, cpt = 0;
  for (let i = 0; i < n; i += bloc) {
    for (let k = 0; k < bloc; k++) {
      const v = Math.sin((2 * Math.PI * hz * (i + k)) / TAUX);
      g[k] = v; d[k] = v;
    }
    h.traiter(g, d, aigus, graves);
    if (i < depart) continue;
    for (let k = 0; k < bloc; k++) {
      const w = (2 * Math.PI * hz * (i + k)) / TAUX;
      re += g[k] * Math.sin(w);
      im += g[k] * Math.cos(w);
      cpt++;
    }
  }
  return cpt ? (2 * Math.hypot(re, im)) / cpt : 0;
}
const enDb = (v) => 20 * Math.log10(Math.max(v, 1e-12));

/* --------------------------------------------------- les coefficients --- */
titre('les Q ne divergent pas entre le worklet et le module');
test('les cinq Q du worklet sont celles du module de réglages', () => {
  const source = readFileSync(
    join(ici, '..', 'engine', 'src', 'core', 'hygiene-worklet.js'), 'utf8');
  const bloc = source.match(/const Q_BUTTERWORTH = \[([^\]]+)\]/);
  assert.ok(bloc, 'Q_BUTTERWORTH introuvable dans le worklet');
  const listes = bloc[1].split(',').map((x) => Number(x.trim())).filter(Number.isFinite);
  assert.deepEqual(listes, Q_BUTTERWORTH);
});
test('…et les deux fréquences aussi', () => {
  const source = readFileSync(
    join(ici, '..', 'engine', 'src', 'core', 'hygiene-worklet.js'), 'utf8');
  assert.match(source, new RegExp(`const AIGUS_HZ = ${AIGUS_HZ};`));
  assert.match(source, new RegExp(`const GRAVES_HZ = ${GRAVES_HZ};`));
});

titre('la coupure reste sous Nyquist, quel que soit le taux');
test('à 48 et 44,1 kHz, vingt kilohertz passent tels quels', () => {
  assert.equal(coupureUtile(AIGUS_HZ, 48000), 20000);
  assert.equal(coupureUtile(AIGUS_HZ, 44100), 20000);
});
test('à 22 050 Hz, la coupure descend au lieu de dépasser Nyquist', () => {
  const c = coupureUtile(AIGUS_HZ, 22050);
  assert.ok(c < 22050 / 2, `${c} Hz au-dessus de Nyquist`);
  assert.ok(c > 9000, `${c} Hz, coupure absurde`);
});
test('un taux absurde ne rend pas NaN', () => {
  assert.ok(Number.isFinite(coupureUtile(AIGUS_HZ, 0)));
  assert.ok(Number.isFinite(coupureUtile(AIGUS_HZ, NaN)));
});
test('les pôles des dix biquads sont dans le cercle unité', () => {
  for (const q of Q_BUTTERWORTH) {
    for (const [type, hz] of [['bas', AIGUS_HZ], ['haut', GRAVES_HZ]]) {
      for (const taux of [22050, 44100, 48000, 96000]) {
        const c = coefficientsBiquad(type, hz, taux, q);
        // stabilité d'un biquad : |a2| < 1 et |a1| < 1 + a2
        assert.ok(Math.abs(c.a2) < 1,
          `${type} q=${q} taux=${taux} : a2=${c.a2}`);
        assert.ok(Math.abs(c.a1) < 1 + c.a2,
          `${type} q=${q} taux=${taux} : a1=${c.a1}, a2=${c.a2}`);
      }
    }
  }
});

/* ------------------------------------------------------- la mesure ----- */
titre('le coupe-haut fait ce qu’un Butterworth d’ordre dix doit faire');
test('mille hertz passent intacts', () => {
  const db = enDb(reponse(1000, { graves: false }));
  assert.ok(Math.abs(db) < 0.1, `${db.toFixed(2)} dB`);
});
test('dix kilohertz passent intacts', () => {
  const db = enDb(reponse(10000, { graves: false }));
  assert.ok(Math.abs(db) < 0.1, `${db.toFixed(2)} dB`);
});
test('seize kilohertz sont encore là, intacts', () => {
  const db = enDb(reponse(16000, { graves: false }));
  assert.ok(db > -0.05, `${db.toFixed(2)} dB`);
});
test('dix-neuf kilohertz ne perdent pas un dixième de décibel', () => {
  const db = enDb(reponse(19000, { graves: false }));
  assert.ok(db > -0.1, `${db.toFixed(2)} dB`);
});
test('vingt kilohertz sont à trois décibels — la coupure, par définition', () => {
  const db = enDb(reponse(20000, { graves: false }));
  assert.ok(db < -2.9 && db > -3.2, `${db.toFixed(2)} dB au lieu de −3,01`);
});
test('un kilohertz plus haut, il en reste un vingtième', () => {
  const db = enDb(reponse(21000, { graves: false }));
  assert.ok(db < -20, `${db.toFixed(2)} dB`);
});
test('vingt-deux kilohertz sont enterrés', () => {
  const db = enDb(reponse(22000, { graves: false }));
  assert.ok(db < -50, `${db.toFixed(2)} dB`);
});

titre('le coupe-bas, symétriquement');
test('mille hertz passent intacts', () => {
  const db = enDb(reponse(1000, { aigus: false }));
  assert.ok(Math.abs(db) < 0.1, `${db.toFixed(2)} dB`);
});
test('cent hertz — une contrebasse — passent intacts', () => {
  const db = enDb(reponse(100, { aigus: false, secondes: 3 }));
  assert.ok(Math.abs(db) < 0.2, `${db.toFixed(2)} dB`);
});
test('trente hertz — la plus basse note d’un orgue — passent intacts', () => {
  const db = enDb(reponse(30, { aigus: false, secondes: 6 }));
  assert.ok(db > -0.05, `${db.toFixed(2)} dB`);
});
test('vingt hertz sont à trois décibels', () => {
  const db = enDb(reponse(20, { aigus: false, secondes: 6 }));
  assert.ok(db < -2.9 && db > -3.2, `${db.toFixed(2)} dB au lieu de −3,01`);
});
test('quinze hertz sont déjà loin', () => {
  const db = enDb(reponse(15, { aigus: false, secondes: 8 }));
  assert.ok(db < -20, `${db.toFixed(2)} dB`);
});
test('cinq hertz ne sortent pas du tout', () => {
  const db = enDb(reponse(5, { aigus: false, secondes: 8 }));
  assert.ok(db < -80, `${db.toFixed(2)} dB`);
});

titre('le continu, qui est ce qui coûte le plus cher');
test('un décalage constant est mangé', () => {
  const h = new Hygiene(TAUX);
  const bloc = 128;
  const g = new Float64Array(bloc);
  const d = new Float64Array(bloc);
  let dernier = 1;
  for (let i = 0; i < TAUX * 4; i += bloc) {
    g.fill(0.5); d.fill(0.5);
    h.traiter(g, d, false, true);
    dernier = Math.abs(g[bloc - 1]);
  }
  assert.ok(dernier < 0.01, `il reste ${dernier.toFixed(4)} de continu`);
});

titre('rien ne s’emballe et rien ne devient NaN');
test('trente secondes de bruit fort ne s’emballent pas', () => {
  const h = new Hygiene(TAUX);
  const bloc = 128;
  const g = new Float64Array(bloc);
  const d = new Float64Array(bloc);
  let graine = 12345;
  const n = TAUX * 30;
  const tiers = [0, 0, 0];
  for (let i = 0; i < n; i += bloc) {
    for (let k = 0; k < bloc; k++) {
      graine = (graine * 1103515245 + 12345) & 0x7fffffff;
      const v = ((graine / 0x7fffffff) * 2 - 1) * 0.9;
      g[k] = v; d[k] = v;
    }
    h.traiter(g, d, true, true);
    const t = Math.min(2, Math.floor(i / (n / 3)));
    for (let k = 0; k < bloc; k++) {
      assert.ok(Number.isFinite(g[k]), `NaN à ${(i / TAUX).toFixed(1)} s`);
      tiers[t] = Math.max(tiers[t], Math.abs(g[k]));
    }
  }
  // On ne demande pas que la sortie tienne sous l'entrée : un filtre raide
  // AUGMENTE le facteur de crête d'un signal (il ôte des partiels, ceux qui
  // restent se réalignent), et sur du bruit blanc à ±0,9 la sortie monte à
  // 1,57 — d'où le coupe-haut, pas le coupe-bas. C'est mesuré, c'est normal,
  // et c'est précisément pourquoi l'hygiène passe AVANT le limiteur : le
  // plafond doit être le dernier mot. Ce qu'on exige ici, c'est que ça ne
  // GRANDISSE pas : un filtre instable, lui, ne s'arrête jamais de monter.
  assert.ok(tiers[2] <= tiers[1] * 1.02,
    `${tiers[1].toFixed(3)} puis ${tiers[2].toFixed(3)} : ça monte encore`);
});
test('un signal musical n’est pas gonflé pour autant', () => {
  const h = new Hygiene(TAUX);
  const bloc = 128;
  const g = new Float64Array(bloc);
  const d = new Float64Array(bloc);
  let crete = 0;
  for (let i = 0; i < TAUX * 5; i += bloc) {
    for (let k = 0; k < bloc; k++) {
      const v = 0.9 * Math.sin((2 * Math.PI * 220 * (i + k)) / TAUX);
      g[k] = v; d[k] = v;
    }
    h.traiter(g, d, true, true);
    if (i > TAUX) for (let k = 0; k < bloc; k++) crete = Math.max(crete, Math.abs(g[k]));
  }
  assert.ok(crete < 0.905, `un la à 0,9 ressort à ${crete.toFixed(4)}`);
});
test('un long silence après du signal retombe vraiment à zéro', () => {
  const h = new Hygiene(TAUX);
  const bloc = 128;
  const g = new Float64Array(bloc);
  const d = new Float64Array(bloc);
  for (let i = 0; i < TAUX; i += bloc) {
    for (let k = 0; k < bloc; k++) {
      const v = Math.sin((2 * Math.PI * 200 * (i + k)) / TAUX);
      g[k] = v; d[k] = v;
    }
    h.traiter(g, d, true, true);
  }
  for (let i = 0; i < TAUX * 3; i += bloc) {
    g.fill(0); d.fill(0);
    h.traiter(g, d, true, true);
  }
  assert.ok(Math.abs(g[bloc - 1]) < 1e-12, `reste ${g[bloc - 1]}`);
});

titre('les deux canaux sont indépendants');
test('un signal à gauche seulement ne fuit pas à droite', () => {
  const h = new Hygiene(TAUX);
  const bloc = 128;
  const g = new Float64Array(bloc);
  const d = new Float64Array(bloc);
  let fuite = 0;
  for (let i = 0; i < TAUX; i += bloc) {
    for (let k = 0; k < bloc; k++) {
      g[k] = Math.sin((2 * Math.PI * 1000 * (i + k)) / TAUX);
      d[k] = 0;
    }
    h.traiter(g, d, true, true);
    for (let k = 0; k < bloc; k++) fuite = Math.max(fuite, Math.abs(d[k]));
  }
  assert.ok(fuite < 1e-12, `fuite ${fuite}`);
});

titre('éteindre un filtre l’éteint vraiment');
test('les deux coupés, le signal ressort tel quel', () => {
  const h = new Hygiene(TAUX);
  const g = new Float64Array([0.1, -0.7, 0.4, 0.9]);
  const d = new Float64Array([0.1, -0.7, 0.4, 0.9]);
  const avant = [...g];
  h.traiter(g, d, false, false);
  assert.deepEqual([...g], avant);
});
test('cinq hertz repassent quand on coupe le coupe-bas', () => {
  const db = enDb(reponse(5, { aigus: false, graves: false, secondes: 2 }));
  assert.ok(Math.abs(db) < 0.01, `${db.toFixed(3)} dB`);
});
test('rallumer part de mémoires vides, sans recracher l’ancien', () => {
  const h = new Hygiene(TAUX);
  const bloc = 128;
  const g = new Float64Array(bloc);
  const d = new Float64Array(bloc);
  // du gros signal, filtres éteints : les mémoires ne bougent pas
  for (let i = 0; i < 200; i++) { g.fill(0.9); d.fill(0.9); h.traiter(g, d, false, false); }
  // on rallume sur du silence : rien ne doit sortir
  g.fill(0); d.fill(0);
  h.traiter(g, d, true, true);
  let crete = 0;
  for (let k = 0; k < bloc; k++) crete = Math.max(crete, Math.abs(g[k]));
  assert.ok(crete < 1e-12, `${crete} au rallumage`);
});

titre('les réglages');
test('les deux bornes sont là par défaut', () => {
  assert.equal(HYGIENE_DEFAUTS.aigus, true);
  assert.equal(HYGIENE_DEFAUTS.graves, true);
});
test('on peut en couper une sans couper l’autre', () => {
  assert.deepEqual(normaliserHygiene({ aigus: false }), { aigus: false, graves: true });
  assert.deepEqual(normaliserHygiene({ graves: false }), { aigus: true, graves: false });
});
test('un JSON vide ou faux rend les défauts', () => {
  assert.deepEqual(normaliserHygiene(null), { aigus: true, graves: true });
  assert.deepEqual(normaliserHygiene('n’importe quoi'), { aigus: true, graves: true });
});
test('vider remet les mémoires à zéro', () => {
  const h = new Hygiene(TAUX);
  const g = new Float64Array(128).fill(0.5);
  const d = new Float64Array(128).fill(0.5);
  h.traiter(g, d, true, true);
  h.vider();
  assert.ok(h.etatBas.every((v) => v === 0));
  assert.ok(h.etatHaut.every((v) => v === 0));
});

console.log(`\n${ok} ✓ / ${ko} ✗`);
process.exit(ko ? 1 : 0);

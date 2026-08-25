/**
 * LE PUPITRE — Channel9, éprouvé au nœud.
 *
 * On ne vérifie pas que le code ressemble à celui de Chris. On mesure ce
 * qu'une table FAIT : elle n'arrive pas à suivre, et cela se compte.
 *
 * ATTENTION AU PIÈGE, il m'a coûté une première version de ce fichier. Le
 * `threshold` de Chris n'est PAS une limite de pente. Ce qu'il borne est une
 * différence seconde — un changement de pente, pas la pente elle-même — et
 * une rampe rapide mais régulière passe donc intacte. Mesurer le plus grand
 * saut d'un échantillon au suivant et le comparer au seuil ne prouve rien :
 * la Neve, seuil 0,33, laisse passer des sauts de 1,3.
 *
 * On mesure donc trois choses qui, elles, se rangent vraiment :
 * l'écart au signal d'entrée, le temps de montée sur un échelon, et ce qui
 * reste d'aigu après un créneau. Si un jour quelqu'un recopie un chiffre de
 * travers, c'est l'un de ces trois ordres qui cassera.
 *
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { PUPITRES, ORDRE_PUPITRES, PUPITRE_DEFAUTS, normaliserPupitre,
  indiceDePupitre, pupitreDIndice } from '../engine/src/core/pupitre-reglages.js';

const ici = dirname(fileURLToPath(import.meta.url));
const TAUX = 48000;

globalThis.sampleRate = TAUX;
globalThis.AudioWorkletProcessor = class { constructor() { this.port = {}; } };
globalThis.registerProcessor = () => {};
const { Channel9 } = await import('../engine/src/core/pupitre-worklet.js');

let ok = 0, ko = 0;
const test = (nom, fn) => {
  try { fn(); ok++; console.log(`  ✓ ${nom}`); }
  catch (e) { ko++; console.log(`  ✗ ${nom}\n    ${e.message}`); }
};
const titre = (t) => console.log(`\n${t}`);

const BLOC = 128;
/** Passe un signal dans une table et rend la sortie entière. */
function traverser(table, signal, { attaque = 0.35, sortie = 1 } = {}) {
  const c = new Channel9(TAUX);
  const i = indiceDePupitre(table);
  const rendu = new Float64Array(signal.length);
  const g = new Float64Array(BLOC);
  const d = new Float64Array(BLOC);
  for (let n = 0; n < signal.length; n += BLOC) {
    const taille = Math.min(BLOC, signal.length - n);
    for (let k = 0; k < BLOC; k++) {
      const v = k < taille ? signal[n + k] : 0;
      g[k] = v; d[k] = v;
    }
    c.traiter(g, d, i, attaque, sortie);
    for (let k = 0; k < taille; k++) rendu[n + k] = g[k];
  }
  return rendu;
}

/** L'écart maximal entre ce qu'on a donné à la table et ce qu'elle rend. */
function ecartAuSec(y, sec, depuis = 0) {
  let m = 0;
  for (let i = depuis; i < y.length; i++) m = Math.max(m, Math.abs(y[i] - sec[i]));
  return m;
}

/** Combien d'échantillons pour atteindre 90 % après un échelon. */
function montee(table, niveau = 0.8) {
  const n = 4096;
  const s = new Float64Array(n);
  for (let i = n / 2; i < n; i++) s[i] = niveau;
  const y = traverser(table, s);
  for (let i = n / 2; i < n; i++) if (Math.abs(y[i]) >= niveau * 0.9) return i - (n / 2);
  return Infinity;
}

/** La part d'énergie au-dessus de 5 kHz, sur un créneau — ce qui « brille ». */
function partAigue(table) {
  const s = creneau(0.3);
  const y = traverser(table, s);
  const depart = Math.floor(TAUX * 0.15);
  let haut = 0, tout = 0;
  for (let h = 1; h <= 180; h++) {
    const f = 110 * h;
    if (f > 20000) break;
    let re = 0, im = 0, cpt = 0;
    for (let i = depart; i < s.length; i++) {
      const w = (2 * Math.PI * f * i) / TAUX;
      re += y[i] * Math.sin(w); im += y[i] * Math.cos(w); cpt++;
    }
    const a = (2 * Math.hypot(re, im)) / cpt;
    tout += a * a;
    if (f > 5000) haut += a * a;
  }
  return Math.sqrt(haut / Math.max(tout, 1e-18));
}

/** Un créneau : le pire cas pour une table, et le plus révélateur. */
function creneau(secondes = 0.4, hz = 110, niveau = 0.8) {
  const n = Math.round(TAUX * secondes);
  const s = new Float64Array(n);
  const periode = TAUX / hz;
  for (let i = 0; i < n; i++) s[i] = ((i % periode) < periode / 2 ? 1 : -1) * niveau;
  return s;
}

/* -------------------------------------------- les tables ne divergent pas */
titre('les cinq tables du worklet sont celles du module de réglages');
test('les trois nombres de chaque table concordent', () => {
  const source = readFileSync(
    join(ici, '..', 'engine', 'src', 'core', 'pupitre-worklet.js'), 'utf8');
  const bloc = source.match(/const TABLES = \[([\s\S]*?)\n\];/);
  assert.ok(bloc, 'TABLES introuvable dans le worklet');
  const lignes = bloc[1].split('\n').filter((l) => l.includes('dielectrique'));
  assert.equal(lignes.length, ORDRE_PUPITRES.length,
    `${lignes.length} tables dans le worklet contre ${ORDRE_PUPITRES.length}`);
  ORDRE_PUPITRES.forEach((cle, i) => {
    const p = PUPITRES[cle];
    const nombres = lignes[i].match(/-?\d+\.?\d*/g).map(Number);
    assert.deepEqual(nombres, [p.dielectrique, p.vitesse, p.bande],
      `${cle} : ${nombres} contre ${[p.dielectrique, p.vitesse, p.bande]}`);
    assert.ok(new RegExp(`//\\s*${p.nom}`).test(lignes[i]),
      `${cle} n'est pas nommée ${p.nom} dans le worklet`);
  });
});

/* ------------------------------------------------ ce que la table fait -- */
titre('une table est ce qu’elle n’arrive pas à suivre');
const carre = creneau(0.3);
const mesures = {};
for (const cle of ORDRE_PUPITRES) {
  mesures[cle] = {
    ecart: ecartAuSec(traverser(cle, carre), carre, Math.floor(TAUX * 0.1)),
    montee: montee(cle),
    aigu: partAigue(cle)
  };
}
console.log('  · ' + ORDRE_PUPITRES.map((c) =>
  `${PUPITRES[c].nom} : écart ${mesures[c].ecart.toFixed(2)},`
  + ` montée ${mesures[c].montee}, aigu ${(mesures[c].aigu * 100).toFixed(1)} %`)
  .join('\n  · '));

test('parmi les trois tables de studio, la plus rapide altère le moins', () => {
  // SSL (0,85) suit presque tout, l'API (0,60) moins, la Neve (0,33) encore
  // moins : l'écart au signal d'entrée doit se ranger dans cet ordre-là.
  assert.ok(mesures.ssl.ecart < mesures.api.ecart,
    `SSL ${mesures.ssl.ecart.toFixed(3)} contre API ${mesures.api.ecart.toFixed(3)}`);
  assert.ok(mesures.api.ecart < mesures.neve.ecart,
    `API ${mesures.api.ecart.toFixed(3)} contre Neve ${mesures.neve.ecart.toFixed(3)}`);
});
test('…et les deux tables modestes altèrent plus que les trois autres', () => {
  const studio = Math.max(mesures.neve.ecart, mesures.api.ecart, mesures.ssl.ecart);
  assert.ok(mesures.teac.ecart > studio,
    `Teac ${mesures.teac.ecart.toFixed(3)} contre ${studio.toFixed(3)}`);
  assert.ok(mesures.mackie.ecart > studio,
    `Mackie ${mesures.mackie.ecart.toFixed(3)} contre ${studio.toFixed(3)}`);
});
test('sur un échelon, la SSL est déjà là quand la Mackie traîne encore', () => {
  assert.equal(mesures.ssl.montee, 0, `SSL : ${mesures.ssl.montee} échantillons`);
  assert.ok(mesures.neve.montee >= mesures.ssl.montee
    && mesures.neve.montee <= 2, `Neve : ${mesures.neve.montee}`);
  assert.ok(mesures.teac.montee >= 2, `Teac : ${mesures.teac.montee}`);
  assert.ok(mesures.mackie.montee >= 2, `Mackie : ${mesures.mackie.montee}`);
});
test('les deux tables modestes gardent nettement moins d’aigu', () => {
  const modeste = Math.max(mesures.teac.aigu, mesures.mackie.aigu);
  const studio = Math.min(mesures.neve.aigu, mesures.api.aigu, mesures.ssl.aigu);
  assert.ok(modeste < studio * 0.85,
    `modestes ${(modeste * 100).toFixed(2)} % contre studio ${(studio * 100).toFixed(2)} %`);
});
test('le seuil de Chris ne borne PAS la pente — et c’est normal', () => {
  // Ce test existe pour empêcher quelqu'un (moi, la prochaine fois) de
  // « corriger » le portage vers un écrêteur de pente ordinaire. Ce que
  // Chris borne est une différence SECONDE : une rampe rapide et régulière
  // traverse intacte, et c'est ce qui distingue une table d'un limiteur de
  // pente. La Neve, seuil 0,33, laisse donc passer bien plus que 0,33.
  const y = traverser('neve', carre);
  let saut = 0;
  for (let i = Math.floor(TAUX * 0.1); i < y.length; i++) {
    saut = Math.max(saut, Math.abs(y[i] - y[i - 1]));
  }
  assert.ok(saut > PUPITRES.neve.vitesse * 2,
    `saut maximal ${saut.toFixed(3)} pour un seuil de ${PUPITRES.neve.vitesse}`);
});

/* --------------------------------------------------- les cinq diffèrent - */
titre('les cinq tables sonnent vraiment différemment');
test('deux tables ne rendent jamais le même signal', () => {
  const s = creneau(0.15);
  const rendus = ORDRE_PUPITRES.map((c) => traverser(c, s));
  for (let a = 0; a < rendus.length; a++) {
    for (let b = a + 1; b < rendus.length; b++) {
      let ecart = 0;
      for (let i = 0; i < s.length; i++) {
        ecart = Math.max(ecart, Math.abs(rendus[a][i] - rendus[b][i]));
      }
      assert.ok(ecart > 1e-3,
        `${ORDRE_PUPITRES[a]} et ${ORDRE_PUPITRES[b]} : écart ${ecart}`);
    }
  }
});
test('les tables étroites coupent l’aigu, les larges non', () => {
  // à 48 kHz, seules la Teac et la Mackie passent sous le `< 0,49999` de
  // Chris : les trois autres ne limitent pas la bande du tout
  const c = new Channel9(TAUX);
  const large = [];
  for (const cle of ORDRE_PUPITRES) {
    c._table = -1;
    c._accorder(indiceDePupitre(cle));
    large.push([cle, c.appliqueA]);
  }
  const filtrees = large.filter(([, a]) => a).map(([cle]) => cle);
  assert.deepEqual(filtrees, ['ssl', 'teac', 'mackie'],
    `filtrées à 48 kHz : ${filtrees.join(', ')}`);
});

/* ----------------------------------------------------------- la sortie -- */
titre('les deux réglages font ce qu’ils disent');
test('le niveau de sortie divise bien', () => {
  const s = creneau(0.2);
  const plein = traverser('neve', s);
  const moitie = traverser('neve', s, { sortie: 0.5 });
  let crete = 0, creteMoitie = 0;
  for (let i = TAUX * 0.1; i < s.length; i++) {
    crete = Math.max(crete, Math.abs(plein[i]));
    creteMoitie = Math.max(creteMoitie, Math.abs(moitie[i]));
  }
  assert.ok(Math.abs((creteMoitie / crete) - 0.5) < 0.05,
    `${(creteMoitie / crete).toFixed(3)} au lieu de 0,5`);
});
test('monter l’attaque ajoute de l’harmonique, pas du niveau', () => {
  const n = Math.round(TAUX * 0.4);
  const s = new Float64Array(n);
  for (let i = 0; i < n; i++) s[i] = 0.5 * Math.sin((2 * Math.PI * 200 * i) / TAUX);
  const mesurer = (attaque) => {
    const y = traverser('neve', s, { attaque });
    let fond = 0, harm = 0;
    const depart = Math.floor(n * 0.5);
    for (let k = 1; k <= 5; k++) {
      let re = 0, im = 0, cpt = 0;
      for (let i = depart; i < n; i++) {
        const w = (2 * Math.PI * 200 * k * i) / TAUX;
        re += y[i] * Math.sin(w); im += y[i] * Math.cos(w); cpt++;
      }
      const amp = (2 * Math.hypot(re, im)) / cpt;
      if (k === 1) fond = amp; else harm += amp * amp;
    }
    return Math.sqrt(harm) / Math.max(fond, 1e-12);
  };
  const doux = mesurer(0.1);
  const fort = mesurer(0.9);
  console.log(`  · distorsion : attaque 0,1 → ${(doux * 100).toFixed(2)} %,`
    + ` attaque 0,9 → ${(fort * 100).toFixed(2)} %`);
  assert.ok(fort > doux * 1.5,
    `${(doux * 100).toFixed(2)} % puis ${(fort * 100).toFixed(2)} %`);
});

/* ------------------------------------------------------- la solidité ---- */
titre('rien ne s’emballe et rien ne devient NaN');
test('trente secondes de bruit fort sur chaque table', () => {
  for (const cle of ORDRE_PUPITRES) {
    const c = new Channel9(TAUX);
    const i = indiceDePupitre(cle);
    const g = new Float64Array(BLOC);
    const d = new Float64Array(BLOC);
    let graine = 987654321;
    let crete = 0;
    for (let n = 0; n < TAUX * 30; n += BLOC) {
      for (let k = 0; k < BLOC; k++) {
        graine = (graine * 1103515245 + 12345) & 0x7fffffff;
        const v = ((graine / 0x7fffffff) * 2 - 1) * 0.95;
        g[k] = v; d[k] = v;
      }
      c.traiter(g, d, i, 1, 1);
      for (let k = 0; k < BLOC; k++) {
        assert.ok(Number.isFinite(g[k]),
          `${cle} : NaN à ${(n / TAUX).toFixed(1)} s`);
        crete = Math.max(crete, Math.abs(g[k]));
      }
    }
    assert.ok(crete < 2, `${cle} : crête ${crete.toFixed(3)}`);
  }
});
test('un long silence après du signal retombe à zéro', () => {
  const c = new Channel9(TAUX);
  const g = new Float64Array(BLOC);
  const d = new Float64Array(BLOC);
  for (let n = 0; n < TAUX; n += BLOC) {
    for (let k = 0; k < BLOC; k++) {
      const v = 0.8 * Math.sin((2 * Math.PI * 200 * (n + k)) / TAUX);
      g[k] = v; d[k] = v;
    }
    c.traiter(g, d, 0, 0.5, 1);
  }
  for (let n = 0; n < TAUX * 3; n += BLOC) {
    g.fill(0); d.fill(0);
    c.traiter(g, d, 0, 0.5, 1);
  }
  assert.ok(Math.abs(g[BLOC - 1]) < 1e-9, `reste ${g[BLOC - 1]}`);
});
test('les deux canaux sont indépendants', () => {
  const c = new Channel9(TAUX);
  const g = new Float64Array(BLOC);
  const d = new Float64Array(BLOC);
  let fuite = 0;
  for (let n = 0; n < TAUX; n += BLOC) {
    for (let k = 0; k < BLOC; k++) {
      g[k] = 0.7 * Math.sin((2 * Math.PI * 500 * (n + k)) / TAUX);
      d[k] = 0;
    }
    c.traiter(g, d, 0, 0.5, 1);
    for (let k = 0; k < BLOC; k++) fuite = Math.max(fuite, Math.abs(d[k]));
  }
  assert.ok(fuite < 1e-9, `fuite ${fuite}`);
});
test('changer de table en marche ne fabrique pas de NaN', () => {
  const c = new Channel9(TAUX);
  const g = new Float64Array(BLOC);
  const d = new Float64Array(BLOC);
  for (let n = 0, t = 0; n < TAUX * 5; n += BLOC, t++) {
    for (let k = 0; k < BLOC; k++) {
      const v = 0.7 * Math.sin((2 * Math.PI * 300 * (n + k)) / TAUX);
      g[k] = v; d[k] = v;
    }
    c.traiter(g, d, t % 5, 0.5, 1);
    for (let k = 0; k < BLOC; k++) assert.ok(Number.isFinite(g[k]), `NaN au tour ${t}`);
  }
});
test('rallumer part de mémoires vides', () => {
  const c = new Channel9(TAUX);
  const g = new Float64Array(BLOC).fill(0.9);
  const d = new Float64Array(BLOC).fill(0.9);
  c.traiter(g, d, 0, 1, 1);
  c.dormir();
  g.fill(0); d.fill(0);
  c.traiter(g, d, 0, 1, 1);
  let crete = 0;
  for (let k = 0; k < BLOC; k++) crete = Math.max(crete, Math.abs(g[k]));
  assert.ok(crete < 1e-9, `${crete} au rallumage`);
});

/* ------------------------------------------------------- les réglages --- */
titre('les réglages');
test('le pupitre est ÉTEINT par défaut', () => {
  assert.equal(PUPITRE_DEFAUTS.actif, false);
  assert.equal(normaliserPupitre(undefined).actif, false);
  assert.equal(normaliserPupitre({}).actif, false);
});
test('…et il faut le dire explicitement pour l’allumer', () => {
  assert.equal(normaliserPupitre({ actif: true }).actif, true);
  assert.equal(normaliserPupitre({ actif: 'oui' }).actif, false);
});
test('une table inconnue retombe sur la Neve', () => {
  assert.equal(normaliserPupitre({ table: 'harrison' }).table, 'neve');
  assert.equal(normaliserPupitre({ table: 'ssl' }).table, 'ssl');
});
test('les valeurs hors bornes sont ramenées', () => {
  assert.equal(normaliserPupitre({ attaque: 9 }).attaque, 1);
  assert.equal(normaliserPupitre({ attaque: -1 }).attaque, 0);
  assert.equal(normaliserPupitre({ sortie: 'fort' }).sortie, PUPITRE_DEFAUTS.sortie);
});
test('les cinq tables font l’aller-retour nom ↔ indice', () => {
  ORDRE_PUPITRES.forEach((cle, i) => {
    assert.equal(indiceDePupitre(cle), i);
    assert.equal(pupitreDIndice(i), cle);
  });
  assert.equal(indiceDePupitre('inconnue'), indiceDePupitre(PUPITRE_DEFAUTS.table));
  assert.equal(pupitreDIndice(99), PUPITRE_DEFAUTS.table);
});
test('chaque table a un nom et une description', () => {
  for (const cle of ORDRE_PUPITRES) {
    assert.ok(PUPITRES[cle].nom, cle);
    assert.ok(PUPITRES[cle].desc?.length > 10, cle);
  }
});

console.log(`\n${ok} ✓ / ${ko} ✗`);
process.exit(ko ? 1 : 0);

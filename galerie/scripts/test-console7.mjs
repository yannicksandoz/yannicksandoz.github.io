/**
 * CONSOLE7 — la table version sept, éprouvée au nœud.
 *
 * Ce qu'on vérifie, c'est ce qui la distingue de la six :
 *   1. l'encodage et le décodage se REPRENNENT à peu près, mais pas
 *      exactement — c'est le déséquilibre qui fait la couleur ;
 *   2. la somme est BORNÉE : c'est le propos d'une table ;
 *   3. le fader poursuivi se pose vraiment sur sa valeur, sans osciller ;
 *   4. une tranche baissée traverse MOINS de distorsion — le « fall back in
 *      the soundstage » de Chris, qui dans une galerie tient à la distance.
 *
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import { CONSOLE_DEFAUTS, MOTEURS_CONSOLE, normaliserConsole }
  from '../engine/src/core/console-reglages.js';

const TAUX = 48000;
globalThis.sampleRate = TAUX;
globalThis.AudioWorkletProcessor = class { constructor() { this.port = {}; } };
globalThis.registerProcessor = () => {};
const { Console7Tranche, Console7Somme } =
  await import('../engine/src/core/console7-worklet.js');

let ok = 0, ko = 0;
const test = (nom, fn) => {
  try { fn(); ok++; console.log(`  ✓ ${nom}`); }
  catch (e) { ko++; console.log(`  ✗ ${nom}\n    ${e.message}`); }
};
const titre = (t) => console.log(`\n${t}`);

const BLOC = 128;
/** Fait passer un signal dans un étage et rend la sortie. */
function passer(Moteur, signal, niveau) {
  const m = new Moteur(TAUX);
  const rendu = new Float64Array(signal.length);
  const g = new Float64Array(BLOC);
  const d = new Float64Array(BLOC);
  for (let n = 0; n < signal.length; n += BLOC) {
    const taille = Math.min(BLOC, signal.length - n);
    for (let k = 0; k < BLOC; k++) {
      const v = k < taille ? signal[n + k] : 0;
      g[k] = v; d[k] = v;
    }
    m.traiter(g, d, niveau);
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

/* ------------------------------------------------- l'aller et le retour - */
titre('encoder puis décoder rend PRESQUE le signal — et c’est le propos');
{
  const s = sinus(300, 0.4, 0.5);
  const encode = passer(Console7Tranche, s, 0.772);
  const rendu = passer(Console7Somme, encode, 0.971);
  const depuis = Math.floor(TAUX * 0.2);
  let pire = 0, niveau = 0;
  for (let i = depuis; i < s.length; i++) {
    pire = Math.max(pire, Math.abs(rendu[i] - s[i]));
    niveau = Math.max(niveau, Math.abs(s[i]));
  }
  console.log(`  · une source seule : écart maximal ${(pire / niveau * 100).toFixed(2)} %`);
  test('une source seule ressort à peu près comme elle est entrée', () => {
    assert.ok(pire < niveau * 0.15,
      `${(pire / niveau * 100).toFixed(1)} % d'écart`);
  });
  test('…mais pas exactement : les deux mélanges ne sont pas réciproques', () => {
    assert.ok(pire > niveau * 1e-4,
      `${(pire / niveau * 100).toExponential(2)} % — trop parfait pour la sept`);
  });
}

/* ------------------------------------------------------ la sommation --- */
titre('la somme est bornée : c’est ce qu’une table fait');
{
  const un = passer(Console7Tranche, sinus(300, 0.3, 0.5), 0.772);
  const additionner = (combien) => {
    const somme = new Float64Array(un.length);
    for (let i = 0; i < un.length; i++) somme[i] = un[i] * combien;
    return crete(passer(Console7Somme, somme, 0.971), Math.floor(TAUX * 0.15));
  };
  const mesures = [1, 3, 8, 15].map((n) => [n, additionner(n)]);
  console.log('  · sources → sortie : '
    + mesures.map(([n, c]) => `${n} → ${c.toFixed(3)}`).join(' · '));
  test('une source seule reste à son niveau', () => {
    assert.ok(Math.abs(mesures[0][1] - 0.5) < 0.08, mesures[0][1].toFixed(3));
  });
  test('quinze sources ne font pas quinze fois plus', () => {
    assert.ok(mesures[3][1] < mesures[0][1] * 5,
      `${mesures[0][1].toFixed(3)} puis ${mesures[3][1].toFixed(3)}`);
  });
  test('…et la somme monte quand même : elle est bornée, pas écrasée', () => {
    for (let i = 1; i < mesures.length; i++) {
      assert.ok(mesures[i][1] > mesures[i - 1][1],
        `${mesures[i - 1][1].toFixed(3)} puis ${mesures[i][1].toFixed(3)}`);
    }
  });
}

/* --------------------------------------------------- le fader poursuivi - */
titre('le fader poursuivi se pose, et ne dépasse pas');
test('un fader immobile finit exactement sur sa valeur', () => {
  const m = new Console7Tranche(TAUX);
  const g = new Float64Array(BLOC);
  const d = new Float64Array(BLOC);
  for (let n = 0; n < 400; n++) { g.fill(0); d.fill(0); m.traiter(g, d, 0.5); }
  const attendu = 0.5 * 1.272019649514069;
  assert.ok(Math.abs(m.fader.valeur - attendu) < 1e-6,
    `${m.fader.valeur} au lieu de ${attendu}`);
});
test('changer de fader ne fait pas d’à-coup dans le signal', () => {
  const m = new Console7Tranche(TAUX);
  const g = new Float64Array(BLOC);
  const d = new Float64Array(BLOC);
  let precedent = 0, saut = 0;
  for (let n = 0; n < 200; n++) {
    for (let k = 0; k < BLOC; k++) {
      const v = 0.5 * Math.sin((2 * Math.PI * 200 * ((n * BLOC) + k)) / TAUX);
      g[k] = v; d[k] = v;
    }
    // on tire le fader d'un bout à l'autre au milieu
    m.traiter(g, d, n < 100 ? 0.2 : 1);
    for (let k = 0; k < BLOC; k++) {
      if (n > 0 || k > 0) saut = Math.max(saut, Math.abs(g[k] - precedent));
      precedent = g[k];
    }
  }
  // un sinus à 200 Hz saute au plus de 0,5·2π·200/48000 ≈ 0,013 par
  // échantillon ; un à-coup de fader se verrait bien au-dessus
  assert.ok(saut < 0.1, `saut de ${saut.toFixed(4)}`);
});
test('la vitesse reste au plafond TANT QUE le fader n’a pas convergé', () => {
  // Chris double la vitesse à chaque bloc où la valeur n'est pas encore
  // exactement la cible, et la borne à la taille du bloc. Tant que la
  // poursuite converge — ce qui prend quelques milliers d'échantillons —
  // elle reste donc épinglée en haut. C'est voulu : c'est ce qui fait qu'un
  // fader qu'on traîne suit la main.
  const m = new Console7Tranche(TAUX);
  const g = new Float64Array(BLOC);
  const d = new Float64Array(BLOC);
  for (let n = 0; n < 20; n++) { g.fill(0); d.fill(0); m.traiter(g, d, 0.3); }
  assert.ok(m.fader.vitesse > BLOC * 0.9,
    `${m.fader.vitesse} pendant la poursuite`);
  assert.ok(m.fader.vitesse <= BLOC, `${m.fader.vitesse} au-dessus du bloc`);
});
test('…et elle s’y GARE, parce que la poursuite ne touche jamais sa cible', () => {
  // Ceci mérite d'être écrit, sans quoi quelqu'un « corrigera » le portage.
  // La condition de Chris est `if (gainchase != inputgain) chasespeed *= 2`.
  // Or la poursuite est une moyenne pondérée : elle converge à quelques
  // ulps de la cible — mesuré, 3·10⁻¹⁵ — et n'y arrive JAMAIS exactement.
  // La condition reste donc vraie pour toujours, la vitesse redouble à
  // chaque bloc, se fait borner à la taille du bloc, et se stabilise juste
  // en dessous. Le plancher de 64 ne sert qu'aux blocs plus courts que lui.
  // Conséquence pratique : la constante de lissage vaut ~125 échantillons,
  // soit deux millisecondes et demie — c'est court, et ça ne craque pas
  // (le test d'à-coup, juste au-dessus, le vérifie).
  const m = new Console7Tranche(TAUX);
  const g = new Float64Array(BLOC);
  const d = new Float64Array(BLOC);
  const cible = 0.3 * 1.272019649514069;
  const releves = [];
  for (let n = 1; n <= 2000; n++) {
    g.fill(0); d.fill(0); m.traiter(g, d, 0.3);
    if (n === 20 || n === 2000) releves.push(m.fader.vitesse);
  }
  assert.ok(Math.abs(m.fader.valeur - cible) < 1e-12,
    `la poursuite n'a pas convergé : ${m.fader.valeur - cible}`);
  assert.notEqual(m.fader.valeur, cible, 'elle a touché la cible — revoir ce test');
  assert.equal(releves[0], releves[1],
    `${releves[0]} puis ${releves[1]} : la vitesse bouge encore`);
  assert.ok(releves[1] > 64 && releves[1] <= BLOC, String(releves[1]));
});

/* ------------------------------------- la tranche baissée recule --------- */
titre('une tranche baissée traverse MOINS de distorsion');
{
  // Le geste de Chris : saturer au cube du fader, puis réamplifier d'un
  // seul facteur. Une tranche à mi-course ne subit donc pas la même courbe
  // qu'une tranche au plein — et dans cette galerie, c'est la distance qui
  // tient le fader.
  const harmoniques = (niveau) => {
    const s = sinus(200, 0.5, 0.9);
    const y = passer(Console7Tranche, s, niveau);
    const depart = Math.floor(TAUX * 0.25);
    let fond = 0, harm = 0;
    for (let k = 1; k <= 7; k++) {
      let re = 0, im = 0, cpt = 0;
      for (let i = depart; i < y.length; i++) {
        const w = (2 * Math.PI * 200 * k * i) / TAUX;
        re += y[i] * Math.sin(w); im += y[i] * Math.cos(w); cpt++;
      }
      const a = (2 * Math.hypot(re, im)) / cpt;
      if (k === 1) fond = a; else harm += a * a;
    }
    return Math.sqrt(harm) / Math.max(fond, 1e-12);
  };
  const plein = harmoniques(1);
  const moitie = harmoniques(0.5);
  const bas = harmoniques(0.2);
  console.log(`  · distorsion : fader 1 → ${(plein * 100).toFixed(2)} %,`
    + ` 0,5 → ${(moitie * 100).toFixed(2)} %, 0,2 → ${(bas * 100).toFixed(2)} %`);
  test('plus le fader est bas, moins la tranche se colore', () => {
    assert.ok(moitie < plein, `${(plein * 100).toFixed(2)} puis ${(moitie * 100).toFixed(2)} %`);
    assert.ok(bas < moitie, `${(moitie * 100).toFixed(2)} puis ${(bas * 100).toFixed(2)} %`);
  });
}

/* -------------------------------------------------------- la solidité -- */
titre('rien ne s’emballe et rien ne devient NaN');
for (const [nom, Moteur, niv] of [['tranche', Console7Tranche, 1], ['somme', Console7Somme, 1]]) {
  test(`${nom} : vingt secondes de bruit fort`, () => {
    const m = new Moteur(TAUX);
    const g = new Float64Array(BLOC);
    const d = new Float64Array(BLOC);
    let graine = 777777;
    let c = 0;
    for (let n = 0; n < TAUX * 20; n += BLOC) {
      for (let k = 0; k < BLOC; k++) {
        graine = (graine * 1103515245 + 12345) & 0x7fffffff;
        const v = ((graine / 0x7fffffff) * 2 - 1) * 0.95;
        g[k] = v; d[k] = v;
      }
      m.traiter(g, d, niv);
      for (let k = 0; k < BLOC; k++) {
        assert.ok(Number.isFinite(g[k]), `NaN à ${(n / TAUX).toFixed(1)} s`);
        c = Math.max(c, Math.abs(g[k]));
      }
    }
    assert.ok(c < 3, `crête ${c.toFixed(3)}`);
  });
}
test('les deux canaux sont indépendants', () => {
  const m = new Console7Tranche(TAUX);
  const g = new Float64Array(BLOC);
  const d = new Float64Array(BLOC);
  let fuite = 0;
  for (let n = 0; n < 400; n++) {
    for (let k = 0; k < BLOC; k++) {
      g[k] = 0.6 * Math.sin((2 * Math.PI * 500 * ((n * BLOC) + k)) / TAUX);
      d[k] = 0;
    }
    m.traiter(g, d, 0.772);
    for (let k = 0; k < BLOC; k++) fuite = Math.max(fuite, Math.abs(d[k]));
  }
  assert.ok(fuite < 1e-9, `fuite ${fuite}`);
});
test('vider remet tout à zéro', () => {
  const m = new Console7Somme(TAUX);
  const g = new Float64Array(BLOC).fill(0.5);
  const d = new Float64Array(BLOC).fill(0.5);
  m.traiter(g, d, 0.971);
  m.vider();
  assert.ok(m.etatA.every((v) => v === 0));
  assert.ok(m.etatB.every((v) => v === 0));
  assert.equal(m.fader.vitesse, 64.0);
});

/* -------------------------------------------------------- les réglages -- */
titre('les réglages');
test('la six reste le défaut', () => {
  assert.equal(CONSOLE_DEFAUTS.moteur, 'console6');
  assert.equal(normaliserConsole(undefined).moteur, 'console6');
});
test('on peut demander la sept par son nom', () => {
  assert.equal(normaliserConsole({ moteur: 'console7' }).moteur, 'console7');
});
test('un moteur inconnu retombe sur la six', () => {
  assert.equal(normaliserConsole({ moteur: 'console9' }).moteur, 'console6');
  assert.equal(normaliserConsole({ moteur: 42 }).moteur, 'console6');
});
test('les deux moteurs se décrivent', () => {
  for (const cle of ['console6', 'console7']) {
    assert.ok(MOTEURS_CONSOLE[cle].nom, cle);
    assert.ok(MOTEURS_CONSOLE[cle].desc?.length > 10, cle);
  }
});
test('le reste des réglages n’a pas bougé', () => {
  const r = normaliserConsole({ actif: true, attaque: 0.5 });
  assert.equal(r.actif, true);
  assert.equal(r.attaque, 0.5);
  assert.equal(r.moteur, 'console6');
});

console.log(`\n${ok} ✓ / ${ko} ✗`);
process.exit(ko ? 1 : 0);

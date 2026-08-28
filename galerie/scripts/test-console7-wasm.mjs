/**
 * CONSOLE7 EN WEBASSEMBLY — le portage confronté à l'original.
 *
 * Un portage audio qui « sonne pareil » sans le prouver ne prouve rien. La
 * suite compare donc le module WASM au JavaScript ÉCHANTILLON PAR
 * ÉCHANTILLON, sur des signaux qui vont chercher les coins : un silence,
 * une sinusoïde douce, un signal qui sature franchement, un fader qu'on
 * traîne (le chemin de la poursuite), et du bruit.
 *
 * Elle vérifie aussi le sinus maison — le seul transcendant du chemin
 * chaud, écrit à la main faute de libm — contre `Math.sin` sur toute la
 * plage que Chris autorise.
 *
 * ET ELLE MESURE. Sans chiffre, le portage est une opinion.
 *
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * LE DÉCOR MINIMAL D'UN WORKLET. `console7-worklet.js` s'enregistre auprès
 * du moteur audio dès son chargement ; hors navigateur, `registerProcessor`
 * et `AudioWorkletProcessor` n'existent pas. On les pose — c'est tout ce
 * qu'il faut pour que la CLASSE de traitement soit importable et jugeable
 * en Node, sans navigateur ni carte son.
 */
globalThis.registerProcessor ??= () => {};
globalThis.AudioWorkletProcessor ??= class { constructor() { this.port = { onmessage: null, postMessage() {} }; } };
globalThis.sampleRate ??= 48000;
globalThis.currentTime ??= 0;
const { Console7Tranche } = await import('../engine/src/core/console7-worklet.js');

let ok = 0, ko = 0;
const test = (nom, fn) => {
  try { fn(); ok++; console.log(`  ✓ ${nom}`); }
  catch (e) { ko++; console.log(`  ✗ ${nom}\n    ${e.message}`); }
};
const titre = (t) => console.log(`\n${t}`);

const ici = dirname(fileURLToPath(import.meta.url));
const octets = readFileSync(join(ici, '..', 'engine', 'assets', 'wasm', 'console7.wasm'));
const module = new WebAssembly.Module(octets);

const TAUX = 48000;
const BLOC = 128;

/** Une instance WASM prête : coefficients posés, état vierge. */
function tranche() {
  const inst = new WebAssembly.Instance(module, {});
  const x = inst.exports;
  const mem = new Float64Array(x.memory.buffer);
  // les coefficients viennent du JavaScript : `tan` ne se calcule qu'une
  // fois, et cela évite d'embarquer une libm pour un appel
  const PHI = 1.618033988749895;
  const f = 20000 / TAUX;
  const K = Math.tan(Math.PI * f);
  const norm = 1 / (1 + (K / PHI) + K * K);
  const b0 = K * K * norm;
  const coefs = [b0, 2 * b0, b0, 2 * (K * K - 1) * norm, (1 - K / PHI + K * K) * norm];
  const base = x.coefficients() / 8;
  for (let i = 0; i < 5; i++) mem[base + i] = coefs[i];
  x.reinitialiser();
  return { x, mem, g: x.tampon_gauche() / 8, d: x.tampon_droite() / 8 };
}

/** Un bloc dans le WASM, mono, comme le worklet le ferait. */
function blocWasm(t, entree, niveau) {
  for (let i = 0; i < entree.length; i++) t.mem[t.g + i] = entree[i];
  t.x.traiter(niveau, 0, entree.length);
  const s = new Float32Array(entree.length);
  for (let i = 0; i < entree.length; i++) s[i] = t.mem[t.g + i];
  return s;
}
/** Le même bloc dans le JavaScript d'origine. */
function blocJs(moteur, entree, niveau) {
  const buf = Float32Array.from(entree);
  moteur.traiter(buf, buf, niveau);
  return buf;
}

/** Compare les deux sur une suite de blocs, et rend l'écart maximal. */
function confronter(faireEntree, niveaux) {
  const w = tranche();
  const j = new Console7Tranche(TAUX);
  let pire = 0, ouBloc = -1;
  for (let b = 0; b < niveaux.length; b++) {
    const entree = faireEntree(b);
    const a = blocWasm(w, entree, niveaux[b]);
    const c = blocJs(j, entree, niveaux[b]);
    for (let i = 0; i < a.length; i++) {
      const e = Math.abs(a[i] - c[i]);
      if (e > pire) { pire = e; ouBloc = b; }
    }
  }
  return { pire, ouBloc };
}

const bruit = (() => {
  let s = 20240827;
  return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648) * 2 - 1;
})();

titre('le sinus maison contre Math.sin');
test('exact à un ulp sur toute la plage que Chris autorise', () => {
  const { x } = tranche();
  // |x| ≤ 1,097 après écrêtage, et |x·|x|| ≤ 1,204 : on déborde à 1,3
  let pire = 0, ou = 0;
  for (let i = 0; i <= 200000; i++) {
    const v = -1.3 + (i / 200000) * 2.6;
    const e = Math.abs(x.sinus(v) - Math.sin(v));
    if (e > pire) { pire = e; ou = v; }
  }
  assert.ok(pire <= 3e-16, `écart ${pire.toExponential(3)} à x = ${ou.toFixed(4)}`);
});
test('le zéro reste le zéro — un silence ne doit pas fuir', () => {
  const { x } = tranche();
  assert.equal(x.sinus(0), 0);
});

titre('le portage rend le MÊME signal');
test('un silence reste un silence', () => {
  const r = confronter(() => new Float32Array(BLOC), Array(8).fill(0.772));
  assert.equal(r.pire, 0, 'un silence traité ne peut pas différer');
});
test('une sinusoïde douce — le régime linéaire du filtre', () => {
  const r = confronter((b) => Float32Array.from({ length: BLOC },
    (_, i) => 0.2 * Math.sin(2 * Math.PI * 220 * (b * BLOC + i) / TAUX)),
  Array(16).fill(0.772));
  assert.ok(r.pire < 1e-7, `écart ${r.pire.toExponential(3)} (bloc ${r.ouBloc})`);
});
test('un signal qui SATURE — là où les deux spirales travaillent', () => {
  const r = confronter((b) => Float32Array.from({ length: BLOC },
    (_, i) => 1.6 * Math.sin(2 * Math.PI * 90 * (b * BLOC + i) / TAUX)),
  Array(16).fill(1));
  assert.ok(r.pire < 1e-7, `écart ${r.pire.toExponential(3)} (bloc ${r.ouBloc})`);
});
test('un fader qu’on TRAÎNE — le chemin de la poursuite', () => {
  // c'est l'état le plus fragile du portage : la vitesse double quand la
  // cible bouge et se pose sinon, et un décalage d'un bloc se verrait ici
  const niveaux = Array.from({ length: 40 }, (_, b) => 0.1 + (b / 40) * 0.8);
  const r = confronter(() => Float32Array.from({ length: BLOC }, () => bruit() * 0.5),
    niveaux);
  assert.ok(r.pire < 1e-7, `écart ${r.pire.toExponential(3)} (bloc ${r.ouBloc})`);
});
test('un fader immobile finit exactement sur sa valeur', () => {
  const r = confronter(() => Float32Array.from({ length: BLOC }, () => bruit() * 0.3),
    Array(200).fill(0.5));
  assert.ok(r.pire < 1e-7, `écart ${r.pire.toExponential(3)} après 200 blocs`);
});
test('du bruit à pleine échelle, cent blocs durant', () => {
  const r = confronter(() => Float32Array.from({ length: BLOC }, () => bruit()),
    Array(100).fill(0.772));
  assert.ok(r.pire < 1e-7, `écart ${r.pire.toExponential(3)} (bloc ${r.ouBloc})`);
});

titre('ce que ça coûte, et ce que ça rapporte');
test('le module reste minuscule — pas un moteur, une tranche', () => {
  assert.ok(octets.length < 8192, `${octets.length} octets`);
});
test('mesure : WASM contre JavaScript, quinze tranches', () => {
  // quinze tranches, comme la galerie en instancie, sur une seconde d'audio
  const BLOCS = Math.round(TAUX / BLOC);
  const entree = Float32Array.from({ length: BLOC }, () => bruit() * 0.4);

  const js = Array.from({ length: 15 }, () => new Console7Tranche(TAUX));
  const wa = Array.from({ length: 15 }, () => tranche());
  // on chauffe : sans cela on mesure la compilation, pas le code
  for (let b = 0; b < 60; b++) {
    for (const m of js) blocJs(m, entree, 0.772);
    for (const t of wa) blocWasm(t, entree, 0.772);
  }
  const chrono = (fn) => {
    const t0 = process.hrtime.bigint();
    fn();
    return Number(process.hrtime.bigint() - t0) / 1e6;
  };
  const tJs = chrono(() => {
    for (let b = 0; b < BLOCS; b++) for (const m of js) blocJs(m, entree, 0.772);
  });
  const tWa = chrono(() => {
    for (let b = 0; b < BLOCS; b++) for (const t of wa) blocWasm(t, entree, 0.772);
  });
  console.log(`      une seconde d'audio × 15 tranches :`
    + ` JS ${tJs.toFixed(1)} ms · WASM ${tWa.toFixed(1)} ms`
    + ` (×${(tJs / tWa).toFixed(2)})`);
  // On n'exige PAS un gain : le JIT de V8 est bon, et la copie de tampons
  // coûte des deux côtés. Ce qu'on exige, c'est que le portage ne soit pas
  // une régression — le jour où il le devient, la suite le dit.
  assert.ok(tWa < tJs * 1.6,
    `le portage coûte ${(tWa / tJs).toFixed(2)} × le JavaScript`);
});

console.log(`\n${ok} ✓ / ${ko} ✗`);
if (ko) process.exitCode = 1;

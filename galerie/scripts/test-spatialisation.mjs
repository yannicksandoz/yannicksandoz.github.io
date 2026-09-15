/**
 * UNE VOIE PAR ŒUVRE (core/Spatialisation.js) : les pistes d'une œuvre
 * partagent leur voie, une piste à réglages propres garde la sienne, la
 * voie ne se défait qu'avec sa dernière piste — et le budget compte des
 * voix. Un AudioContext de carton suffit : on éprouve le graphe, pas le son.
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import { Spatialisation, modeSpatial } from '../engine/src/core/Spatialisation.js';

let ok = 0; let ko = 0;
const test = (nom, fn) => { try { fn(); ok++; console.log(`  ✓ ${nom}`); } catch (e) { ko++; console.log(`  ✗ ${nom}\n      ${e.message}`); } };

// un nœud de carton : il se branche, se débranche, et compte ses liaisons
const noeud = (extra = {}) => {
  const n = { liaisons: new Set(), connect(c) { this.liaisons.add(c); return c; }, disconnect() { this.liaisons.clear(); }, ...extra };
  return n;
};
const param = (v = 1) => ({ value: v, setTargetAtTime() {}, cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime() {} });
const ctx = {
  currentTime: 0,
  createGain: () => noeud({ gain: param() }),
  createPanner: () => noeud({ positionX: param(0), positionY: param(0), positionZ: param(0), panningModel: 'HRTF' }),
  createBiquadFilter: () => noeud({ frequency: param(20000), Q: param(0.6), type: 'lowpass' })
};
const app = { audio: { ctx }, reglages: { audio: { maxHRTF: 2 } }, quality: { profile: { maxHRTF: 2 } } };
const oeuvre = (id) => ({ config: { id }, audioReady: true, _stemsActive: true, room: null, stems: [] });

/** Monte une œuvre comme Artwork le fait : un gain par piste, une voie demandée par piste. */
function monter(spatial, art, pistes) {
  const bus = ctx.createGain();
  art.stems = pistes.map((cfg) => {
    const gain = ctx.createGain();
    const voie = spatial.creerVoie(art, cfg, gain, bus);
    if (!voie) gain.connect(bus);
    return { cfg, gain, voie };
  });
  return bus;
}
const nbVoix = (art) => new Set(art.stems.map((s) => s.voie ?? s)).size;

console.log('\nune voie par œuvre');

test('trois pistes sans réglages propres : une seule voie, trois gains sur son entrée', () => {
  const sp = new Spatialisation(app);
  const art = oeuvre('marees');
  monter(sp, art, [{ file: 'a.wav' }, { file: 'b.wav', spatial: true }, { file: 'c.wav' }]);
  const voies = new Set(art.stems.map((s) => s.voie));
  assert.equal(voies.size, 1);
  const [v] = voies;
  assert.equal(v.usages, 3);
  assert.deepEqual(v.stems.map((s) => s.file), ['a.wav', 'b.wav', 'c.wav']);
  for (const s of art.stems) assert.ok(s.gain.liaisons.has(v.entree));
  assert.equal(sp.voies.size, 1);
  assert.equal(nbVoix(art), 1);
  assert.equal(sp.etat()[0].fichier, 'a.wav + b.wav + c.wav');
  assert.equal(sp.etat()[0].pistes, 3);
});

test('une piste qui déclare ses réglages garde une voie à elle ; deux pistes aux mêmes réglages la partagent', () => {
  const sp = new Spatialisation(app);
  const art = oeuvre('voix');
  monter(sp, art, [{ file: 'a.wav' }, { file: 'b.wav', spatial: { refDistance: 1, rolloff: 2 } },
    { file: 'c.wav', spatial: { refDistance: 1, rolloff: 2 } }, { file: 'd.wav', spatial: { largeur: 1.5 } }]);
  const [a, b, c, d] = art.stems.map((s) => s.voie);
  assert.notEqual(a, b);
  assert.equal(b, c);
  assert.notEqual(c, d);
  assert.equal(sp.voies.size, 3);
  assert.equal(nbVoix(art), 3);
});

test('une nappe (spatial: false) n\'a pas de voie et compte une voix à elle', () => {
  const sp = new Spatialisation(app);
  const art = oeuvre('nappe');
  monter(sp, art, [{ file: 'a.wav' }, { file: 'nappe.wav', spatial: false }]);
  assert.equal(modeSpatial({ spatial: false }), false);
  assert.equal(art.stems[1].voie, null);
  assert.equal(sp.voies.size, 1);
  assert.equal(nbVoix(art), 2);
});

test('deux œuvres ne partagent jamais : une voie chacune', () => {
  const sp = new Spatialisation(app);
  const a = oeuvre('a'); const b = oeuvre('b');
  monter(sp, a, [{ file: 'a1.wav' }, { file: 'a2.wav' }]);
  monter(sp, b, [{ file: 'b1.wav' }]);
  assert.equal(sp.voies.size, 2);
  assert.notEqual(a.stems[0].voie, b.stems[0].voie);
});

test('la voie ne se défait qu\'avec sa dernière piste, puis se recrée', () => {
  const sp = new Spatialisation(app);
  const art = oeuvre('marees');
  monter(sp, art, [{ file: 'a.wav' }, { file: 'b.wav' }, { file: 'c.wav' }]);
  const v = art.stems[0].voie;
  sp.libererVoie(v);
  assert.equal(sp.voies.size, 1);
  assert.equal(v.usages, 2);
  sp.libererVoie(v); sp.libererVoie(v);
  assert.equal(sp.voies.size, 0);
  assert.equal(art._voiesPartagees.size, 0);
  assert.equal(v.entree.liaisons.size, 0);
  // rendre une voie déjà rendue ne casse rien
  sp.libererVoie(v);
  assert.equal(sp.voies.size, 0);
  // rechargée : une voie neuve, pas l'ancienne
  monter(sp, art, [{ file: 'a.wav' }]);
  assert.equal(sp.voies.size, 1);
  assert.notEqual(art.stems[0].voie, v);
});

test('le budget HRTF compte des voies : trois pistes n\'en consomment qu\'une', () => {
  const sp = new Spatialisation(app);   // maxHRTF 2
  const a = oeuvre('a'); const b = oeuvre('b'); const c = oeuvre('c');
  monter(sp, a, [{ file: '1' }, { file: '2' }, { file: '3' }]);
  monter(sp, b, [{ file: '1' }]);
  monter(sp, c, [{ file: '1' }]);
  const modeles = [a, b, c].map((art) => art.stems[0].voie.modele);
  assert.deepEqual(modeles, ['HRTF', 'HRTF', 'equalpower']);
});

console.log(`\n${ok} ✓ / ${ko} ✗`);
process.exit(ko ? 1 : 0);

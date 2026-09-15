/**
 * LE BUDGET D'UNE SALLE (core/budget-salle.js) : le périmètre, ce qui se
 * pèse, ce qui se décode, le pire point — et ce qu'on ne sait pas.
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import { budgetSalle, budgetsGalerie, voisinesDe, fichiersDe, pirePoint, dureeWav, texteBudgets, BUDGET, OCTETS_PAR_SECONDE, RESIDENT_S } from '../engine/src/core/budget-salle.js';

let ok = 0; let ko = 0;
const test = (nom, fn) => { try { fn(); ok++; console.log(`  ✓ ${nom}`); } catch (e) { ko++; console.log(`  ✗ ${nom}\n      ${e.message}`); } };
const MO = 1048576;

const WORKS = [
  { id: 'tableau', image: 'textures/tableau.png', position: [0, 1.5, -5], stems: [{ file: 'audio/nappe.wav', radius: 10 }, { file: 'audio/voix.wav', radius: 4 }] },
  { id: 'lune', model: { url: 'library/lune.glb' }, position: [8, 2, 0], stems: [{ file: 'audio/nappe.wav', radius: 30 }] },
  { id: 'cascade', position: [-8, 0, 6], stems: [{ file: 'assets/cascade.mp3', fragments: 'assets/cascade.fragments.json', radius: 20 }] },
  { id: 'encode', position: [0, 0, 0], stems: [{ file: 'audio/gros.wav', formats: { webm: 'assets/gros.webm', m4a: 'assets/gros.m4a' } }] },
  { id: 'banc', model: { url: 'library/banc.glb' }, role: 'decor' }
];
const ROOMS = [
  { id: 'a', shell: { width: 20, depth: 10 }, works: ['tableau', 'lune', 'banc'], portals: [{ to: 'b' }, { to: 'a' }, { to: 'fantome' }] },
  { id: 'b', floor: { size: 12 }, works: ['cascade', 'encode'], portals: [{ to: 'a' }], ambience: [{ file: 'audio/nappe.wav', gain: 0.2 }] },
  { id: 'c', works: [], portals: [] }
];
const mesures = {
  octets: new Map([['textures/tableau.png', 2 * MO], ['audio/nappe.wav', 1 * MO], ['audio/voix.wav', 0.5 * MO],
    ['library/lune.glb', 3 * MO], ['library/banc.glb', 0.25 * MO], ['assets/cascade.fragments.json', 6 * MO], ['assets/gros.webm', 2 * MO]]),
  durees: new Map([['audio/nappe.wav', 60], ['audio/voix.wav', 30], ['assets/cascade.fragments.json', 300], ['assets/gros.webm', 120]])
};

console.log('\nle budget d\'une salle');

test('les voisines : les portails vers des salles qui existent, sans soi-même ni doublon', () => {
  assert.deepEqual(voisinesDe(ROOMS[0], ROOMS), ['b']);
  assert.deepEqual(voisinesDe(ROOMS[2], ROOMS), []);
  assert.deepEqual(voisinesDe({ id: 'x', portals: [{ to: 'a' }, { to: 'a' }] }, ROOMS), ['a']);
});

test('les fichiers d\'une salle : chacun une fois, le décor compris, l\'ambiance aussi', () => {
  const a = fichiersDe(ROOMS[0], WORKS);
  assert.deepEqual(a.map((f) => f.chemin).sort(), ['audio/nappe.wav', 'audio/voix.wav', 'library/banc.glb', 'library/lune.glb', 'textures/tableau.png']);
  const b = fichiersDe(ROOMS[1], WORKS);
  // une piste par fragments se repère par son manifeste ; une piste encodée par son premier format
  assert.deepEqual(b.map((f) => [f.chemin, f.genre]).sort(), [['assets/cascade.fragments.json', 'fragments'], ['assets/gros.webm', 'son'], ['audio/nappe.wav', 'son']]);
  assert.equal(b.find((f) => f.chemin === 'audio/nappe.wav').oeuvre, 'ambiance:b');
});

test('le transfert pèse la salle ET ses voisines, un fichier partagé une seule fois', () => {
  const b = budgetSalle(ROOMS[0], { rooms: ROOMS, works: WORKS, mesures });
  assert.deepEqual(b.voisines, ['b']);
  // a : 2 + 1 + 0,5 + 3 + 0,25 ; b : cascade 6 × (30/300) + gros 2 ; nappe déjà comptée
  assert.equal((b.transfert.octets / MO).toFixed(2), (6.75 + 0.6 + 2).toFixed(2));
  assert.equal(b.transfert.parts[0].chemin, 'library/lune.glb');
  assert.deepEqual(b.transfert.inconnus, []);
  assert.equal(b.transfert.budget, BUDGET.transfertMo * MO);
});

test('le PCM : la durée fois 384 000 octets, une piste par fragments plafonnée à ce qu\'elle tient', () => {
  const b = budgetSalle(ROOMS[0], { rooms: ROOMS, works: WORKS, mesures });
  assert.equal(OCTETS_PAR_SECONDE, 384000);
  const attendu = (60 + 30 + 120 + Math.min(300, RESIDENT_S)) * OCTETS_PAR_SECONDE;
  assert.equal(b.pcm.octets, attendu);
  assert.equal(b.pcm.pistes, 4);
});

test('le pire point : les œuvres audibles depuis un même mètre carré, une voix chacune', () => {
  // le tableau (deux pistes, r 10 et 4) et la lune (r 30) : sous le tableau, DEUX voix, pas trois
  const p = pirePoint(ROOMS[0], WORKS);
  assert.equal(p.pire, 2);
  // le point est sous le tableau (à moins de 10 m, son rayon) : la lune couvre toute la salle
  assert.ok(Math.hypot(p.point[0] - 0, p.point[1] + 5) < 10, `point ${p.point}`);
  assert.deepEqual(pirePoint(ROOMS[2], WORKS), { pire: 0, point: null });
  // b : cascade (r 20, en -8,6) et gros (r 12 par défaut, en 0,0) se recouvrent
  assert.equal(pirePoint(ROOMS[1], WORKS).pire, 2);
});

test('ce qu\'on ne sait pas est dit inconnu, jamais compté à zéro en silence', () => {
  const b = budgetSalle(ROOMS[1], { rooms: ROOMS, works: WORKS, mesures: { octets: new Map(), durees: new Map() } });
  assert.equal(b.transfert.octets, 0);
  assert.ok(b.transfert.inconnus.includes('assets/gros.webm') && b.transfert.inconnus.includes('library/lune.glb'));
  assert.ok(b.pcm.inconnus.includes('audio/nappe.wav'));
  const sansMesures = budgetSalle(ROOMS[1], { rooms: ROOMS, works: WORKS });
  assert.equal(sansMesures.transfert.inconnus.length, b.transfert.inconnus.length);
});

test('les écarts : chaque plafond dépassé, dans les mots de l\'auteur', () => {
  const serre = { transfertMo: 5, pcmMo: 50, stems: 2 };
  const b = budgetSalle(ROOMS[0], { rooms: ROOMS, works: WORKS, mesures, budget: serre });
  assert.deepEqual(b.ecarts.map((e) => e.regle), ['transfert', 'pcm']);
  assert.match(b.ecarts[0].texte, /9\.[34] Mo .* 5 Mo/);   // 9,35 : l'arrondi flottant tombe d'un côté ou de l'autre
  const c = budgetSalle(ROOMS[0], { rooms: ROOMS, works: WORKS, mesures, budget: { ...serre, stems: 1 } });
  assert.match(c.ecarts.at(-1).texte, /2 œuvres audibles .* 1 voix/);
  assert.deepEqual(budgetSalle(ROOMS[2], { rooms: ROOMS, works: WORKS, mesures }).ecarts, []);
});

test('la durée d\'un WAV : depuis l\'en-tête, sinon 44,1 kHz stéréo 16 bits', () => {
  const entete = new Uint8Array(44); const dv = new DataView(entete.buffer);
  dv.setUint16(22, 1, true); dv.setUint32(24, 48000, true); dv.setUint16(34, 16, true);
  assert.equal(dureeWav(44 + 48000 * 2 * 10, entete), 10);
  assert.equal(dureeWav(44 + 44100 * 4 * 3), 3);
  assert.equal(dureeWav(10), 0);
});

test('le rapport : une ligne par salle, les écarts marqués', () => {
  const t = texteBudgets(budgetsGalerie(ROOMS, WORKS, mesures, { transfertMo: 5, pcmMo: 500, stems: 6 }));
  assert.match(t, /^budget par salle/);
  assert.match(t, /\n {3}a {13}.*✗ transfert/);
  assert.match(t, /\n {3}c {13}.*0 piste/);
});

console.log(`\n${ok} ✓ / ${ko} ✗`);
process.exit(ko ? 1 : 0);

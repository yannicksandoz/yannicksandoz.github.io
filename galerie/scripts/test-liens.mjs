/**
 * LES LIENS, LES SIGNAUX, LE DANCEFLOOR, LE PORTAIL PORTÉ — l'état pur.
 *
 *  - liens.js : normaliser, traduire l'ancien `model.audio`, résoudre une
 *    entrée depuis un signal (plage, bornes, bool), le portail `via` ;
 *  - signaux.js : les cases d'une bande, la moyenne d'une bande, la crête ;
 *  - dancefloor.js : les entrées ont la forme ISF, poser/appliquer/suivre
 *    poussent bien les uniforms (three au nœud, sans WebGL).
 *
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import { normaliserLien, liensDuModele, resoudreLien, portailPorte, SIGNAUX } from '../engine/src/core/liens.js';
import { casesDe, niveauBande, crete, BANDES } from '../engine/src/core/signaux.js';
import { creerDancefloor, ENTREES_DANCEFLOOR } from '../engine/src/core/dancefloor.js';

let ok = 0;
let ko = 0;
const groupe = (t) => console.log(`\n${t}`);
const test = (nom, fn) => {
  try { fn(); ok++; console.log(`  ✓ ${nom}`); }
  catch (e) { ko++; console.log(`  ✗ ${nom}\n      ${e.message}`); }
};

groupe('les liens : normaliser');

test('un lien complet garde entrée, œuvre, signal, plage, gain', () => {
  assert.deepEqual(normaliserLien({ entree: 'brightness', oeuvre: 'pulsation', signal: 'basse', min: 0.3, max: 1.2, gain: 2 }),
    { entree: 'brightness', oeuvre: 'pulsation', signal: 'basse', min: 0.3, max: 1.2, gain: 2 });
});

test('sans entrée ou sans œuvre : null ; signal inconnu : niveau ; plage absente : undefined', () => {
  assert.equal(normaliserLien({ oeuvre: 'x' }), null);
  assert.equal(normaliserLien({ entree: 'a' }), null);
  assert.equal(normaliserLien('n/a'), null);
  const l = normaliserLien({ entree: ' a ', oeuvre: 'x', signal: 'voix', gain: -1 });
  assert.deepEqual(l, { entree: 'a', oeuvre: 'x', signal: 'niveau', min: undefined, max: undefined, gain: 1 });
});

test('les cinq signaux sont nommés, niveau d\'abord', () => {
  assert.deepEqual(SIGNAUX.map((s) => s.cle), ['niveau', 'basse', 'medium', 'aigu', 'crete']);
});

test('liensDuModele : `liens` plus l\'ancien `audio` (le niveau de l\'œuvre elle-même), sans doublon', () => {
  const m = { liens: [{ entree: 'a', oeuvre: 'autre', signal: 'aigu' }], audio: { entree: 'b', gain: 0.5 } };
  const l = liensDuModele(m, 'moi');
  assert.equal(l.length, 2);
  assert.deepEqual(l[1], { entree: 'b', oeuvre: 'moi', signal: 'niveau', min: undefined, max: undefined, gain: 0.5 });
  // l'ancien n'ajoute rien si un lien nomme déjà son entrée
  assert.equal(liensDuModele({ liens: [{ entree: 'b', oeuvre: 'x' }], audio: { entree: 'b' } }, 'moi').length, 1);
  assert.deepEqual(liensDuModele(null, 'moi'), []);
});

groupe('les liens : résoudre');
const entree = { nom: 'brightness', type: 'float', defaut: 0.85, min: 0, max: 1.5 };

test('sans plage : du repos (le réglage) au maximum de l\'entrée', () => {
  const l = normaliserLien({ entree: 'brightness', oeuvre: 'p' });
  assert.equal(resoudreLien(l, entree, 0, 0.5), 0.5);
  assert.equal(resoudreLien(l, entree, 1, 0.5), 1.5);
  assert.ok(Math.abs(resoudreLien(l, entree, 0.5, 0.5) - 1.0) < 1e-9);
  // sans réglage : le défaut de l'entrée
  assert.equal(resoudreLien(l, entree, 0, undefined), 0.85);
});

test('avec plage : min → max, borné aux limites de l\'entrée, signal borné à [0,1] après gain', () => {
  const l = normaliserLien({ entree: 'brightness', oeuvre: 'p', min: 0.3, max: 2.0, gain: 2 });
  assert.equal(resoudreLien(l, entree, 0, 0.5), 0.3);
  assert.equal(resoudreLien(l, entree, 0.5, 0.5), 1.5);   // 0,5×2 = 1 → max 2,0 borné à 1,5
  assert.equal(resoudreLien(l, entree, 0.25, 0.5), 1.15); // 0,5 : 0,3 + 0,5·1,7
  assert.equal(resoudreLien(l, entree, -3, 0.5), 0.3);
});

test('une entrée bool bascule à mi-course ; une couleur ne se lie pas ; sans entrée : null', () => {
  const l = normaliserLien({ entree: 'animate', oeuvre: 'p' });
  assert.equal(resoudreLien(l, { nom: 'animate', type: 'bool', defaut: true }, 0.2, true), false);
  assert.equal(resoudreLien(l, { nom: 'animate', type: 'bool', defaut: true }, 0.7, true), true);
  assert.equal(resoudreLien(l, { nom: 'c', type: 'color', defaut: [1, 1, 1, 1] }, 1, null), null);
  assert.equal(resoudreLien(l, null, 1, 0), null);
});

groupe('le portail porté par une œuvre');

test('portailPorte trouve l\'entrée `via` de la pièce, et rien sinon', () => {
  const salle = { portals: [{ to: 'a', position: [0, 0, 0] }, { to: 'dancefloor', via: 'shader-dancefloor', arrival: [0, 2.2, 9] }] };
  assert.equal(portailPorte(salle, 'shader-dancefloor').to, 'dancefloor');
  assert.equal(portailPorte(salle, 'autre'), null);
  assert.equal(portailPorte(null, 'x'), null);
  assert.equal(portailPorte({ portals: [{ via: 'x' }] }, 'x'), null);   // sans `to`, ce n'est pas un portail
});

groupe('les signaux');

test('les cases d\'une bande suivent la fréquence d\'échantillonnage et la taille de FFT', () => {
  assert.deepEqual(casesDe('basse', 48000, 512), [0, 3]);       // 93,75 Hz par case : 20→0, 250→3
  assert.deepEqual(casesDe('aigu', 48000, 512), [21, 86]);
  assert.deepEqual(casesDe('niveau', 22050, 512), [0, 255]);    // 16 kHz > Nyquist : borné à la dernière case
  assert.deepEqual(casesDe('inconnue', 48000, 512), casesDe('niveau', 48000, 512));
  assert.deepEqual(Object.keys(BANDES), ['niveau', 'basse', 'medium', 'aigu']);
});

test('la moyenne d\'une bande vaut 0..1, ignore les bornes hors spectre, 0 sur le vide', () => {
  const data = new Uint8Array(8).fill(255);
  assert.equal(niveauBande(data, 0, 7), 1);
  data.fill(0); data[2] = 255; data[3] = 255;
  assert.equal(niveauBande(data, 2, 3), 1);
  assert.equal(niveauBande(data, 0, 7), 0.25);
  assert.equal(niveauBande(data, 6, 100), 0);
  assert.equal(niveauBande(null, 0, 1), 0);
  assert.equal(niveauBande(data, 5, 2), 0);
});

test('la crête monte d\'un coup et retombe lentement', () => {
  assert.equal(crete(0.2, 0.9, 0.016), 0.9);
  const apres = crete(0.9, 0, 0.1);
  assert.ok(apres > 0.5 && apres < 0.9, `retombée ${apres}`);
});

groupe('le dancefloor');

test('les entrées ont la forme ISF et portent les noms du shader de l\'auteur', () => {
  for (const e of ENTREES_DANCEFLOOR) assert.ok(e.nom && e.type && 'defaut' in e && e.etiquette);
  const noms = ENTREES_DANCEFLOOR.map((e) => e.nom);
  for (const n of ['pattern_mode', 'pattern_speed', 'tile_color', 'hue_spread', 'glow_strength', 'brightness', 'tiles_mask_lo', 'animate']) assert.ok(noms.includes(n), n);
});

test('creerDancefloor : grille, réglages appliqués aux uniforms, poser, bornes', () => {
  const sol = creerDancefloor({ size: 24, cols: 10, rows: 8, reglages: { brightness: 0.4, pattern_mode: 3, tile_color: [0, 1, 0] } });
  assert.equal(sol.uniforms.grid_cols.value, 10);
  assert.equal(sol.uniforms.grid_rows.value, 8);
  assert.equal(sol.uniforms.brightness.value, 0.4);
  assert.equal(sol.uniforms.pattern_mode.value, 3);
  assert.deepEqual([sol.uniforms.tile_color.value.x, sol.uniforms.tile_color.value.y, sol.uniforms.tile_color.value.z, sol.uniforms.tile_color.value.w], [0, 1, 0, 1]);
  sol.poser('brightness', 1.2);
  assert.equal(sol.uniforms.brightness.value, 1.2);
  sol.poser('inconnue', 3);   // ignoré
  sol.appliquer({ brightness: 9 });   // borné au max de l'entrée
  assert.equal(sol.uniforms.brightness.value, 1.5);
  sol.rendre(3601.5);
  assert.ok(Math.abs(sol.uniforms.TIME.value - 1.5) < 1e-9);
  assert.equal(sol.mesh.userData.ignoreRaycast, true);
  sol.dispose();
});

test('suivre : les liens poussent les entrées depuis un service de signaux de carton', () => {
  const sol = creerDancefloor({ reglages: { brightness: 0.5 },
    liens: [{ entree: 'brightness', oeuvre: 'pulsation', signal: 'basse', max: 1.5 }, { entree: 'nope', oeuvre: 'x' }, 'invalide'] });
  assert.equal(sol.liens.length, 2);   // l'invalide est écarté ; l'entrée inconnue reste un lien, sans effet
  const signaux = { valeur: (id, s) => (id === 'pulsation' && s === 'basse' ? 0.5 : 0) };
  sol.suivre(signaux);
  assert.equal(sol.uniforms.brightness.value, 1.0);   // 0,5 + 0,5·(1,5−0,5)
  sol.regler({ liens: [] });
  sol.suivre(signaux);
  assert.equal(sol.uniforms.brightness.value, 1.0);   // plus de lien : rien ne bouge
  sol.regler({ reglages: { brightness: 0.2 } });
  assert.equal(sol.uniforms.brightness.value, 0.2);
  sol.dispose();
});

console.log(`\n${ok} ✓ / ${ko} ✗`);
process.exit(ko ? 1 : 0);

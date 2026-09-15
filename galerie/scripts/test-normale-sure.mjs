/**
 * LA GARDE DE LA NORMALE (textures.js) — le flash blanc d'une image.
 *
 * Le bump de three rend l'infini sur un sol vu en rasant au bord de
 * l'image ; la lumière hémisphérique en fait une couleur infinie, le bloom
 * l'étale partout. La greffe vérifie la normale après TOUTES les
 * perturbations et retombe sur celle de la géométrie. La suite au nœud
 * vérifie où la garde se pose, qu'elle attrape bien un NaN, et que la
 * greffe de salle l'emporte avec elle.
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import { patcherNormaleSure, GARDE_NORMALE } from '../engine/src/core/textures.js';
import { patcherArbreLignes, activerLignes } from '../engine/src/core/lignes-lumiere.js';

let ok = 0; let ko = 0;
const test = (nom, fn) => { try { fn(); ok++; console.log(`  ✓ ${nom}`); } catch (e) { ko++; console.log(`  ✗ ${nom}\n      ${e.message}`); } };

console.log('\nla garde de la normale');

const FRAG = '#include <normal_fragment_begin>\n#include <normal_fragment_maps>\n{ relief du grain }\n#include <clearcoat_normal_fragment_maps>\n#include <emissivemap_fragment>\n#include <lights_fragment_begin>';

test('la garde se pose APRÈS toutes les perturbations, juste avant l\'émissif', () => {
  const mat = { isMeshStandardMaterial: true, userData: {} };
  patcherNormaleSure(mat);
  const shader = { uniforms: {}, fragmentShader: FRAG };
  mat.onBeforeCompile(shader, null);
  const garde = shader.fragmentShader.indexOf('nonPerturbedNormal');
  assert.ok(garde > 0, 'la garde est injectée');
  assert.ok(garde > shader.fragmentShader.indexOf('relief du grain'), 'après le relief du grain');
  assert.ok(garde > shader.fragmentShader.indexOf('clearcoat_normal_fragment_maps'), 'après la couche vernie');
  assert.ok(garde < shader.fragmentShader.indexOf('emissivemap_fragment'), 'avant l\'émissif');
  assert.ok(shader.fragmentShader.includes('#include <emissivemap_fragment>'), 'l\'inclusion de three reste en place');
});

test('idempotente, chaînée, et réservée aux matériaux qui s\'éclairent', () => {
  let appels = 0;
  const mat = { isMeshStandardMaterial: true, userData: {}, onBeforeCompile: () => { appels++; } };
  patcherNormaleSure(mat);
  const apres = mat.onBeforeCompile;
  patcherNormaleSure(mat);
  assert.equal(mat.onBeforeCompile, apres, 'la deuxième greffe ne fait rien');
  mat.onBeforeCompile({ uniforms: {}, fragmentShader: FRAG }, null);
  assert.equal(appels, 1, 'le onBeforeCompile précédent est appelé');
  const basique = { isMeshBasicMaterial: true, userData: {} };
  patcherNormaleSure(basique);
  assert.ok(!basique.onBeforeCompile, 'un matériau sans éclairage n\'a pas de normale à garder');
});

test('la condition attrape un NaN et l\'infini, et laisse passer un vecteur unité', () => {
  // la même logique que le GLSL, évaluée en JavaScript : `!(a && b)`
  const garde = (n) => { const nn = n[0] * n[0] + n[1] * n[1] + n[2] * n[2]; return !(nn > 0.5 && nn < 2.0); };
  assert.equal(garde([0, 0, 1]), false);
  assert.equal(garde([0.7, 0.7, 0.14]), false);
  assert.equal(garde([NaN, NaN, NaN]), true);
  assert.equal(garde([Infinity, 0, 0]), true);
  assert.equal(garde([0, 0, 0]), true);
  assert.equal(garde([1e-20, 0, 0]), true);
  assert.ok(GARDE_NORMALE.includes('!(nn > 0.5 && nn < 2.0)'), 'le GLSL écrit bien la négation d\'une conjonction');
});

test('la greffe de salle emporte la garde sur tout matériau standard d\'un sous-arbre', () => {
  activerLignes(true);
  const sol = { isMeshStandardMaterial: true, userData: {} };
  const bandeau = { isMeshBasicMaterial: true, userData: {} };
  const racine = { traverse(f) { f({ material: sol }); f({ material: [bandeau, sol] }); f({}); } };
  patcherArbreLignes(racine);
  assert.equal(sol.userData.normaleSure, true);
  assert.ok(!bandeau.userData.normaleSure);
  const shader = { uniforms: {}, fragmentShader: '#include <common>\n' + FRAG };
  sol.onBeforeCompile(shader, null);
  assert.ok(shader.fragmentShader.includes('lignesIrradiance'), 'les lignes sont là');
  assert.ok(shader.fragmentShader.includes('nonPerturbedNormal'), 'et la garde aussi');
});

console.log(`\n${ok} ✓ / ${ko} ✗`);
process.exit(ko ? 1 : 0);

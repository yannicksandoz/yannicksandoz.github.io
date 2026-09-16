// LA SONDE DE REFLETS (engine/src/core/reflets.js) : l'échantillonneur
// renommé et ses constantes, la greffe sur un matériau, les réglages.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { echantillonneurGLSL, patcherReflets, REFLETS_DEFAUT, centreDeSalle }
  from '../engine/src/core/reflets.js';

let ok = 0, ko = 0;
const test = (nom, f) => {
  try { f(); ok++; console.log('  ✓', nom); } catch (e) { ko++; console.log('  ✗', nom, '\n   ', e.message); }
};
const titre = (t) => console.log('\n' + t);

titre('l’échantillonneur : une copie renommée du chunk CubeUV de three');
test('plus rien du chunk d’origine ne subsiste sous son nom', () => {
  const g = echantillonneurGLSL(128);
  for (const nom of ['textureCubeUV', 'bilinearCubeUV', 'getFace', 'getUV', 'roughnessToMip',
    'CUBEUV_MAX_MIP', 'CUBEUV_TEXEL_WIDTH', 'CUBEUV_TEXEL_HEIGHT', 'ENVMAP_TYPE_CUBE_UV', 'cubeUV_']) {
    assert.ok(!new RegExp(`\\b${nom}`).test(g), `« ${nom} » encore présent`);
  }
  assert.match(g, /vec4 refletsCubeUV\( sampler2D envMap, vec3 sampleDir, float roughness \)/);
  assert.match(g, /vec3 refletsBilineaire\(/);
});
test('les constantes suivent WebGLProgram pour un cube de 128 (image PMREM de 512)', () => {
  const g = echantillonneurGLSL(128);
  // maxMip = log2(hauteur) − 2 = log2(512) − 2 = 7
  assert.match(g, /exp2\( 7\.0 \)/);
  assert.match(g, /clamp\( refletsMip\( roughness \), refletsUV_m0, 7\.0 \)/);
  // texel : largeur 1 / (3 × max(128, 112)) = 1/384, hauteur 1/512
  assert.ok(g.includes((1 / 384).toFixed(10)), 'largeur de texel');
  assert.ok(g.includes((1 / 512).toFixed(10)), 'hauteur de texel');
});
test('à 64, la largeur suit le plancher de sept tuiles de seize', () => {
  const g = echantillonneurGLSL(64);
  assert.ok(g.includes((1 / 336).toFixed(10)));
  assert.ok(g.includes((1 / 256).toFixed(10)));
  assert.match(g, /exp2\( 6\.0 \)/);
});

titre('la greffe');
test('un matériau standard reçoit la greffe une seule fois, en gardant son onBeforeCompile', () => {
  const m = new THREE.MeshStandardMaterial();
  let appels = 0;
  m.onBeforeCompile = () => { appels++; };
  patcherReflets(m);
  const premier = m.onBeforeCompile;
  patcherReflets(m);
  assert.equal(m.onBeforeCompile, premier, 'greffée deux fois');
  const shader = { uniforms: {}, fragmentShader: '#include <common>\n#include <lights_fragment_maps>\n' };
  m.onBeforeCompile(shader, null);
  assert.equal(appels, 1, 'l’ancien onBeforeCompile n’a pas été appelé');
  assert.ok(shader.uniforms.uReflets && shader.uniforms.uRefletsForce && shader.uniforms.uRefletsRebond);
  assert.match(shader.fragmentShader, /refletsCubeUV\(uReflets, refletsR, material\.roughness\)[\s\S]*uRefletsMix[\s\S]*radiance \+= refletsC \* uRefletsForce/);
  assert.match(shader.fragmentShader, /refletsCubeUV\(uReflets, refletsN, 1\.0\)[\s\S]*iblIrradiance \+= PI \* refletsI \* uRefletsRebond/);
  assert.ok(shader.uniforms.uRefletsAvant && shader.uniforms.uRefletsMix, 'le fondu entre deux photos est branché');
  assert.match(shader.fragmentShader, /vec4 refletsCubeUV\(/, 'l’échantillonneur est injecté');
});
test('un matériau qui n’est pas standard est laissé tel quel', () => {
  const m = new THREE.MeshBasicMaterial();
  patcherReflets(m);
  assert.ok(!m.userData.reflets);
  assert.equal(m.onBeforeCompile.toString(), new THREE.MeshBasicMaterial().onBeforeCompile.toString());
});
test('les défauts : un reflet plein, un rebond discret', () => {
  assert.equal(REFLETS_DEFAUT.force, 1);
  assert.ok(REFLETS_DEFAUT.rebond > 0 && REFLETS_DEFAUT.rebond < 0.5);
});

titre('une photo par salle, du centre de la salle');
test('le centre d’une salle : sa coque, sinon son sol, sinon tout le groupe', () => {
  const coque = new THREE.Mesh(new THREE.BoxGeometry(10, 4, 6)); coque.position.set(5, 2, -3); coque.updateMatrixWorld(true);
  const c = centreDeSalle({ shell: coque, floor: null, group: new THREE.Group() });
  assert.ok(Math.abs(c.x - 5) < 1e-6 && Math.abs(c.z + 3) < 1e-6, `centre de coque : ${c.toArray()}`);
  const sol = new THREE.Mesh(new THREE.PlaneGeometry(20, 20)); sol.rotation.x = -Math.PI / 2; sol.position.x = -4; sol.updateMatrixWorld(true);
  const s = centreDeSalle({ shell: null, floor: sol, group: new THREE.Group() });
  assert.ok(Math.abs(s.x + 4) < 1e-6, `centre de sol : ${s.toArray()}`);
  assert.equal(centreDeSalle({ shell: null, floor: null, group: new THREE.Group() }), null, 'un groupe vide n’a pas de centre');
});
// le gestionnaire de qualité lit l'écran à sa construction : on lui en donne un
globalThis.window ??= { devicePixelRatio: 1, matchMedia: () => ({ matches: false }) };
globalThis.navigator ??= { userAgent: 'node', maxTouchPoints: 0 };
const { QualityManager } = await import('../engine/src/core/Quality.js');
test('l’image unique n’a pas de sonde ; l’enrichie garde la sienne, vivante', () => {
  const q = new QualityManager();
  assert.equal(q.profile.reflets, false);
  globalThis.location = { search: '?profil=riche' };
  const riche = new QualityManager();
  delete globalThis.location;
  assert.equal(riche.profile.reflets.resolution, 128);
  assert.equal(riche.profile.reflets.cadence, 1);
});

console.log(`\n${ok} ✓ / ${ko} ✗`);
process.exit(ko ? 1 : 0);

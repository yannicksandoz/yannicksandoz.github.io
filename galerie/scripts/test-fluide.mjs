/**
 * LE MODE FLUIDE — le « mod » Hadid, éprouvé au nœud.
 *
 * Un style est un contrat double : activé, il transforme portails, murs à
 * ciel ouvert et masses voxel ; désactivé, il ne change RIEN — le même
 * JSON doit rendre le monde historique au sommet près. Les deux moitiés
 * du contrat se testent, parce que la seconde est celle qu'on casse sans
 * s'en apercevoir.
 *
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';

// `matieres.js` importe des `.jpg` — un import que seul un bundler résout.
// Pour éprouver les primitives au nœud, on enregistre un chargeur qui rend
// une chaîne vide pour ces fichiers : la texture manque, `styleMatiere`
// rend null, et les matériaux se construisent sans elle — exactement le
// comportement headless voulu.
register('data:text/javascript,'
  + encodeURIComponent(`export async function load(url, ctx, next) {
      if (/\.(jpg|jpeg|png|exr|glb)$/.test(url)) {
        return { format: 'module', source: 'export default ""', shortCircuit: true };
      }
      return next(url, ctx);
    }`), import.meta.url);

const { setStyle, styleCourant, estFluide, patcherStries, dessinerCouronne } =
  await import('../engine/src/core/style.js');
const { buildPrimitive } = await import('../engine/src/core/primitives.js');
const { buildVoxelMeshMerged } = await import('../engine/src/core/voxel.js');

const ici = dirname(fileURLToPath(import.meta.url));

globalThis.document ??= undefined; // les modules savent vivre sans DOM

let ok = 0, ko = 0;
const groupe = (t) => console.log(`\n${t}`);
const test = (nom, fn) => {
  try { fn(); ok++; console.log(`  ✓ ${nom}`); }
  catch (e) { ko++; console.log(`  ✗ ${nom}\n      ${String(e.message).split('\n')[0]}`); }
};

/* ------------------------------------------------------------- le drapeau */

groupe('le drapeau de style');

test('fluide s\'active, tout le reste retombe sur brut', () => {
  setStyle('fluide');
  assert.equal(styleCourant(), 'fluide');
  assert.equal(estFluide(), true);
  setStyle('gothique');
  assert.equal(styleCourant(), 'brut');
  setStyle(undefined);
  assert.equal(estFluide(), false);
});

/* --------------------------------------------------------------- le ruban */

groupe('le ruban : l\'outil de design des formes fluides');

const RUBAN = {
  shape: 'ruban',
  points: [[-2, 0, 0], [0, 1, 1], [2, 2.4, 0]],
  largeur: 1.2, epaisseur: 0.14
};

test('il se construit, et sa boîte couvre les points de contrôle', () => {
  setStyle('brut'); // le ruban existe dans LES DEUX styles : c'est un outil
  const mesh = buildPrimitive(RUBAN);
  assert.ok(mesh?.isMesh, 'un maillage');
  const boite = new THREE.Box3().setFromObject(mesh);
  assert.ok(boite.max.x - boite.min.x >= 3.6, `envergure x ${boite.max.x - boite.min.x}`);
  assert.ok(boite.max.y >= 2.2, `hauteur ${boite.max.y}`);
});

test('la torsion change réellement la coque', () => {
  const plat = buildPrimitive(RUBAN);
  const tordu = buildPrimitive({ ...RUBAN, torsion: 120 });
  const a1 = plat.geometry.attributes.position;
  const a2 = tordu.geometry.attributes.position;
  assert.equal(a1.count, a2.count);
  // la vrille déplace réellement la coque : l'écart cumulé est franc,
  // et il grandit le long du chemin (nul au départ, plein à l'arrivée)
  let debut = 0, fin = 0;
  const tiers = Math.floor(a1.count / 3);
  for (let i = 0; i < tiers; i++) {
    debut += Math.abs(a1.getY(i) - a2.getY(i)) + Math.abs(a1.getZ(i) - a2.getZ(i));
  }
  for (let i = a1.count - tiers; i < a1.count; i++) {
    fin += Math.abs(a1.getY(i) - a2.getY(i)) + Math.abs(a1.getZ(i) - a2.getZ(i));
  }
  assert.ok(fin > 1, `écart final ${fin.toFixed(2)}`);
  assert.ok(fin > debut * 3, `la vrille croît le long du chemin (${debut.toFixed(2)} → ${fin.toFixed(2)})`);
});

test('largeurFin fait un ruban qui s\'effile', () => {
  const mesh = buildPrimitive({ ...RUBAN, largeurFin: 0.2 });
  assert.ok(mesh?.isMesh);
  // les sommets de la fin sont plus resserrés que ceux du début
  const pos = mesh.geometry.attributes.position;
  const n = pos.count;
  const COTE = 21;
  const etendue = (depart) => {
    let mn = Infinity, mx = -Infinity;
    for (let i = depart; i < depart + COTE; i++) {
      mn = Math.min(mn, pos.getZ(i)); mx = Math.max(mx, pos.getZ(i));
    }
    return mx - mn;
  };
  assert.ok(etendue(n - COTE) < etendue(0), 'la section finale est plus étroite');
});

test('fermé, le ruban boucle (anneau)', () => {
  const mesh = buildPrimitive({ ...RUBAN, ferme: true });
  assert.ok(mesh?.isMesh);
});

/* ---------------------------------------------- murs à ciel ouvert (mod) */

groupe('le couronnement des murs sans plafond');

/** Le profil du couronnement, lu sur la Shape elle-même. */
function profil(length, height) {
  const forme = new THREE.Shape();
  forme.moveTo(-length / 2, 0);
  forme.lineTo(length / 2, 0);
  dessinerCouronne(forme, length, height);
  forme.lineTo(-length / 2, 0);
  const pts = forme.getPoints(4);
  let haut = -Infinity, hautMilieu = -Infinity;
  for (const q of pts) {
    if (q.y > haut) haut = q.y;
    if (Math.abs(q.x) < length * 0.06 && q.y > hautMilieu) hautMilieu = q.y;
  }
  return { haut, hautMilieu };
}

test('les angles gardent la pleine hauteur, le milieu s\'affaisse', () => {
  const { haut, hautMilieu } = profil(20, 6);
  assert.ok(Math.abs(haut - 6) < 0.02, `angles a ${haut}`);
  assert.ok(hautMilieu < 6 - 0.4, `milieu a ${hautMilieu}`);
});

test('le creux est plafonné : un mur de 20 m ne perd jamais plus d\'1,20 m', () => {
  const forme = new THREE.Shape();
  forme.moveTo(-10, 0); forme.lineTo(10, 0);
  dessinerCouronne(forme, 20, 30);
  const bas = Math.min(...forme.getPoints(4).filter((q) => q.y > 1).map((q) => q.y));
  assert.ok(bas >= 30 - 1.21, `creux ${30 - bas}`);
});

test('murPerce est bien câblé : couronne fluide SEULEMENT sans plafond', () => {
  const src = readFileSync(join(ici, '..', 'engine/src/core/RoomManager.js'), 'utf8');
  assert.ok(src.includes('dessinerCouronne(forme, length, height)'),
    'murPerce appelle dessinerCouronne');
  assert.ok(src.includes("couronneFluide: estFluide() && !opt.ceiling"),
    'la couronne est conditionnée au style ET à l\'absence de plafond');
});

/* ------------------------------------------------------- masses voxel --- */

groupe('les masses voxel en mode fluide');

const GRILLE = {
  type: 'voxel', dims: [2, 2, 2], cell: 0.5,
  palette: ['#3f6a54'], cells: [8, 1]
};

test('fluide : les couleurs tirent au blanc, le matériau prend les stries', () => {
  setStyle('fluide');
  const mesh = buildVoxelMeshMerged(GRILLE);
  setStyle('brut');
  const c = new THREE.Color();
  c.fromBufferAttribute(mesh.instanceColor, 0);
  // les couleurs d'instance vivent en LINÉAIRE : le blanc de plâtre y
  // descend vers 0,68 — le seuil se pose en linéaire, pas en sRGB
  assert.ok(c.r > 0.55 && c.g > 0.55 && c.b > 0.55, `couleur ${c.getHexString()}`);
  assert.equal(mesh.material.customProgramCacheKey(), 'voxel-fluide');
});

test('brut : la palette reste la palette — le mod éteint ne change rien', () => {
  setStyle('brut');
  const mesh = buildVoxelMeshMerged(GRILLE);
  const c = new THREE.Color();
  c.fromBufferAttribute(mesh.instanceColor, 0);
  const attendu = new THREE.Color('#3f6a54');
  assert.ok(Math.abs(c.r - attendu.r) < 0.02 && Math.abs(c.g - attendu.g) < 0.02,
    `couleur ${c.getHexString()}`);
  assert.notEqual(mesh.material.customProgramCacheKey(), 'voxel-fluide');
});

/* ------------------------------------------------------------ les stries */

groupe('les stries');

test('le patch s\'installe sans casser la chaîne onBeforeCompile', () => {
  const m = new THREE.MeshStandardMaterial();
  let dabord = false;
  m.onBeforeCompile = () => { dabord = true; };
  patcherStries(m, { pas: 0.4 });
  const shader = {
    uniforms: {},
    vertexShader: '#include <common>\n#include <project_vertex>',
    fragmentShader: '#include <common>\n#include <color_fragment>'
  };
  m.onBeforeCompile(shader, null);
  assert.ok(dabord, 'le patch précédent a tourné');
  assert.ok(shader.uniforms.uStriePas, 'les uniformes des stries');
  assert.ok(shader.fragmentShader.includes('uStrieForce'), 'le fragment est patché');
});

console.log(`\n${ok} ✓ / ${ko} ✗`);
process.exit(ko ? 1 : 0);

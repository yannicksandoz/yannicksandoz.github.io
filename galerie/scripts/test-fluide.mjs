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
const tex = await import('../engine/src/core/textures.js');

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

/** Les hauteurs du couronnement, échantillonnées le long du mur. */
function hauteurs(length, height) {
  const forme = new THREE.Shape();
  forme.moveTo(-length / 2, 0);
  forme.lineTo(length / 2, 0);
  dessinerCouronne(forme, length, height);
  return forme.getPoints(2).filter((q) => q.y > height * 0.4);
}

test('les angles gardent la pleine hauteur — les murs voisins se rejoignent', () => {
  const pts = hauteurs(20, 6);
  const gauche = pts.filter((q) => q.x < -9.9).map((q) => q.y);
  const droite = pts.filter((q) => q.x > 9.9).map((q) => q.y);
  assert.ok(Math.max(...gauche, ...droite) > 5.98, 'les extrémités touchent le sommet');
});

test('la ligne n\'est JAMAIS droite : tout l\'intérieur vit sous le sommet', () => {
  const pts = hauteurs(20, 6).filter((q) => Math.abs(q.x) < 9.2);
  assert.ok(pts.length > 20, 'assez d\'échantillons');
  assert.ok(pts.every((q) => q.y < 6 - 0.02), 'aucun palier au sommet');
  assert.ok(Math.min(...pts.map((q) => q.y)) < 6 - 0.5, 'au moins un vrai creux');
});

test('elle ONDULE — plusieurs vagues, pas une seule arche', () => {
  const pts = hauteurs(20, 6).sort((p1, p2) => p1.x - p2.x)
    .filter((q) => Math.abs(q.x) < 9.5);
  let bascules = 0;
  for (let i = 2; i < pts.length; i++) {
    const d1 = pts[i - 1].y - pts[i - 2].y;
    const d2 = pts[i].y - pts[i - 1].y;
    if (Math.abs(d1) > 1e-4 && Math.abs(d2) > 1e-4 && Math.sign(d1) !== Math.sign(d2)) bascules++;
  }
  assert.ok(bascules >= 3, `la pente ne bascule que ${bascules} fois`);
});

test('l\'amplitude est plafonnée : un mur de 30 m de haut ne perd pas plus d\'1,50 m', () => {
  const pts = hauteurs(20, 30);
  const bas = Math.min(...pts.map((q) => q.y));
  assert.ok(bas >= 30 - 1.51, `creux ${(30 - bas).toFixed(2)}`);
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
  assert.ok(mesh.material.customProgramCacheKey().startsWith('voxel-fluide'),
    'la clé porte la variante fluide (et l\'axe de montée)');
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

/* --------------------------------------------------------------- le galet */

groupe('le galet : la dalle qui n\'est jamais droite');

test('plein : une dalle posée, base au sol, empreinte super-elliptique', () => {
  const mesh = buildPrimitive({ shape: 'galet', size: 5, ratio: 0.7, epaisseur: 0.2 });
  assert.ok(mesh?.isMesh);
  const b1 = new THREE.Box3().setFromObject(mesh);
  assert.ok(Math.abs(b1.min.y) < 0.02, `base a ${b1.min.y}`);
  assert.ok(b1.max.y > 0.15 && b1.max.y < 0.3, `epaisseur ${b1.max.y}`);
  assert.ok(Math.abs(b1.max.x - 4) < 0.15, `demi-grand axe ${b1.max.x}`);
  assert.ok(Math.abs(b1.max.z - 2.8) < 0.2, `demi-petit axe ${b1.max.z}`);
});

test('troué : l\'anneau d\'une margelle a plus de sommets que la dalle pleine', () => {
  const plein = buildPrimitive({ shape: 'galet', size: 5 });
  const anneau = buildPrimitive({ shape: 'galet', size: 5, troue: 0.84 });
  assert.ok(anneau.geometry.attributes.position.count
    > plein.geometry.attributes.position.count, 'le trou ajoute son contour');
});

/* ------------------------------------------------------- le sable ratissé */

groupe('le ratissé fluide');

test('les sillons ONDULENT — la position du creux dépend de x', () => {
  const { peindreRatisseFluide } = tex;
  const S = 128;
  const px = peindreRatisseFluide(() => 0.5);
  const creuxEn = (x) => {
    for (let y = 0; y < 32; y++) if (px[y * S + x] < 0.8) return y;
    return -1;
  };
  const a1 = creuxEn(0), b1 = creuxEn(32), c1 = creuxEn(64);
  assert.ok(a1 >= 0 && b1 >= 0, 'des sillons existent');
  assert.ok(a1 !== b1 || b1 !== c1, `creux fixes (${a1}, ${b1}, ${c1})`);
});

test('la tuile boucle : les colonnes x=0 et x=127 portent le même dessin', () => {
  const { peindreRatisseFluide } = tex;
  const S = 128;
  const px = peindreRatisseFluide(() => 0.5);
  // l'onde a des périodes entières : le raccord x=0 / x=S est continu —
  // les creux de la dernière colonne sont à un texel au plus de la première
  const creux = (x) => {
    const c = [];
    for (let y = 0; y < S; y++) if (px[y * S + x] < 0.8) c.push(y);
    return c;
  };
  const c0 = creux(0), cN = creux(S - 1);
  assert.ok(Math.abs(c0.length - cN.length) <= 1, 'même nombre de sillons');
  if (c0.length && cN.length) {
    assert.ok(Math.abs(c0[0] - cN[0]) <= 2, `raccord ${c0[0]} vs ${cN[0]}`);
  }
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

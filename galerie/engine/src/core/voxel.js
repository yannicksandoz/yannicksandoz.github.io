import * as THREE from 'three';
import { patcherGrain } from './textures.js';
import { estFluide, patcherStries, serpentinVoxel } from './style.js';

/**
 * Constructions voxel — données et rendu.
 *
 * Une construction est **décrite**, pas cuite : le JSON contient la grille
 * compressée, pas un maillage. Elle reste donc légère, rééditable, et
 * surtout c'est un objet de scène comme les autres — il accepte les mêmes
 * stems audio et les mêmes modules, sans une ligne de code spécifique.
 *
 *   "model": {
 *     "type": "voxel",
 *     "dims": [16, 16, 16],        // nombre de cellules par axe
 *     "cell": 0.25,                // taille d'une cellule, en mètres
 *     "palette": ["#8a7cff", "#66f0d8"],
 *     "cells": [40, 0, 3, 1, …]    // RLE : longueur, valeur, longueur, valeur…
 *   }
 *
 * Valeur d'une cellule : 0 = vide, n ≥ 1 = couleur n−1 de la palette.
 *
 * Rendu par `InstancedMesh` — un seul appel de dessin pour toute la
 * construction, quel qu'en soit le nombre de cubes. Les cellules
 * entièrement entourées ne sont pas instanciées : invisibles par
 * construction, elles ne coûteraient que du temps GPU.
 */

export const DEFAULT_DIMS = [16, 16, 16];
export const DEFAULT_CELL = 0.25;
export const DEFAULT_PALETTE = [
  // la dernière entrée (« encre ») doit rester lisible dans la salle noire :
  // #2a2a3e, quasi éteinte après l'émission ×0.45, semblait une pose ratée
  '#8a7cff', '#66f0d8', '#ff7ab8', '#ffc46b', '#7fe0b0', '#e8e6f0', '#3d3d5c'
];

/* ------------------------------------------------------------- indices --- */

export function cellIndex(dims, x, y, z) {
  return x + dims[0] * (y + dims[1] * z);
}

export function inBounds(dims, x, y, z) {
  return x >= 0 && y >= 0 && z >= 0 && x < dims[0] && y < dims[1] && z < dims[2];
}

export function cellCount(dims) {
  return dims[0] * dims[1] * dims[2];
}

/* ----------------------------------------------------------------- RLE --- */

/** Grille → RLE. Une grille vide donne [n, 0], soit deux nombres. */
export function encodeRLE(grid) {
  const out = [];
  if (!grid.length) return out;
  let run = 1;
  let value = grid[0];
  for (let i = 1; i < grid.length; i++) {
    if (grid[i] === value) { run++; continue; }
    out.push(run, value);
    run = 1;
    value = grid[i];
  }
  out.push(run, value);
  return out;
}

/** RLE → grille de `length` cellules (complétée de zéros si le RLE est court). */
export function decodeRLE(rle, length) {
  const grid = new Uint8Array(length);
  let i = 0;
  for (let k = 0; k + 1 < rle.length; k += 2) {
    const run = rle[k];
    const value = rle[k + 1];
    for (let n = 0; n < run && i < length; n++) grid[i++] = value;
  }
  return grid;
}

/** Grille d'un modèle voxel (créée vide si le modèle n'en a pas encore). */
export function gridOf(model) {
  const dims = model.dims ?? DEFAULT_DIMS;
  return decodeRLE(model.cells ?? [], cellCount(dims));
}

/* --------------------------------------------------------------- rendu --- */

/**
 * Pose la matrice d'un pavé [x,y,z, sx,sy,sz] de la grille — et, en mode
 * fluide, lui applique le SERPENTEMENT (style.serpentinVoxel) : les masses
 * allongées (escaliers, rampes) ondoient en plan et gonflent en leur
 * milieu, extrémités fixes. La même fonction sert au rendu par cellule,
 * au rendu fusionné ET au collider : la marche reste posée sur la forme.
 */
function poserPave(m, dims, cell, x, y, z, sx, sy, sz, serpent) {
  const c0 = cellCenter(dims, cell, x, y, z);
  let px = c0[0] + (sx - 1) * cell / 2;
  const py = c0[1] + (sy - 1) * cell / 2;
  let pz = c0[2] + (sz - 1) * cell / 2;
  let ex = sx * cell, ez = sz * cell;
  if (serpent) {
    const t = serpent.axe === 0 ? (x + sx / 2) / dims[0] : (z + sz / 2) / dims[2];
    const g = serpent.gonflement(t), d = serpent.decalage(t);
    // le gonflement s'échelonne autour du centre du modèle (grille centrée
    // en x/z), le décalage vient ensuite — l'axe long ne bouge jamais
    if (serpent.axe === 0) { pz = pz * g + d; ez *= g; }
    else { px = px * g + d; ex *= g; }
  }
  m.makeScale(ex, sy * cell, ez);
  m.setPosition(px, py, pz);
}

/**
 * Avant de serpenter, DÉCOUPER les pavés en tranches d'une cellule le long
 * de l'axe du serpent : un pavé fusionné qui court sur toute la longueur
 * (un palier, une dalle) serait sinon décalé d'un bloc — les extrémités ne
 * resteraient pas fixes. Tranché, il se PLIE. Le surcoût d'instances est
 * dérisoire (un escalier passe de ~30 à ~60 instances).
 */
function decouperPaves(paves, axe) {
  const out = [];
  for (const p of paves) {
    const n = axe === 0 ? p[3] : p[5];
    if (n === 1) { out.push(p); continue; }
    for (let k = 0; k < n; k++) {
      const q = p.slice();
      if (axe === 0) { q[0] = p[0] + k; q[3] = 1; }
      else { q[2] = p[2] + k; q[5] = 1; }
      out.push(q);
    }
  }
  return out;
}

/**
 * Construit l'InstancedMesh d'une grille. Renvoie null si rien n'est posé,
 * pour que l'œuvre garde son placeholder plutôt qu'un objet vide invisible.
 */
export function buildVoxelMesh(model, grid = gridOf(model)) {
  const dims = model.dims ?? DEFAULT_DIMS;
  const cell = model.cell ?? DEFAULT_CELL;
  const palette = (model.palette ?? DEFAULT_PALETTE).map((c) => new THREE.Color(c));

  // cellules visibles : pleines, et pas entièrement entourées
  const visible = [];
  for (let z = 0; z < dims[2]; z++) {
    for (let y = 0; y < dims[1]; y++) {
      for (let x = 0; x < dims[0]; x++) {
        const v = grid[cellIndex(dims, x, y, z)];
        if (!v) continue;
        if (isEnclosed(grid, dims, x, y, z)) continue;
        visible.push([x, y, z, v]);
      }
    }
  }
  if (!visible.length) return null;

  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const mesh = new THREE.InstancedMesh(geometry, buildVoxelMaterial(model), visible.length);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  const serpent = serpentinVoxel(dims, cell);
  const m = new THREE.Matrix4();
  const white = new THREE.Color('#ffffff');
  visible.forEach(([x, y, z, v], i) => {
    poserPave(m, dims, cell, x, y, z, 1, 1, 1, serpent);
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, teinteVoxel(palette[v - 1] ?? white));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

  // permet de retrouver la cellule d'une instance cliquée
  mesh.userData.voxelCells = visible.map(([x, y, z]) => [x, y, z]);
  const lisiere = buildLisiere(model, grid);
  if (lisiere) mesh.add(lisiere);
  return mesh;
}

/**
 * Maillage de rendu FUSIONNÉ : la même forme, en pavés au lieu de cellules.
 *
 * L'InstancedMesh cellule-par-cellule est parfait pour l'édition (chaque
 * cube se pique au rayon), mais en visite la grille est figée — et un
 * escalier plein du belvédère, c'est 1 500 instances dessinées DEUX fois
 * par frame (passe d'ombre puis passe principale). Onze masses comme ça et
 * le M1 le plus large s'essouffle.
 *
 * On fusionne donc comme pour la collision, mais PAR COULEUR : deux
 * cellules ne s'agrègent que si elles portent la même entrée de palette,
 * si bien que le rendu est rigoureusement identique — mêmes faces, mêmes
 * teintes, même matériau émissif — pour ~1 % des instances. Les faces
 * intérieures des pavés voisins existent mais sont invisibles (elles se
 * recouvrent exactement, aucune n'est jamais devant l'autre).
 *
 * Pas de `userData.voxelCells` : ce maillage ne s'édite pas. L'éditeur
 * garde buildVoxelMesh ; la visite prend celui-ci.
 */
export function buildVoxelMeshMerged(model, grid = gridOf(model)) {
  const dims = model.dims ?? DEFAULT_DIMS;
  const cell = model.cell ?? DEFAULT_CELL;
  const palette = (model.palette ?? DEFAULT_PALETTE).map((c) => new THREE.Color(c));
  const pris = new Uint8Array(grid.length);
  const pavés = [];

  const meme = (x, y, z, v) =>
    grid[cellIndex(dims, x, y, z)] === v && !pris[cellIndex(dims, x, y, z)];

  for (let z = 0; z < dims[2]; z++) {
    for (let y = 0; y < dims[1]; y++) {
      for (let x = 0; x < dims[0]; x++) {
        const v = grid[cellIndex(dims, x, y, z)];
        if (!v || pris[cellIndex(dims, x, y, z)]) continue;
        let sx = 1;
        while (x + sx < dims[0] && meme(x + sx, y, z, v)) sx++;
        let sy = 1;
        grandirY: while (y + sy < dims[1]) {
          for (let i = 0; i < sx; i++) if (!meme(x + i, y + sy, z, v)) break grandirY;
          sy++;
        }
        let sz = 1;
        grandirZ: while (z + sz < dims[2]) {
          for (let j = 0; j < sy; j++) {
            for (let i = 0; i < sx; i++) {
              if (!meme(x + i, y + j, z + sz, v)) break grandirZ;
            }
          }
          sz++;
        }
        for (let k = 0; k < sz; k++) {
          for (let j = 0; j < sy; j++) {
            for (let i = 0; i < sx; i++) pris[cellIndex(dims, x + i, y + j, z + k)] = 1;
          }
        }
        pavés.push([x, y, z, sx, sy, sz, v]);
      }
    }
  }
  if (!pavés.length) return null;

  const serpent = serpentinVoxel(dims, cell);
  const tranches = serpent ? decouperPaves(pavés, serpent.axe) : pavés;
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const mesh = new THREE.InstancedMesh(geometry, buildVoxelMaterial(model), tranches.length);
  const m = new THREE.Matrix4();
  const white = new THREE.Color('#ffffff');
  for (let i = 0; i < tranches.length; i++) {
    const [x, y, z, sx, sy, sz, v] = tranches[i];
    poserPave(m, dims, cell, x, y, z, sx, sy, sz, serpent);
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, teinteVoxel(palette[v - 1] ?? white));
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  const lisiere = buildLisiere(model, grid);
  if (lisiere) mesh.add(lisiere);
  return mesh;
}

/* ------------------------------------------------------------- lisière --- */

/**
 * LA LISIÈRE — une ligne de lumière qui appartient à la masse.
 *
 * Les rubans posés à part (des pavés émissifs droits du pied à la crête)
 * coupaient la courbe des volées serpentines : la volée ondoie au rendu,
 * le ruban restait droit. La lisière se trace ICI, dans le repère de la
 * grille, le long des cellules de bord du dessus — le nez des marches d'un
 * côté, ou le pourtour d'une dalle — puis chaque point passe par la MÊME
 * loi du serpentin que les pavés (poserPave). Elle suit la courbe parce
 * qu'elle est tracée sur la courbe.
 *
 *   "lisiere": { "cote": "gauche" | "droite" | "pourtour",
 *                "couleur": "#d9ccff", "emissive": 0.9, "rayon": 0.03,
 *                "hauteur": 0.08 }
 *
 * `gauche`/`droite` se lisent en regardant vers +axe long (z croissant si
 * la masse est longue en z, x croissant sinon) : gauche = côté −latéral.
 * `pourtour` ferme la boucle sur le contour du dessus (un lobe, un balcon).
 * Rien n'est solide : ni collider, ni survol, ni ombre — la lisière ne
 * fait que dessiner, et la sonde de reflets la voit.
 */
export const LISIERE_DEFAUT = { couleur: '#d9ccff', emissive: 0.9, rayon: 0.03, hauteur: 0.08 };

/** Colonne (i, j) → hauteur du dessus (index de cellule +1) ou 0 si vide. */
function hauteursDessus(grid, dims) {
  const h = new Uint16Array(dims[0] * dims[2]);
  for (let z = 0; z < dims[2]; z++) {
    for (let x = 0; x < dims[0]; x++) {
      let top = 0;
      for (let y = dims[1] - 1; y >= 0; y--) {
        if (grid[cellIndex(dims, x, y, z)]) { top = y + 1; break; }
      }
      h[x + dims[0] * z] = top;
    }
  }
  return h;
}

/**
 * Les points de la lisière, dans le repère de l'objet et DÉJÀ serpentés
 * (fonction pure : le test au nœud la conduit sans WebGL).
 * Rend { points: [[x, y, z], …], ferme } ou null si rien à tracer.
 */
export function tracerLisiere(model, grid = gridOf(model), serpent = serpentinVoxel(
  model.dims ?? DEFAULT_DIMS, model.cell ?? DEFAULT_CELL)) {
  const lis = model.lisiere;
  if (!lis || typeof lis !== 'object') return null;
  const dims = model.dims ?? DEFAULT_DIMS;
  const cell = model.cell ?? DEFAULT_CELL;
  const hauteur = Number.isFinite(lis.hauteur) ? lis.hauteur : LISIERE_DEFAUT.hauteur;
  const dessus = hauteursDessus(grid, dims);
  const top = (x, z) => dessus[x + dims[0] * z];
  // l'axe long : celui du serpent s'il y en a un, sinon la plus grande dimension
  const axe = serpent ? serpent.axe : (dims[0] * cell >= dims[2] * cell ? 0 : 2);
  const nLong = axe === 0 ? dims[0] : dims[2];
  const nLat = axe === 0 ? dims[2] : dims[0];
  const at = (i, j) => (axe === 0 ? top(i, j) : top(j, i)); // i le long, j en travers
  // le point du bord d'une colonne, côté −latéral (signe −1) ou +latéral
  const point = (i, j, signe, h) => {
    const [cx, , cz] = axe === 0 ? cellCenter(dims, cell, i, 0, j) : cellCenter(dims, cell, j, 0, i);
    let long = axe === 0 ? cx : cz;
    let lat = (axe === 0 ? cz : cx) + signe * cell / 2;
    if (serpent) {
      const t = (i + 0.5) / nLong;
      lat = lat * serpent.gonflement(t) + serpent.decalage(t);
    }
    const y = h * cell + hauteur;
    return axe === 0 ? [long, y, lat] : [lat, y, long];
  };
  const bord = (signe) => {
    const pts = [];
    for (let i = 0; i < nLong; i++) {
      // la cellule pleine la plus au bord de ce côté, sur cette colonne
      let j = signe < 0 ? 0 : nLat - 1;
      const fin = signe < 0 ? nLat : -1;
      while (j !== fin && !at(i, j)) j += -signe;
      if (j === fin) continue;                       // colonne vide
      pts.push(point(i, j, signe, at(i, j)));
    }
    return pts;
  };
  if (lis.cote === 'pourtour') {
    const a = bord(-1), b = bord(1);
    if (a.length < 2 || b.length < 2) return null;
    return { points: [...a, ...b.reverse()], ferme: true };
  }
  const pts = bord(lis.cote === 'droite' ? 1 : -1);
  return pts.length >= 2 ? { points: pts, ferme: false } : null;
}

/** Le maillage de la lisière (un tube fin émissif), ou null. */
export function buildLisiere(model, grid = gridOf(model)) {
  const trace = tracerLisiere(model, grid);
  if (!trace) return null;
  const lis = model.lisiere;
  const rayon = Number.isFinite(lis.rayon) ? lis.rayon : LISIERE_DEFAUT.rayon;
  const courbe = new THREE.CatmullRomCurve3(
    trace.points.map((p) => new THREE.Vector3(p[0], p[1], p[2])), trace.ferme, 'centripetal');
  const geometry = new THREE.TubeGeometry(courbe, Math.max(8, trace.points.length * 3), rayon, 6, trace.ferme);
  const couleur = new THREE.Color(lis.couleur ?? LISIERE_DEFAUT.couleur);
  const material = new THREE.MeshStandardMaterial({
    color: couleur, emissive: couleur,
    emissiveIntensity: Number.isFinite(lis.emissive) ? lis.emissive : LISIERE_DEFAUT.emissive,
    roughness: 0.5, metalness: 0
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'lisiere';
  // elle dessine, elle ne pèse rien : pas d'ombre, pas de cible, pas de
  // lumière reçue (couche auto-éclairée, posée par Artwork._setMesh)
  mesh.userData.sansOmbre = true;
  mesh.userData.ignoreRaycast = true;
  mesh.userData.autoEclaire = true;
  return mesh;
}

/**
 * La couleur d'une cellule, selon le style. En mode FLUIDE, les masses
 * deviennent la coque blanche des références — la palette ne survit qu'en
 * murmure (18 %), assez pour qu'un escalier vert et un escalier ocre
 * restent distincts de près, assez peu pour que l'ensemble se lise comme
 * UNE architecture blanche striée et non comme un jouet.
 */
const _BLANC_FLUIDE = new THREE.Color('#e9e7f0');
function teinteVoxel(couleur) {
  if (!estFluide()) return couleur;
  return couleur.clone().lerp(_BLANC_FLUIDE, 0.82);
}

/**
 * Maillage de COLLISION d'une grille : la même forme, en beaucoup moins de
 * pièces.
 *
 * Le maillage de rendu est un InstancedMesh d'une cellule par cube — un
 * escalier plein en compte deux mille. Or un lancer de rayon contre un
 * InstancedMesh coûte O(nombre d'instances) : marcher dans un escalier
 * revenait à multiplier deux mille matrices par rayon, quatre fois par
 * frame. Pire, la borne `far` du Raycaster n'est même pas consultée par le
 * test de sphère englobante d'InstancedMesh : un rayon de cinquante
 * centimètres payait le plein tarif.
 *
 * On fusionne donc les cellules pleines en PAVÉS (greedy meshing) : chaque
 * marche d'un escalier devient une seule boîte. La forme est rigoureusement
 * la même — les pavés recouvrent exactement les cellules pleines — mais un
 * escalier de deux mille cellules se réduit à quarante boîtes.
 *
 * Renvoie null si la grille est vide.
 */
export function buildVoxelCollider(model, grid = gridOf(model)) {
  const dims = model.dims ?? DEFAULT_DIMS;
  const cell = model.cell ?? DEFAULT_CELL;
  const pris = new Uint8Array(grid.length);
  const pavés = [];

  const plein = (x, y, z) => grid[cellIndex(dims, x, y, z)] && !pris[cellIndex(dims, x, y, z)];

  for (let z = 0; z < dims[2]; z++) {
    for (let y = 0; y < dims[1]; y++) {
      for (let x = 0; x < dims[0]; x++) {
        if (!plein(x, y, z)) continue;
        // on étend le pavé tant que la tranche entière reste pleine
        let sx = 1;
        while (x + sx < dims[0] && plein(x + sx, y, z)) sx++;
        let sy = 1;
        grandirY: while (y + sy < dims[1]) {
          for (let i = 0; i < sx; i++) if (!plein(x + i, y + sy, z)) break grandirY;
          sy++;
        }
        let sz = 1;
        grandirZ: while (z + sz < dims[2]) {
          for (let j = 0; j < sy; j++) {
            for (let i = 0; i < sx; i++) {
              if (!plein(x + i, y + j, z + sz)) break grandirZ;
            }
          }
          sz++;
        }
        for (let k = 0; k < sz; k++) {
          for (let j = 0; j < sy; j++) {
            for (let i = 0; i < sx; i++) pris[cellIndex(dims, x + i, y + j, z + k)] = 1;
          }
        }
        pavés.push([x, y, z, sx, sy, sz]);
      }
    }
  }
  if (!pavés.length) return null;

  const serpent = serpentinVoxel(dims, cell);
  const tranches = serpent ? decouperPaves(pavés, serpent.axe) : pavés;
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshBasicMaterial(),
    tranches.length);
  mesh.visible = false;          // il ne sert qu'aux rayons
  mesh.name = 'collision-voxel';
  mesh.userData.ignoreRaycast = false;
  const m = new THREE.Matrix4();
  for (let i = 0; i < tranches.length; i++) {
    const [x, y, z, sx, sy, sz] = tranches[i];
    poserPave(m, dims, cell, x, y, z, sx, sy, sz, serpent);
    mesh.setMatrixAt(i, m);
  }
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

/**
 * Matériau des cellules.
 *
 * La galerie est une salle noire : un matériau seulement éclairé y disparaît
 * (vérifié — une construction de 552 cubes s'y rendait entièrement noire).
 * Les autres œuvres s'en sortent parce qu'elles émettent : les panneaux ont
 * une emissiveMap, le monolithe est un shader. Les cellules font de même.
 *
 * Trois lignes de shader sont nécessaires parce que Three multiplie la
 * couleur d'instance dans le diffus, jamais dans l'émission : sans ce patch,
 * toutes les cellules émettraient la même lueur blanche et la palette
 * disparaîtrait. Le résultat garde l'ombrage du MeshStandardMaterial, nourrit
 * le bloom, et reste un seul appel de dessin.
 */
function buildVoxelMaterial(model = {}) {
  // La matière se règle par œuvre (`roughness`, `metalness`) : un escalier
  // blanc laqué renvoie la corniche d'en face, une masse mate l'absorbe.
  const material = new THREE.MeshStandardMaterial({
    roughness: model.roughness ?? 0.62,
    metalness: model.metalness ?? 0.05,
    emissive: new THREE.Color(0xffffff),
    // L'AUTO-ÉCLAIRAGE, ramené à ce qu'il doit être.
    //
    // À 0,45, chaque cube rendait près de la moitié de sa couleur SANS
    // qu'aucune lumière n'intervienne : les marches et les passerelles du
    // belvédère étaient donc à moitié insensibles à l'éclairage de la
    // salle. C'est la définition même du plastique — une surface qui ne
    // répond pas à la lumière. La valeur venait d'une époque où le
    // belvédère était presque noir et où il fallait que le labyrinthe
    // reste lisible ; maintenant que la clé y porte et que les ombres se
    // lisent, l'émission n'a plus à faire ce travail.
    //
    // On garde un fond de braise — la palette compte une « encre »
    // (#3d3d5c) qui, complètement éteinte, disparaîtrait dans le noir.
    emissiveIntensity: 0.2
  });
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance *= vColor;'
    );
  };
  // LE GRAIN. Une construction voxel est faite de pavés instanciés : leurs
  // UV vont de zéro à un quelle que soit leur taille, donc aucune texture
  // ordinaire ne peut y garder une échelle physique. C'est ce qui laissait
  // tout le belvédère — ses marches, ses masses, ses passerelles — en
  // aplats de plastique. Le grain est donc échantillonné sur la POSITION
  // MONDE, projeté selon les trois axes (voir patcherGrain) : rien ne
  // s'étire, un pavé de six mètres et un cube de vingt-cinq centimètres
  // portent la même matière à la même taille réelle.
  // L'ÉCHELLE DU GRAIN, VUE EN PEINTRE. À 1,3 m de période, sur des marches
  // de 50 cm, le motif ne se lisait plus comme une matière mais comme un
  // DAMIER : une tuile couvrait deux marches et demie, et l'œil comptait
  // les tuiles au lieu de voir la pierre. Un grain doit être plus fin que
  // le plus petit élément qu'il habille, sans quoi il le contredit. À
  // 38 cm il passe sous la marche ; la force et le relief redescendent
  // d'autant — un voxel a déjà ses arêtes franches pour dire son volume,
  // il n'a pas besoin qu'on lui en peigne d'autres par-dessus.
  if (estFluide()) {
    // MODE FLUIDE : le blanc structurel prend des STRIES sombres — les
    // lignes du hall de la Dominion Tower — et son émission se tait
    // (une coque blanche qui émet devient du lait). Le grain reste,
    // plus doux : le plâtre n'est pas un plastique non plus.
    //
    // LES STRIES SUIVENT LA MONTÉE. Des bandes horizontales sur un
    // escalier ne racontent rien : celles des références suivent le
    // mouvement. L'axe des stries est donc la DIAGONALE de la masse —
    // (0, hauteur, profondeur) en espace LOCAL, insensible aux rotations
    // de salle et aux bascules de gravité : sur un escalier, les lignes
    // traversent les marches le long de l'ascension ; sur une passerelle
    // plate, elles redeviennent des travées régulières.
    const dims = model.dims ?? DEFAULT_DIMS;
    const cell = model.cell ?? DEFAULT_CELL;
    const montee = [0, dims[1] * cell, dims[2] * cell];
    material.roughness = model.roughness ?? 0.42;
    material.emissiveIntensity = 0.05;
    patcherGrain(material, 'poli', { echelle: 0.38, force: 0.1, relief: 0.18 });
    patcherStries(material, {
      pas: 0.55, epaisseur: 0.12, force: 0.5,
      axe: montee, espace: 'local'
    });
    material.customProgramCacheKey =
      () => `voxel-fluide-${montee.map((v) => v.toFixed(1)).join(',')}`;
    return material;
  }
  return patcherGrain(material, 'poli', { echelle: 0.38, force: 0.16, relief: 0.3 });
}

/** Centre d'une cellule, dans le repère de l'objet (grille centrée, base à y=0). */
export function cellCenter(dims, cell, x, y, z) {
  return [
    (x - dims[0] / 2 + 0.5) * cell,
    (y + 0.5) * cell,
    (z - dims[2] / 2 + 0.5) * cell
  ];
}

/** Coordonnées de cellule d'un point exprimé dans le repère de l'objet. */
export function cellAt(dims, cell, point) {
  return [
    Math.floor(point.x / cell + dims[0] / 2),
    Math.floor(point.y / cell),
    Math.floor(point.z / cell + dims[2] / 2)
  ];
}

function isEnclosed(grid, dims, x, y, z) {
  const solid = (a, b, c) =>
    inBounds(dims, a, b, c) && grid[cellIndex(dims, a, b, c)] !== 0;
  return solid(x + 1, y, z) && solid(x - 1, y, z)
      && solid(x, y + 1, z) && solid(x, y - 1, z)
      && solid(x, y, z + 1) && solid(x, y, z - 1);
}

/* ------------------------------------------------------------ édition --- */

/** Modèle voxel neuf, vide. */
export function newVoxelModel(dims = DEFAULT_DIMS, cell = DEFAULT_CELL) {
  return {
    type: 'voxel',
    dims: [...dims],
    cell,
    palette: [...DEFAULT_PALETTE],
    cells: encodeRLE(new Uint8Array(cellCount(dims)))
  };
}

/** Nombre de cellules pleines — utile pour informer l'auteur. */
export function filledCount(grid) {
  let n = 0;
  for (let i = 0; i < grid.length; i++) if (grid[i]) n++;
  return n;
}

/**
 * Écrit une valeur dans un pavé (une seule cellule si a === b).
 * Retourne true si quelque chose a changé.
 */
export function fillBox(grid, dims, a, b, value) {
  let changed = false;
  const [x0, x1] = minmax(a[0], b[0]);
  const [y0, y1] = minmax(a[1], b[1]);
  const [z0, z1] = minmax(a[2], b[2]);
  for (let z = z0; z <= z1; z++) {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (!inBounds(dims, x, y, z)) continue;
        const i = cellIndex(dims, x, y, z);
        if (grid[i] === value) continue;
        grid[i] = value;
        changed = true;
      }
    }
  }
  return changed;
}

function minmax(a, b) {
  return a <= b ? [a, b] : [b, a];
}

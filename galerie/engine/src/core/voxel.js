import * as THREE from 'three';

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

  const geometry = new THREE.BoxGeometry(cell, cell, cell);
  const mesh = new THREE.InstancedMesh(geometry, buildVoxelMaterial(), visible.length);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  const m = new THREE.Matrix4();
  const white = new THREE.Color('#ffffff');
  visible.forEach(([x, y, z, v], i) => {
    m.makeTranslation(...cellCenter(dims, cell, x, y, z));
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, palette[v - 1] ?? white);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

  // permet de retrouver la cellule d'une instance cliquée
  mesh.userData.voxelCells = visible.map(([x, y, z]) => [x, y, z]);
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

  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const mesh = new THREE.InstancedMesh(geometry, buildVoxelMaterial(), pavés.length);
  const m = new THREE.Matrix4();
  const white = new THREE.Color('#ffffff');
  for (let i = 0; i < pavés.length; i++) {
    const [x, y, z, sx, sy, sz, v] = pavés[i];
    const c0 = cellCenter(dims, cell, x, y, z);
    m.makeScale(sx * cell, sy * cell, sz * cell);
    m.setPosition(
      c0[0] + (sx - 1) * cell / 2,
      c0[1] + (sy - 1) * cell / 2,
      c0[2] + (sz - 1) * cell / 2
    );
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, palette[v - 1] ?? white);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return mesh;
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

  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshBasicMaterial(),
    pavés.length);
  mesh.visible = false;          // il ne sert qu'aux rayons
  mesh.name = 'collision-voxel';
  mesh.userData.ignoreRaycast = false;
  const m = new THREE.Matrix4();
  for (let i = 0; i < pavés.length; i++) {
    const [x, y, z, sx, sy, sz] = pavés[i];
    const c0 = cellCenter(dims, cell, x, y, z);
    m.makeScale(sx * cell, sy * cell, sz * cell);
    m.setPosition(
      c0[0] + (sx - 1) * cell / 2,
      c0[1] + (sy - 1) * cell / 2,
      c0[2] + (sz - 1) * cell / 2
    );
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
function buildVoxelMaterial() {
  const material = new THREE.MeshStandardMaterial({
    roughness: 0.62,
    metalness: 0.05,
    emissive: new THREE.Color(0xffffff),
    emissiveIntensity: 0.45
  });
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance *= vColor;'
    );
  };
  return material;
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

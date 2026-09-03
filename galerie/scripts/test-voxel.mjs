/**
 * Test des constructions voxel : encodage RLE, coordonnées, édition, rendu.
 * Le RLE est le format de persistance : une erreur d'aller-retour corromprait
 * silencieusement les scènes exportées. C'est donc le cœur du test.
 * Lancer avec : npm test
 */
import {
  DEFAULT_DIMS, DEFAULT_CELL,
  cellIndex, inBounds, cellCount,
  encodeRLE, decodeRLE, gridOf, buildVoxelMesh,
  cellCenter, cellAt, newVoxelModel, filledCount, fillBox,
  tracerLisiere, buildLisiere
} from '../engine/src/core/voxel.js';

let passed = 0, failed = 0;
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function check(name, actual, expected) {
  if (eq(actual, expected)) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}\n      attendu : ${JSON.stringify(expected)}\n      obtenu  : ${JSON.stringify(actual)}`); }
}

console.log('\nindices');
{
  const dims = [4, 3, 2];
  check('cellCount', cellCount(dims), 24);
  check('cellIndex origine', cellIndex(dims, 0, 0, 0), 0);
  check('cellIndex x', cellIndex(dims, 3, 0, 0), 3);
  check('cellIndex y', cellIndex(dims, 0, 1, 0), 4);
  check('cellIndex z', cellIndex(dims, 0, 0, 1), 12);
  check('indices tous distincts', new Set(
    Array.from({ length: 24 }, (_, i) => {
      const x = i % 4, y = Math.floor(i / 4) % 3, z = Math.floor(i / 12);
      return cellIndex(dims, x, y, z);
    })).size, 24);
  check('inBounds dedans', inBounds(dims, 3, 2, 1), true);
  check('inBounds hors x', inBounds(dims, 4, 0, 0), false);
  check('inBounds négatif', inBounds(dims, 0, -1, 0), false);
}

console.log('\nRLE — aller-retour');
{
  const grid = new Uint8Array([0, 0, 0, 1, 1, 2, 0, 0]);
  check('encodage', encodeRLE(grid), [3, 0, 2, 1, 1, 2, 2, 0]);
  check('aller-retour', [...decodeRLE(encodeRLE(grid), grid.length)], [...grid]);

  const vide = new Uint8Array(4096);
  check('grille vide tient en deux nombres', encodeRLE(vide), [4096, 0]);
  check('grille vide restaurée', decodeRLE([4096, 0], 4096).every((v) => v === 0), true);

  const plein = new Uint8Array(100).fill(3);
  check('grille pleine', encodeRLE(plein), [100, 3]);

  check('grille de longueur nulle', encodeRLE(new Uint8Array(0)), []);
}

console.log('\nRLE — cas limites de décodage');
{
  check('RLE trop court : complété de zéros',
    [...decodeRLE([2, 5], 5)], [5, 5, 0, 0, 0]);
  check('RLE trop long : tronqué',
    [...decodeRLE([10, 7], 3)], [7, 7, 7]);
  check('paire incomplète ignorée',
    [...decodeRLE([2, 1, 9], 4)], [1, 1, 0, 0]);
  check('RLE absent → grille vide',
    [...gridOf({ dims: [2, 2, 2] })], [0, 0, 0, 0, 0, 0, 0, 0]);
}

console.log('\nRLE — aller-retour aléatoire (100 grilles)');
{
  // Générateur déterministe : un échec doit être reproductible.
  let seed = 20260812;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  let ok = true;
  let totalCells = 0, totalNumbers = 0;
  for (let n = 0; n < 100; n++) {
    const len = 1 + Math.floor(rnd() * 500);
    const grid = new Uint8Array(len);
    // des paquets, pas du bruit : c'est à quoi ressemble une construction
    for (let i = 0; i < len; i++) {
      if (rnd() < 0.12) grid[i] = Math.floor(rnd() * 7);
      else grid[i] = i ? grid[i - 1] : 0;
    }
    const rle = encodeRLE(grid);
    if (!eq([...decodeRLE(rle, len)], [...grid])) { ok = false; break; }
    totalCells += len;
    totalNumbers += rle.length;
  }
  check('toutes les grilles se restaurent à l’identique', ok, true);
  // Le RLE peut gonfler un cas dégénéré (alternance à chaque cellule) ; ce qui
  // compte est le régime réel, où les cellules vont par paquets.
  check('compression effective en moyenne', totalNumbers / totalCells < 0.5, true);

  // Cas concret : une dalle pleine dans une grille 16³ (le cas d'usage type).
  const dims = [16, 16, 16];
  const dalle = new Uint8Array(cellCount(dims));
  fillBox(dalle, dims, [0, 0, 0], [15, 1, 15], 1);
  const rle = encodeRLE(dalle);
  check('dalle 16×2×16 : moins de 200 nombres exportés', rle.length < 200, true);
  check('dalle restaurée', [...decodeRLE(rle, dalle.length)], [...dalle]);
}

console.log('\ncoordonnées');
{
  const dims = [4, 4, 4];
  const cell = 0.5;
  check('grille centrée en x/z, base à y=0',
    cellCenter(dims, cell, 0, 0, 0), [-0.75, 0.25, -0.75]);
  check('cellule opposée',
    cellCenter(dims, cell, 3, 3, 3), [0.75, 1.75, 0.75]);

  // cellAt doit être l'inverse de cellCenter pour toutes les cellules
  let inverse = true;
  for (let z = 0; z < dims[2]; z++) {
    for (let y = 0; y < dims[1]; y++) {
      for (let x = 0; x < dims[0]; x++) {
        const [cx, cy, cz] = cellCenter(dims, cell, x, y, z);
        if (!eq(cellAt(dims, cell, { x: cx, y: cy, z: cz }), [x, y, z])) inverse = false;
      }
    }
  }
  check('cellAt est l’inverse de cellCenter', inverse, true);
}

console.log('\nédition');
{
  const dims = [4, 4, 4];
  const grid = new Uint8Array(cellCount(dims));

  check('pose d’une cellule', fillBox(grid, dims, [1, 1, 1], [1, 1, 1], 2), true);
  check('valeur écrite', grid[cellIndex(dims, 1, 1, 1)], 2);
  check('pose identique : rien à faire',
    fillBox(grid, dims, [1, 1, 1], [1, 1, 1], 2), false);

  check('pavé', fillBox(grid, dims, [0, 0, 0], [1, 1, 1], 1), true);
  check('8 cellules remplies', filledCount(grid), 8);

  // coins donnés à l'envers : le pavé doit être le même
  const g2 = new Uint8Array(cellCount(dims));
  fillBox(g2, dims, [1, 1, 1], [0, 0, 0], 1);
  check('coins inversés donnent le même pavé', filledCount(g2), 8);

  // débordement : on écrit ce qui tient, sans erreur ni corruption
  const g3 = new Uint8Array(cellCount(dims));
  check('pavé débordant accepté', fillBox(g3, dims, [-5, -5, -5], [1, 1, 1], 1), true);
  check('seules les cellules valides sont écrites', filledCount(g3), 8);

  const g4 = new Uint8Array(cellCount(dims));
  check('pavé entièrement hors grille : sans effet',
    fillBox(g4, dims, [10, 10, 10], [12, 12, 12], 1), false);

  check('effacement', fillBox(grid, dims, [0, 0, 0], [3, 3, 3], 0), true);
  check('grille vidée', filledCount(grid), 0);
}

console.log('\nmodèle neuf');
{
  const m = newVoxelModel();
  check('type', m.type, 'voxel');
  check('dimensions par défaut', m.dims, DEFAULT_DIMS);
  check('taille de cellule par défaut', m.cell, DEFAULT_CELL);
  check('grille vide', m.cells, [cellCount(DEFAULT_DIMS), 0]);
  check('palette non vide', m.palette.length > 0, true);
  check('dims copiés, pas partagés', m.dims === DEFAULT_DIMS, false);

  const m2 = newVoxelModel([2, 2, 2], 1);
  check('dimensions sur mesure', m2.dims, [2, 2, 2]);
  check('grille vide correspondante', m2.cells, [8, 0]);
}

console.log('\nrendu — instanciation et occlusion');
{
  const dims = [3, 3, 3];
  const model = { type: 'voxel', dims, cell: 1, palette: ['#ffffff'], cells: [] };

  check('grille vide : aucun maillage', buildVoxelMesh(model), null);

  // cube plein 3×3×3 : la cellule centrale est entourée, donc non instanciée
  const grid = new Uint8Array(27).fill(1);
  const mesh = buildVoxelMesh(model, grid);
  check('27 cellules, 26 instances (le cœur est masqué)', mesh.count, 26);
  check('table de correspondance alignée', mesh.userData.voxelCells.length, 26);
  check('la cellule centrale est bien celle qui manque',
    mesh.userData.voxelCells.some(([x, y, z]) => x === 1 && y === 1 && z === 1), false);

  // une cellule creusée en surface rend le cœur visible à nouveau
  const grid2 = new Uint8Array(27).fill(1);
  grid2[cellIndex(dims, 1, 1, 0)] = 0;
  check('cellule ouverte : le cœur redevient visible',
    buildVoxelMesh(model, grid2).count, 26);

  // une seule cellule
  const grid3 = new Uint8Array(27);
  grid3[cellIndex(dims, 2, 0, 1)] = 1;
  const solo = buildVoxelMesh(model, grid3);
  check('une cellule → une instance', solo.count, 1);
  check('coordonnées retrouvées depuis l’instance',
    solo.userData.voxelCells[0], [2, 0, 1]);

  // valeur de palette hors bornes : ne doit pas planter le rendu
  const grid4 = new Uint8Array(27);
  grid4[0] = 9;
  check('index de palette invalide toléré', buildVoxelMesh(model, grid4).count, 1);
}

console.log('\nlisière — la ligne de lumière suit le bord de la masse');
{
  // une volée de 4 marches, 3 de large, 8 de long (2 cellules par marche)
  const dims = [3, 4, 8];
  const grid = new Uint8Array(cellCount(dims));
  for (let z = 0; z < 8; z++) {
    for (let y = 0; y <= Math.min(3, Math.floor(z / 2)); y++) {
      for (let x = 0; x < 3; x++) grid[cellIndex(dims, x, y, z)] = 1;
    }
  }
  const model = { type: 'voxel', dims, cell: 0.5, lisiere: { cote: 'gauche', hauteur: 0.1 } };
  const t = tracerLisiere(model, grid, null);
  check('une volée ouverte : autant de points que de colonnes', t.points.length, 8);
  check('pas fermée', t.ferme, false);
  check('gauche = bord −x de la grille (x = −0,75)', t.points.every((p) => Math.abs(p[0] + 0.75) < 1e-9), true);
  check('la ligne monte avec les marches', t.points[0][1] < t.points[7][1], true);
  check('hauteur de la première marche + 10 cm', +t.points[0][1].toFixed(2), 0.6);
  check('hauteur de la crête + 10 cm', +t.points[7][1].toFixed(2), 2.1);
  const d = tracerLisiere({ ...model, lisiere: { cote: 'droite' } }, grid, null);
  check('droite = bord +x', d.points.every((p) => Math.abs(p[0] - 0.75) < 1e-9), true);
  // le serpentin déplace et gonfle : une loi jouet, décalage 1 partout
  const serpent = { axe: 2, decalage: () => 1, gonflement: () => 2 };
  const s = tracerLisiere(model, grid, serpent);
  check('serpenté : x = −0,75 × 2 + 1', s.points.every((p) => Math.abs(p[0] - (-0.5)) < 1e-9), true);
  // pourtour d'une dalle pleine 4 × 1 × 6
  const dalle = { type: 'voxel', dims: [4, 1, 6], cell: 0.5, lisiere: { cote: 'pourtour' } };
  const g2 = new Uint8Array(24).fill(1);
  const p = tracerLisiere(dalle, g2, null);
  check('pourtour fermé', p.ferme, true);
  check('pourtour : deux bords de 6 colonnes', p.points.length, 12);
  check('sans lisière : rien', tracerLisiere({ type: 'voxel', dims, cell: 0.5 }, grid, null), null);
  const mesh = buildLisiere(model, grid);
  check('un maillage nommé lisiere', mesh?.name, 'lisiere');
  check('qui ne pèse rien : ni ombre, ni cible', [mesh.userData.sansOmbre, mesh.userData.ignoreRaycast], [true, true]);
}

console.log(`\n${passed} réussis, ${failed} échoués\n`);
process.exit(failed ? 1 : 0);

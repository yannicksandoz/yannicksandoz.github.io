import * as THREE from 'three';

/**
 * Textures procédurales — le grain d'un pack Minecraft, sans un octet
 * téléchargé.
 *
 * Chaque style est une tuile de 32×32 texels dessinée UNE fois dans un
 * canvas au chargement, en NIVEAUX DE GRIS : c'est la couleur du matériau
 * (celle que la pièce déclare déjà) qui la teinte, si bien que chaque
 * salle garde sa palette — la texture n'apporte que la matière. Filtre
 * NEAREST à l'agrandissement : les texels restent des carrés francs,
 * l'esthétique des meilleurs packs pixel-art ; mipmaps au rétrécissement,
 * pour que le lointain ne grésille pas.
 *
 * Les UV sont à l'échelle du MONDE (une tuile ≈ 2 m, voir scaleBoxUV) :
 * un seul matériau, une seule texture par style, partagés par tous les
 * segments de murs quelle que soit leur taille.
 *
 * Par pièce, dans le JSON :
 *   "floor": { "texture": "herbe", … }
 *   "shell": { "texture": "pierre", … }
 *
 * Styles : pierre, brique, planches, dalles, herbe, sable.
 * Déterministe (PRNG semé par style) : le même build rend le même monde.
 */

/** Côté d'une tuile, en mètres — l'échelle du « bloc ». */
export const TILE = 2;

/**
 * Filtrage anisotrope des textures à venir — réglé par l'App une fois le
 * renderer créé (profil de qualité, borné par le matériel) : c'est lui qui
 * garde le parquet et le sable ratissé nets aux angles rasants. Les
 * textures déjà en cache gardent leur valeur — l'App appelle AVANT que la
 * première pièce ne se construise.
 */
let _anisotropy = 4;
export function setDefaultAnisotropy(n) { _anisotropy = n; }

const SIZE = 32;

/** PRNG déterministe (mulberry32) : les textures ne changent pas d'un build à l'autre. */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Bruit de valeur 2D périodique sur la grille de la tuile (elle boucle). */
function valueNoise(rand, period) {
  const g = [];
  for (let i = 0; i < period * period; i++) g.push(rand());
  const at = (x, y) => g[((y % period + period) % period) * period
    + ((x % period + period) % period)];
  return (fx, fy) => {
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const a = at(x0, y0), b = at(x0 + 1, y0);
    const c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

/* Chaque peintre remplit un tableau SIZE×SIZE de luminances (≈0,7–1,05).
   Autour de 0,9 de moyenne : la couleur du matériau reste maîtresse. */

function peindrePierre(rand) {
  const n1 = valueNoise(rand, 4), n2 = valueNoise(rand, 8);
  const px = [];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const f = x / SIZE * 4, g = y / SIZE * 4;
      let v = 0.88 + (n1(f, g) - 0.5) * 0.18 + (n2(f * 2, g * 2) - 0.5) * 0.10;
      if (rand() < 0.03) v -= 0.10; // piqûres sombres éparses
      px.push(v);
    }
  }
  return px;
}

function peindreBrique(rand) {
  const px = new Array(SIZE * SIZE).fill(0.9);
  const H = 8; // 4 rangées de briques par tuile
  for (let y = 0; y < SIZE; y++) {
    const row = Math.floor(y / H);
    const decal = (row % 2) * (SIZE / 4);
    for (let x = 0; x < SIZE; x++) {
      const joinH = y % H === 0;
      const joinV = (x + decal) % (SIZE / 2) === 0;
      let v;
      if (joinH || joinV) v = 0.72; // mortier
      else v = 0.9 + (((row * 7 + Math.floor((x + decal) / (SIZE / 2)) * 13) % 5) - 2) * 0.03
        + (rand() - 0.5) * 0.05;
      px[y * SIZE + x] = v;
    }
  }
  return px;
}

function peindrePlanches(rand) {
  const px = new Array(SIZE * SIZE).fill(0.9);
  const W = 8; // 4 planches verticales par tuile
  const teintes = [0.94, 0.87, 0.91, 0.84];
  for (let x = 0; x < SIZE; x++) {
    const planche = Math.floor(x / W);
    const bord = x % W === 0;
    const grain = valueNoise(prng(planche * 97 + 11), 4);
    for (let y = 0; y < SIZE; y++) {
      let v = teintes[planche % 4] + (grain(0.5, y / SIZE * 4) - 0.5) * 0.10;
      if (bord) v = 0.7;                       // rainure entre planches
      if (rand() < 0.01) v -= 0.08;            // nœud du bois
      px[y * SIZE + x] = v;
    }
  }
  return px;
}

function peindreDalles(rand) {
  const px = new Array(SIZE * SIZE).fill(0.9);
  const D = 16; // 2×2 dalles par tuile
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const joint = x % D === 0 || y % D === 0;
      const dalle = Math.floor(x / D) + Math.floor(y / D) * 2;
      let v = joint ? 0.74
        : 0.9 + ((dalle * 31 % 7) - 3) * 0.018 + (rand() - 0.5) * 0.045;
      px[y * SIZE + x] = v;
    }
  }
  return px;
}

function peindreHerbe(rand) {
  const n = valueNoise(rand, 8);
  const px = [];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let v = 0.86 + (n(x / SIZE * 8, y / SIZE * 8) - 0.5) * 0.16;
      const r = rand();
      if (r < 0.06) v += 0.12;      // brins clairs
      else if (r < 0.10) v -= 0.10; // creux d'ombre
      px.push(v);
    }
  }
  return px;
}

function peindreSable(rand) {
  const n = valueNoise(rand, 4);
  const px = [];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let v = 0.92 + (n(x / SIZE * 4, y / SIZE * 4) - 0.5) * 0.08
        + (rand() - 0.5) * 0.05;
      if (rand() < 0.02) v += 0.08; // grains qui accrochent la lumière
      px.push(v);
    }
  }
  return px;
}

function peindreRatisse(rand) {
  // Karesansui : les sillons du râteau — des lignes parallèles fines,
  // légèrement ondulantes, l'arête éclairée d'un côté et l'ombre de
  // l'autre, sur un fond de gravier finement moucheté.
  const px = new Array(SIZE * SIZE).fill(0.92);
  const PAS = 4; // un sillon tous les 4 texels
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      // l'ondulation est périodique sur la tuile : pas de couture
      const onde = Math.sin(x / SIZE * Math.PI * 2) * 0.9;
      const ligne = ((y + onde + PAS * 100) % PAS + PAS) % PAS;
      let v = 0.92 + (rand() - 0.5) * 0.05;            // gravier
      if (ligne < 1) v = 0.72;                          // creux du sillon
      else if (ligne < 2) v = 1.02;                     // arête éclairée
      px[y * SIZE + x] = v;
    }
  }
  return px;
}

const PEINTRES = {
  pierre: [peindrePierre, 101],
  brique: [peindreBrique, 211],
  planches: [peindrePlanches, 307],
  dalles: [peindreDalles, 401],
  herbe: [peindreHerbe, 503],
  sable: [peindreSable, 601],
  ratisse: [peindreRatisse, 701]
};

/** Styles offerts par l'éditeur (l'ordre est celui du menu). */
export const TEXTURE_STYLES = Object.keys(PEINTRES);

const _cache = new Map();

/**
 * Texture d'un style, construite au premier usage puis partagée par tous
 * les matériaux qui la demandent. Renvoie null pour un style inconnu ou
 * absent — le matériau reste uni, comme avant.
 */
export function styleTexture(style) {
  if (!style || !PEINTRES[style]) return null;
  if (_cache.has(style)) return _cache.get(style);
  const [peindre, seed] = PEINTRES[style];
  const px = peindre(prng(seed));

  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(SIZE, SIZE);
  for (let i = 0; i < px.length; i++) {
    const v = Math.round(THREE.MathUtils.clamp(px[i], 0, 1.2) * 212); // ~0,83 max
    img.data[4 * i] = v;
    img.data[4 * i + 1] = v;
    img.data[4 * i + 2] = v;
    img.data[4 * i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;              // les texels restent carrés
  tex.minFilter = THREE.LinearMipmapLinearFilter;   // le lointain ne grésille pas
  tex.generateMipmaps = true;
  tex.anisotropy = _anisotropy;
  tex.colorSpace = THREE.NoColorSpace; // niveaux de gris : pas une couleur
  _cache.set(style, tex);
  return tex;
}

/**
 * Met les UV d'une BoxGeometry à l'échelle du MONDE : une tuile tous les
 * TILE mètres sur chaque face, quelle que soit la taille de la boîte. C'est
 * ce qui permet à tous les segments d'un mur de partager le même matériau.
 * Les faces d'une BoxGeometry sont ordonnées +x, −x, +y, −y, +z, −z, à
 * 4 sommets chacune ; leurs plans portent respectivement (d,h), (w,d), (w,h).
 */
export function scaleBoxUV(geometry, w, h, d) {
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  const uv = geometry.attributes.uv;
  for (let face = 0; face < 6; face++) {
    const [du, dv] = dims[face];
    for (let v = 0; v < 4; v++) {
      const i = face * 4 + v;
      uv.setXY(i, uv.getX(i) * du / TILE, uv.getY(i) * dv / TILE);
    }
  }
  uv.needsUpdate = true;
}

/** Même échelle-monde pour un plan (le sol). */
export function scalePlaneUV(geometry, w, h) {
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * w / TILE, uv.getY(i) * h / TILE);
  }
  uv.needsUpdate = true;
}

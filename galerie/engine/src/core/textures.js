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
/** L'anisotropie courante — les matières photographiques la lisent aussi. */
export function anisotropie() { return _anisotropy; }

// LA FINESSE DE LA TUILE. Trente-deux texels suffisaient tant qu'une
// tuile couvrait deux mètres : un texel valait six centimètres, sous le
// seuil de l'œil. Le grain triplanaire des voxels, lui, la répète tous
// les 38 cm — un texel y vaut plus d'un centimètre, et de près la pierre
// se lisait en pâtés de camouflage. À 128, le texel retombe à trois
// millimètres. Les constantes des peintres (rangées de briques, largeur
// de planche, pas du râteau) sont DÉDUITES de SIZE : la définition
// change, les proportions ne bougent pas d'un poil.
const SIZE = 128;

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
  // QUATRE OCTAVES, ET LES BASSES RABOTÉES. Deux octaves à 4 et 8 cellules
  // par tuile donnaient, sur une tuile de deux mètres, des motifs de 50 et
  // 25 cm : à cette taille la pierre ne se lit plus comme une matière mais
  // comme des nuages. On garde les basses fréquences pour que le mur ne
  // soit pas un aplat, mais on divise leur amplitude par deux et on ajoute
  // ce qui manquait — du grain à 12 puis 6 cm, la taille d'un éclat.
  const n1 = valueNoise(rand, 4), n2 = valueNoise(rand, 8);
  const n3 = valueNoise(rand, 16), n4 = valueNoise(rand, 32);
  const px = [];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const f = x / SIZE * 4, g = y / SIZE * 4;
      let v = 0.88
        + ((n1(f, g) - 0.5) * 0.09)
        + ((n2(f * 2, g * 2) - 0.5) * 0.06)
        + ((n3(f * 4, g * 4) - 0.5) * 0.07)
        + ((n4(f * 8, g * 8) - 0.5) * 0.05);
      if (rand() < 0.03) v -= 0.10; // piqûres sombres éparses
      px.push(v);
    }
  }
  return px;
}

function peindreBrique(rand) {
  const px = new Array(SIZE * SIZE).fill(0.9);
  const H = SIZE / 4; // 4 rangées de briques par tuile
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
  const W = SIZE / 4; // 4 planches verticales par tuile
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
  // DEUX dalles par tuile, soit un mètre de côté : la taille d'une dalle
  // de hall, celle qu'on enjambe. `16` était écrit en dur du temps où la
  // tuile faisait 32 texels ; passée à 128, il donnait 8×8 dalles de
  // 25 cm — un carrelage de salle de bains répété à l'infini, et c'est
  // exactement ce qui datait les sols. Les autres peintres déduisaient
  // déjà leurs constantes de SIZE ; celui-ci ne l'avait pas suivi.
  const D = SIZE / 2;
  // le joint doit rester un joint quelle que soit la définition : trois
  // millimètres à l'échelle du monde, pas « un texel »
  const JOINT = Math.max(1, Math.round(SIZE / 64));
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const joint = x % D < JOINT || y % D < JOINT;
      const dalle = Math.floor(x / D) + Math.floor(y / D) * 2;
      // chaque dalle a SON nuage : sans quoi quatre grands aplats voisins
      // se lisent comme une seule surface rayée de croix
      const nuage = valueNoise(prng(401 + dalle * 137), 3);
      const v = joint ? 0.74
        : 0.9 + ((dalle * 31 % 7) - 3) * 0.018
          + (nuage((x % D) / D * 3, (y % D) / D * 3) - 0.5) * 0.09
          + (rand() - 0.5) * 0.03;
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
  const PAS = SIZE / 8; // un sillon tous les huitièmes de tuile
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

/* --- les trois surfaces d'OBJET : pour ce qui n'est ni sol ni mur ------- */

function peindreMetal(rand) {
  // métal brossé : des stries horizontales très fines, à peine contrastées.
  // Ce qu'on lit d'un métal, ce n'est pas son grain mais la façon dont son
  // reflet s'étire — d'où une carte presque plate, dont l'essentiel du
  // travail se fait en RUGOSITÉ (voir SURFACES.metal).
  const px = new Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) {
    const strie = (rand() - 0.5) * 0.06;
    for (let x = 0; x < SIZE; x++) {
      px[(y * SIZE) + x] = 0.93 + strie + ((rand() - 0.5) * 0.02);
    }
  }
  return px;
}

function peindrePoli(rand) {
  // pierre polie : le nuage minéral d'une plaque de marbre, sans veine
  // franche — deux octaves de bruit doux, rien qui accroche l'œil de près
  // mais qui empêche la surface d'être un aplat.
  const a = valueNoise(rand, 4);
  const b = valueNoise(rand, 8);
  const px = [];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const u = (x / SIZE) * 4, v = (y / SIZE) * 4;
      // amplitude franche : sur une masse sombre, un grain à quatre pour
      // cent ne se voit tout simplement pas — la première version en a
      // fait la démonstration sur les marches du belvédère
      px.push(0.9 + ((a(u, v) - 0.5) * 0.26) + ((b(u * 2, v * 2) - 0.5) * 0.13));
    }
  }
  return px;
}

function peindreBoisUse(rand) {
  // bois d'atelier : les veines d'une planche vue en travers, plus douces
  // que `planches` (qui dessine des lames entières) — la surface d'un banc
  // ou d'un rayonnage, où l'on voit le fil et non le joint.
  const n = valueNoise(rand, 6);
  const px = [];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      // le fil court en x : on écrase le bruit dans cette direction
      const fil = n((x / SIZE) * 1.5, (y / SIZE) * 6);
      // contraste franc : mesuré sur les rayonnages de la bibliothèque, un
      // fil à sept pour cent ne se voyait pas à trois mètres sous une
      // lanterne — le bois restait un aplat olive
      let v = 0.9 + ((fil - 0.5) * 0.3);
      if (rand() < 0.02) v -= 0.12;       // pore
      px.push(v);
    }
  }
  return px;
}

export const PEINTRES = {
  pierre: [peindrePierre, 101],
  brique: [peindreBrique, 211],
  planches: [peindrePlanches, 307],
  dalles: [peindreDalles, 401],
  herbe: [peindreHerbe, 503],
  sable: [peindreSable, 601],
  ratisse: [peindreRatisse, 701],
  metal: [peindreMetal, 809],
  poli: [peindrePoli, 907],
  'bois-use': [peindreBoisUse, 1009]
};

/**
 * LES SURFACES : ce qu'une matière fait à la LUMIÈRE, et non à la couleur.
 *
 * Une primitive n'était qu'une couleur avec une rugosité fixe — d'où le
 * plastique uniforme des bancs, des lanternes et des marches. Une surface
 * ajoute trois choses à un style : la profondeur de son relief, sa
 * rugosité, et son côté métallique. C'est ce trio, pas la texture, qui
 * distingue un bronze d'un galet.
 *
 * `metres` dit la taille physique d'une répétition : c'est ce qui empêche
 * une marche de deux mètres et un jeton de dix centimètres de porter le
 * même motif à la même taille apparente.
 */
/** Les noms des tuiles procédurales, pour le menu de l'éditeur. */
export const PEINTRES_NOMS = Object.keys(PEINTRES);

export const SURFACES = {
  metal:      { creux: 0.12, rugosite: 0.34, metal: 0.85, metres: 1.2 },
  poli:       { creux: 0.4, rugosite: 0.34, metal: 0.06, metres: 1.8 },
  'bois-use': { creux: 0.5, rugosite: 0.72, metal: 0.02, metres: 1.2 },
  pierre:     { creux: 0.28, rugosite: 0.92, metal: 0.02, metres: 2 },
  brique:     { creux: 0.3, rugosite: 0.9, metal: 0.02, metres: 2 },
  planches:   { creux: 0.26, rugosite: 0.8, metal: 0.02, metres: 2 },
  dalles:     { creux: 0.24, rugosite: 0.7, metal: 0.04, metres: 2 },
  herbe:      { creux: 0.2, rugosite: 0.95, metal: 0, metres: 2 },
  sable:      { creux: 0.14, rugosite: 0.98, metal: 0, metres: 2 },
  ratisse:    { creux: 0.3, rugosite: 0.96, metal: 0, metres: 2 }
};


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
  // LE FILTRE. NEAREST venait des tuiles de 32 texels : à cette
  // définition, des carrés francs étaient un parti pris pixel-art. À 128,
  // ce n'en est plus un — un joint de dalle et une veine de pierre ne
  // gagnent rien à monter en marches d'escalier, et de près la surface se
  // met à grouiller d'angles droits que la matière n'a pas. C'est
  // d'ailleurs pour ça que `patcherGrain` en clonait déjà une copie
  // adoucie. On lisse donc partout, et la matière redevient continue.
  tex.magFilter = THREE.LinearFilter;
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

/**
 * Même échelle-monde pour une géométrie EXTRUDÉE (un mur percé).
 *
 * `ExtrudeGeometry` pose les UV des faces avant et arrière directement en
 * mètres (les coordonnées de la forme) : il suffit de les ramener au pas de
 * la tuile. Les faces de tranche — l'ébrasement d'une baie — suivent la
 * même règle, si bien qu'une brique garde sa taille en tournant le coin.
 */
export function scaleWorldUV(geometry, tile = TILE) {
  const uv = geometry.attributes?.uv;
  if (!uv) return;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) / tile, uv.getY(i) / tile);
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

/**
 * ÉCHELLE-MONDE POUR UNE PRIMITIVE QUELCONQUE — la règle qui manquait.
 *
 * Une boîte, un cylindre, un tore portent des UV NORMALISÉS : zéro à un sur
 * chaque face, quelle que soit sa taille. Un motif y couvrait donc toujours
 * l'objet entier — les briques d'une stèle de quatre mètres étaient quatre
 * fois plus grosses que celles du mur derrière elle, et un jeton de dix
 * centimètres portait une brique entière. On mesure ici la boîte englobante
 * et on redistribue les UV en MÈTRES, comme pour les murs : la matière
 * garde sa taille physique, et deux objets voisins parlent enfin la même
 * langue.
 *
 * `metres` est la taille d'une répétition. La géométrie est modifiée en
 * place ; elle doit donc être PROPRE à l'objet (les primitives en
 * construisent une par mesh, c'est le cas).
 */
export function scaleObjetUV(geometry, metres = TILE, echelle = null) {
  const uv = geometry.attributes?.uv;
  const pos = geometry.attributes?.position;
  if (!uv || !pos || !(metres > 0)) return;
  geometry.computeBoundingBox();
  const b = geometry.boundingBox;
  // l'ÉCHELLE de l'objet compte : une œuvre étire souvent sa primitive
  // (un rayonnage est une boîte aplatie et montée en hauteur). Sans elle,
  // le motif serait posé à la taille de la boîte d'origine puis étiré
  // avec elle — des veines de bois trois fois plus longues que larges.
  const [ex, ey, ez] = Array.isArray(echelle) && echelle.length === 3
    ? echelle.map((v) => Math.abs(Number(v)) || 1) : [1, 1, 1];
  const dx = Math.max(0.05, (b.max.x - b.min.x) * ex);
  const dy = Math.max(0.05, (b.max.y - b.min.y) * ey);
  const dz = Math.max(0.05, (b.max.z - b.min.z) * ez);
  // deux dimensions suffisent : on prend les deux plus grandes, qui sont
  // celles que le regard parcourt — un motif ne s'étire jamais de plus
  // qu'un facteur deux, et c'est invisible sur une matière sans direction
  const [a, c] = [dx, dy, dz].sort((p, q) => q - p);
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, (uv.getX(i) * a) / metres, (uv.getY(i) * c) / metres);
  }
  uv.needsUpdate = true;
}

/**
 * LE GRAIN TRIPLANAIRE — pour ce qui n'a pas d'UV exploitables.
 *
 * Les constructions voxel sont des InstancedMesh : une géométrie unitaire,
 * mise à l'échelle par instance. Leurs UV vont de zéro à un sur chaque face
 * quelle que soit sa taille réelle — un pavé de six mètres et un cube de
 * vingt-cinq centimètres porteraient le même motif à la même taille
 * apparente. C'est pour cela que tout le belvédère restait un aplat.
 *
 * On échantillonne donc la texture SUR LA POSITION MONDE, projetée selon
 * les trois axes et mélangée par la normale : aucune UV n'est nécessaire,
 * l'échelle est physique, et rien ne s'étire — la façon habituelle de
 * texturer un terrain ou une géométrie procédurale.
 *
 * `patcherGrain(material, style, { echelle, force })` greffe cela sur
 * n'importe quel MeshStandardMaterial, en préservant un `onBeforeCompile`
 * déjà posé (le voxel en a un, pour sa couleur d'instance).
 */
/**
 * CASSER LA RÉPÉTITION D'UNE COQUE — le même remède que pour le grain des
 * voxels, mais pour une texture posée en UV et non en projection monde.
 *
 * Un mur de coque répète sa tuile tous les deux mètres. Sur les cinquante
 * mètres du belvédère, cela fait vingt-cinq copies identiques en largeur et
 * autant en hauteur : l'œil ne voit plus de la pierre, il voit un carrelage
 * de photocopies. On ajoute donc une SECONDE lecture de la même tuile, à
 * une échelle dont le rapport à la première est irrationnel (le nombre
 * d'or) et tournée d'un angle qui n'est pas un quart de tour. Deux réseaux
 * incommensurables ne se réalignent jamais.
 *
 * On n'écrit pas par-dessus l'échantillonnage de three : on module SON
 * résultat. Le chunk `map_fragment` reste le sien (donc ses corrections
 * d'espace colorimétrique, ses variantes vidéo), et le patch ne dépend que
 * de deux choses stables : l'existence de `map` et de `vMapUv`.
 *
 * Les tuiles procédurales tournent autour de 0,9 : diviser par cette
 * moyenne garde la clarté du mur inchangée — on casse le motif, on ne
 * repeint pas la salle.
 */
export function patcherRepetition(material, force = 0.45) {
  if (!material || typeof document === 'undefined') return material;
  const precedent = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    precedent?.call(material, shader, renderer);
    shader.uniforms.uRepetForce = { value: force };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uRepetForce;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        #ifdef USE_MAP
          // nombre d'or et rotation de ~33° : ni les pas ni les axes des
          // deux réseaux ne sont commensurables
          mat2 repBiais = mat2(0.8391, -0.5440, 0.5440, 0.8391);
          float repOctave = texture2D(map, repBiais * vMapUv * 1.6180339887 + 0.37).r;
          diffuseColor.rgb *= mix(1.0, repOctave / 0.9, uRepetForce);
        #endif`);
    // deux matériaux au même programme ne doivent pas se partager le cache
    material.customProgramCacheKey = () => `repet-${force}`;
  };
  material.needsUpdate = true;
  return material;
}

export function patcherGrain(material, style = 'poli',
  { echelle = 1.4, force = 0.65, relief = 0.5 } = {}) {
  // hors navigateur (les suites au nœud construisent de vrais maillages
  // voxel pour compter leurs instances), il n'y a pas de canvas : le
  // matériau part sans grain plutôt que de faire échouer le test
  const tex = typeof document === 'undefined' ? null : styleTexture(style);
  if (!tex) return material;
  // un grain se lit en continu : le NEAREST des tuiles pixel-art ferait des
  // marches d'escalier sur une surface lisse
  const doux = tex.clone();
  doux.magFilter = THREE.LinearFilter;
  doux.needsUpdate = true;

  const precedent = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    precedent?.call(material, shader, renderer);
    shader.uniforms.uGrain = { value: doux };
    shader.uniforms.uGrainEchelle = { value: echelle };
    shader.uniforms.uGrainForce = { value: force };
    shader.uniforms.uGrainRelief = { value: relief };

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>',
        '#include <common>\nvarying vec3 vGrainPos;\nvarying vec3 vGrainNrm;')
      .replace('#include <project_vertex>', `
        #ifdef USE_INSTANCING
          vec4 grainW = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
          vGrainNrm = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
        #else
          vec4 grainW = modelMatrix * vec4(transformed, 1.0);
          vGrainNrm = normalize(mat3(modelMatrix) * objectNormal);
        #endif
        vGrainPos = grainW.xyz;
        #include <project_vertex>`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uGrain;
        uniform float uGrainEchelle;
        uniform float uGrainForce;
        uniform float uGrainRelief;
        varying vec3 vGrainPos;
        varying vec3 vGrainNrm;
        // la hauteur du grain en un point du MONDE : trois projections,
        // mélangées par la normale — aucune UV, aucune couture
        // CASSER LE RÉSEAU. Une tuile répétée reste une tuile : à 38 cm de
        // période, l'œil retrouvait les mêmes pâtés alignés en damier sur
        // toute une volée de marches. C'est le problème classique de la
        // répétition de texture. Quilez tire un décalage au hasard PAR
        // TUILE et fond les tuiles voisines près des bords ; Heitz & Neyret
        // (2018), repris en hex-tiling temps réel, mélangent trois patchs
        // sur un réseau triangulaire avec un opérateur qui préserve
        // l'histogramme. Les deux sont faits pour des textures STRUCTURÉES
        // en projection simple : ici la projection est triplanaire (trois
        // lectures déjà) et le grain est un scalaire de bruit, sans
        // structure à préserver — le mélange de patchs coûterait neuf
        // lectures pour résoudre un problème qu'on n'a pas.
        //
        // On décorrèle donc les OCTAVES : la même tuile lue à deux échelles
        // dont le rapport est IRRATIONNEL (le nombre d'or), la seconde
        // tournée d'un angle qui n'est pas un quart de tour. Deux réseaux
        // dont ni les pas ni les axes ne sont commensurables ne se
        // réalignent jamais : la période visible disparaît, pour six
        // lectures au lieu de neuf.
        const float OR = 1.6180339887;
        const mat2 BIAIS = mat2(0.8391, -0.5440, 0.5440, 0.8391); // ~33°
        float deuxOctaves(vec2 q) {
          float a = texture2D(uGrain, q).r;
          float b = texture2D(uGrain, BIAIS * q * OR + 0.37).r;
          // 0,62 / 0,38 : l'octave fine détaille sans effacer la première,
          // et la moyenne reste celle de la tuile — donc la clarté aussi
          return a * 0.62 + b * 0.38;
        }
        float grainEn(vec3 p, vec3 an) {
          return deuxOctaves(p.zy / uGrainEchelle) * an.x
               + deuxOctaves(p.xz / uGrainEchelle) * an.y
               + deuxOctaves(p.xy / uGrainEchelle) * an.z;
        }`)
      // LE GRAIN EST CALCULÉ UNE FOIS, ET SERT DEUX FOIS. `color_fragment`
      // passe avant `normal_fragment_maps` dans le shader standard : on y
      // pose la hauteur et la pondération triplanaire, que le relief relit
      // plus bas. Trois lectures de texture par pixel, pas quinze.
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 grainAxes = abs(normalize(vGrainNrm));
        grainAxes /= max(1e-4, grainAxes.x + grainAxes.y + grainAxes.z);
        float grainH = grainEn(vGrainPos, grainAxes);
        // les tuiles tournent autour de 0,9 : on ramène à 1 pour que le
        // grain MODULE la couleur sans l'assombrir en moyenne
        diffuseColor.rgb *= mix(1.0, grainH / 0.9, uGrainForce);`)
      // LE RELIEF — c'est lui qu'on voit. Une modulation de couleur seule
      // reste invisible sur une masse sombre : ce qui fait qu'une marche
      // cesse d'être du plastique, c'est que la lumière rasante d'une
      // lanterne accroche sa surface. Le gradient vient des DÉRIVÉES
      // d'écran (la méthode de Mikkelsen, celle du bump de three.js) :
      // aucune lecture supplémentaire, là où quatre échantillonnages
      // décalés en coûtaient douze de plus par pixel.
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec3 dpdxG = dFdx(vGrainPos);
          vec3 dpdyG = dFdy(vGrainPos);
          float dhdxG = dFdx(grainH);
          float dhdyG = dFdy(grainH);
          vec3 nG = normalize(vGrainNrm);
          vec3 r1 = cross(dpdyG, nG);
          vec3 r2 = cross(nG, dpdxG);
          float det = dot(dpdxG, r1);
          vec3 grad = sign(det) * ((dhdxG * r1) + (dhdyG * r2));
          normal = normalize((abs(det) * normal) - (grad * uGrainRelief));
        }`)
      // LA RUGOSITÉ SUIT LE GRAIN. Le relief seul ne suffit pas : une
      // marche du belvédère bosselée mais uniformément lustrée reste du
      // plastique bosselé. Ce qui fait la pierre, c'est que le creux boit
      // la lumière et que l'arête la rend. On module donc la rugosité par
      // la MÊME hauteur déjà calculée — pas une lecture de plus — en
      // rendant les creux mats et les reliefs lisses.
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor * (1.0 + (0.9 - grainH) * 0.55), 0.04, 1.0);`);
  };
  material.customProgramCacheKey = () => `grain-${style}-${echelle}-${force}-${relief}`;
  return material;
}

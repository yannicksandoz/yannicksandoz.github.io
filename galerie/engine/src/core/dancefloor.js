/**
 * LE DANCEFLOOR — un sol de dalles lumineuses, à la manière du shader ISF.
 *
 * Le shader « dancefloor.fs » de l'auteur peint un dancefloor en
 * perspective dans une image : grille de dalles, motifs animés (damier
 * pulsant, ondulation, scintillement, balayages), écart entre dalles,
 * halo, teinte qui tourne d'une dalle à l'autre. Ici, le MÊME dallage
 * devient le sol réel d'une pièce : le plan du sol est découpé en
 * `cols × rows` dalles par ses coordonnées, et chaque dalle s'allume selon
 * les mêmes lois — mêmes noms d'entrées, mêmes formules — sans la
 * perspective (c'est la caméra du visiteur qui la fait).
 *
 * Les entrées ont la forme des entrées ISF (isf.js) : l'inspecteur les
 * montre avec les mêmes curseurs, et les liens (liens.js) les poussent
 * depuis le son d'une œuvre — « brightness suit les basses de la
 * pulsation ». Le matériau est un ShaderMaterial non éclairé : le sol EST
 * une lumière ; la fleur (bloom) de la passe de sortie lui donne son halo.
 *
 *   "floor": { "type": "dancefloor", "size": 30, "cols": 12, "rows": 12,
 *              "reglages": { "pattern_mode": 2, "hue_spread": 0.35 },
 *              "liens": [{ "entree": "brightness", "oeuvre": "pulsation", "signal": "basse" }] }
 */
import * as THREE from 'three';
import { valeursDe } from './isf.js';
import { normaliserLien, resoudreLienSuivi } from './liens.js';

/** Les entrées du dancefloor — celles du shader ISF, moins la perspective. */
export const ENTREES_DANCEFLOOR = [
  { nom: 'tile_gap', type: 'float', defaut: 0.05, min: 0, max: 0.3, etiquette: 'écart entre dalles' },
  { nom: 'pattern_mode', type: 'float', defaut: 2, min: 0, max: 6, etiquette: 'motif (0 masque, 1 damier, 2 ondes, 3 scintillement, 4–6 balayages)' },
  { nom: 'pattern_speed', type: 'float', defaut: 1, min: 0, max: 5, etiquette: 'vitesse du motif' },
  { nom: 'pattern_density', type: 'float', defaut: 0.5, min: 0, max: 1, etiquette: 'densité du motif' },
  { nom: 'pattern_mix', type: 'float', defaut: 1, min: 0, max: 1, etiquette: 'motif contre masque' },
  { nom: 'tile_color', type: 'color', defaut: [1, 0.12, 0.82, 1], etiquette: 'couleur des dalles allumées' },
  { nom: 'tile_off_color', type: 'color', defaut: [0.02, 0.02, 0.07, 1], etiquette: 'couleur des dalles éteintes' },
  { nom: 'hue_spread', type: 'float', defaut: 0.3, min: 0, max: 1, etiquette: 'étalement de teinte' },
  { nom: 'glow_strength', type: 'float', defaut: 0.4, min: 0, max: 1, etiquette: 'halo' },
  { nom: 'brightness', type: 'float', defaut: 0.85, min: 0, max: 1.5, etiquette: 'luminosité' },
  { nom: 'tiles_mask_lo', type: 'float', defaut: 0, min: 0, max: 1, etiquette: 'masque dalles 0–23' },
  { nom: 'tiles_mask_hi', type: 'float', defaut: 0, min: 0, max: 1, etiquette: 'masque dalles 24–47' },
  { nom: 'animate', type: 'bool', defaut: true, etiquette: 'animer' }
];

export const DANCEFLOOR_DEFAUTS = { size: 30, cols: 12, rows: 12 };

const VERTEX = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Le fragment : la partie « dalle » du shader de l'auteur, sans la
// projection — tileU/tileV viennent des UV du plan multipliés par la grille.
const FRAGMENT = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  uniform float TIME;
  uniform float grid_cols, grid_rows;
  uniform float tile_gap, pattern_mode, pattern_speed, pattern_density, pattern_mix;
  uniform vec4 tile_color, tile_off_color;
  uniform float hue_spread, glow_strength, brightness, tiles_mask_lo, tiles_mask_hi;
  uniform bool animate;

  vec3 hsv2rgb(vec3 c) {
    vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0);
    return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
  }
  vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-4)), d / (q.x + 1e-4), q.x);
  }
  float hash21(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 17.5);
    return fract(p.x * p.y);
  }
  float getBit(float mask, float bitIdx) {
    float bits = floor(mask * 16777215.0 + 0.5);
    return floor(mod(bits / pow(2.0, bitIdx), 2.0));
  }

  void main() {
    float t = animate ? TIME : 0.0;
    float gc = grid_cols;
    float gr = grid_rows;
    int pm = int(pattern_mode + 0.5);
    float tileU = vUv.x * gc;
    float tileV = vUv.y * gr;
    float fu = fract(tileU);
    float fv = fract(tileV);
    float fcol = mod(floor(tileU), gc);
    float frow = mod(floor(tileV), gr);
    float idx = frow * gc + fcol;

    float hg = tile_gap * 0.5;
    float inTile = smoothstep(hg, hg + 0.02, min(fu, 1.0 - fu)) *
                   smoothstep(hg, hg + 0.02, min(fv, 1.0 - fv));
    float tileDist = length(vec2(fu - 0.5, fv - 0.5)) * 2.0;
    float glowFade = exp(-max(tileDist - 0.85, 0.0) * 18.0);

    float maskBit = 0.0;
    if (idx < 24.0)      maskBit = getBit(tiles_mask_lo, idx);
    else if (idx < 48.0) maskBit = getBit(tiles_mask_hi, idx - 24.0);

    float rowFl = floor(tileV);
    float colFl = floor(tileU);
    float patternLit = 0.0;
    if (pm == 1) {
      float checker = mod(fcol + frow, 2.0) < 1.0 ? 1.0 : 0.0;
      float pulse = step(1.0 - pattern_density, 0.5 + 0.5 * sin(t * pattern_speed * 3.14159));
      patternLit = checker * pulse;
    } else if (pm == 2) {
      float dist = length(vec2(fcol - gc * 0.5, frow - gr * 0.5));
      float wave = 0.5 + 0.5 * sin(dist * 2.0 - t * pattern_speed * 5.0);
      patternLit = step(1.0 - pattern_density, wave);
    } else if (pm == 3) {
      float timeBin = floor(t * pattern_speed * 3.0);
      patternLit = step(1.0 - pattern_density, hash21(vec2(fcol, frow) + timeBin));
    } else if (pm == 4) {
      float sweep = mod(rowFl - t * pattern_speed * gr * 0.3, gr);
      patternLit = step(sweep, gr * pattern_density);
    } else if (pm == 5) {
      float sweep = mod(colFl - t * pattern_speed * gc * 0.3, gc);
      patternLit = step(sweep, gc * pattern_density);
    } else if (pm == 6) {
      float sweep = mod(colFl + rowFl - t * pattern_speed * (gc + gr) * 0.2, gc + gr);
      patternLit = step(sweep, (gc + gr) * pattern_density);
    }

    float litValue = clamp(mix(maskBit, patternLit, pattern_mix), 0.0, 1.0);
    vec3 hsv = rgb2hsv(tile_color.rgb);
    hsv.x = fract(hsv.x + fract(idx / (gc * gr)) * hue_spread);
    vec3 tileOnColor = hsv2rgb(hsv);
    vec3 offColor = tile_off_color.rgb;
    vec3 col = mix(offColor, mix(offColor, tileOnColor, litValue), inTile);
    col += tileOnColor * glowFade * glow_strength * litValue;
    col *= brightness;
    // Les couleurs du shader sont pensées à l'écran (sRGB) : on les passe en
    // linéaire pour le pipeline de three, qui les remettra en sRGB à la
    // sortie. Et l'on PLAFONNE à 1 : au-delà, la fleur (bloom) de la passe
    // de sortie transformait tout le sol en brouillard rouge — un dancefloor
    // est net, ce sont ses dalles qui brillent, pas l'air au-dessus.
    gl_FragColor = vec4(pow(clamp(col, 0.0, 1.0), vec3(2.2)), 1.0);
  }
`;

/** vec4 pour three, scalaires tels quels (comme EcranISF). */
function enveloppe(entree, valeur) {
  if (entree.type === 'color') {
    const c = Array.isArray(valeur) ? valeur : [1, 1, 1, 1];
    return new THREE.Vector4(c[0] ?? 1, c[1] ?? 1, c[2] ?? 1, c[3] ?? 1);
  }
  return entree.type === 'bool' ? Boolean(valeur) : (Number(valeur) || 0);
}

/**
 * Construit le sol : rend { group, mesh, entrees, poser, appliquer, rendre,
 * dispose }. `opt` est le `floor` du JSON (size, cols, rows, reglages).
 */
export function creerDancefloor(opt = {}) {
  const size = Number.isFinite(opt.size) && opt.size > 0 ? opt.size : DANCEFLOOR_DEFAUTS.size;
  const cols = Math.max(1, Math.round(Number(opt.cols) || DANCEFLOOR_DEFAUTS.cols));
  const rows = Math.max(1, Math.round(Number(opt.rows) || DANCEFLOOR_DEFAUTS.rows));
  const uniforms = {
    TIME: { value: 0 },
    grid_cols: { value: cols },
    grid_rows: { value: rows }
  };
  for (const e of ENTREES_DANCEFLOOR) uniforms[e.nom] = { value: enveloppe(e, e.defaut) };
  const materiau = new THREE.ShaderMaterial({ vertexShader: VERTEX, fragmentShader: FRAGMENT, uniforms });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), materiau);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = false;
  mesh.userData.ignoreRaycast = true;   // un repère, pas une cible
  const group = new THREE.Group();
  group.name = 'sol';
  group.add(mesh);

  const sol = {
    group, mesh, materiau, uniforms,
    entrees: ENTREES_DANCEFLOOR,
    cols, rows, size,
    /** Pose UNE entrée (lien, curseur de l'inspecteur). */
    poser(nom, valeur) {
      const e = ENTREES_DANCEFLOOR.find((x) => x.nom === nom);
      const u = uniforms[nom];
      if (!e || !u) return;
      const v = enveloppe(e, valeur);
      if (e.type === 'color') u.value.copy(v); else u.value = v;
    },
    /** Applique un jeu de réglages (défauts recouverts par le JSON). */
    appliquer(reglages = {}) {
      const valeurs = valeursDe(ENTREES_DANCEFLOOR, reglages);
      for (const e of ENTREES_DANCEFLOOR) sol.poser(e.nom, valeurs[e.nom]);
    },
    /** L'horloge du motif, à chaque image. */
    rendre(temps) { uniforms.TIME.value = temps % 3600; },
    /** Les liens du JSON, normalisés ; `repos` : la valeur de chaque entrée hors lien. */
    liens: (Array.isArray(opt.liens) ? opt.liens : []).map(normaliserLien).filter(Boolean),
    repos: valeursDe(ENTREES_DANCEFLOOR, opt.reglages ?? {}),
    /** L'état des enveloppes, par entrée (la course précédente). */
    etats: new Map(),
    /** Pousse les entrées liées depuis les signaux (une fois par image, `dt` en s). */
    suivre(signaux, dt = 1 / 60) {
      if (!signaux || !sol.liens.length) return;
      for (const lien of sol.liens) {
        const e = ENTREES_DANCEFLOOR.find((x) => x.nom === lien.entree);
        if (!e) continue;
        const v = resoudreLienSuivi(lien, e, signaux.valeur(lien.oeuvre, lien.signal, lien.hz), sol.repos[e.nom], sol.etats, dt);
        if (v !== null) sol.poser(e.nom, v);
      }
    },
    /** Reprend réglages et liens (l'inspecteur, en direct). */
    regler({ reglages, liens } = {}) {
      if (reglages) { sol.repos = valeursDe(ENTREES_DANCEFLOOR, reglages); sol.appliquer(reglages); }
      if (liens) sol.liens = (Array.isArray(liens) ? liens : []).map(normaliserLien).filter(Boolean);
    },
    dispose() { mesh.geometry.dispose(); materiau.dispose(); }
  };
  sol.appliquer(opt.reglages ?? {});
  return sol;
}

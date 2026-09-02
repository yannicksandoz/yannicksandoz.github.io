/**
 * ISF → three.js — le convertisseur.
 *
 * ISF (Interactive Shader Format) est le format des shaders de VJing :
 * un en-tête JSON dans un commentaire /*{ … }*​/ qui déclare les ENTRÉES
 * (curseurs, couleurs, cases), puis un fragment GLSL qui parle quelques
 * conventions — `TIME`, `RENDERSIZE`, `isf_FragNormCoord`. L'auteur écrit
 * ses shaders dans les outils qu'il connaît déjà ; la galerie les lit
 * tels quels, sans réécriture.
 *
 * Ce module est la PART PURE : du texte vers du texte. Il extrait
 * l'en-tête, transforme chaque entrée en uniform, enveloppe le fragment
 * pour `ShaderMaterial`, et dit honnêtement ce qu'il ne sait pas faire
 * (multi-passes, images en entrée). Ni Three.js, ni DOM : il se teste au
 * nœud, sur les vrais shaders du dépôt.
 *
 * Périmètre v1 — les GÉNÉRATEURS mono-passe : pas de PASSES multiples,
 * pas d'IMPORTED, pas d'entrée image/audio. C'est le cas des trois
 * shaders de l'auteur (cat, dog, dancefloor), et de l'immense majorité
 * des générateurs ISF.
 */

/** Types d'entrée ISF que l'on sait poser en uniform. */
const TYPES_UNIFORMS = {
  float: 'float',
  long: 'float',      // les menus ISF sont des entiers : un float suffit
  bool: 'bool',
  color: 'vec4',
  point2D: 'vec2'
};

/**
 * L'en-tête JSON et le corps GLSL, séparés.
 * Rend null si la source ne ressemble pas à un ISF (pas d'en-tête).
 */
export function extraireISF(source) {
  const texte = String(source ?? '');
  const m = texte.match(/\/\*\s*({[\s\S]*?})\s*\*\//);
  if (!m) return null;
  let meta;
  try { meta = JSON.parse(m[1]); } catch { return null; }
  if (!meta || typeof meta !== 'object') return null;
  return { meta, corps: texte.slice(m.index + m[0].length) };
}

/**
 * Ce que la v1 ne sait pas faire, dit AVANT d'essayer : une liste de
 * problèmes en clair (vide = convertible). L'éditeur l'affiche tel quel.
 */
export function validerISF(meta) {
  const problemes = [];
  if (!meta) { problemes.push('en-tête ISF introuvable'); return problemes; }
  if (Array.isArray(meta.PASSES) && meta.PASSES.length > 1) {
    problemes.push(`${meta.PASSES.length} passes — seul le mono-passe est géré`);
  }
  if (Array.isArray(meta.IMPORTED) && meta.IMPORTED.length) {
    problemes.push('textures importées (IMPORTED) non gérées');
  }
  for (const e of meta.INPUTS ?? []) {
    if (!TYPES_UNIFORMS[e?.TYPE] && e?.TYPE !== 'event') {
      problemes.push(`entrée « ${e?.NAME ?? '?'} » de type ${e?.TYPE ?? '?'} non gérée`);
    }
  }
  return problemes;
}

/**
 * Les entrées de l'en-tête, normalisées pour l'éditeur et le moteur :
 * { nom, type, defaut, min, max, etiquette }. Les types `event` sont
 * ignorés (un bouton-poussoir n'a pas de sens dans une œuvre posée).
 */
export function entreesDe(meta) {
  const entrees = [];
  for (const e of meta?.INPUTS ?? []) {
    const type = TYPES_UNIFORMS[e?.TYPE];
    if (!type || !e.NAME) continue;
    const defaut = e.DEFAULT ?? (
      e.TYPE === 'bool' ? false
        : e.TYPE === 'color' ? [1, 1, 1, 1]
          : e.TYPE === 'point2D' ? [0, 0] : 0);
    entrees.push({
      nom: String(e.NAME),
      type: e.TYPE === 'long' ? 'float' : e.TYPE,
      glsl: type,
      defaut,
      min: Number.isFinite(e.MIN) ? e.MIN : undefined,
      max: Number.isFinite(e.MAX) ? e.MAX : undefined,
      etiquette: e.LABEL ?? e.NAME
    });
  }
  return entrees;
}

/** Le vertex shader de l'écran : l'UV du quad devient la coordonnée ISF. */
export const VERTEX_ISF = `
varying vec2 isf_FragNormCoord;
void main() {
  isf_FragNormCoord = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

/**
 * Le fragment enveloppé : les conventions ISF déclarées en tête (TIME,
 * RENDERSIZE, la coordonnée normalisée en varying), chaque entrée posée
 * en uniform, puis le corps de l'auteur, INTACT. `vv_FragNormCoord`
 * (ISF v1) devient un alias du varying v2.
 */
export function fragmentDe(source) {
  const isf = extraireISF(source);
  if (!isf) return null;
  const problemes = validerISF(isf.meta);
  if (problemes.length) return { problemes };
  const entrees = entreesDe(isf.meta);
  const declarations = entrees
    .map((e) => `uniform ${e.glsl} ${e.nom};`).join('\n');
  const corps = isf.corps.replace(/\bvv_FragNormCoord\b/g, 'isf_FragNormCoord');
  const fragment = `
uniform float TIME;
uniform vec2 RENDERSIZE;
varying vec2 isf_FragNormCoord;
${declarations}
${corps}`;
  return { fragment, entrees, meta: isf.meta, problemes: [] };
}

/**
 * LES CALQUES — plusieurs shaders superposés sur un même écran.
 *
 * Le premier shader peint l'écran ; chaque suivant se pose dessus avec un
 * MODE DE FONDU et une OPACITÉ, comme des calques d'image. Le mélange
 * lui-même est fait par le GPU (fonctions de fusion, voir isf-ecran.js) ;
 * ici on ne prépare que la couleur SOURCE du calque : sa `main` est
 * renommée et rappelée par une main de composition qui applique l'opacité
 * selon le mode — un fondu normal l'écrit dans l'alpha, un ajout ou un
 * écran atténuent la couleur, une multiplication tire vers le blanc (ce
 * qui, multiplié, ne change rien).
 *
 * Rend null si le fragment n'a pas de `main` reconnaissable.
 */
export const MODES_FONDU = { normal: 0, ajouter: 1, ecran: 2, multiplier: 3 };

export function envelopperCalque(fragment) {
  const texte = String(fragment ?? '');
  const renomme = texte.replace(/\bvoid\s+main\s*\(\s*(?:void)?\s*\)/, 'void isf_calque_main()');
  if (renomme === texte) return null;
  return `${renomme}
uniform float isf_opacite;
uniform int isf_mode;
void main() {
  isf_calque_main();
  vec4 c = gl_FragColor;
  if (isf_mode == 0) { c.a *= isf_opacite; }
  else if (isf_mode == 3) { c.rgb = mix(vec3(1.0), c.rgb, isf_opacite * c.a); c.a = 1.0; }
  else { c.rgb *= isf_opacite * c.a; c.a = 1.0; }
  gl_FragColor = c;
}`;
}

/**
 * Les valeurs d'uniforms de départ : les défauts de l'en-tête, recouverts
 * par les réglages de l'œuvre (JSON). Les couleurs acceptent [r,g,b] ou
 * [r,g,b,a] ; un nombre pour un bool vaut ≠ 0.
 */
export function valeursDe(entrees, reglages = {}) {
  const valeurs = {};
  for (const e of entrees) {
    let v = reglages[e.nom] ?? e.defaut;
    if (e.type === 'color') {
      const c = Array.isArray(v) ? v : [1, 1, 1, 1];
      v = [c[0] ?? 1, c[1] ?? 1, c[2] ?? 1, c[3] ?? 1];
    } else if (e.type === 'bool') {
      v = Boolean(v);
    } else if (e.type === 'point2D') {
      v = Array.isArray(v) ? [v[0] ?? 0, v[1] ?? 0] : [0, 0];
    } else {
      v = Number(v);
      if (!Number.isFinite(v)) v = Number(e.defaut) || 0;
      if (Number.isFinite(e.min)) v = Math.max(e.min, v);
      if (Number.isFinite(e.max)) v = Math.min(e.max, v);
    }
    valeurs[e.nom] = v;
  }
  return valeurs;
}

import * as THREE from 'three';
import { scaleObjetUV } from './textures.js';
import { jeuDeSurface } from './matieres.js';

/**
 * Primitives paramétriques du mode Objets.
 *
 * Elles vivent dans le cœur (et non dans l'éditeur) parce que le runtime
 * doit savoir les reconstruire depuis le JSON d'une scène publiée :
 *     "model": { "shape": "torus", "color": "#66f0d8", "size": 1.4 }
 *
 * `monolith` reste géré à part dans Artwork : c'est un shader réactif à
 * l'audio, pas une simple géométrie.
 */
export const PRIMITIVES = {
  box:      { label: 'Cube',     build: (s) => new THREE.BoxGeometry(s, s, s) },
  sphere:   { label: 'Sphère',   build: (s) => new THREE.SphereGeometry(s * 0.6, 32, 20) },
  plane:    { label: 'Plan',     build: (s) => new THREE.PlaneGeometry(s * 1.6, s) },
  cylinder: { label: 'Cylindre', build: (s) => new THREE.CylinderGeometry(s * 0.5, s * 0.5, s * 1.6, 28) },
  cone:     { label: 'Cône',     build: (s) => new THREE.ConeGeometry(s * 0.6, s * 1.6, 28) },
  torus:    { label: 'Tore',     build: (s) => new THREE.TorusGeometry(s * 0.6, s * 0.22, 18, 40) },
  eau:      { label: 'Eau',      build: (s) => new THREE.PlaneGeometry(s * 1.6, s, 48, 32) },
  // fût ouvert, plus large au pied : un puits de lumière qui tombe
  faisceau: { label: 'Faisceau', build: (s) => new THREE.CylinderGeometry(s * 0.25, s * 0.85, s * 6, 24, 1, true) },
  // la géométrie réelle (essaim de points) se construit dans buildPrimitive
  lucioles: { label: 'Lucioles', build: (s) => new THREE.BoxGeometry(s, s, s) }
};

/**
 * Horloge partagée des matériaux d'eau : UN objet uniform pour toutes les
 * étendues d'eau de la scène, avancé d'une ligne dans la boucle de l'App.
 * Ni registre, ni traverse — le coût est le même pour zéro ou cent bassins.
 */
export const WATER_TIME = { value: 0 };

/**
 * Matériau d'eau — un bassin de jardin japonais, pas un océan : une eau
 * sombre et calme, des vaguelettes procédurales qui froissent la normale
 * (deux trains d'ondes + un souffle de bruit), un fresnel qui éclaircit
 * l'eau rasante vers la teinte du ciel, et le reflet du soleil qui glisse
 * sur les rides. Tout est dans le shader : aucune texture, aucun rendu
 * supplémentaire — le reflet est suggéré, pas calculé.
 */
function buildWaterMaterial(model) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: WATER_TIME, // partagé : l'App n'avance qu'une horloge
      uDeep: { value: new THREE.Color(model.color ?? '#16324a') },
      uSkyTint: { value: new THREE.Color(model.skyTint ?? '#8fb6de') },
      uSunDir: { value: new THREE.Vector3(0.47, 0.79, -0.40).normalize() },
      uRipple: { value: Number.isFinite(model.ripple) ? model.ripple : 1 }
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      varying vec3 vNormalW;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        vNormalW = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uDeep, uSkyTint, uSunDir;
      uniform float uTime, uRipple;
      varying vec3 vWorld;
      varying vec3 vNormalW;

      // hash SANS sin(x·43758) : sur les GPU Apple (Metal), sin perd toute
      // précision au-delà de ~10^4 et le motif dégénère — celui-ci n'emploie
      // que fract et dot, il est stable partout.
      float hash(vec2 p) {
        vec3 q = fract(vec3(p.xyx) * 0.1031);
        q += dot(q, q.yzx + 33.33);
        return fract((q.x + q.y) * q.z);
      }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
                   mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
      }

      void main() {
        float t = uTime;
        vec2 p = vWorld.xz;
        // deux trains d'ondes croisés + un froissement de bruit
        float h = sin(p.x * 2.1 + t * 0.9) * 0.5
                + sin(dot(p, vec2(1.3, 1.7)) + t * 0.6) * 0.35
                + (noise(p * 1.4 + t * 0.12) - 0.5) * 0.9;
        float hx = cos(p.x * 2.1 + t * 0.9) * 1.05
                 + cos(dot(p, vec2(1.3, 1.7)) + t * 0.6) * 0.45;
        float hz = cos(dot(p, vec2(1.3, 1.7)) + t * 0.6) * 0.6;
        vec3 n = normalize(vNormalW + vec3(hx, 0.0, hz) * 0.045 * uRipple);

        vec3 view = normalize(cameraPosition - vWorld);
        // fresnel : l'eau vue de haut est profonde, rasante elle prend le
        // ciel. Cubique EXPLICITE, pas pow() : dot(view, n) dépasse 1.0
        // d'un chouia en flottant quand on regarde l'eau à l'aplomb, la
        // base devient négative et pow() est indéfini en GLSL — NaN, donc
        // noir, sur Metal (le bassin vu du dessus devenait un bloc noir).
        float fc = clamp(1.0 - dot(view, n), 0.0, 1.0);
        float fres = fc * fc * fc;
        vec3 col = mix(uDeep, uSkyTint, 0.15 + fres * 0.7);
        // le soleil glisse sur les rides (base clampée dans [0,1] : sûre)
        vec3 refl = reflect(-view, n);
        float sun = pow(clamp(dot(refl, uSunDir), 0.0, 1.0), 140.0);
        col += vec3(1.0, 0.95, 0.85) * sun * 0.9;
        // profondeur qui respire à peine avec la houle
        col *= 1.0 + h * 0.03;
        gl_FragColor = vec4(col, 1.0);
      }`
  });
}

export function isPrimitive(shape) {
  return Object.hasOwn(PRIMITIVES, shape);
}

/**
 * Construit le mesh d'une primitive depuis `config.model`.
 *
 * `echelle` est l'échelle que l'ŒUVRE applique ensuite à son groupe
 * (`config.scale`). Elle compte : un rayonnage est une boîte d'un mètre et
 * demi étirée à 0,5 × 3,2 × 3,6, et sans elle le motif du bois serait posé
 * à l'échelle de la boîte d'origine puis étiré sept fois en hauteur. On la
 * reçoit ici pour poser les UV à la taille FINALE de l'objet.
 */
export function buildPrimitive(model, echelle = null) {
  const def = PRIMITIVES[model.shape];
  if (!def) return null;
  const size = Number.isFinite(model.size) ? model.size : 1.5;

  if (model.shape === 'eau') {
    const mesh = new THREE.Mesh(def.build(size), buildWaterMaterial(model));
    mesh.rotation.x = -Math.PI / 2; // une étendue d'eau est horizontale
    return mesh;
  }
  if (model.shape === 'faisceau') return buildFaisceau(def, size, model);
  if (model.shape === 'lucioles') return buildLucioles(size, model);

  return finishPrimitive(def, size, model, echelle);
}

/**
 * Faisceau de lumière volumétrique — un puits de lumière suggéré, pas
 * calculé : un fût conique additif dont l'intensité est pleine quand le
 * regard TRAVERSE le volume (fresnel inversé) et s'évanouit sur la
 * tranche, avec un fondu vers le pied et une lente respiration. Aucune
 * vraie volumétrie, aucun coût : deux passes de triangles transparents.
 * `emissive` règle la force, `color` la teinte.
 */
function buildFaisceau(def, size, model) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: WATER_TIME,
      uColor: { value: new THREE.Color(model.color ?? '#cbb4ff') },
      uForce: { value: model.emissive ?? 0.4 },
      uHauteur: { value: size * 6 }
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      uniform float uHauteur;
      varying float vHaut;   // 0 au pied, 1 au sommet
      varying vec3 vN, vVue;
      void main() {
        vHaut = clamp(position.y / uHauteur + 0.5, 0.0, 1.0);
        vN = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vVue = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uForce, uTime;
      varying float vHaut;
      varying vec3 vN, vVue;
      void main() {
        // plein au cœur du fût, évanoui sur la tranche
        float coeur = pow(abs(dot(normalize(vN), normalize(vVue))), 1.6);
        // le pied se dissout, le sommet reste franc
        float fondu = smoothstep(0.0, 0.45, vHaut);
        float vie = 1.0 + 0.08 * sin(uTime * 0.55 + vHaut * 5.0);
        gl_FragColor = vec4(uColor, coeur * fondu * uForce * vie);
      }`
  });
  const mesh = new THREE.Mesh(def.build(size), mat);
  mesh.raycast = () => {};          // de la lumière : jamais une cible
  mesh.userData.sansOmbre = true;   // …et jamais un cône d'ombre
  return mesh;
}

/**
 * Lucioles — un essaim de points dorés à dérive lente. Tout le mouvement
 * vit dans le shader (trois sinus déphasés par luciole) : zéro CPU, et
 * l'horloge partagée s'arrête d'elle-même en mouvement réduit. La graine
 * est déterministe : le même essaim à chaque visite.
 * `count`, `seed`, `color`, `emissive` (éclat) se règlent au modèle ;
 * `size` donne le côté du volume de vol.
 */
function buildLucioles(size, model) {
  const n = Math.max(1, Math.round(model.count ?? 36));
  let graine = ((model.seed ?? 7) >>> 0) || 7;
  const rand = () => {
    graine = (graine * 1664525 + 1013904223) >>> 0;
    return graine / 4294967296;
  };
  const pos = new Float32Array(n * 3);
  const phase = new Float32Array(n);
  const vitesse = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    pos[3 * i] = (rand() - 0.5) * size;
    pos[3 * i + 1] = (rand() - 0.5) * size;
    pos[3 * i + 2] = (rand() - 0.5) * size;
    phase[i] = rand() * Math.PI * 2;
    vitesse[i] = 0.35 + rand() * 0.75;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  geo.setAttribute('aVitesse', new THREE.BufferAttribute(vitesse, 1));
  // l'essaim déborde de ses positions de repos : la boîte de culling suit
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), size * 0.9 + 1.6);

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: WATER_TIME,
      uColor: { value: new THREE.Color(model.color ?? '#ffd97a') },
      uEclat: { value: model.emissive ?? 0.8 },
      uTaille: { value: model.dotSize ?? 0.14 }
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      uniform float uTime, uTaille;
      attribute float aPhase, aVitesse;
      varying float vVie;
      void main() {
        float t = uTime * aVitesse + aPhase;
        vec3 p = position
          + vec3(sin(t * 0.90), sin(t * 0.63 + 1.7), sin(t * 0.77 + 3.4)) * 0.9;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vVie = 0.45 + 0.55 * (0.5 + 0.5 * sin(t * 1.9)); // clignotement doux
        gl_PointSize = uTaille * 420.0 / max(1.0, -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uEclat;
      varying float vVie;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float lum = smoothstep(1.0, 0.0, length(c) * 2.0);
        gl_FragColor = vec4(uColor, lum * lum * vVie * uEclat);
      }`
  });
  const points = new THREE.Points(geo, mat);
  points.raycast = () => {};
  return points;
}

/**
 * LA SURFACE D'UNE PRIMITIVE — là où le plastique disparaît.
 *
 * Une primitive n'avait qu'une couleur, une rugosité fixe et, au mieux, un
 * albédo pixel-art étiré sur tout l'objet. D'où l'aplat de plastique des
 * bancs, des lanternes, des stèles et de toutes les marches du belvédère,
 * juste à côté de murs qui, eux, avaient du grain. Trois changements :
 *
 *   • le style passe par `jeuDeSurface` — le MÊME robinet que le sol et les
 *     murs : relief, rugosité et métal viennent avec l'albédo, et une
 *     matière photographique (bois, damier…) est acceptée là aussi ;
 *
 *   • les UV sont mis à l'ÉCHELLE DU MONDE (`scaleObjetUV`). Les UV d'une
 *     boîte vont de zéro à un quelle que soit sa taille : les briques d'une
 *     stèle de quatre mètres étaient donc quatre fois plus grosses que
 *     celles du mur derrière. Désormais un motif garde sa taille physique,
 *     et deux objets voisins parlent la même langue ;
 *
 *   • sans style déclaré, la primitive reçoit tout de même un grain fin —
 *     `poli`, très doux et sans direction. Quatre-vingts objets de la
 *     galerie n'ont aucune texture dans leur JSON : leur donner un aplat
 *     parfait, c'est précisément ce qui les faisait lire comme du plastique.
 *     `"texture": "aucune"` rend l'aplat à qui le veut.
 */
function finishPrimitive(def, size, model, echelleObjet = null) {
  const style = model.texture === 'aucune' ? null : (model.texture ?? 'poli');
  const serrage = Number.isFinite(model.textureRepeat) && model.textureRepeat > 0
    ? model.textureRepeat : 1;
  const jeu = jeuDeSurface(style, serrage);
  const geometry = def.build(size);
  if (jeu) scaleObjetUV(geometry, jeu.metres, echelleObjet);

  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(model.color ?? '#8a7cff'),
    map: jeu?.map ?? null,
    bumpMap: jeu?.bumpMap ?? null,
    bumpScale: jeu?.bumpScale ?? 1,
    normalMap: jeu?.normalMap ?? null,
    normalScale: jeu?.normalScale
      ? new THREE.Vector2(jeu.normalScale, jeu.normalScale) : undefined,
    roughnessMap: jeu?.roughnessMap ?? null,
    // le JSON garde le dernier mot : une œuvre qui a réglé sa rugosité ne
    // doit pas changer d'aspect parce que le moteur a appris les surfaces
    roughness: model.roughness ?? jeu?.roughness ?? 0.5,
    metalness: model.metalness ?? jeu?.metalness ?? 0.15,
    // L'émission peut différer de la couleur du corps : une lanterne a une
    // paroi sombre et une lueur claire — les confondre donnait un objet
    // uniformément blanc, qui fleurissait dans le bloom.
    emissive: new THREE.Color(model.emissiveColor ?? model.color ?? '#8a7cff'),
    emissiveIntensity: model.emissive ?? 0.18,
    side: model.shape === 'plane' ? THREE.DoubleSide : THREE.FrontSide
  });
  // la texture teinte aussi l'émission, sinon la lueur gomme les sillons
  if (jeu?.map) material.emissiveMap = jeu.map;
  return new THREE.Mesh(geometry, material);
}

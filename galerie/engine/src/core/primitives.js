import * as THREE from 'three';
import { styleTexture } from './textures.js';

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
  eau:      { label: 'Eau',      build: (s) => new THREE.PlaneGeometry(s * 1.6, s, 48, 32) }
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

/** Construit le mesh d'une primitive depuis `config.model`. */
export function buildPrimitive(model) {
  const def = PRIMITIVES[model.shape];
  if (!def) return null;
  const size = Number.isFinite(model.size) ? model.size : 1.5;

  if (model.shape === 'eau') {
    const mesh = new THREE.Mesh(def.build(size), buildWaterMaterial(model));
    mesh.rotation.x = -Math.PI / 2; // une étendue d'eau est horizontale
    return mesh;
  }

  // texture pixel-art optionnelle (« texture »: ratisse, planches…) — en
  // niveaux de gris, teintée par la couleur de la primitive. `textureRepeat`
  // règle combien de fois la tuile couvre l'objet (défaut : 1).
  const map = styleTexture(model.texture);
  if (map && Number.isFinite(model.textureRepeat) && model.textureRepeat !== 1) {
    // répétition propre à l'objet : clone léger (l'image GPU est partagée
    // par style, seule la matrice UV diffère)
    const clone = map.clone();
    clone.repeat.set(model.textureRepeat, model.textureRepeat);
    clone.needsUpdate = true;
    return finishPrimitive(def, size, model, clone);
  }
  return finishPrimitive(def, size, model, map);
}

function finishPrimitive(def, size, model, map) {
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(model.color ?? '#8a7cff'),
    map: map ?? null,
    roughness: model.roughness ?? 0.5,
    metalness: model.metalness ?? 0.15,
    emissive: new THREE.Color(model.color ?? '#8a7cff'),
    emissiveIntensity: model.emissive ?? 0.18,
    side: model.shape === 'plane' ? THREE.DoubleSide : THREE.FrontSide
  });
  // la texture teinte aussi l'émission, sinon la lueur gomme les sillons
  if (map) material.emissiveMap = map;
  return new THREE.Mesh(def.build(size), material);
}

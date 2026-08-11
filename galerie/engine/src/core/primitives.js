import * as THREE from 'three';

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
  torus:    { label: 'Tore',     build: (s) => new THREE.TorusGeometry(s * 0.6, s * 0.22, 18, 40) }
};

export function isPrimitive(shape) {
  return Object.hasOwn(PRIMITIVES, shape);
}

/** Construit le mesh d'une primitive depuis `config.model`. */
export function buildPrimitive(model) {
  const def = PRIMITIVES[model.shape];
  if (!def) return null;
  const size = Number.isFinite(model.size) ? model.size : 1.5;
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(model.color ?? '#8a7cff'),
    roughness: model.roughness ?? 0.5,
    metalness: model.metalness ?? 0.15,
    emissive: new THREE.Color(model.color ?? '#8a7cff'),
    emissiveIntensity: model.emissive ?? 0.18,
    side: model.shape === 'plane' ? THREE.DoubleSide : THREE.FrontSide
  });
  return new THREE.Mesh(def.build(size), material);
}

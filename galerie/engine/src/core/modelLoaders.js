import * as THREE from 'three';
import { reessayer } from './utils.js';

/**
 * Chargement de modèles 3D (GLB / glTF / OBJ), en import dynamique.
 *
 * Aucun de ces chargeurs n'entre dans le bundle tant qu'aucune œuvre
 * n'utilise de modèle : ils sont demandés à la première utilisation.
 *
 * **Résolution des fichiers annexes** — un .obj référence un .mtl, qui
 * référence des textures, par simple nom de fichier. Déposés dans le
 * navigateur, ces fichiers n'ont pas de dossier : leurs URL sont des blobs
 * opaques. Un `setURLModifier` sur le LoadingManager rétablit le lien en
 * traduisant « bois.jpg » vers le blob du fichier déposé sous ce nom.
 */

const loaders = {};

/** Table nom de fichier → URL blob, alimentée par l'import de l'éditeur. */
const sidecars = new Map();

/** Enregistre un fichier annexe (texture, .mtl) accessible par son nom. */
export function registerSidecar(fileName, url) {
  sidecars.set(fileName.toLowerCase(), url);
}

function makeManager() {
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => {
    // les URL absolues et les blobs passent tels quels
    if (/^(blob:|data:|https?:)/.test(url)) return url;
    const name = url.split('/').pop().toLowerCase();
    return sidecars.get(name) ?? url;
  });
  return manager;
}

async function getLoader(kind) {
  if (loaders[kind]) return loaders[kind];
  const manager = makeManager();
  if (kind === 'gltf') {
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    loaders.gltf = new GLTFLoader(manager);
  } else if (kind === 'obj') {
    const { OBJLoader } = await import('three/addons/loaders/OBJLoader.js');
    loaders.obj = new OBJLoader(manager);
  } else if (kind === 'mtl') {
    const { MTLLoader } = await import('three/addons/loaders/MTLLoader.js');
    loaders.mtl = new MTLLoader(manager);
  }
  return loaders[kind];
}

/** Déduit le type de modèle d'un nom de fichier ou d'une URL. */
export function modelKind(name) {
  if (/\.(glb|gltf)(\?|#|$)/i.test(name)) return 'gltf';
  if (/\.obj(\?|#|$)/i.test(name)) return 'obj';
  return null;
}

/**
 * Charge un modèle et renvoie { object3d, animations, triangles }.
 * `mtlUrl` est optionnel et ne concerne que les .obj.
 */
export async function loadModel(url, { kind, mtlUrl } = {}) {
  const type = kind ?? modelKind(url);
  if (!type) throw new Error(`Format de modèle non reconnu : ${url}`);

  let object3d;
  let animations = [];

  // Le réseau d'un téléphone a des creux : on réessaie plutôt que de
  // condamner l'œuvre pour toute la visite (voir utils.reessayer).
  const prevenir = (erreur, essai) => console.warn(
    `[galerie] Modèle « ${url} » : tentative ${essai} échouée, on réessaie —`, erreur);

  if (type === 'gltf') {
    const loader = await getLoader('gltf');
    const gltf = await reessayer(() => loader.loadAsync(url), { surEchec: prevenir });
    object3d = gltf.scene;
    animations = gltf.animations ?? [];
  } else {
    const loader = await getLoader('obj');
    if (mtlUrl) {
      // un .mtl manquant ou illisible ne doit pas empêcher la géométrie de
      // s'afficher : on retombe sur le matériau par défaut
      try {
        const mtlLoader = await getLoader('mtl');
        const materials = await mtlLoader.loadAsync(mtlUrl);
        materials.preload();
        loader.setMaterials(materials);
      } catch (err) {
        console.warn(`[galerie] Matériaux OBJ ignorés (${mtlUrl}) :`, err);
      }
    }
    object3d = await reessayer(() => loader.loadAsync(url), { surEchec: prevenir });
  }

  return { object3d, animations, triangles: countTriangles(object3d) };
}

/** Nombre de triangles, pour avertir avant qu'une scène ne devienne lourde. */
export function countTriangles(object3d) {
  let n = 0;
  object3d.traverse((o) => {
    const g = o.geometry;
    if (!g) return;
    n += g.index ? g.index.count / 3 : (g.attributes.position?.count ?? 0) / 3;
  });
  return Math.round(n);
}

/**
 * Ramène un modèle à une taille exploitable et le pose sur son origine.
 *
 * Sans cela, un modèle importé apparaît soit invisible soit gigantesque
 * selon l'unité de son auteur (mètre, centimètre, pouce…). On normalise
 * donc sa plus grande dimension à `target` mètres, et on centre
 * horizontalement en gardant la base au sol.
 */
export function fitModel(object3d, target = 2) {
  const box = new THREE.Box3().setFromObject(object3d);
  if (box.isEmpty()) return 1;
  const size = box.getSize(new THREE.Vector3());
  const largest = Math.max(size.x, size.y, size.z);
  const k = largest > 0 ? target / largest : 1;
  object3d.scale.multiplyScalar(k);

  const box2 = new THREE.Box3().setFromObject(object3d);
  const center = box2.getCenter(new THREE.Vector3());
  object3d.position.x -= center.x;
  object3d.position.z -= center.z;
  object3d.position.y -= box2.min.y; // pose la base à y = 0 du groupe
  return k;
}

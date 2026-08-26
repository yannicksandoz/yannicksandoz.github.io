/**
 * LES SCANS — le splatting gaussien comme type d'œuvre.
 *
 * Rendu par **GaussianSplats3D** de Mark Kellogg (© 2023, licence MIT —
 * https://github.com/mkkellogg/GaussianSplats3D), installé par `npm`. Un
 * « scan » est une capture volumétrique — Polycam, Luma, ou la sortie d'un
 * entraînement 3D Gaussian Splatting — posée dans une salle comme n'importe
 * quelle œuvre : des dizaines de milliers de taches ellipsoïdales, triées
 * par profondeur à chaque déplacement, qui rendent un LIEU photoréel là où
 * un maillage rendrait un objet. Pour une galerie d'art sonore, c'est la
 * possibilité d'exposer l'endroit où un son a été enregistré.
 *
 * Dans le JSON d'une œuvre :   "scan": "assets/scans/capture.splat"
 * (formats acceptés : .splat, .ksplat, .ply de 3DGS)
 *
 * DEUX CHOIX QUI NE SE VOIENT PAS, et qu'il faut connaître :
 *
 *   • `sharedMemoryForWorkers: false` — le tri des taches passe par un
 *     worker, et la voie rapide (SharedArrayBuffer) exige des en-têtes
 *     d'isolation (COOP/COEP) que GitHub Pages N'ENVOIE PAS. Sans ce
 *     drapeau, la galerie publiée afficherait une console rouge et aucun
 *     scan. La voie par messages suffit largement à nos tailles ;
 *
 *   • ce module est importé DYNAMIQUEMENT par Artwork : la bibliothèque
 *     (~600 ko) vit dans son propre morceau, téléchargé à la première
 *     œuvre « scan » rencontrée — une galerie sans scan ne la charge
 *     jamais, comme le BVH des rayons.
 *
 * Le sélecteur d'œuvres ne sait pas piquer une tache gaussienne : chaque
 * scan porte un PAVÉ DE PRÉHENSION invisible (`scanTaille`, en mètres),
 * qui reçoit les clics et donne prise au gizmo de l'éditeur.
 */
import * as THREE from 'three';
import { DropInViewer } from '@mkkellogg/gaussian-splats-3d';

/**
 * Charge un scan : rend un groupe { visionneuse, pavé de préhension }.
 *
 * `options` : { taille: [x, y, z] } — le pavé de préhension (défaut 2×2×2,
 * centré sur l'origine du scan).
 */
export async function creerScan(url, options = {}) {
  const groupe = new THREE.Group();
  groupe.name = 'scan';

  const visionneuse = new DropInViewer({
    sharedMemoryForWorkers: false,
    gpuAcceleratedSort: false,
    freeIntermediateSplatData: true
  });
  await visionneuse.addSplatScene(url, {
    showLoadingUI: false,
    splatAlphaRemovalThreshold: 5
  });
  // AUCUNE OMBRE PORTÉE. Une tache gaussienne n'a pas de silhouette : le
  // nuage est dessiné par un shader qui déplie un quad par tache, et la
  // passe d'ombre, elle, ne connaît que l'attribut `position` — les 21 000
  // instances s'y écrasent toutes sur le même carré de 2 m à l'origine du
  // maillage, qui projette une ombre carrée là où il n'y a rien. Les scans
  // s'excluent donc du calcul (voir `_setMesh`, qui respecte `sansOmbre`).
  visionneuse.traverse((o) => { o.userData.sansOmbre = true; });
  groupe.add(visionneuse);

  // le pavé de préhension : invisible à l'image, plein pour les rayons
  const taille = Array.isArray(options.taille) && options.taille.length === 3
    ? options.taille : [2, 2, 2];
  const prise = new THREE.Mesh(
    new THREE.BoxGeometry(...taille),
    new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false })
  );
  prise.name = 'prise-scan';
  // invisible à l'image ET à la lumière : sans cela, le pavé de préhension
  // projetait au sol l'ombre franche d'une boîte que personne ne voit.
  prise.userData.sansOmbre = true;
  groupe.add(prise);
  groupe.userData.priseScan = prise;

  return groupe;
}

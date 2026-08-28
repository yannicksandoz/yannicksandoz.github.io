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
 * POURQUOI UN SCAN QUI RATE ÉTAIT MUET — la panne sous la panne. Pendant
 * trois diagnostics, un scan en échec ne disait rien et ne rendait jamais la
 * main. La cause n'est pas dans le rendu mais dans deux défauts d'API de la
 * bibliothèque, dont la CONJONCTION efface toute trace : `AbortablePromise`
 * n'est pas une promesse et perd le gestionnaire d'échec de tout `await`
 * (l'attente ne se règle donc jamais), pendant que `Viewer.updateError`
 * remplace la cause par un message générique. Les deux sont ceinturés plus
 * bas, à l'appel, avec le détail ; `test-scans.mjs` surveille les deux
 * défauts chez l'amont et rougira le jour où ils seront corrigés.
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
import { poserContournementScan } from './scan-memoire.js';
import { poserContournementLongueur } from './scan-longueur.js';

/**
 * Charge un scan : rend un groupe { visionneuse, pavé de préhension }.
 *
 * `options` : { taille: [x, y, z] } — le pavé de préhension (défaut 2×2×2,
 * centré sur l'origine du scan).
 */
export async function creerScan(url, options = {}) {
  const groupe = new THREE.Group();
  groupe.name = 'scan';

  // Hors contexte isolé, le worker de tri alloue une mémoire WASM partagée
  // que Firefox et Safari refusent — et le nuage reste invisible sans le
  // moindre message. Voir `scan-memoire.js` : le contournement ne vit que
  // le temps de faire naître ce worker.
  const { retirer, applique } = poserContournementScan(globalThis, (message) => {
    // Le tri meurt DANS son worker, longtemps après que `creerScan` a rendu
    // la main : sans ce relais, l'œuvre resterait invisible et muette.
    console.error(`[galerie] Scan « ${url} » : le worker de tri est mort `
      + `(${message}). Les taches ne seront pas dessinées.`);
  });
  // La bibliothèque dimensionne son tampon d'après `Content-Length`, qui
  // compte les octets COMPRESSÉS : servi par GitHub Pages, le scan
  // débordait le tampon et disparaissait. Voir `scan-longueur.js` — c'est
  // la panne qui rendait le local trompeur, puisqu'un serveur de
  // développement ne compresse pas.
  const longueur = poserContournementLongueur(globalThis,
    (adresse) => adresse.includes(url));
  let visionneuse;
  try {
    visionneuse = new DropInViewer({
      sharedMemoryForWorkers: false,
      // Sans SIMD : la variante non partagée AVEC SIMD exigerait Safari
      // 16.4+, et trier vingt mille taches sans SIMD coûte moins d'une
      // milliseconde — la portabilité vaut plus que cette milliseconde.
      enableSIMDInSort: false,
      gpuAcceleratedSort: false,
      freeIntermediateSplatData: true
    });
    // DEUX PIÈGES DE LA BIBLIOTHÈQUE, ET C'EST LEUR CONJONCTION QUI REND LA
    // PANNE MUETTE. Ils ont coûté trois diagnostics faux ; ils sont désarmés
    // ici, en quatre lignes, et `test-scans.mjs` surveille les deux.
    //
    // 1. `AbortablePromise` n'est PAS une promesse. Son `then` ne prend
    //    qu'un seul paramètre — `then(onResolve)` — et jette silencieusement
    //    le second. Or `await p` appelle `p.then(succès, échec)` : le gestion-
    //    naire d'échec part à la poubelle, la promesse attendue ne se règle
    //    JAMAIS en cas d'erreur, et le rejet ressort en « unhandled
    //    rejection » sans propriétaire. Un scan qui échoue laissait donc
    //    `creerScan` suspendue pour toujours : ni œuvre, ni message. On
    //    attend la vraie promesse qu'elle enveloppe (`.promise`), qui, elle,
    //    se règle dans les deux sens.
    //
    // 2. `Viewer.updateError` JETTE la cause : quoi qu'il soit arrivé, elle
    //    rend `new Error('Viewer::addSplatScene -> Could not load file …')`.
    //    On la ceinture pour rattacher l'erreur d'origine — sans quoi on
    //    diagnostique à l'aveugle, ce qui est exactement ce qui s'est passé.
    const majErreur = visionneuse.viewer.updateError.bind(visionneuse.viewer);
    visionneuse.viewer.updateError = (erreur, secours) => {
      const remise = majErreur(erreur, secours);
      if (remise !== erreur && erreur) {
        remise.message += ` — cause : ${erreur?.message ?? erreur}`;
        remise.cause = erreur;
      }
      return remise;
    };
    const chargement = visionneuse.addSplatScene(url, {
      showLoadingUI: false,
      splatAlphaRemovalThreshold: 5
    });
    await (chargement?.promise ?? chargement);
  } finally {
    retirer();
    longueur.retirer();
  }
  if (!applique()) {
    // Le trieur est passé sans être réécrit : le motif de `scan-memoire.js`
    // ne reconnaît plus le source (nouveau minifieur ? bibliothèque mise à
    // jour ?). On le CRIE — la dernière fois, cette régression fut muette.
    console.warn('[galerie] Scan : le contournement mémoire n\'a pas trouvé '
      + 'le worker de tri — les scans risquent d\'être invisibles sur '
      + 'Firefox et Safari. Voir engine/src/core/scan-memoire.js.');
  }
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

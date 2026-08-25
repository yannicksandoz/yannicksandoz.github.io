/**
 * LES RAYONS — un arbre de volumes englobants, mais SEULEMENT S'IL SERT.
 *
 * D'après **three-mesh-bvh** de Garrett Johnson (© 2018, licence MIT —
 * https://github.com/gkjohnson/three-mesh-bvh), installé par `npm` et chargé
 * À LA DEMANDE.
 *
 * CE QU'ON A MESURÉ AVANT D'ÉCRIRE CE MODULE, et qui a tout décidé.
 *
 * Le `Raycaster` de three essaie chaque triangle de chaque cible, et la
 * marche en tire jusqu'à SEPT par frame : un pour le suivi de sol, trois
 * pour la collision (le pas, puis le glissement en X, puis en Z), trois pour
 * l'anti-chute qui sonde le vide devant chacun. On s'attendait à ce que le
 * belvédère — cinquante mètres, quatre-vingt-quatre objets — en souffre.
 *
 * Relevé au navigateur, la passe de collision complète y coûte **0,192 ms**,
 * soit un centième d'une frame à soixante images par seconde. Et surtout :
 * les cinquante-huit cibles totalisent **676 triangles**, et LA PLUS GROSSE
 * EN FAIT DOUZE. Le labyrinthe n'est pas fait de masses lourdes mais d'une
 * multitude de pavés. Il n'y a donc rien à accélérer : le coût est celui du
 * NOMBRE D'OBJETS, pas du nombre de triangles, et un arbre par géométrie
 * n'y peut rien. (Jardin : 0,012 ms. Labo : 0,062 ms.)
 *
 * Empaqueter la bibliothèque quand même coûtait 63 ko — 20 ko compressés —
 * pour ne rien faire. C'était le vrai choix : shipper vingt kilo-octets
 * morts, ou renoncer à une protection qui deviendra utile le jour où
 * quelqu'un posera un modèle importé de deux cent mille triangles et le
 * déclarera plein. On ne fait ni l'un ni l'autre : la bibliothèque est
 * chargée par `import()` DYNAMIQUE, dans son propre morceau, et ce morceau
 * n'est jamais demandé tant qu'aucune cible ne dépasse le seuil. La galerie
 * d'aujourd'hui ne le télécharge pas ; celle qui en aura besoin le fera
 * toute seule.
 *
 * TROIS CHOSES À SAVOIR SI L'ON Y TOUCHE.
 *
 * 1. **`firstHitOnly` est légitime ICI, et pas partout.** Il fait s'arrêter
 *    la descente de l'arbre au premier triangle touché. Nos trois rayons de
 *    marche ne lisent que le plus proche (`[0]`) ou une simple présence
 *    (`.length > 0`). Le poser sur le rayon de SÉLECTION d'`App.pickAt`,
 *    qui doit traverser les vitres pour trouver l'œuvre derrière, serait un
 *    contresens. Sans la bibliothèque, la propriété est ignorée : trois lit
 *    seulement ce qu'il connaît.
 *
 * 2. **Les masses instanciées marchent, et c'est le meilleur gain.** On
 *    pourrait croire qu'un `InstancedMesh` échappe à l'arbre puisqu'il a son
 *    propre `raycast`. C'est l'inverse : three y fabrique un `Mesh` interne
 *    auquel il donne la matrice de CHAQUE instance, puis appelle son
 *    `raycast` — donc le nôtre, avec la bonne matrice. Vérifié dans la
 *    source de r166 et éprouvé dans `test-rayons.mjs`, parce qu'un résultat
 *    juste par accident redeviendrait faux au premier `npm update`.
 *
 * 3. **Bâtir un arbre RÉORDONNE l'index de la géométrie.** C'est ainsi qu'un
 *    BVH range ses triangles en feuilles, et c'est sans conséquence : le
 *    rendu se moque de l'ordre, et un impact rend le même point, la même
 *    distance et la même NORMALE — seul son `faceIndex` porte un autre
 *    numéro. L'éditeur lit la normale (`VoxelMode`), jamais le numéro.
 */

/**
 * Le seuil, et c'est le cœur du module.
 *
 * En dessous, l'arbre coûte plus qu'il ne rapporte — et, mesure à l'appui,
 * TOUTE la galerie actuelle est en dessous (douze triangles par pavé). Deux
 * mille triangles, c'est un modèle importé, pas une boîte : le jour où
 * quelqu'un en pose un et le déclare plein, la bibliothèque se télécharge et
 * la protection s'allume. Ce jour-là seulement.
 */
export const MOINS_DE_TRIANGLES = 2000;

/** Temps qu'on s'autorise à passer à bâtir des arbres, par frame (ms). */
export const BUDGET_PAR_FRAME = 3;

/** État du chargement : 'dormant', 'en-cours', 'pret', 'indisponible'. */
let etat = 'dormant';
let bvh = null;

/** Nombre de triangles d'une géométrie, indexée ou non — 0 si illisible. */
export function compterTriangles(geometry) {
  if (!geometry) return 0;
  if (geometry.index) return Math.floor(geometry.index.count / 3);
  const pos = geometry.attributes?.position;
  return pos ? Math.floor(pos.count / 3) : 0;
}

/**
 * Décide, et rien d'autre — pour que la règle s'éprouve au nœud.
 *
 * On refuse : ce qui n'est pas un maillage, ce qui a déjà son arbre, ce qui
 * est trop petit pour en valoir un, et ce que le BVH ne sait pas traiter —
 * les cibles de morphing, dont les positions bougent à chaque frame : un
 * arbre bâti sur la pose de repos mentirait dès la première animation.
 */
export function meriteUnArbre(objet, seuil = MOINS_DE_TRIANGLES) {
  if (!objet?.isMesh) return false;
  const g = objet.geometry;
  if (!g || g.boundsTree || g.arbreRefuse) return false;
  if (g.morphAttributes && Object.keys(g.morphAttributes).length > 0) return false;
  return compterTriangles(g) >= seuil;
}

/** Vrai s'il y a, dans cette liste, de quoi justifier le téléchargement. */
export function meriteLaBibliotheque(objets, seuil = MOINS_DE_TRIANGLES) {
  for (const o of objets ?? []) if (meriteUnArbre(o, seuil)) return true;
  return false;
}

/** Ce que le module est en train de faire — pour les tests et la console. */
export function etatRayons() { return etat; }

/**
 * Charge la bibliothèque et pose ses extensions sur les prototypes de three.
 *
 * Idempotent, et volontairement SANS `await` chez l'appelant : la frame en
 * cours se déroule normalement avec le rayon ordinaire de three, et l'arbre
 * arrivera à la frame suivante ou à la centième. Un visiteur qui marche ne
 * doit pas attendre un téléchargement pour poser le pied.
 */
export async function installerRayons(THREE) {
  if (etat !== 'dormant') return etat === 'pret';
  etat = 'en-cours';
  try {
    bvh = await import('three-mesh-bvh');
    THREE.BufferGeometry.prototype.computeBoundsTree = bvh.computeBoundsTree;
    THREE.BufferGeometry.prototype.disposeBoundsTree = bvh.disposeBoundsTree;
    // `InstancedMesh` garde le sien, qui délègue au nôtre par instance —
    // voir la note 2 en tête de fichier.
    THREE.Mesh.prototype.raycast = bvh.acceleratedRaycast;
    etat = 'pret';
    return true;
  } catch {
    // Pas de réseau, ou un morceau qui ne se charge pas : la galerie marche
    // exactement comme avant, en un peu plus lent sur ce modèle-là. On ne
    // réessaie pas — un échec de chargement de module ne se répare pas en
    // insistant soixante fois par seconde.
    etat = 'indisponible';
    return false;
  }
}

/**
 * Bâtit les arbres manquants d'une liste de cibles, dans la limite du budget.
 *
 * Rend le nombre d'arbres bâtis. Appelée une fois par frame depuis les
 * contrôles, sur la liste DÉJÀ filtrée par la portée : on ne prépare que ce
 * qui est à portée d'un pas, jamais la galerie entière. Et si rien ne mérite
 * un arbre — le cas de toute la galerie d'aujourd'hui — elle ne fait qu'un
 * parcours de liste et ne télécharge rien.
 */
export function preparerRayons(objets, budget = BUDGET_PAR_FRAME, THREE = null) {
  if (!objets?.length) return 0;
  if (etat !== 'pret') {
    // On ne réveille la bibliothèque QUE si une cible la justifie.
    if (etat === 'dormant' && THREE && meriteLaBibliotheque(objets)) {
      installerRayons(THREE);
    }
    return 0;
  }
  const horloge = typeof performance !== 'undefined' ? performance : Date;
  const debut = horloge.now();
  let faits = 0;
  for (const o of objets) {
    if (!meriteUnArbre(o)) continue;
    try {
      o.geometry.computeBoundsTree();
      faits++;
    } catch {
      // Une géométrie que le BVH refuse reste parfaitement utilisable : on
      // la MARQUE — sinon on la reproposerait à chaque frame, et le budget
      // serait mangé par une cible qui échouera toujours — et three la
      // balaiera comme avant. Un rayon lent vaut mieux qu'un rayon absent.
      o.geometry.arbreRefuse = true;
    }
    if (horloge.now() - debut > budget) break;
  }
  return faits;
}

/**
 * Autorise un raycaster à s'arrêter au premier triangle touché.
 *
 * À ne poser que sur un rayon dont on ne lit que `[0]` ou `.length` — voir
 * la note 1 en tête de fichier. Sans la bibliothèque, la propriété dort.
 */
export function rayonRapide(raycaster) {
  if (raycaster) raycaster.firstHitOnly = true;
  return raycaster;
}

/** Rend l'arbre d'un objet, si l'on veut libérer sans jeter la géométrie. */
export function oublierRayons(objet) {
  const g = objet?.geometry;
  if (g?.boundsTree && g.disposeBoundsTree) g.disposeBoundsTree();
}

/**
 * LES CARTELS — le texte de la galerie, net à toute distance.
 *
 * Le dessin est fait par `lettrage.js` : l'algorithme **Slug** d'Eric
 * Lengyel (MIT OU Apache-2.0, brevet au domaine public — crédit exigé et
 * rendu là-bas), qui résout les courbes de Bézier des glyphes DANS le
 * fragment shader. Pas d'atlas, pas de worker, pas de champ de distances :
 * le trait est analytique, exact au nez comme à dix mètres.
 *
 * CE FICHIER A DÉJÀ CHANGÉ DE MOTEUR UNE FOIS — canevas, puis SDF
 * (troika), puis Slug — et c'est voulu : il est la FRONTIÈRE. RoomManager
 * ne connaît que `creerCartel`, `majCartel`, `tournerVersCamera`,
 * `disposerCartel` ; le moteur de dessin se change derrière sans toucher
 * une porte. Ce que la version SDF nous a appris est resté dans les tests :
 *   • jamais de police par le réseau (troika allait chercher Roboto sur un
 *     CDN, puis son résolveur de replis sur un autre — deux fuites) ; Slug
 *     n'a même plus de police au sens fichier : les courbes d'Inter sont
 *     DANS le bundle (`lettrage-inter.js`), rien ne peut partir nulle part ;
 *   • ne jamais reposer un texte qui n'a pas changé (`majLettres` compare) ;
 *   • ne tourner qu'autour de la VERTICALE (un sprite se couche vu d'en
 *     haut, une enseigne du belvédère devenait une ligne).
 *
 * La police reste **Inter** de Rasmus Andersson (SIL OFL 1.1) — sous forme
 * de courbes maintenant, plus de `.woff` téléchargé.
 */
import * as THREE from 'three';
import { creerLettres, majLettres, disposerLettres, chaufferLettrage }
  from './lettrage.js';
import { ENCRE, ENCRE_FINI, texteEtiquette, encreEtiquette }
  from './cartels-reglages.js';

export { ENCRE, ENCRE_FINI, texteEtiquette, encreEtiquette };

const _regard = new THREE.Vector3();
const _q = new THREE.Quaternion();

/**
 * Prépare les textures de glyphes d'avance — à l'ouverture, pendant que le
 * rendu s'installe. Sans worker ni réseau, ce n'est plus qu'un emballage en
 * mémoire : quelques millisecondes, une seule fois. Idempotent, sans effet
 * hors navigateur.
 */
export function chauffer() {
  if (typeof document === 'undefined') return false;
  return chaufferLettrage();
}

/**
 * Un cartel : du texte plat, posé dans la scène — UN appel de dessin.
 *
 * `taille` est une HAUTEUR DE LETTRE EN MÈTRES, pas une taille de police en
 * points : c'est un objet du monde, il se mesure comme les autres.
 */
export function creerCartel({
  texte = '', taille = 0.26, couleur = ENCRE, opacite = 1,
  ancrageX = 'center', ancrageY = 'middle', largeur = Infinity,
  interligne = 1.25
} = {}) {
  if (typeof document === 'undefined') return null;   // tests, rendu hors écran
  const t = creerLettres({
    texte, taille, couleur, opacite,
    largeurMax: largeur, interligne, ancrageX, ancrageY
  });
  // Le texte ne doit ni masquer une œuvre ni recevoir un clic : il flotte,
  // il informe, il ne fait pas partie du décor solide. (raycast est déjà
  // neutralisé par creerLettres ; renderOrder aussi.)
  return t;
}

/** Change ce qu'un cartel dit — et NE REPOSE QUE SI ÇA A CHANGÉ. */
export function majCartel(cartel, { texte, couleur, opacite } = {}) {
  if (!cartel) return false;
  return majLettres(cartel, { texte, couleur, opacite });
}

/**
 * Tourne un cartel vers la caméra — AUTOUR DE LA VERTICALE SEULEMENT.
 *
 * La verticale de référence est celle du GROUPE porteur, et non l'axe Y du
 * monde : quand un mur devient le sol (Escher), l'étiquette doit se
 * redresser avec la pièce.
 */
export function tournerVersCamera(cartel, camera) {
  if (!cartel || !camera) return;
  cartel.getWorldPosition(_regard);
  _regard.subVectors(camera.position, _regard);
  const parent = cartel.parent;
  if (parent) {
    parent.updateWorldMatrix(true, false);
    _regard.applyQuaternion(parent.getWorldQuaternion(_q).invert());
  }
  cartel.rotation.set(0, Math.atan2(_regard.x, _regard.z), 0);
}

/** Rend la géométrie et le matériau d'un cartel. À ne pas oublier. */
export function disposerCartel(cartel) {
  disposerLettres(cartel);
}

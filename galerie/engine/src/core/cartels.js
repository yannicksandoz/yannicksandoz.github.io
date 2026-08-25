/**
 * LES CARTELS — le texte de la galerie, net à toute distance.
 *
 * D'après **troika-three-text** de Jason Johnston et ProtectWise (© 2019,
 * © 2021, licence MIT — https://github.com/protectwise/troika), installé par
 * `npm`. La police est **Inter** de Rasmus Andersson, sous licence SIL Open
 * Font License 1.1 (via `@fontsource/inter`).
 *
 * CE QUI CHANGE. Les étiquettes étaient des `CanvasTexture` : on dessinait le
 * nom d'une salle dans un canevas de 512 pixels, et l'on étirait ce canevas
 * sur deux mètres soixante. À dix mètres, c'était net ; en poussant la porte,
 * une lettre faisait quinze pixels de haut et le mot devenait une bouillie —
 * exactement au moment où le visiteur le lit. Le champ de distances signées
 * (SDF) ne stocke pas des pixels mais la DISTANCE au trait le plus proche :
 * la carte s'interpole, et le bord reste franc quel que soit le
 * grossissement. On lit le nom d'une salle le nez sur le linteau.
 *
 * DEUX CHOSES À SAVOIR AVANT DE S'EN SERVIR AILLEURS.
 *
 * 1. **LA POLICE EST LOCALE, ET CE N'EST PAS UN DÉTAIL.** Sans `font`,
 *    troika va chercher Roboto sur `fonts.gstatic.com` — un hôte tiers, dans
 *    une galerie qui doit tenir indéfiniment sans dépendre de personne. On
 *    passe donc toujours notre fichier, empaqueté par Vite avec le reste ;
 *    et `check-visitor-build.mjs` refuse désormais un build où
 *    `fonts.gstatic.com` apparaîtrait, pour que la règle soit VÉRIFIÉE et
 *    non pas seulement écrite ici. Trente et un kilo-octets, latin, une
 *    graisse : le prix est connu.
 *
 * 2. **`sync()` est asynchrone, et la première fois coûte.** La carte SDF se
 *    calcule dans un worker ; entre la pose du texte et son apparition il
 *    s'écoule une frame ou deux. C'est invisible sur une étiquette qui
 *    accompagne une porte, ce le serait moins sur un compteur qui bat la
 *    seconde — d'où les glyphes mis en cache dès l'ouverture (`chauffer`),
 *    pour que le premier cartel affiché ne soit pas le premier calculé.
 */
import * as THREE from 'three';
import { Text, preloadFont } from 'troika-three-text';
import POLICE from '@fontsource/inter/files/inter-latin-300-normal.woff';
import { GLYPHES_COURANTS, ENCRE, ENCRE_FINI, texteEtiquette, encreEtiquette }
  from './cartels-reglages.js';

/** Le fichier de police, empaqueté avec le build — jamais un CDN. */
export const POLICE_URL = POLICE;

export { ENCRE, ENCRE_FINI, texteEtiquette, encreEtiquette };

const _regard = new THREE.Vector3();
const _q = new THREE.Quaternion();
let chauffe = false;

/**
 * Fait calculer d'avance la carte des glyphes courants.
 *
 * À appeler une fois, quand la galerie s'ouvre. Sans quoi le premier cartel
 * posé attend son worker, et l'on voit un trou là où le nom devrait être.
 * Idempotent, et sans effet hors navigateur.
 */
export function chauffer(police = POLICE_URL) {
  if (chauffe || typeof document === 'undefined') return false;
  chauffe = true;
  try { preloadFont({ font: police, characters: GLYPHES_COURANTS }, () => {}); }
  catch { /* pas de worker : les cartels se calculeront à la demande */ }
  return true;
}

/**
 * Un cartel : du texte plat, posé dans la scène.
 *
 * `taille` est une HAUTEUR DE LETTRE EN MÈTRES, pas une taille de police en
 * points — c'est un objet du monde, il se mesure comme les autres.
 */
export function creerCartel({
  texte = '', taille = 0.26, couleur = ENCRE, opacite = 1,
  ancrageX = 'center', ancrageY = 'middle', largeur = Infinity,
  interligne = 1.25
} = {}) {
  if (typeof document === 'undefined') return null;   // tests, rendu hors écran
  const t = new Text();
  t.font = POLICE_URL;
  t.text = texte;
  t.fontSize = taille;
  t.color = couleur;
  t.anchorX = ancrageX;
  t.anchorY = ancrageY;
  t.maxWidth = largeur;
  t.lineHeight = interligne;
  t.textAlign = 'center';
  // Le texte ne doit ni masquer une œuvre ni recevoir un clic : il flotte,
  // il informe, il ne fait pas partie du décor solide.
  t.material.transparent = true;
  t.material.opacity = opacite;
  t.material.depthWrite = false;
  t.raycast = () => {};
  t.renderOrder = 10;
  t.sync();
  return t;
}

/**
 * Change ce qu'un cartel dit — et NE RESYNCHRONISE QUE SI ÇA A CHANGÉ.
 *
 * `sync()` refait la carte des glyphes. L'appeler à chaque frame sur un texte
 * immobile mettrait un worker en marche pour rien, soixante fois par seconde.
 * La comparaison ici n'est pas une optimisation prématurée : c'est ce qui
 * sépare un cartel d'une fuite.
 */
export function majCartel(cartel, { texte, couleur, opacite } = {}) {
  if (!cartel) return false;
  let bouge = false;
  if (texte !== undefined && texte !== cartel.text) { cartel.text = texte; bouge = true; }
  if (couleur !== undefined && couleur !== cartel.color) { cartel.color = couleur; bouge = true; }
  if (opacite !== undefined && cartel.material) cartel.material.opacity = opacite;
  if (bouge) cartel.sync();
  return bouge;
}

/**
 * Tourne un cartel vers la caméra, comme le faisait le `Sprite` qu'il
 * remplace — mais AUTOUR DE LA VERTICALE SEULEMENT.
 *
 * Un sprite pivote aussi en tangage : vu d'en haut, il se couche et le texte
 * devient une ligne. Dans un belvédère où l'on regarde souvent depuis un
 * étage, ce n'est pas ce qu'on veut d'une enseigne. La verticale de
 * référence est celle du GROUPE porteur, et non l'axe Y du monde : quand un
 * mur devient le sol, l'étiquette doit se redresser avec la pièce.
 */
export function tournerVersCamera(cartel, camera) {
  if (!cartel || !camera) return;
  cartel.getWorldPosition(_regard);
  _regard.subVectors(camera.position, _regard);
  const parent = cartel.parent;
  if (parent) {
    // dans le repère du parent : la verticale locale est son axe Y
    parent.updateWorldMatrix(true, false);
    _regard.applyQuaternion(parent.getWorldQuaternion(_q).invert());
  }
  cartel.rotation.set(0, Math.atan2(_regard.x, _regard.z), 0);
}

/** Rend la géométrie et le matériau d'un cartel. À ne pas oublier. */
export function disposerCartel(cartel) {
  if (!cartel) return;
  cartel.parent?.remove(cartel);
  cartel.dispose?.();
}

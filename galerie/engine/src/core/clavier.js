/**
 * LE CLAVIER RÉEL — deux questions distinctes, souvent confondues.
 *
 * 1. QUELLE TOUCHE L'UTILISATEUR A-T-IL PRESSÉE ?
 *    Deux réponses, et le choix n'est pas une affaire de goût :
 *      • `e.code` nomme une POSITION sur un clavier américain. C'est ce
 *        qu'il faut pour les touches choisies pour leur place sous les
 *        doigts — la marche (W A S D forment une croix quelle que soit la
 *        disposition), les flèches, Suppr, la touche à gauche du 1.
 *      • `e.key` donne le CARACTÈRE imprimé. C'est ce qu'il faut pour les
 *        touches choisies pour leur lettre — G comme « grab », Ctrl+Z comme
 *        « annuler ». Sur un clavier suisse (QWERTZ), la touche marquée Z
 *        est à la place du Y américain : `e.code === 'KeyZ'` y écoutait la
 *        touche marquée Y, et Ctrl+Z n'annulait rien. Même histoire en
 *        AZERTY, où `KeyZ` est la touche marquée W.
 *
 * 2. COMMENT S'APPELLE-T-ELLE SUR CE CLAVIER-CI ?
 *    Une touche de position n'a pas de nom universel : la même case est
 *    « ² » sur un PC français, « § » sur un suisse, « ` » en américain.
 *    `navigator.keyboard.getLayoutMap()` (Chromium) donne la carte ;
 *    ailleurs, on garde les libellés neutres écrits en dur, qui couvrent
 *    déjà les dispositions courantes.
 *
 * Ce module tient les deux bouts : `lettre()` pour comparer, `libelle()` et
 * `peindreLibelles()` pour afficher.
 */

/** Codes dont le libellé dépend de la disposition, et leur repli neutre. */
const REPLIS = {
  KeyW: 'W', KeyA: 'A', KeyS: 'S', KeyD: 'D',
  KeyQ: 'Q', KeyE: 'E', Backquote: '²'
};

let _carte;           // Promise<Map|null>, résolue une seule fois

/** Carte `code → étiquette imprimée`, ou null si le navigateur l'ignore. */
export function carte() {
  if (!_carte) {
    _carte = (async () => {
      try {
        return (await navigator.keyboard?.getLayoutMap?.()) ?? null;
      } catch {
        return null;   // permission refusée, contexte non sécurisé
      }
    })();
  }
  return _carte;
}

/** Étiquette imprimée d'une touche de position (majuscule), ou son repli. */
export async function libelle(code, repli = REPLIS[code] ?? code) {
  const m = await carte();
  const brut = m?.get(code);
  return (brut || repli).toUpperCase();
}

/**
 * Les quatre touches de marche, dans l'ordre avant/gauche/arrière/droite —
 * « ZQSD » en AZERTY, « WASD » ailleurs, et la vérité sur un clavier
 * exotique. On les colle sans séparateur : c'est un bloc, pas une liste.
 */
export async function libelleMarche() {
  const m = await carte();
  if (!m) return null;   // l'appelant garde son texte neutre bilingue
  const de = (c) => (m.get(c) || REPLIS[c]).toUpperCase();
  return `${de('KeyW')}${de('KeyA')}${de('KeyS')}${de('KeyD')}`;
}

/**
 * Remplace le contenu des `[data-keylabel]` par les étiquettes réelles.
 * Sans carte de disposition, ne touche à rien : les textes en place sont
 * déjà des replis lisibles.
 */
export async function peindreLibelles(racine = document) {
  const m = await carte();
  if (!m) return false;
  const marche = await libelleMarche();
  const valeurs = {
    move: marche,
    pivot: `${await libelle('KeyQ')}/${await libelle('KeyE')}`,
    edit: await libelle('Backquote')
  };
  for (const [nom, valeur] of Object.entries(valeurs)) {
    if (!valeur) continue;
    racine.querySelectorAll(`[data-keylabel="${nom}"]`)
      .forEach((el) => { el.textContent = valeur; });
  }
  return true;
}

/**
 * Lettre imprimée sur la touche pressée, en minuscule, ou '' si l'événement
 * n'en porte pas (flèche, Suppr, touche morte). À comparer à 'g', 'z'… :
 * c'est la seule lecture juste sur une disposition non américaine.
 */
export function lettre(e) {
  const k = e?.key;
  // `key` vaut « Shift », « ArrowUp », « Dead »… pour tout ce qui n'imprime
  // pas un caractère : un test de longueur les écarte tous d'un coup.
  return typeof k === 'string' && k.length === 1 ? k.toLowerCase() : '';
}

/**
 * Chiffre 1–9 pressé, ou null. Accepte la POSITION (`Digit3`) comme le
 * CARACTÈRE (`'3'`) : en AZERTY les chiffres demandent Maj, et exiger le
 * caractère y rendrait les outils inatteignables ; en QWERTZ suisse les
 * deux coïncident. Accepter les deux ne coûte rien et ne trompe personne.
 */
export function chiffre(e) {
  const parPosition = /^Digit([1-9])$/.exec(e?.code ?? '')?.[1];
  if (parPosition) return Number(parPosition);
  const k = e?.key;
  return /^[1-9]$/.test(k ?? '') ? Number(k) : null;
}

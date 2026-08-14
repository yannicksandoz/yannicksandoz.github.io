/**
 * Langue de l'interface VISITEUR (l'éditeur reste en français).
 *
 * Le point important n'est pas la traduction : c'est
 * `document.documentElement.lang`, qui suit le choix. C'est lui qui fait
 * changer de voix à VoiceOver — un texte anglais lu par une voix française
 * est incompréhensible. Tout le reste découle de là.
 *
 * Un dictionnaire central plutôt que des ternaires dispersés : une clé
 * manquante retombe sur le français, jamais sur une chaîne vide.
 */

const FR = {
  'enter.sub': 'Un espace sonore immersif — casque recommandé',
  'enter.loading': 'Chargement…',
  'enter.enter': 'Entrer',
  'enter.audio': 'Visite audio',
  'enter.tip': "ZQSD / WASD ou flèches pour se déplacer · {pivot} pour pivoter · souris pour orbiter · clic sur une œuvre pour l'approcher",
  'enter.error': 'Impossible de charger la configuration des œuvres (voir console).',

  'hint.line': '{move} · {pivot} : pivoter · clic ou Espace : découvrir',

  'nogl.sub': "Votre navigateur ne prend pas en charge WebGL2, nécessaire à l'affichage 3D. La galerie reste entièrement visitable à l'oreille : navigation au clavier, sons spatialisés — casque recommandé.",
  'nogl.start': 'Visite audio',
  'nogl.loading': 'Chargement…',
  'nogl.failed': 'Échec du chargement — réessayer',
  'nogl.resume': 'Reprendre la visite audio',

  'menu.title': 'Menu',
  'menu.audio': 'Visite audio',
  'menu.keys': 'Clavier',
  'menu.keys.move': 'Se déplacer — ZQSD / WASD ou flèches',
  'menu.keys.pivot': 'Pivoter — {pivot}',
  'menu.keys.orbit': 'Orbiter — souris',
  'menu.keys.focus': 'Approcher une œuvre — clic, ou Espace sur ce qu\'on regarde · Reculer — Échap',
  'menu.lang': 'Langue',
  'menu.resume': 'Reprendre la visite',
  'menu.label': 'Menu de la visite',

  'tour.title': 'Visite audio',
  'tour.label': 'Visite audio de la galerie',
  'tour.help': 'Haut et bas : œuvres. Gauche et droite : pièces. Entrée : approcher. Échap : revenir. Casque recommandé.',
  'tour.works': 'Œuvres',
  'tour.quit': 'Quitter la visite audio',
  'tour.empty': 'Aucune œuvre dans cette pièce.',
  'tour.untitled': 'Sans titre',
  'tour.approached': '{title}, approché.',
  'tour.back': 'Reculé.',
  'tour.room': '{room} — {n} œuvre{s}',

  'focus.tip': 'Échap ou × pour reculer',
  'focus.close': 'Fermer',
  'credits.title': 'Crédits',
  'credits.close': 'Fermer',
  'credits.label': 'Crédits',
  'credits.unknown': 'auteur non précisé',
  'credits.polypizza': 'Modèles fournis par Poly Pizza',
  'tipjar.support': "Soutenir l'artiste",
  'tipjar.tip': 'Paiement hébergé par un prestataire externe — rien ne transite par ce site.'
};

const EN = {
  'enter.sub': 'An immersive sound space — headphones recommended',
  'enter.loading': 'Loading…',
  'enter.enter': 'Enter',
  'enter.audio': 'Audio tour',
  'enter.tip': 'WASD or arrow keys to move · {pivot} to turn · mouse to orbit · click a work to approach it',
  'enter.error': 'Could not load the artwork configuration (see console).',

  'hint.line': '{move} · {pivot}: turn · click or Space: discover',

  'nogl.sub': 'Your browser does not support WebGL2, which the 3D display requires. The gallery remains fully visitable by ear: keyboard navigation, spatialised sound — headphones recommended.',
  'nogl.start': 'Audio tour',
  'nogl.loading': 'Loading…',
  'nogl.failed': 'Loading failed — try again',
  'nogl.resume': 'Resume the audio tour',

  'menu.title': 'Menu',
  'menu.audio': 'Audio tour',
  'menu.keys': 'Keyboard',
  'menu.keys.move': 'Move — WASD or arrow keys',
  'menu.keys.pivot': 'Turn — {pivot}',
  'menu.keys.orbit': 'Orbit — mouse',
  'menu.keys.focus': 'Approach a work — click, or Space on what you are looking at · Step back — Escape',
  'menu.lang': 'Language',
  'menu.resume': 'Resume the visit',
  'menu.label': 'Visit menu',

  'tour.title': 'Audio tour',
  'tour.label': 'Audio tour of the gallery',
  'tour.help': 'Up and down: works. Left and right: rooms. Enter: approach. Escape: back. Headphones recommended.',
  'tour.works': 'Works',
  'tour.quit': 'Leave the audio tour',
  'tour.empty': 'No works in this room.',
  'tour.untitled': 'Untitled',
  'tour.approached': '{title}, approached.',
  'tour.back': 'Stepped back.',
  'tour.room': '{room} — {n} work{s}',

  'focus.tip': 'Escape or × to step back',
  'focus.close': 'Close',
  'credits.title': 'Credits',
  'credits.close': 'Close',
  'credits.label': 'Credits',
  'credits.unknown': 'author not specified',
  'credits.polypizza': 'Models provided by Poly Pizza',
  'tipjar.support': 'Support the artist',
  'tipjar.tip': 'Payment hosted by an external provider — nothing transits through this site.'
};

const DICTS = { fr: FR, en: EN };
const CLE_STOCKAGE = 'galerie-lang';

let courante = 'fr';

/** Langue en vigueur ('fr' | 'en'). */
export function lang() {
  return courante;
}

/**
 * Traduit une clé. `vars` remplace les {jetons} ; `{s}` reçoit
 * automatiquement le pluriel français/anglais quand `n` est fourni.
 */
export function t(key, vars = {}) {
  const dict = DICTS[courante] ?? FR;
  let s = dict[key] ?? FR[key] ?? key;
  const all = { ...vars };
  if (all.n !== undefined && all.s === undefined) all.s = all.n > 1 ? 's' : '';
  for (const [k, v] of Object.entries(all)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

/**
 * Choisit la langue et l'applique au document. `lang` de <html> suit :
 * c'est ce qui fait basculer la voix des lecteurs d'écran.
 */
export function setLang(code, { persist = true } = {}) {
  courante = DICTS[code] ? code : 'fr';
  document.documentElement.lang = courante;
  if (persist) {
    try { localStorage.setItem(CLE_STOCKAGE, courante); } catch { /* stockage refusé */ }
  }
  for (const fn of abonnes) fn(courante);
  return courante;
}

const abonnes = new Set();

/** S'abonner aux changements de langue (les vues se re-rendent). */
export function onLangChange(fn) {
  abonnes.add(fn);
  return () => abonnes.delete(fn);
}

/**
 * Langue initiale : choix mémorisé, sinon la langue du navigateur, sinon
 * le français. Appelé au tout début du démarrage — avant tout affichage.
 */
export function initLang() {
  let choix = null;
  try { choix = localStorage.getItem(CLE_STOCKAGE); } catch { /* stockage refusé */ }
  if (!choix) {
    const nav = (navigator.language || 'fr').slice(0, 2).toLowerCase();
    choix = DICTS[nav] ? nav : 'fr';
  }
  return setLang(choix, { persist: false });
}

/**
 * Applique les traductions au HTML statique : `data-i18n` sur un élément
 * remplace son texte, `data-i18n-attr="aria-label:clé"` un attribut.
 * Les éléments porteurs de balisage interne (jetons {pivot}) sont laissés
 * aux vues qui les construisent.
 */
export function traduireDom(racine = document) {
  for (const el of racine.querySelectorAll('[data-i18n]')) {
    el.textContent = t(el.dataset.i18n);
  }
  for (const el of racine.querySelectorAll('[data-i18n-attr]')) {
    for (const paire of el.dataset.i18nAttr.split(',')) {
      const [attr, cle] = paire.split(':').map((s) => s.trim());
      if (attr && cle) el.setAttribute(attr, t(cle));
    }
  }
}

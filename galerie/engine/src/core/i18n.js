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
  'enter.sub': 'Une galerie d’art sonore, mixée en binaural : vos déplacements composent le mixage. Écoutez au casque — sur haut-parleur, le relief du son disparaît.',
  'enter.loading': 'Chargement…',
  'enter.enter': 'Entrer',
  'enter.audio': 'Visite audio',
  'enter.tip': "{move} ou flèches pour se déplacer · {pivot} pour pivoter · souris pour orbiter · clic sur une œuvre pour l'approcher",
  'enter.tip.touch': "1 doigt pour regarder autour · 2 doigts pour se déplacer et zoomer · joystick pour marcher · toucher une œuvre pour l'approcher",
  'enter.liste': 'Parcourir les œuvres en liste (2D)',
  'enter.error': "La configuration des œuvres n'a pas pu être chargée — l'incident est presque toujours passager.",
  'enter.retry': 'Réessayer',

  'hint.line': '{move} · {pivot} : pivoter · clic ou Espace : découvrir',
  'hint.touch': '1 doigt : regarder · 2 doigts : se déplacer · joystick : marcher · toucher : découvrir',
  'hint.fly': 'Vous planez · avancez en regardant vers le bas pour vous poser',

  'nogl.sub': "Votre navigateur ne prend pas en charge WebGL2, nécessaire à l'affichage 3D. La galerie reste entièrement visitable à l'oreille : navigation au clavier, sons spatialisés — casque recommandé.",
  'nogl.start': 'Visite audio',
  'nogl.loading': 'Chargement…',
  'nogl.failed': 'Échec du chargement — réessayer',
  'nogl.resume': 'Reprendre la visite audio',

  'menu.title': 'Menu',
  'menu.audio': 'Visite audio',
  'menu.keys': 'Clavier',
  'menu.keys.move': 'Se déplacer — {move} ou flèches',
  'menu.keys.pivot': 'Pivoter — {pivot}',
  'menu.keys.orbit': 'Orbiter — souris',
  'menu.keys.focus': 'Approcher une œuvre — clic, ou Espace sur ce qu\'on regarde · Reculer — Échap',
  'menu.lang': 'Langue',
  'menu.settings': 'Réglages',
  'menu.settings.minimap': 'Minimap dans le coin de l\'écran',
  'menu.settings.memory': 'Mémoire de visite',
  'menu.settings.memory.note': 'La galerie garde vos pièces visitées, vos œuvres '
    + 'rencontrées et vos jetons ◈ d\'une visite à l\'autre, sur cet appareil.',
  'menu.settings.forget': 'Recommencer la visite',
  'menu.settings.forget.sure': 'Tout oublier ? Cliquez encore',
  'menu.settings.forget.done': 'La galerie vous a oublié',
  'menu.settings.dev': 'Développement',
  'menu.settings.fps': 'Compteur d\'images (FPS)',
  'menu.map.note': 'La carte se dessine en marchant : « ? » marque un passage '
    + 'que vous n\'avez pas encore pris.',
  'carte.titre': 'Plan de la galerie',
  'carte.ouvrir': 'Voir le plan en grand',
  'carte.fermer': 'Fermer le plan',
  'carte.compte': '{connues} pièce{sc} parcourue{sc} · {reste} encore inconnue{sr}',
  'carte.complet': '{connues} pièces parcourues · la galerie entière',
  'carte.aller': 'Aller dans « {piece} »',
  'carte.ici': 'Vous êtes ici',
  'carte.oeuvres': '{vues} œuvre{sv} vue{sv} sur {total}',
  'carte.legende': '◆ œuvres vues · « ? » un passage jamais pris · '
    + 'cliquez une pièce pour vous y rendre',
  'menu.open': 'Ouvrir le menu de la visite',
  'menu.resume': 'Reprendre la visite',
  'menu.label': 'Menu de la visite',
  'menu.rooms': 'Pièces',
  'menu.rooms.left': '{n} pièce{s} encore inconnue{s}',
  'menu.derive': 'Laisse-toi porter (visite guidée)',
  'menu.share': 'Partager',
  'menu.share.copied': 'Lien copié !',
  'menu.fullscreen': 'Plein écran',
  'menu.fullscreen.exit': 'Quitter le plein écran',
  'menu.liste': 'Vue liste (2D)',
  'menu.finish': 'Terminer la visite',
  'menu.groupe.visite': 'Visite',
  'menu.groupe.affichage': 'Affichage',
  'menu.groupe.systeme': 'Aide et mémoire',
  'tb.label': 'Outils de visite',
  'tb.carte': 'Voir la carte',
  'tb.capture': 'Capturer l\'écran',
  'tb.capture.faite': 'Image enregistrée',
  'tb.derive': 'Laisse-toi porter',
  'tb.derive.stop': 'Arrêter la visite guidée',
  'tb.son.couper': 'Couper le son',
  'tb.son.rendre': 'Rendre le son',

  'progress.label': '{n} œuvre{s} sur {total} dans cette salle — voir la liste',
  'progress.title': 'Œuvres',
  'progress.vide': 'Aucune œuvre dans cette salle — poussez une porte.',
  'progress.ailleurs': 'Et {n} salle{s} que vous n\u2019avez pas encore vue{s}.',
  'progress.hint': 'Encore {n} à trouver ici — suivez le pointeur ▲',
  'derive.start': 'Laisse-toi porter',
  'derive.stop': 'Reprendre la main',
  'derive.title': 'Visite guidée des {n} œuvres découvertes',
  'derive.empty': 'Découvrez une œuvre ou trouvez un jeton ◈ — suivez le pointeur',
  'derive.prev': 'Œuvre précédente',
  'derive.next': 'Œuvre suivante',
  'derive.unlock': 'Vers une œuvre non découverte — coûte 1 jeton ◈ (vous en avez {n})',
  'derive.needToken': 'Il faut un jeton ◈ — il y en a de cachés dans la galerie',
  'progress.jetons': '{n} jeton{s} ◈',
  'progress.jetons.hint': 'Des jetons ◈ sont cachés dans la galerie : chacun débloque une œuvre dans la visite guidée (▸ ◈), ou dévoile une ligne « ??? » du catalogue.',
  'progress.reveler': 'Dévoiler cette œuvre — coûte 1 jeton ◈',
  'progress.revelee': 'Dévoilée par un jeton — à découvrir sur place',

  'tour.title': 'Visite audio',
  'tour.label': 'Visite audio de la galerie',
  'tour.help': 'Haut et bas : parcourir. Entrée : approcher ou franchir. Droite : avancer, gauche : revenir. Échap : remonter. Casque recommandé.',
  'tour.works': 'Œuvres',
  'tour.quit': 'Quitter la visite audio',
  'tour.empty': 'Aucune œuvre dans cette pièce.',
  'tour.auto': 'Visite guidée de la pièce',
  'tour.auto.stop': 'Mettre en pause',
  'tour.auto.on': 'Visite guidée. Une flèche ou Échap pour reprendre la main.',
  'tour.auto.off': 'Pause.',
  'tour.auto.end': 'Pièce parcourue.',
  'tour.tokens': 'Jetons',
  'tour.token': 'Jeton ◈',
  'tour.token.taken': 'Jeton ramassé. {n} en réserve.',
  'tour.doors': 'Passages',
  'tour.door': 'Vers {room}',
  'tour.doors.list': '{n} passage{s} : {liste}.',
  'tour.doors.none': 'Aucun passage depuis cette pièce.',
  'tour.room.empty': '{room} — aucune œuvre',
  'tour.dead.end': 'Vous êtes revenu au point de départ.',
  'tour.untitled': 'Sans titre',
  'tour.approached': '{title}, approché.',
  'tour.back': 'Reculé.',
  'tour.room': '{room} — {n} œuvre{s}',
  'tour.room.count': '{room} — {n} sur {total} découverte{s}',
  'tour.room.complete': '{room} — complète, {total} œuvre{s}',
  'tour.unknown': 'Œuvre non découverte',
  'tour.discovered': 'Découverte : {title}. {n} sur {total}.',
  'tour.room.done': 'Pièce complète.',

  'focus.tip': 'Échap ou × pour reculer',
  'focus.close': 'Fermer',
  'ad.play': "Écouter la description de l'image",
  'ad.stop': 'Arrêter la description',
  'ad.done': 'Description terminée.',
  'focus.image': "Voir l'image",
  'focus.link': 'En savoir plus',
  'viewer.close': "Fermer l'image",
  'credits.title': 'Crédits',
  'credits.close': 'Fermer',
  'credits.label': 'Crédits',
  'credits.unknown': 'auteur non précisé',
  'credits.polypizza': 'Modèles fournis par Poly Pizza',
  'tipjar.support': "Soutenir l'artiste",
  'tipjar.tip': 'Paiement hébergé par un prestataire externe — rien ne transite par ce site.'
};

const EN = {
  'enter.sub': 'A sound-art gallery, mixed binaurally: your movements compose the mix. Listen on headphones — on a speaker, the sound loses its relief.',
  'enter.loading': 'Loading…',
  'enter.enter': 'Enter',
  'enter.audio': 'Audio tour',
  'enter.tip': '{move} or arrow keys to move · {pivot} to turn · mouse to orbit · click a work to approach it',
  'enter.tip.touch': '1 finger to look around · 2 fingers to move and zoom · joystick to walk · tap a work to approach it',
  'enter.liste': 'Browse the works as a list (2D)',
  'enter.error': 'The artwork configuration could not be loaded — this is almost always temporary.',
  'enter.retry': 'Try again',

  'hint.line': '{move} · {pivot}: turn · click or Space: discover',
  'hint.touch': '1 finger: look · 2 fingers: move · joystick: walk · tap: discover',
  'hint.fly': 'You are gliding · look down and move forward to land',

  'nogl.sub': 'Your browser does not support WebGL2, which the 3D display requires. The gallery remains fully visitable by ear: keyboard navigation, spatialised sound — headphones recommended.',
  'nogl.start': 'Audio tour',
  'nogl.loading': 'Loading…',
  'nogl.failed': 'Loading failed — try again',
  'nogl.resume': 'Resume the audio tour',

  'menu.title': 'Menu',
  'menu.audio': 'Audio tour',
  'menu.keys': 'Keyboard',
  'menu.keys.move': 'Move — {move} or arrow keys',
  'menu.keys.pivot': 'Turn — {pivot}',
  'menu.keys.orbit': 'Orbit — mouse',
  'menu.keys.focus': 'Approach a work — click, or Space on what you are looking at · Step back — Escape',
  'menu.lang': 'Language',
  'menu.settings': 'Settings',
  'menu.settings.minimap': 'Minimap in the corner',
  'menu.settings.memory': 'Visit memory',
  'menu.settings.memory.note': 'The gallery remembers the rooms you have walked, '
    + 'the works you have met and your ◈ tokens from one visit to the next, on this device.',
  'menu.settings.forget': 'Start the visit over',
  'menu.settings.forget.sure': 'Forget everything? Click again',
  'menu.settings.forget.done': 'The gallery has forgotten you',
  'menu.settings.dev': 'Development',
  'menu.settings.fps': 'Frame counter (FPS)',
  'menu.map.note': 'The map draws itself as you walk: “?” marks a passage you '
    + 'have not taken yet.',
  'carte.titre': 'Map of the gallery',
  'carte.ouvrir': 'Open the full map',
  'carte.fermer': 'Close the map',
  'carte.compte': '{connues} room{sc} walked · {reste} still unknown',
  'carte.complet': '{connues} rooms walked · the whole gallery',
  'carte.aller': 'Go to “{piece}”',
  'carte.ici': 'You are here',
  'carte.oeuvres': '{vues} of {total} work{st} seen',
  'carte.legende': '◆ works seen · “?” a passage never taken · '
    + 'click a room to travel there',
  'menu.open': 'Open the visit menu',
  'menu.resume': 'Resume the visit',
  'menu.label': 'Visit menu',
  'menu.rooms': 'Rooms',
  'menu.rooms.left': '{n} room{s} still unknown',
  'menu.derive': 'Let yourself drift (guided visit)',
  'menu.share': 'Share',
  'menu.share.copied': 'Link copied!',
  'menu.fullscreen': 'Fullscreen',
  'menu.fullscreen.exit': 'Exit fullscreen',
  'menu.liste': 'List view (2D)',
  'menu.finish': 'End the visit',
  'menu.groupe.visite': 'Visit',
  'menu.groupe.affichage': 'Display',
  'menu.groupe.systeme': 'Help & memory',
  'tb.label': 'Visit tools',
  'tb.carte': 'Open the map',
  'tb.capture': 'Take a screenshot',
  'tb.capture.faite': 'Image saved',
  'tb.derive': 'Let yourself drift',
  'tb.derive.stop': 'Stop the guided visit',
  'tb.son.couper': 'Mute the sound',
  'tb.son.rendre': 'Unmute the sound',

  'progress.label': '{n} of {total} works in this room — open the list',
  'progress.title': 'Works',
  'progress.vide': 'No work in this room — try a door.',
  'progress.ailleurs': 'And {n} room{s} you have not seen yet.',
  'progress.hint': '{n} still to find here — follow the pointer ▲',
  'derive.start': 'Let yourself drift',
  'derive.stop': 'Take back control',
  'derive.title': 'Guided tour of the {n} works you found',
  'derive.empty': 'Find a work or a ◈ token first — follow the pointer',
  'derive.prev': 'Previous work',
  'derive.next': 'Next work',
  'derive.unlock': 'To an undiscovered work — costs 1 ◈ token (you have {n})',
  'derive.needToken': 'You need a ◈ token — some are hidden around the gallery',
  'progress.jetons': '{n} ◈ token{s}',
  'progress.jetons.hint': '◈ tokens are hidden around the gallery: each one unlocks an undiscovered work in the guided tour (▸ ◈), or unveils a “???” line in the catalogue.',
  'progress.reveler': 'Unveil this work — costs 1 ◈ token',
  'progress.revelee': 'Unveiled by a token — still to be discovered in person',

  'tour.title': 'Audio tour',
  'tour.label': 'Audio tour of the gallery',
  'tour.help': 'Up and down: browse. Enter: approach or go through. Right: onward, left: back. Escape: up a level. Headphones recommended.',
  'tour.works': 'Works',
  'tour.quit': 'Leave the audio tour',
  'tour.empty': 'No works in this room.',
  'tour.auto': 'Guided tour of this room',
  'tour.auto.stop': 'Pause',
  'tour.auto.on': 'Guided tour. Any arrow or Escape takes back control.',
  'tour.auto.off': 'Paused.',
  'tour.auto.end': 'Room visited.',
  'tour.tokens': 'Tokens',
  'tour.token': '◈ token',
  'tour.token.taken': 'Token picked up. {n} in hand.',
  'tour.doors': 'Ways out',
  'tour.door': 'To {room}',
  'tour.doors.list': '{n} way{s} out: {liste}.',
  'tour.doors.none': 'No way out of this room.',
  'tour.room.empty': '{room} — no works',
  'tour.dead.end': 'You are back where you started.',
  'tour.untitled': 'Untitled',
  'tour.approached': '{title}, approached.',
  'tour.back': 'Stepped back.',
  'tour.room': '{room} — {n} work{s}',
  'tour.room.count': '{room} — {n} of {total} found',
  'tour.room.complete': '{room} — complete, {total} work{s}',
  'tour.unknown': 'Undiscovered work',
  'tour.discovered': 'Found: {title}. {n} of {total}.',
  'tour.room.done': 'Room complete.',

  'focus.tip': 'Escape or × to step back',
  'focus.close': 'Close',
  'ad.play': 'Listen to the image description',
  'ad.stop': 'Stop the description',
  'ad.done': 'Description finished.',
  'focus.image': 'View the image',
  'focus.link': 'Learn more',
  'viewer.close': 'Close the image',
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

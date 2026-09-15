/**
 * LE HUD QUI S'EFFACE — sur téléphone, l'écran revient à la scène.
 *
 * Sur un iPhone, la rangée d'icônes, la minimap, le nom de la pièce et le
 * compteur d'œuvres occupaient le tiers haut de l'écran, en permanence :
 * plus de chrome que de galerie. Sur tactile, ils s'ESTOMPENT après quatre
 * secondes sans toucher l'écran, et un TAP dans le tiers haut les ramène
 * pour quatre secondes. Le bouton ☰ reste : c'est la poignée de tout le
 * reste, elle ne disparaît jamais. Le pense-bête (#hint), le manche et le
 * bouton de course ne bougent pas non plus — eux guident le geste.
 *
 * Deux règles, pour que ça ne clignote pas :
 *   • tant que le HUD est VISIBLE, tout toucher le garde (on s'en sert,
 *     ou on regarde autour : il attend qu'on ait fini) ;
 *   • une fois EFFACÉ, seul un tap dans le tiers haut le ramène — un doigt
 *     qui tourne la caméra ou pousse le manche ne le fait pas revenir, ce
 *     serait justement le moment où l'on veut voir la scène.
 * Un panneau ouvert (le compteur déplié, le menu, la carte) le tient
 * visible : on ne retire pas une étiquette sous les yeux de qui la lit.
 *
 * La MINUTERIE est pure (`MinuterieHud`) : test-hud-tactile l'éprouve. Le
 * reste est du DOM : une classe `hud-efface` sur <body>, et du CSS.
 */

export const DELAI = 4;          // secondes sans toucher avant l'effacement
const TAP_MS = 350;              // au-delà, c'est un appui, pas un tap
const TAP_PX = 12;               // au-delà, c'est un glissement

export class MinuterieHud {
  constructor({ delai = DELAI } = {}) {
    this.delai = delai;
    this._depuis = 0;            // dernier moment où le HUD a été « réveillé »
    this._tenu = false;          // un panneau ouvert le tient visible
  }

  /** Le HUD se voit-il à l'instant t ? */
  visible(t) {
    return this._tenu || t - this._depuis < this.delai;
  }

  /** Un toucher quelconque : il garde le HUD s'il est visible, sinon rien. */
  toucher(t) {
    if (this.visible(t)) this._depuis = t;
  }

  /**
   * Un TAP (court, sans glissement) à la hauteur `y` d'un écran de
   * `hauteur` : dans le tiers haut, il ramène un HUD effacé. Rend true si
   * le tap a servi à cela — l'appelant sait alors qu'il n'était pas
   * destiné à la scène.
   */
  tap(t, y, hauteur) {
    if (this.visible(t)) { this._depuis = t; return false; }
    if (y > hauteur / 3) return false;
    this._depuis = t;
    return true;
  }

  /** Un panneau s'ouvre (true) ou se ferme (false). */
  tenir(t, oui) {
    this._tenu = Boolean(oui);
    if (!oui) this._depuis = t;  // fermé : quatre secondes de plus, puis l'ombre
  }
}

/** Ce qui s'efface. Le bouton ☰ (#room-menu-btn) n'en est pas. */
export const EFFACES = ['#toolbox', '#minimap', '#room-badge-name', '#progress-badge'];

/**
 * Monte l'effacement, sur tactile seulement. Rend une poignée { dispose }.
 * Sans `matchMedia` (nœud) ou sur un écran à pointeur fin, ne fait rien.
 */
export function mountHudTactile(app, { delai = DELAI } = {}) {
  if (typeof document === 'undefined' || typeof matchMedia !== 'function') return null;
  if (!matchMedia('(pointer: coarse)').matches) return null;
  if (app._hudTactile) return app._hudTactile;

  const minuterie = new MinuterieHud({ delai });
  const maintenant = () => performance.now() / 1000;
  minuterie._depuis = maintenant();
  let appui = null;

  const panneauOuvert = () => Boolean(
    document.querySelector('#progress-badge[aria-expanded="true"], #visit-menu, #carte-pleine, #focus-overlay:not([hidden])')
  );

  const surAppui = (e) => {
    if (!e.isPrimary) return;
    appui = { x: e.clientX, y: e.clientY, t: maintenant() };
    minuterie.toucher(appui.t);
  };
  const surLever = (e) => {
    if (!appui || !e.isPrimary) return;
    const t = maintenant();
    const glisse = Math.hypot(e.clientX - appui.x, e.clientY - appui.y) > TAP_PX;
    const long = (t - appui.t) * 1000 > TAP_MS;
    if (!glisse && !long) minuterie.tap(t, e.clientY, window.innerHeight);
    appui = null;
  };
  // en capture et passifs : on ÉCOUTE, on ne prend rien à la scène
  document.addEventListener('pointerdown', surAppui, { capture: true, passive: true });
  document.addEventListener('pointerup', surLever, { capture: true, passive: true });

  let efface = false;
  const tick = () => {
    const t = maintenant();
    const ouvert = panneauOuvert();
    if (ouvert !== minuterie._tenu) minuterie.tenir(t, ouvert);
    const veut = !minuterie.visible(t);
    if (veut === efface) return;
    efface = veut;
    document.body.classList.toggle('hud-efface', efface);
  };
  const off = app.onUpdate?.(tick);

  const poignee = {
    minuterie,
    dispose() {
      off?.();
      document.removeEventListener('pointerdown', surAppui, { capture: true });
      document.removeEventListener('pointerup', surLever, { capture: true });
      document.body.classList.remove('hud-efface');
      app._hudTactile = null;
    }
  };
  app._hudTactile = poignee;
  return poignee;
}

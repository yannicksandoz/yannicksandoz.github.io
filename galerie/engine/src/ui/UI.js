import { collectCredits, collectSources } from '../core/credits.js';
import { t, lang, traduireDom, onLangChange } from '../core/i18n.js';

/**
 * Interface DOM : écran d'accueil (chargement + déblocage AudioContext),
 * fiche d'œuvre du module FocusCamera, indice de navigation, aide tactile
 * au premier lancement, écran de crédits.
 */
export class UI {
  constructor() {
    this.enterScreen = document.getElementById('enter-screen');
    this.enterBtn = document.getElementById('enter-btn');
    this.loadBar = document.getElementById('load-bar');
    this.loadBarFill = this.loadBar?.querySelector('i');
    this.focusOverlay = document.getElementById('focus-overlay');
    this.focusTitle = document.getElementById('focus-title');
    this.focusDesc = document.getElementById('focus-desc');
    this.focusClose = document.getElementById('focus-close');
    this.hint = document.getElementById('hint');
    this.touchHint = document.getElementById('touch-hint');
    this._onCloseFocus = null;

    this.focusClose.addEventListener('click', () => this._onCloseFocus?.());
    this._applyLang();
    this._confineToWelcome();
    // Un changement de langue re-traduit le HTML statique et les textes
    // composés (pense-bêtes, crédits) sans recharger la page.
    onLangChange(() => this._applyLang());
  }

  /** (Re)pose les textes traduits, puis les vraies étiquettes de touches. */
  _applyLang() {
    traduireDom();
    const enterBtn = this.enterBtn;
    if (enterBtn) {
      enterBtn.textContent = t(enterBtn.disabled ? 'enter.loading' : 'enter.enter');
    }
    this._renderKeyTexts();
    this._refineKeyLabels();
    this._credits?.();  // les crédits contiennent des libellés traduits
  }

  /**
   * Textes contenant des étiquettes de touches : reconstruits en HTML pour
   * que `data-keylabel` reste un point d'accroche de `_refineKeyLabels`.
   */
  _renderKeyTexts() {
    const pivot = '<span data-keylabel="pivot">A/E ou Q/E</span>';
    const tip = this.enterScreen?.querySelector('.tip');
    if (tip) tip.innerHTML = t('enter.tip', { pivot });
    if (this.hint) {
      // Le fragment « édition » n'existe que dans le build Auteur (le HTML
      // du build Visiteur ne le contient pas) : on le préserve tel quel.
      const edit = this.hint.querySelector('[data-keylabel="edit"]');
      const suffixe = edit ? ` · <b data-keylabel="edit">${edit.textContent}</b> : édition` : '';
      const move = lang() === 'en' ? 'WASD' : 'ZQSD / WASD';
      this.hint.innerHTML = t('hint.line', { move, pivot }) + suffixe;
    }
  }

  /**
   * Tant qu'on est à l'accueil, le reste du document est inerte : sans cela
   * un lecteur d'écran continue après les deux boutons et rencontre le ♥
   * « Soutenir l'artiste », les coins crédits/édition, etc. — du bruit
   * avant même d'être entré. Libéré par waitForEnter au moment du choix.
   * (En mode sans WebGL2, l'écran d'accueil est déjà remplacé par #nogl :
   * c'est alors lui le seul îlot vivant.)
   */
  _confineToWelcome() {
    const island = this.enterScreen ?? document.getElementById('nogl');
    if (!island) return;
    this._welcomeInerted = [];
    for (const el of document.body.children) {
      if (el !== island && !el.inert) {
        el.inert = true;
        this._welcomeInerted.push(el);
      }
    }
  }

  _releaseWelcome() {
    for (const el of this._welcomeInerted ?? []) el.inert = false;
    this._welcomeInerted = [];
    this._welcomeReleased = true;
  }

  /**
   * Remplace les étiquettes de touches par celles du clavier RÉEL.
   *
   * Les raccourcis sont liés aux touches physiques (`e.code`), mais
   * l'utilisateur lit des étiquettes : sur un AZERTY, la touche physique
   * KeyQ s'appelle « A ». `getLayoutMap()` (Chrome/Edge) donne la
   * correspondance ; ailleurs, les textes statiques restent — ils couvrent
   * déjà les deux dispositions courantes (« A/E ou Q/E »).
   */
  async _refineKeyLabels() {
    try {
      const map = await navigator.keyboard?.getLayoutMap?.();
      if (!map) return;
      const of = (code, fallback) => (map.get(code) || fallback).toUpperCase();
      document.querySelectorAll('[data-keylabel="pivot"]').forEach((el) => {
        el.textContent = `${of('KeyQ', 'Q')}/${of('KeyE', 'E')}`;
      });
      document.querySelectorAll('[data-keylabel="edit"]').forEach((el) => {
        el.textContent = of('Backquote', '²');
      });
    } catch { /* pas de carte de layout : les libellés neutres suffisent */ }
  }

  /** Branche la barre de progression sur le LoadingTracker de l'App. */
  bindLoading(tracker) {
    tracker.onChange((done, total) => {
      if (!this.loadBarFill) return;
      const pct = total > 0 ? Math.round((done / total) * 100) : 100;
      this.loadBarFill.style.width = `${pct}%`;
      if (total > 0 && done >= total) {
        this.loadBar.classList.add('complete');
      } else {
        this.loadBar.classList.remove('complete');
      }
    });
  }

  /** Le bouton « Entrer » reste désactivé tant que la config n'est pas lue. */
  setReady() {
    this.enterBtn.disabled = false;
    this.enterBtn.textContent = t('enter.enter');
    document.getElementById('enter-audio')?.removeAttribute('aria-disabled');
  }

  showLoadError(message) {
    const sub = this.enterScreen.querySelector('.sub');
    if (sub) {
      sub.textContent = message ?? t('enter.error');
      delete sub.dataset.i18n; // message d'erreur : ne pas le retraduire
    }
  }

  /**
   * Résout quand l'utilisateur choisit son mode d'entrée :
   * { audioTour: false } — visite 3D (bouton « Entrer », ou Entrée au
   * clavier quand AUCUN bouton n'a le focus) ;
   * { audioTour: true }  — visite audio accessible.
   *
   * Les deux gestes débloquent l'AudioContext (l'appelant s'en charge).
   * Le bouton audio est DERNIER dans l'ordre de tabulation : en parcourant
   * l'écran, un utilisateur de lecteur d'écran s'arrête dessus. Il reste
   * inerte tant que la configuration charge — même garde que le bouton
   * Entrer, mais sans `disabled`, qui le rendrait infocusable.
   *
   * Entrée « globale » : entre en 3D par défaut, mais SEULEMENT si le
   * focus n'est pas sur un élément activable — un utilisateur qui a tabulé
   * sur un bouton garde son Entrée locale, et VoiceOver active l'élément
   * sous son curseur par un clic, jamais par un Entrée brut.
   */
  waitForEnter() {
    return new Promise((resolve) => {
      const leave = (audioTour) => {
        window.removeEventListener('keydown', onKey);
        this._releaseWelcome(); // le reste du document redevient vivant
        this.enterScreen.classList.add('leaving');
        setTimeout(() => { this.enterScreen.remove(); }, 1300);
        if (!audioTour) this.hint.hidden = false;
        resolve({ audioTour });
      };
      const onKey = (e) => {
        if (e.key !== 'Enter' || this.enterBtn.disabled) return;
        const a = document.activeElement;
        if (a && a !== document.body && a.matches?.('button, a, input, select, textarea, [tabindex]')) return;
        leave(false);
      };
      window.addEventListener('keydown', onKey);
      this.enterBtn.addEventListener('click', () => leave(false), { once: true });
      const audioBtn = document.getElementById('enter-audio');
      audioBtn?.addEventListener('click', () => {
        if (this.enterBtn.disabled) return; // configuration pas encore lue
        leave(true);
      });
    });
  }

  /** Aide tactile éphémère, montrée une seule fois par appareil. */
  maybeShowTouchHint(isMobile) {
    if (!isMobile || !this.touchHint) return;
    try {
      if (localStorage.getItem('galerie-touch-hint')) return;
      localStorage.setItem('galerie-touch-hint', '1');
    } catch { /* stockage indisponible : on montre quand même */ }
    this.touchHint.hidden = false;
    setTimeout(() => {
      this.touchHint.classList.add('leaving');
      setTimeout(() => this.touchHint.remove(), 900);
    }, 6000);
  }

  showFocus(artwork, onClose) {
    this._onCloseFocus = onClose;
    this.focusTitle.textContent = artwork.config.title ?? artwork.config.id;
    this.focusDesc.textContent = artwork.config.description ?? '';
    this.focusOverlay.hidden = false;
  }

  hideFocus() {
    this.focusOverlay.hidden = true;
    this._onCloseFocus = null;
  }

  /**
   * Écran de crédits.
   *
   * Une licence CC-BY oblige à citer l'auteur, et cette obligation ne doit
   * pas dépendre de la mémoire de qui compose la scène : le crédit voyage
   * avec l'objet depuis la bibliothèque, et cet écran le publie. Le bouton
   * n'apparaît que s'il y a effectivement quelque chose à citer — une scène
   * entièrement personnelle ne s'encombre de rien.
   */
  /**
   * Badge de pièce (haut-gauche) : un petit bouton rond qui ouvre le menu
   * de la visite — Échap reste, mais le menu a désormais une porte
   * VISIBLE — et le nom de la pièce courante à côté : on sait toujours
   * où l'on est. Alimenté par RoomManager à chaque changement de pièce.
   */
  mountRoomBadge(app) {
    const el = document.createElement('div');
    el.id = 'room-badge';
    el.hidden = true; // apparaît avec le premier titre de pièce
    const btn = document.createElement('button');
    btn.id = 'room-menu-btn';
    btn.type = 'button';
    btn.textContent = '☰';
    const name = document.createElement('span');
    name.id = 'room-badge-name';
    el.append(btn, name);
    document.body.appendChild(el);
    // Le badge naît APRÈS _confineToWelcome : sans cela il resterait
    // cliquable et lu par-dessus l'écran d'accueil, alors que tout le reste
    // du document est neutralisé — on l'inclut donc dans le confinement.
    if (this._welcomeInerted?.length !== undefined && !this._welcomeReleased) {
      el.inert = true;
      this._welcomeInerted.push(el);
    }
    this._roomBadge = el;
    this._roomBadgeName = name;
    const label = () => btn.setAttribute('aria-label', t('menu.open'));
    label();
    onLangChange(label);
    btn.addEventListener('click', async () => {
      const { mountVisitMenu } = await import('./VisitMenu.js');
      mountVisitMenu(app);
    });
  }

  /** Met à jour le nom de pièce du badge (masqué tant qu'il n'y en a pas). */
  setRoomTitle(title) {
    if (!this._roomBadgeName) return;
    this._roomBadgeName.textContent = title ?? '';
    this._roomBadge.hidden = !title;
  }

  setCredits(works) {
    // mémorisé : un changement de langue re-rend la liste (mention de
    // plateforme et « auteur non précisé » sont traduits, le LIEN reste)
    this._credits = () => this.setCredits(works);

    const corner = document.getElementById('credits-corner');
    const overlay = document.getElementById('credits-overlay');
    const list = document.getElementById('credits-list');
    if (!corner || !overlay || !list) return;

    const credits = collectCredits(works);
    const sources = collectSources(works);
    corner.hidden = credits.length === 0 && sources.length === 0;
    if (corner.hidden) { overlay.hidden = true; return; }

    list.innerHTML = sources.map(mentionSource).join('') + credits.map((c) => {
      const who = esc(c.author || t('credits.unknown'));
      const name = c.sourceUrl
        ? `<a href="${esc(c.sourceUrl)}" target="_blank" rel="noopener noreferrer">${who}</a>`
        : who;
      return `<p><b>${name}</b>${c.license ? ` — ${esc(c.license)}` : ''}
        <br><span class="muted">${esc(c.titles.join(', '))}</span></p>`;
    }).join('');

    if (this._creditsWired) return;
    this._creditsWired = true;
    corner.addEventListener('click', () => { overlay.hidden = false; });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.closest('[data-credits-close]')) {
        overlay.hidden = true;
      }
    });
  }
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

/**
 * Mention obligatoire d'une plateforme source.
 *
 * Poly Pizza demande une mention nommée avec lien vers le service, en plus
 * de l'attribution de chaque auteur. C'est une condition d'usage, pas une
 * politesse : elle s'affiche dès qu'un modèle en vient, et rien ne permet
 * de la retirer.
 */
const PLATEFORMES = {
  polypizza: { cle: 'credits.polypizza', url: 'https://poly.pizza' }
};

function mentionSource(source) {
  const p = PLATEFORMES[source];
  if (!p) return '';
  // Le libellé se traduit, le lien ne bouge pas : c'est lui, l'obligation.
  return `<p class="credits-source"><a href="${esc(p.url)}" target="_blank"
    rel="noopener noreferrer">${esc(t(p.cle))}</a></p>`;
}

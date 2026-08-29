import { collectCredits, collectSources } from '../core/credits.js';
import { pointeurGrossier } from '../core/utils.js';
import { t, traduireDom, onLangChange } from '../core/i18n.js';
import { peindreLibelles } from '../core/clavier.js';
import { pisteAD, LecteurAD, mountLecteurAD } from '../core/audiodescription.js';

/**
 * Repli des touches de marche, tant que la disposition réelle n'est pas
 * connue (Firefox, Safari) : il nomme les deux dispositions courantes
 * plutôt que d'en choisir une au hasard.
 */
const MARCHE = '<span data-keylabel="move">ZQSD / WASD</span>';

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
    this.focusMeta = document.getElementById('focus-meta');
    this.focusActions = document.getElementById('focus-actions');
    this.focusClose = document.getElementById('focus-close');
    this.hint = document.getElementById('hint');
    this.touchHint = document.getElementById('touch-hint');
    this._onCloseFocus = null;
    // L'aide s'adresse à l'appareil RÉEL : un écran tactile n'a ni ZQSD ni
    // souris — lui parler de touches, c'est parler à quelqu'un d'autre.
    this.tactile = pointeurGrossier();

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
    // en plein vol, l'aide parle du vol : la traduction ne la ramène pas
    // aux touches de marche
    if (this._planant && this.hint) this.hint.textContent = t('hint.fly');
    this._refineKeyLabels();
    this._credits?.();  // les crédits contiennent des libellés traduits
  }

  /**
   * Textes contenant des étiquettes de touches : reconstruits en HTML pour
   * que `data-keylabel` reste un point d'accroche de `_refineKeyLabels`.
   */
  _renderKeyTexts() {
    const pivot = '<span data-keylabel="pivot">A/E ou Q/E</span>';
    // `peindreLibelles` remplacera ces replis par les vraies étiquettes
    // dès que la carte du clavier est connue — d'où le point d'accroche.
    const tip = this.enterScreen?.querySelector('.tip');
    if (tip) {
      tip.innerHTML = this.tactile
        ? t('enter.tip.touch') : t('enter.tip', { move: MARCHE, pivot });
    }
    if (this.hint) {
      if (this.tactile) {
        this.hint.textContent = t('hint.touch');
      } else {
        // Le fragment « édition » n'existe que dans le build Auteur (le HTML
        // du build Visiteur ne le contient pas) : on le préserve tel quel.
        const edit = this.hint.querySelector('[data-keylabel="edit"]');
        const suffixe = edit ? ` · <b data-keylabel="edit">${edit.textContent}</b> : édition` : '';
        this.hint.innerHTML = t('hint.line', { move: MARCHE, pivot }) + suffixe;
      }
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
   * Remplace les étiquettes de touches par celles du clavier RÉEL —
   * marche, pivot, et la touche d'édition. Voir `core/clavier.js` : les
   * raccourcis visent des POSITIONS, l'utilisateur lit des ÉTIQUETTES, et
   * les deux ne coïncident que sur un clavier américain.
   */
  _refineKeyLabels() {
    return peindreLibelles();
  }

  /** Branche la barre de progression sur le LoadingTracker de l'App. */
  bindLoading(tracker) {
    // LA CIBLE BOUGE, LA BARRE NON. Le total du tracker grandit à mesure que
    // les chargements s'ajoutent : une barre qui suit `fait/attendu` au pied
    // de la lettre RECULE après avoir presque fini. Trois règles la rendent
    // honnête, et chacune corrige une façon différente de mentir :
    //
    //   • elle ne recule jamais (progression monotone) ;
    //   • elle ne compte QUE la salle d'arrivée (voir LoadingTracker) — un
    //     scan gaussien préchargé dans la salle voisine, c'est 1,3 Mo et une
    //     dizaine de secondes de retard sur un écran qu'on peut déjà quitter ;
    //   • ELLE N'ATTEINT PAS LE BOUT AVANT LA FIN. Le premier fichier suivi
    //     donne 1/1 = 100 % : la barre se remplissait donc entièrement dès la
    //     première seconde, puis restait pleine et grise pendant tout le vrai
    //     chargement — pleine mais pas finie, ce qui se lit comme une panne.
    //     Elle plafonne à 92 % tant que tout n'est pas là ; les 8 % restants
    //     n'appartiennent qu'à la fin, et la fin verdit la barre.
    //
    // Fini reste fini : les chargements paresseux d'après appartiennent à la
    // visite, plus à l'accueil.
    // DEUX PHASES, PARCE QU'IL Y EN A DEUX. Un compte seul ne peut pas être
    // honnête au démarrage : le premier fichier suivi vaut 1/1, donc 100 %.
    // Or le chargement a bien deux temps, et le second ne commence qu'une
    // fois le premier fini :
    //   1. LIRE LA GALERIE (works.json, rooms.json, réglages) — on ne sait
    //      pas encore ce qu'il y aura à charger ; la barre monte jusqu'à
    //      LECTURE et s'y arrête. C'est `setReady` qui la clôt ;
    //   2. CHARGER LA SALLE D'ARRIVÉE — là seulement le rapport
    //      `faits / essentiels` veut dire quelque chose ; il occupe le reste,
    //      moins les derniers pour-cent qui n'appartiennent qu'à la fin.
    const LECTURE = 45;
    const PLAFOND_AVANT_FIN = 92;
    let plafond = 0;
    let fini = false;
    let verrou = null;
    this._peindreBarre = (faits, essentiels) => {
      if (!this.loadBarFill || fini) return;
      let brut;
      if (this._configPrete) {
        // La phase 2 compte À PARTIR DE ZÉRO : au moment où la galerie est
        // lue, le seul suivi terminé est works.json lui-même — un rapport
        // brut vaudrait 1/1 et remplirait la barre avant que la salle
        // d'arrivée ait seulement demandé son premier fichier. On repart
        // donc du compte de ce moment-là (`_base`).
        const [baseFaits, baseEssentiels] = this._base ?? [0, 0];
        const restant = essentiels - baseEssentiels;
        const part = restant > 0 ? (faits - baseFaits) / restant : 0;
        brut = LECTURE + part * (PLAFOND_AVANT_FIN - LECTURE);
      } else {
        brut = (essentiels > 0 ? faits / essentiels : 0) * LECTURE;
      }
      plafond = Math.max(plafond, Math.min(Math.round(brut), PLAFOND_AVANT_FIN));
      this.loadBarFill.style.width = `${plafond}%`;
    };
    tracker.onChange((done, total, faits, essentiels) => {
      if (!this.loadBarFill || fini) return;
      this._dernierCompte = [faits, essentiels];
      this._peindreBarre(faits, essentiels);
      clearTimeout(verrou);
      // Fini : tout ce que la salle d'arrivée demandait est là, et la
      // galerie est lue. Sans cette seconde condition, le tout premier
      // fichier (1/1) déclencherait la fin avant même que la scène existe.
      if (this._configPrete && essentiels > 0 && faits >= essentiels) {
        verrou = setTimeout(() => {
          fini = true;
          this.loadBarFill.style.width = '100%';
          this.loadBar.classList.add('complete');
        }, 400);
      }
    });
  }

  /** Le bouton « Entrer » reste désactivé tant que la config n'est pas lue. */
  setReady() {
    // La galerie est lue : la barre passe de la phase « lecture » à la phase
    // « salle d'arrivée » (voir bindLoading), et repart du compte courant.
    this._configPrete = true;
    this._base = this._dernierCompte ?? [0, 0];
    if (this._dernierCompte) this._peindreBarre?.(...this._dernierCompte);
    this.enterBtn.disabled = false;
    this.enterBtn.textContent = t('enter.enter');
    document.getElementById('enter-audio')?.removeAttribute('aria-disabled');
  }

  /**
   * Échec de chargement : on le dit, ET on offre la porte de sortie.
   * L'incident est presque toujours passager (un fichier de configuration
   * mal servi sur une connexion froide) — le visiteur ne devrait pas avoir
   * à deviner qu'un rechargement suffit.
   */
  showLoadError(message) {
    const sub = this.enterScreen?.querySelector('.sub');
    if (sub) {
      sub.textContent = message ?? t('enter.error');
      delete sub.dataset.i18n; // message d'erreur : ne pas le retraduire
    }
    if (this._retryBtn || !this.enterBtn) return;
    const btn = document.createElement('button');
    btn.id = 'enter-retry';
    btn.type = 'button';
    btn.textContent = t('enter.retry');
    btn.addEventListener('click', () => window.location.reload());
    this.enterBtn.replaceWith(btn);   // il prend la place d'« Entrer », inutile
    this._retryBtn = btn;
    btn.focus();
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

  /**
   * Entrée DIRECTE (lien profond depuis la liste 2D ou un partage) : pas
   * d'écran d'accueil — on arrive devant l'œuvre. L'AudioContext, lui,
   * exige toujours un geste : l'appelant le débloque au premier.
   */
  skipEnter() {
    if (!this.enterScreen) return;
    this._releaseWelcome();
    this.enterScreen.classList.add('leaving');
    setTimeout(() => { this.enterScreen.remove(); }, 1300);
    this.hint.hidden = false;
  }

  /**
   * On plane : l'aide le dit, et dit comment se poser. La visite guidée
   * laisse le visiteur en l'air (c'est là que l'œuvre se regarde) ; sans un
   * mot, se retrouver à voler passerait pour une panne.
   */
  planer(actif) {
    if (!this.hint || this._planant === actif) return;
    this._planant = actif;
    this.hint.classList.toggle('en-vol', actif);
    if (actif) this.hint.textContent = t('hint.fly');
    else this._renderKeyTexts();
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
    const cfg = artwork.config;
    this._focusConfig = cfg;
    this.focusTitle.textContent = cfg.title ?? cfg.id;
    this.focusDesc.textContent = cfg.description ?? '';

    // Cartel : année · technique — les champs sont optionnels dans le JSON,
    // la ligne n'existe que si l'un d'eux est renseigné.
    if (this.focusMeta) {
      const meta = [cfg.year, cfg.technique].filter(Boolean).join(' · ');
      this.focusMeta.textContent = meta;
      this.focusMeta.hidden = !meta;
    }

    // Actions : voir l'image en grand (si l'œuvre en a une), lien externe.
    if (this.focusActions) {
      const imgBtn = this.focusActions.querySelector('#focus-image');
      const lien = this.focusActions.querySelector('#focus-link');
      const aImage = typeof cfg.image === 'string' && cfg.image.length > 0;
      imgBtn.hidden = !aImage;
      imgBtn.textContent = t('focus.image');
      if (aImage) {
        imgBtn.onclick = () => this.showImageViewer(
          artwork.app.resolveAsset(cfg.image), cfg.title ?? cfg.id);
      }
      // Audiodescription : la voix qui dit ce que l'image montre. Le bouton
      // n'existe que si un enregistrement existe pour la langue courante ;
      // il porte SA langue, pour que le lecteur d'écran l'annonce juste.
      const adBtn = this.focusActions.querySelector('#focus-ad');
      if (adBtn) {
        const piste = pisteAD(cfg);
        adBtn.hidden = !piste;
        if (piste) {
          const lecteur = mountLecteurAD(artwork.app);
          this._lecteurAD = lecteur;
          adBtn.lang = piste.lang;
          adBtn.textContent = LecteurAD.libelle(lecteur.enCours === cfg);
          adBtn.setAttribute('aria-pressed', String(lecteur.enCours === cfg));
          adBtn.onclick = () => lecteur.basculer(cfg);
          // Une seule inscription : le libellé suit le lecteur, y compris
          // quand la description se termine d'elle-même.
          if (!this._adAbonne) {
            this._adAbonne = true;
            lecteur.onChange((l) => this._peindreAD(l));
          }
        }
      }

      const aLien = typeof cfg.link === 'string' && /^https?:\/\//.test(cfg.link);
      lien.hidden = !aLien;
      if (aLien) {
        lien.href = cfg.link;
        lien.textContent = t('focus.link');
      }
      this.focusActions.hidden = !aImage && !aLien;
    }
    this.focusOverlay.hidden = false;
  }

  /** Le bouton d'audiodescription suit l'état du lecteur (fin, arrêt). */
  _peindreAD(lecteur) {
    const b = this.focusActions?.querySelector('#focus-ad');
    if (!b || b.hidden) return;
    const parle = Boolean(lecteur.enCours) && lecteur.enCours === this._focusConfig;
    b.textContent = LecteurAD.libelle(parle);
    b.setAttribute('aria-pressed', String(parle));
  }

  hideFocus() {
    // Reculer, c'est quitter l'œuvre : sa description s'arrête avec elle.
    this._focusConfig = null;
    this._lecteurAD?.arreter();
    this.focusOverlay.hidden = true;
    this._onCloseFocus = null;
  }

  /**
   * Vue détail : l'image de l'œuvre, seule, en plein écran. Échap ou un
   * clic n'importe où referme — et l'Échap est intercepté en amont
   * (capture) pour ne pas faire reculer la caméra en même temps.
   */
  showImageViewer(url, alt = '') {
    const overlay = document.getElementById('image-viewer');
    const img = document.getElementById('viewer-img');
    if (!overlay || !img) return;
    img.src = url;
    img.alt = alt;
    overlay.hidden = false;
    const close = overlay.querySelector('#viewer-close');
    const rendu = document.activeElement;
    close?.focus();
    const fermer = () => {
      overlay.hidden = true;
      img.src = '';
      window.removeEventListener('keydown', surTouche, true);
      overlay.removeEventListener('click', surClic);
      if (rendu instanceof HTMLElement) rendu.focus?.();
    };
    const surTouche = (e) => {
      if (e.key !== 'Escape' && e.key !== 'Tab') return;
      if (e.key === 'Tab') { e.preventDefault(); close?.focus(); return; }
      e.stopPropagation();
      fermer();
    };
    const surClic = () => fermer();
    window.addEventListener('keydown', surTouche, true);
    overlay.addEventListener('click', surClic);
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

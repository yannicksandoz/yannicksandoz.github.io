/**
 * Toolbox de visite — la rangée d'icônes en haut de l'écran.
 *
 * Le menu (Échap) est un ARRÊT : il fige la visite, couvre la vue, se lit.
 * Or les gestes les plus fréquents — plein écran, carte, capture, dérive,
 * couper le son — sont des gestes DE VISITE : on les fait en marchant, pas
 * en s'arrêtant. La toolbox les met à un clic, sans rien figer ; le menu
 * garde les réglages rares (langue, mémoire, minimap, FPS…).
 *
 * Icônes : petits SVG dessinés ici même (trait, pas de remplissage), dans
 * la sobriété des glyphes déjà en place (☰, ✕, ◈) — rien de vendu au build
 * visiteur, aucune bibliothèque.
 *
 * La capture d'écran lit le canevas au vol : le tampon WebGL n'est pas
 * conservé d'une frame à l'autre (preserveDrawingBuffer: false — plus
 * rapide), donc on rend UNE frame exprès, dans le même tour de boucle que
 * la lecture, et le pixel est encore là. PNG téléchargé, rien d'envoyé.
 */
import { t, onLangChange } from '../core/i18n.js';

/* Trait 24×24, rond aux bouts — le style d'icône le plus lisible en 1rem. */
const svg = (chemins) => `<svg viewBox="0 0 24 24" width="17" height="17"
  fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
  stroke-linejoin="round" aria-hidden="true">${chemins}</svg>`;

const ICONES = {
  agrandir: svg('<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M8 21H5a2 2 0 0 1-2-2v-3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>'),
  reduire: svg('<path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M16 3v3a2 2 0 0 0 2 2h3"/><path d="M8 21v-3a2 2 0 0 0-2-2H3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/>'),
  carte: svg('<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14"/><path d="M15 6v14"/>'),
  capture: svg('<path d="M20 19H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h3l2-3h6l2 3h3a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2z"/><circle cx="12" cy="13" r="3.5"/>'),
  derive: svg('<path d="M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H3"/><path d="M9.6 4.6A2 2 0 1 1 11 8H3"/><path d="M12.6 19.4A2 2 0 1 0 14 16H3"/>'),
  son: svg('<path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>'),
  sonCoupe: svg('<path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="m16 9 6 6"/><path d="m22 9-6 6"/>')
};

export class Toolbox {
  constructor(app) {
    this.app = app;
    this._build();
    onLangChange(() => this._peindre());
  }

  _build() {
    const el = document.createElement('div');
    el.id = 'toolbox';
    el.setAttribute('role', 'toolbar');
    const pleinEcranDispo = Boolean(document.fullscreenEnabled);
    // Chaque bouton porte un aria-label ET un title : le premier pour les
    // lecteurs d'écran, le second pour la souris qui hésite sur une icône.
    el.innerHTML = `
      ${pleinEcranDispo ? '<button id="tb-fullscreen" type="button"></button>' : ''}
      <button id="tb-carte" type="button"></button>
      <button id="tb-capture" type="button"></button>
      <button id="tb-derive" type="button" aria-pressed="false"></button>
      <button id="tb-son" type="button" aria-pressed="false"></button>`;
    document.body.appendChild(el);
    this.el = el;
    this._peindre();

    el.querySelector('#tb-fullscreen')?.addEventListener('click', async () => {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await document.documentElement.requestFullscreen();
      } catch { /* refusé par le navigateur : l'icône ne bouge pas */ }
    });
    // l'état réel fait foi (F11, Échap système, geste du menu…)
    document.addEventListener('fullscreenchange', () => this._peindre());

    el.querySelector('#tb-carte').addEventListener('click', async () => {
      if (this.app.ouvrirCarte) return this.app.ouvrirCarte();
      const { mountCartePleine } = await import('./Carte.js');
      mountCartePleine(this.app).ouvrir();
    });

    el.querySelector('#tb-capture').addEventListener('click', () => this._capturer());

    el.querySelector('#tb-derive').addEventListener('click', async () => {
      const { mountDerive } = await import('../core/Derive.js');
      const derive = mountDerive(this.app);
      if (derive.active) derive.arreter();
      else derive.demarrer();
    });
    // la dérive s'arrête aussi d'elle-même (fin de parcours, éditeur…) :
    // le bouton suit son état publié, pas le dernier clic
    document.addEventListener('galerie:derive', (e) => {
      this._deriveActive = Boolean(e.detail?.active);
      this._peindre();
    });

    el.querySelector('#tb-son').addEventListener('click', () => {
      this.app.audio?.couperLeSon(!this.app.audio.sonCoupe);
      this._peindre();
    });
  }

  /** (Re)pose icônes, libellés et états pressés — idempotent. */
  _peindre() {
    const pose = (id, icone, libelle, presse) => {
      const b = this.el.querySelector(id);
      if (!b) return;
      b.innerHTML = ICONES[icone];
      b.setAttribute('aria-label', libelle);
      b.title = libelle;
      if (presse !== undefined) b.setAttribute('aria-pressed', String(presse));
    };
    const plein = Boolean(document.fullscreenElement);
    pose('#tb-fullscreen', plein ? 'reduire' : 'agrandir',
      t(plein ? 'menu.fullscreen.exit' : 'menu.fullscreen'), plein);
    pose('#tb-carte', 'carte', t('tb.carte'));
    pose('#tb-capture', 'capture', t('tb.capture'));
    pose('#tb-derive', 'derive',
      t(this._deriveActive ? 'tb.derive.stop' : 'tb.derive'), Boolean(this._deriveActive));
    const coupe = Boolean(this.app.audio?.sonCoupe);
    pose('#tb-son', coupe ? 'sonCoupe' : 'son',
      t(coupe ? 'tb.son.rendre' : 'tb.son.couper'), coupe);
  }

  /** Rend une frame et la télécharge en PNG — tout reste sur la machine. */
  _capturer() {
    const app = this.app;
    if (!app.renderer || !app.composer) return;
    app.composer.render(); // le tampon n'est frais que si on vient de peindre
    app.renderer.domElement.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const piece = app.rooms?.current?.config.id ?? 'galerie';
      const heure = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      a.href = url;
      a.download = `galerie-${piece}-${heure}.png`;
      a.click();
      URL.revokeObjectURL(url);
      // un mot de confirmation, à la place du libellé, deux secondes
      const b = this.el.querySelector('#tb-capture');
      if (b) {
        b.classList.add('tb-fait');
        b.title = t('tb.capture.faite');
        setTimeout(() => {
          if (!b.isConnected) return;
          b.classList.remove('tb-fait');
          b.title = t('tb.capture');
        }, 2000);
      }
    }, 'image/png');
  }
}

let instance = null;

/** Monte la toolbox (une seule), une fois entré dans la visite 3D. */
export function mountToolbox(app) {
  if (!instance) {
    instance = new Toolbox(app);
    app.toolbox = instance;
  }
  return instance;
}

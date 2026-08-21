import { lang, t } from './i18n.js';

/**
 * L'audiodescription d'une œuvre — la voix qui dit ce que l'image montre.
 *
 * Une galerie sonore reste, pour ses images, une galerie muette : le titre
 * et la description écrite disent ce qu'une œuvre EST, pas ce qu'elle donne
 * à voir. L'audiodescription comble cet écart, et c'est un enregistrement,
 * pas une synthèse : la voix de l'auteur décrivant son image vaut mieux
 * qu'un robot lisant un texte que le lecteur d'écran lit déjà.
 *
 * Déclaration, par langue :
 *
 *   "audioDescription": { "fr": "audio/nebuleuse-ad-fr.mp3",
 *                         "en": "audio/nebuleuse-ad-en.mp3" }
 *
 * Une simple chaîne vaut pour le français. Sans fichier pour la langue
 * courante, on retombe sur le français — et le bouton porte alors
 * `lang="fr"`, pour que le lecteur d'écran l'annonce de la bonne voix.
 * Sans fichier du tout, il n'y a pas de bouton : jamais de promesse vide.
 */

/** La piste à lire pour la langue en cours, ou null. */
export function pisteAD(config) {
  const brut = config?.audioDescription;
  if (!brut) return null;
  if (typeof brut === 'string') {
    return brut.trim() ? { src: brut.trim(), lang: 'fr' } : null;
  }
  const courante = lang();
  const src = brut[courante] ?? brut.fr ?? brut.en ?? null;
  if (typeof src !== 'string' || !src.trim()) return null;
  return { src: src.trim(), lang: brut[courante] ? courante : (brut.fr ? 'fr' : 'en') };
}

/**
 * Lecteur unique : une seule audiodescription à la fois, et le reste de la
 * galerie s'efface pendant qu'elle parle.
 *
 * L'atténuation porte sur le maître audio, pas sur l'œuvre seule : ce qui
 * doit être intelligible, c'est la voix, et une nappe d'ambiance couvre une
 * voix aussi sûrement qu'un stem. La piste, elle, passe par un élément
 * <audio> ordinaire — hors du graphe spatialisé : une description ne vient
 * pas d'un point de l'espace, elle est dite à l'oreille.
 */
export class LecteurAD {
  constructor(app) {
    this.app = app;
    this.el = null;
    this.enCours = null;   // config de l'œuvre en cours de description
    this._abonnes = new Set();
  }

  onChange(fn) {
    this._abonnes.add(fn);
    return () => this._abonnes.delete(fn);
  }

  _notifier() {
    for (const fn of this._abonnes) fn(this);
  }

  /** Bascule : lance la description de cette œuvre, ou arrête la sienne. */
  basculer(config) {
    if (this.enCours === config) { this.arreter(); return false; }
    return this.lire(config);
  }

  lire(config) {
    const piste = pisteAD(config);
    if (!piste) return false;
    this.arreter();

    const el = new Audio(this.app.resolveAsset?.(piste.src) ?? piste.src);
    el.preload = 'auto';
    el.addEventListener('ended', () => this._fin());
    el.addEventListener('error', () => this._fin());
    this.el = el;
    this.enCours = config;
    this._attenuer(true);
    // Le geste utilisateur est encore chaud (bouton) : la lecture passe.
    el.play().catch(() => this._fin());
    this._notifier();
    return true;
  }

  arreter() {
    if (!this.el) return;
    const el = this.el;
    this.el = null;
    this.enCours = null;
    try { el.pause(); el.src = ''; } catch { /* déjà libre */ }
    this._attenuer(false);
    this._notifier();
  }

  _fin() {
    const parlait = Boolean(this.el);
    this.el = null;
    this.enCours = null;
    this._attenuer(false);
    if (parlait) this._notifier();
  }

  /** La galerie baisse la voix — puis la retrouve. */
  _attenuer(actif) {
    const audio = this.app.audio;
    if (!audio?.ctx || !audio.master) return;
    const cible = actif ? 0.25 : 1;
    audio.master.gain.setTargetAtTime(cible, audio.ctx.currentTime, 0.14);
  }

  /** Libellé du bouton, selon qu'elle parle ou non. */
  static libelle(enCours) {
    return enCours ? t('ad.stop') : t('ad.play');
  }
}

/** Point d'entrée : un lecteur pour toute la visite. */
export function mountLecteurAD(app) {
  if (!app.lecteurAD) app.lecteurAD = new LecteurAD(app);
  return app.lecteurAD;
}

/**
 * Mémoire de visite — ce que la galerie garde de vous.
 *
 * Longtemps, tout se rejouait à chaque visite : on rouvrait la galerie sur
 * six « ??? », les jetons ◈ étaient à reprendre, et rien ne disait qu'on
 * était déjà venu. Le pari était de préserver la surprise. Il coûtait plus
 * qu'il ne rapportait : une galerie qui se traverse en plusieurs fois — la
 * seule manière honnête d'en faire le tour — punissait celui qui revenait,
 * en effaçant la moitié de son travail entre deux sessions.
 *
 * Une seule mémoire, donc, et elle est ici. Elle tient dans une clé de
 * `localStorage` et retient :
 *
 *   • les pièces où l'on a POSÉ LE PIED (la carte s'en dessine) ;
 *   • les passages EMPRUNTÉS (les traits entre les pièces) ;
 *   • les œuvres rencontrées, et celles dévoilées par un jeton ;
 *   • les jetons ramassés, et le solde non dépensé.
 *
 * Ce qu'elle ne retient pas : où l'on se tenait, ce qu'on regardait. On
 * revient toujours par l'entrée — retrouver ses pas est le plaisir, être
 * reposé là où l'on s'était arrêté ne l'est pas.
 *
 * **Rien n'est irréversible** : « Recommencer la visite » (menu de visite)
 * efface tout et rend la galerie au premier jour. Sans ce bouton, une
 * mémoire persistante serait une porte sans poignée.
 *
 * Le stockage peut être refusé (navigation privée, réglage strict) : tout
 * y est en `try`, et la visite se déroule alors normalement, simplement
 * sans mémoire — la galerie ne doit jamais dépendre d'un droit d'écrire.
 */

const CLE = 'galerie-visite';
const VERSION = 1;

/** Lecture défensive : une mémoire illisible vaut une mémoire vide. */
function lire() {
  try {
    const brut = localStorage.getItem(CLE);
    if (!brut) return null;
    const o = JSON.parse(brut);
    return o && o.v === VERSION ? o : null;
  } catch { return null; }
}

const listeDe = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);

export class Memoire {
  constructor() {
    const o = lire() ?? {};
    this.pieces = new Set(listeDe(o.pieces));
    this.portes = new Set(listeDe(o.portes));
    this.oeuvres = new Set(listeDe(o.oeuvres));
    this.revelees = new Set(listeDe(o.revelees));
    this.jetonsPris = new Set(listeDe(o.jetons?.pris));
    this.jetonsSolde = Number.isFinite(o.jetons?.solde) ? Math.max(0, o.jetons.solde) : 0;
    // vraie à la construction si la galerie nous connaissait déjà : de quoi
    // dire « bon retour » plutôt que « bienvenue », et rien de plus
    this.reprise = this.pieces.size > 0 || this.oeuvres.size > 0;
    this._abonnes = new Set();
  }

  onChange(fn) {
    this._abonnes.add(fn);
    return () => this._abonnes.delete(fn);
  }

  /** Nom canonique d'un passage : une porte est la même vue des deux côtés. */
  static porte(a, b) {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  }

  aVu(piece) { return this.pieces.has(piece); }
  aPris(porteA, porteB) { return this.portes.has(Memoire.porte(porteA, porteB)); }

  /**
   * Note quelque chose. Rend true si c'est NOUVEAU — l'appelant peut alors
   * décider d'en faire un événement (un trait qui apparaît sur la carte).
   */
  noter(champ, valeur) {
    const set = this[champ];
    if (!(set instanceof Set) || !valeur || set.has(valeur)) return false;
    set.add(valeur);
    this._ecrire();
    return true;
  }

  /** Note un passage franchi, dans les deux sens à la fois. */
  noterPorte(a, b) {
    return a && b && a !== b ? this.noter('portes', Memoire.porte(a, b)) : false;
  }

  /** Le solde de jetons ◈ : ce qui reste à dépenser. */
  setSolde(n) {
    const v = Math.max(0, Math.round(Number(n) || 0));
    if (v === this.jetonsSolde) return;
    this.jetonsSolde = v;
    this._ecrire();
  }

  /** Tout oublier — et le dire, pour que l'écran se refasse. */
  oublier() {
    this.pieces.clear();
    this.portes.clear();
    this.oeuvres.clear();
    this.revelees.clear();
    this.jetonsPris.clear();
    this.jetonsSolde = 0;
    this.reprise = false;
    try { localStorage.removeItem(CLE); } catch { /* stockage refusé */ }
    for (const fn of this._abonnes) fn(this);
  }

  /** Forme sérialisée — publique, car c'est elle que les tests vérifient. */
  serialiser() {
    return {
      v: VERSION,
      pieces: [...this.pieces],
      portes: [...this.portes],
      oeuvres: [...this.oeuvres],
      revelees: [...this.revelees],
      jetons: { solde: this.jetonsSolde, pris: [...this.jetonsPris] }
    };
  }

  _ecrire() {
    try {
      localStorage.setItem(CLE, JSON.stringify(this.serialiser()));
    } catch { /* stockage refusé — la visite continue sans mémoire */ }
    for (const fn of this._abonnes) fn(this);
  }
}

export function mountMemoire(app) {
  if (!app.memoire) app.memoire = new Memoire();
  return app.memoire;
}

/**
 * « Recommencer la visite » — oublier, ET le faire voir tout de suite.
 *
 * Effacer la mémoire ne suffit pas : les jetons déjà ramassés doivent
 * réapparaître dans les pièces, le compteur du catalogue retomber à zéro,
 * la carte redevenir blanche. Sans quoi l'écran continuerait d'afficher un
 * passé que la galerie a oublié — et il faudrait recharger la page pour y
 * croire.
 */
export function recommencerLaVisite(app) {
  app.memoire?.oublier();
  if (app.jetons) {
    app.jetons.compte = 0;
    app.jetons.oublier();       // les octaèdres seront reposés à l'entrée
  }
  if (app.progression) {
    app.progression.nouvelles = 0;
    app.progression._dwell?.clear?.();
    app.progression._peindre?.();
  }
  app._minimap?.redessiner?.();
}

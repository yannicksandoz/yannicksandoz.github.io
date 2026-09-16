/**
 * LA SÛRETÉ DU REGARD — les pointeurs que la toile n'a jamais vus partir.
 *
 * « Après un tour dans la galerie, je n'ai soudainement plus pu contrôler
 * la vue (rotation), seulement le joystick. » Le regard, c'est
 * OrbitControls sur la toile : il note chaque pointeur qui descend et ne
 * l'oublie qu'au `pointerup` ou `pointercancel` reçu PAR LA TOILE. Qu'un
 * relâchement lui échappe — une capture qui n'a pas pris, un geste avalé
 * par le système au bord de l'écran, un élément d'interface apparu sous
 * le doigt — et il garde un pointeur fantôme : dès lors chaque doigt qui
 * glisse compte pour deux, le glissé n'est plus une rotation mais un
 * pincement, et le regard est mort jusqu'au rechargement. Le manche,
 * lui, a sa propre sûreté (Controls._setupJoystick) et continue.
 *
 * Ici, la comptabilité seule, sans DOM (éprouvée au nœud) : ce qui est
 * descendu sur la toile, ce qu'elle a vu repartir, et ce qui reste — les
 * fantômes, à qui Controls envoie un `pointercancel` de synthèse quand la
 * fenêtre, elle, sait que tout est relâché (plus aucun contact tactile,
 * perte de focus, onglet caché) ou qu'un relâchement est passé ailleurs.
 */
export class SureteRegard {
  constructor() {
    this._enfonces = new Set();
  }

  /** Un pointeur descend sur la toile. */
  enfoncer(id) { this._enfonces.add(id); }

  /** La toile a vu ce pointeur repartir (up ou cancel) : plus rien à lui. */
  vu(id) { this._enfonces.delete(id); }

  /** Ce pointeur est-il encore tenu pour enfoncé sur la toile ? */
  tenu(id) { return this._enfonces.has(id); }

  /** Combien de pointeurs la toile tient encore. */
  get nombre() { return this._enfonces.size; }

  /**
   * Un relâchement vu par la FENÊTRE pour ce pointeur : s'il est encore
   * tenu, la toile ne l'a pas vu (cible ailleurs) — rend [id] à annuler,
   * ou [] si la toile l'avait bien vu. L'oublie dans les deux cas.
   */
  relacheAilleurs(id) {
    if (!this._enfonces.has(id)) return [];
    this._enfonces.delete(id);
    return [id];
  }

  /**
   * Plus aucun contact (fin du tactile, perte de focus, onglet caché) :
   * tout ce qui reste tenu est fantôme — rend la liste et oublie tout.
   */
  toutRelache() {
    const fantomes = [...this._enfonces];
    this._enfonces.clear();
    return fantomes;
  }
}

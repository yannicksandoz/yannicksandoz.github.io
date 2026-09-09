import { Module } from './Module.js';
import { portailPorte } from '../core/liens.js';

/**
 * PORTAIL — l'œuvre est une porte : l'activer emmène dans une autre pièce.
 *
 * Une « fonction activable » de l'œuvre, comme FocusCamera. La cible se lit
 * d'abord dans la PIÈCE : une entrée de `portals` dont `via` est l'id de
 * l'œuvre (voir liens.portailPorte) — la carte, les passages fermés et le
 * test « un aller a toujours son retour » y voient un portail ordinaire,
 * simplement sans porte dessinée ; l'œuvre est la porte. À défaut, les
 * params du module (`to`, `arrival`, `regard`, `plane`) disent la cible.
 *
 * APPROCHE, PUIS TRAVERSÉE. Placé APRÈS FocusCamera dans `modules`, il ne
 * reçoit le clic que lorsque FocusCamera l'a laissé passer, c'est-à-dire
 * une fois l'œuvre approchée : le premier clic approche (et la fiche dit
 * « Entrer »), le second — ou Espace, ou le bouton de la fiche — traverse.
 * Sans FocusCamera, le premier clic traverse.
 *
 *   "modules": [{ "type": "FocusCamera" }, { "type": "Portail" }]
 */
export class Portail extends Module {
  /** L'entrée de portail qui vaut : celle de la pièce (`via`), sinon les params. */
  get cible() {
    const salle = this.artwork.room?.config;
    const porte = portailPorte(salle, this.artwork.config.id);
    if (porte) return porte;
    const p = this.params ?? {};
    return p.to ? { to: p.to, arrival: p.arrival, regard: p.regard, plane: p.plane, via: this.artwork.config.id } : null;
  }

  /** Le titre de la pièce visée, pour la fiche et le survol. */
  get titreCible() {
    const to = this.cible?.to;
    return to ? (this.app.rooms?.get?.(to)?.config?.title ?? to) : null;
  }

  onClick() {
    if (this.app.editor?.enabled) return false;
    return this.traverser();
  }

  /** Part vers la pièce visée ; rend true si le départ a lieu. */
  traverser() {
    const cible = this.cible;
    if (!cible || !this.app.rooms?.allerA) return false;
    // la fiche et le travelling d'approche se referment : on part
    this.app.activeFocus?.release?.();
    return this.app.rooms.allerA(cible, { depuis: this.artwork.room?.config.id ?? null });
  }
}

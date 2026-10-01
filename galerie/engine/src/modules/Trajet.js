import { Module } from './Module.js';
import { parcoursDe, positionSurTrajet, capVers } from '../core/trajet-regles.js';

/**
 * TRAJET — l'œuvre se déplace en boucle sur un chemin, et sa source sonore
 * avec elle : la spatialisation lit la position du groupe à chaque image
 * (Artwork.update → `_worldPos`, puis Spatialisation), le panner suit.
 *
 * Le chemin part de l'objet, là où l'auteur l'a posé (`config.position`) :
 * les points sont des décalages en mètres. Les règles — formes, bornes,
 * échantillonnage, vitesse constante, allers-retours adoucis — vivent dans
 * core/trajet-regles.js, pures et testées.
 *
 * params (voir TRAJET_DEFAUT) :
 *  - forme       : 'ligne' | 'cercle' | 'courbe'
 *  - points      : [[dx, dy, dz], …] — l'arrivée (ligne), ou les points
 *                  de passage (courbe)
 *  - rayon, plan : le cercle ('horizontal' | 'face' | 'cote')
 *  - duree       : secondes par cycle (un aller-retour, ou un tour)
 *  - allerRetour : revenir sur ses pas (chemin ouvert) ; fermee : boucler (courbe)
 *  - orienter    : l'œuvre tourne pour regarder où elle va
 *  - phase       : 0…1, décale le départ (deux œuvres sur un même chemin)
 *
 * DANS L'ÉDITEUR, l'œuvre reste à sa place : le gizmo, l'inspecteur et la
 * sélection raisonnent sur la position écrite, et c'est elle que l'auteur
 * règle. Le mouvement ne se voit qu'en visite et à l'essai (« Tester »).
 * L'horloge est celle de l'application (`ctx.time`) : deux œuvres de même
 * durée restent en phase, et le mouvement reprend où il en était après une
 * pause de l'onglet.
 */
export class Trajet extends Module {
  init() {
    this.parcours = parcoursDe(this.params);
    this._base = null;      // la rotation Y écrite, pour `orienter`
    this._dernier = null;   // le dernier décalage appliqué (ombres)
    this._enPlace = true;   // vrai tant que l'œuvre est à sa position écrite
  }

  /** La position écrite de l'œuvre, lue à chaque image (l'éditeur peut la changer). */
  _origine() {
    const p = this.artwork.config.position ?? [0, 1.8, 0];
    return [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0];
  }

  _remettreEnPlace() {
    if (this._enPlace) return;
    const g = this.artwork.group;
    g.position.fromArray(this._origine());
    if (this._base !== null) { g.rotation.y = this._base; this._base = null; }
    this._enPlace = true;
    this._dernier = null;
    this.app.ombresSales = true;
  }

  update(_dt, ctx) {
    if (this.app.editor?.enabled) { this._remettreEnPlace(); return; }
    // hors de la salle courante ou de ses voisines, rien ne bouge : rien ne se voit ni ne s'entend
    const etat = this.artwork.room?.state ?? 'current';
    if (etat === 'far') { this._remettreEnPlace(); return; }
    const { point, tangente } = positionSurTrajet(this.parcours, ctx.time ?? 0);
    const o = this._origine();
    const g = this.artwork.group;
    g.position.set(o[0] + point[0], o[1] + point[1], o[2] + point[2]);
    if (this.parcours.trajet.orienter) {
      if (this._base === null) this._base = g.rotation.y;
      g.rotation.y = capVers(tangente);
    }
    this._enPlace = false;
    // les ombres se redessinent à 2 Hz au repos : une œuvre qui marche y
    // sauterait. Dès qu'elle a bougé d'un centimètre, la carte est marquée.
    const d = this._dernier;
    if (!d || Math.abs(d[0] - point[0]) + Math.abs(d[1] - point[1]) + Math.abs(d[2] - point[2]) > 0.01) {
      this._dernier = point;
      if (this.artwork.room?.isCurrent ?? true) this.app.ombresSales = true;
    }
  }

  dispose() {
    this._remettreEnPlace();
  }
}

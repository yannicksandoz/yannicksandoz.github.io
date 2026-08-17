import * as THREE from 'three';
import { Module } from './Module.js';
import { easeInOutCubic } from '../core/utils.js';

/**
 * Au clic sur l'œuvre : approche douce de la caméra jusqu'à un point de vue
 * face à l'œuvre, affichage d'une fiche (titre + description). Échap, le
 * bouton × ou un clic dans le vide ramènent la caméra à sa position d'origine.
 *
 * params :
 *  - distance (défaut 6)   : recul du point de vue par rapport à l'œuvre
 *  - height   (défaut 0)   : décalage vertical du point de vue
 *  - duration (défaut 1.4) : durée du travelling (secondes)
 */
export class FocusCamera extends Module {
  init() {
    this.state = 'idle'; // idle | in | focused | out
    this.t = 0;
    this._from = { pos: new THREE.Vector3(), target: new THREE.Vector3() };
    this._to = { pos: new THREE.Vector3(), target: new THREE.Vector3() };

    this._onKey = (e) => {
      if (e.code === 'Escape' && (this.state === 'focused' || this.state === 'in')) {
        this.release();
      }
    };
    window.addEventListener('keydown', this._onKey);
  }

  onClick() {
    if (this.app.editor?.enabled) return false; // l'éditeur a la priorité
    if (this.state === 'idle' || this.state === 'out') {
      this.focus();
      return true;
    }
    return false;
  }

  focus() {
    const controls = this.app.controls;
    const art = this.artwork.group;

    // On vise le CENTRE VU de l'œuvre, pas son origine : une construction
    // voxel a la sienne posée au sol (voxel.js), et s'en servir mettait la
    // caméra à hauteur zéro — le regard passait sous la carte. La boîte
    // englobante donne le vrai centre, quel que soit le type de modèle.
    const centre = art.position.clone();
    if (this.artwork.mesh) {
      const boite = new THREE.Box3().setFromObject(this.artwork.mesh);
      if (!boite.isEmpty()) boite.getCenter(centre);
    }
    // point de vue : face à l'œuvre, dans l'axe de sa normale (rotation Y)
    const dist = this.params.distance ?? 6;
    const dir = new THREE.Vector3(0, 0, 1).applyQuaternion(art.quaternion);
    this._to.pos.copy(centre).addScaledVector(dir, dist);
    this._to.pos.y = centre.y + (this.params.height ?? 0);
    // et jamais sous les pieds du visiteur : on contemple debout
    const solY = (this.artwork.room?.group.position.y ?? 0) + 1.6;
    if (this._to.pos.y < solY) this._to.pos.y = solY;
    this._to.target.copy(centre);

    this._from.pos.copy(this.app.camera.position);
    this._from.target.copy(controls.orbit.target);
    this._saved = {
      pos: this._from.pos.clone(),
      target: this._from.target.clone()
    };

    controls.locked = true;
    this.state = 'in';
    this.t = 0;
    this.app.ui.showFocus(this.artwork, () => this.release());
    this.app.setActiveFocus(this);
  }

  release() {
    if (this.state !== 'focused' && this.state !== 'in') return;
    this._from.pos.copy(this.app.camera.position);
    this._from.target.copy(this.app.controls.orbit.target);
    this._to.pos.copy(this._saved.pos);
    this._to.target.copy(this._saved.target);
    this.state = 'out';
    this.t = 0;
    this.app.ui.hideFocus();
  }

  /**
   * Résolution instantanée, sans travelling de retour ni restauration de la
   * caméra — pour un changement de pièce, où la caméra sera replacée de
   * toute façon. Sans cela, un module en plein recul cesse d'être mis à
   * jour dès que sa pièce n'est plus la courante : il resterait figé avec
   * les contrôles verrouillés.
   */
  cancel() {
    if (this.state === 'idle') return;
    this.state = 'idle';
    this.app.ui.hideFocus();
    if (this.app.activeFocus === this) {
      this.app.controls.locked = false;
      this.app.setActiveFocus(null);
    }
  }

  update(dt, _ctx) {
    if (this.state !== 'in' && this.state !== 'out') return;
    // Un autre module a pris le focus pendant notre recul : la caméra lui
    // appartient — on s'efface sans l'animer ni toucher au verrou.
    if (this.state === 'out' && this.app.activeFocus !== this) {
      this.state = 'idle';
      return;
    }
    // prefers-reduced-motion : travelling quasi instantané
    const duration = this.app.quality.reducedMotion
      ? 0.3
      : (this.params.duration ?? 1.4);
    this.t = Math.min(1, this.t + dt / duration);
    const k = easeInOutCubic(this.t);

    this.app.camera.position.lerpVectors(this._from.pos, this._to.pos, k);
    this.app.controls.orbit.target.lerpVectors(this._from.target, this._to.target, k);

    if (this.t >= 1) {
      if (this.state === 'in') {
        this.state = 'focused';
      } else {
        this.state = 'idle';
        // seul le focus encore enregistré rend le verrou : si un autre
        // module a pris la main entre-temps, c'est le sien désormais
        if (this.app.activeFocus === this) {
          this.app.controls.locked = false;
          this.app.setActiveFocus(null);
        }
      }
    }
  }

  dispose() {
    window.removeEventListener('keydown', this._onKey);
  }
}

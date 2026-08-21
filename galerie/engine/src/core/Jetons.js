import * as THREE from 'three';

/**
 * Jetons ◈ — la monnaie du raccourci, cachée dans le monde.
 *
 * Le catalogue se gagne à pied ; les jetons offrent l'autre chemin. De
 * petits octaèdres dorés sont dissimulés dans les pièces (déclarés dans le
 * JSON de chaque pièce : `"jetons": [[x, y, z], …]` — l'auteur en règle le
 * nombre selon celui des œuvres). On les ramasse en marchant dessus ;
 * chacun permet à la visite guidée de mener vers UNE œuvre non découverte.
 *
 * Deux économies, zéro paywall : explorer révèle les œuvres, fouiller
 * révèle les jetons — et les jetons achètent ce que l'exploration n'a pas
 * encore donné. Ramassés et solde SE GARDENT d'une visite à l'autre, comme
 * le catalogue et la carte : fouiller une pièce pour rien parce qu'on l'a
 * déjà fouillée la semaine dernière est le contraire d'un jeu. « Recommencer
 * la visite » (menu) recache tout.
 */

const PORTEE = 1.7;   // on ramasse en marchant dessus
const TAILLE = 0.26;

export class Jetons {
  constructor(app) {
    this.app = app;
    // « pris » et solde appartiennent à la mémoire de visite : un jeton
    // ramassé ne se repose pas, et ce qui n'a pas été dépensé attend.
    this._pris = this.app.memoire?.jetonsPris ?? new Set(); // "roomId:index"
    this.compte = this.app.memoire?.jetonsSolde ?? 0;
    this._meshes = new Map();    // roomId → [{ mesh, cle }]
    this._abonnes = new Set();
    this._mat = new THREE.MeshStandardMaterial({
      color: '#8a6d1f',
      emissive: '#ffd97a',
      emissiveIntensity: 0.75,
      roughness: 0.3,
      metalness: 0.6
    });
    this._geo = new THREE.OctahedronGeometry(TAILLE);
    this._off = app.onUpdate((dt, ctx) => this._tick(dt, ctx));
  }

  get total() {
    let n = 0;
    for (const room of this.app.rooms?.rooms?.values() ?? []) {
      n += (room.config.jetons ?? []).length;
    }
    return n;
  }

  onChange(fn) {
    this._abonnes.add(fn);
    return () => this._abonnes.delete(fn);
  }

  /** Dépense `n` jetons ; renvoie false s'il n'y en a pas assez. */
  depenser(n = 1) {
    if (this.compte < n) return false;
    this.compte -= n;
    this._notifier();
    return true;
  }

  _notifier() {
    this.app.memoire?.setSolde(this.compte);
    for (const fn of this._abonnes) fn(this);
    // le compteur ◈ vit sur le badge du catalogue
    this.app.progression?._peindre?.();
  }

  /**
   * Oublie les jetons POSÉS (d'une pièce, ou de toutes) sans rien rendre au
   * visiteur : les octaèdres déjà ramassés le restent, ceux qui attendaient
   * seront reposés à la prochaine visite de la pièce.
   *
   * Sert à l'éditeur : une reconstruction de scène détruit le groupe qui
   * portait les jetons, mais ce cache — qui existe pour ne pas les reposer
   * chaque frame — continuerait de croire le travail fait, et la pièce
   * resterait vide.
   */
  oublier(roomId = null) {
    if (roomId) this._meshes.delete(roomId); else this._meshes.clear();
  }

  /**
   * Les jetons encore posés dans une pièce. Un octaèdre doré ne fait aucun
   * bruit : la visite audio n'a aucun moyen de le chercher à l'oreille, et
   * sans cette liste la visite guidée qu'ils débloquent resterait fermée à
   * qui ne voit pas. Elle les annonce donc, et s'y rend — le ramassage,
   * lui, reste celui de tout le monde : la proximité (voir `_tick`).
   */
  restants(roomId) {
    return (this._meshes.get(roomId) ?? []).map((j) => j.mesh);
  }

  /** Pose (une fois) les jetons restants de la pièce dans son groupe. */
  _poser(room) {
    const id = room.config.id;
    if (this._meshes.has(id)) return;
    const liste = [];
    (room.config.jetons ?? []).forEach((pos, i) => {
      const cle = `${id}:${i}`;
      if (this._pris.has(cle)) return;
      const mesh = new THREE.Mesh(this._geo, this._mat);
      mesh.position.fromArray(pos);
      mesh.userData.ignoreRaycast = true;
      mesh.raycast = () => {};
      room.group.add(mesh);
      liste.push({ mesh, cle, y: pos[1] });
    });
    this._meshes.set(id, liste);
  }

  _tick(dt, ctx) {
    const room = this.app.rooms?.current;
    if (!room) return;
    this._poser(room);
    const liste = this._meshes.get(room.config.id);
    if (!liste?.length) return;

    const anim = !this.app.quality.reducedMotion;
    for (let i = liste.length - 1; i >= 0; i--) {
      const j = liste[i];
      if (anim) {
        j.mesh.rotation.y += dt * 1.8;
        j.mesh.position.y = j.y + Math.sin(ctx.time * 2.1 + j.y) * 0.08;
      }
      // portée mesurée en MONDE : la pièce a pu être orientée (Escher)
      const d = j.mesh.getWorldPosition(_pos).distanceTo(ctx.cameraPos);
      if (d < PORTEE + 1.2 && Math.abs(_pos.y - ctx.cameraPos.y) < 2.6
        && Math.hypot(_pos.x - ctx.cameraPos.x, _pos.z - ctx.cameraPos.z) < PORTEE) {
        if (this.app.memoire) this.app.memoire.noter('jetonsPris', j.cle);
        else this._pris.add(j.cle);
        j.mesh.removeFromParent();
        liste.splice(i, 1);
        this.compte++;
        this._notifier();
      }
    }
  }

  dispose() {
    this._off?.();
    for (const liste of this._meshes.values()) {
      for (const j of liste) j.mesh.removeFromParent();
    }
    this._meshes.clear();
    this._geo.dispose();
    this._mat.dispose();
  }
}

const _pos = new THREE.Vector3();

export function mountJetons(app) {
  if (!app.jetons) app.jetons = new Jetons(app);
  return app.jetons;
}

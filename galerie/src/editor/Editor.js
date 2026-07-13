import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

const SPHERE_COLORS = [0x38e0c8, 0x5aa0ff, 0xffc46b, 0xff7ab8];
const CROSSFADE_COLOR = 0xc06bff;

/**
 * Mode édition (touche E) :
 *  - clic sur une œuvre → gizmo de translation (TransformControls) ;
 *  - sphères filaires matérialisant les rayons audio (une par stem, plus
 *    celle du SpatialCrossfade s'il est présent) ;
 *  - panneau de réglage : rotation, rayon/gain par stem, rayon de crossfade ;
 *  - export du JSON mis à jour (fichier combiné works.json, ou œuvre seule).
 *
 * Les réglages modifient la configuration en place : les modules, qui lisent
 * leurs paramètres à chaque frame, réagissent immédiatement.
 */
export class Editor {
  constructor(app) {
    this.app = app;
    this.enabled = false;
    this.selected = null;
    this.panel = document.getElementById('editor-panel');
    this._spheres = new Map(); // artwork → THREE.Group

    this.tc = new TransformControls(app.camera, app.renderer.domElement);
    this.tc.setMode('translate');
    this.tc.visible = false;
    app.scene.add(this.tc);

    this.tc.addEventListener('dragging-changed', (e) => {
      // pendant le drag du gizmo, l'orbite est suspendue (voir Controls.update)
      app.controls.dragging = e.value;
    });
    this.tc.addEventListener('objectChange', () => this._syncFromGizmo());

    window.addEventListener('keydown', (e) => {
      if (e.target.matches('input, textarea')) return;
      if (e.code === 'KeyE') this.toggle();
    });

    app.onArtworkClick((artwork) => {
      if (!this.enabled) return false;
      if (artwork) this.select(artwork);
      return true; // en mode édition, l'éditeur consomme tous les clics
    });
  }

  toggle() {
    this.enabled = !this.enabled;
    if (this.enabled) {
      this._buildSpheres();
      this._renderPanel();
      this.panel.hidden = false;
    } else {
      this.select(null);
      this._destroySpheres();
      this.panel.hidden = true;
    }
  }

  select(artwork) {
    this.selected = artwork;
    if (artwork) {
      this.tc.attach(artwork.group);
      this.tc.visible = true;
    } else {
      this.tc.detach();
      this.tc.visible = false;
    }
    this._renderPanel();
  }

  /* -------------------------------------------------- sphères de rayon --- */

  _buildSpheres() {
    this._destroySpheres();
    for (const art of this.app.artworks) {
      const holder = new THREE.Group();
      const geo = new THREE.SphereGeometry(1, 18, 10);

      (art.config.stems ?? []).forEach((stem, i) => {
        const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
          color: SPHERE_COLORS[i % SPHERE_COLORS.length],
          wireframe: true, transparent: true, opacity: 0.09, depthWrite: false
        }));
        mesh.scale.setScalar(stem.radius ?? 12);
        mesh.userData.stem = stem;
        holder.add(mesh);
      });

      const crossfade = (art.config.modules ?? []).find((m) => m.type === 'SpatialCrossfade');
      if (crossfade) {
        crossfade.params = crossfade.params ?? {};
        const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
          color: CROSSFADE_COLOR,
          wireframe: true, transparent: true, opacity: 0.07, depthWrite: false
        }));
        mesh.scale.setScalar(crossfade.params.radius ?? 15);
        mesh.userData.crossfade = crossfade;
        holder.add(mesh);
      }

      art.group.add(holder);
      this._spheres.set(art, holder);
    }
  }

  _destroySpheres() {
    for (const [, holder] of this._spheres) {
      holder.removeFromParent();
      holder.traverse((o) => o.material?.dispose());
    }
    this._spheres.clear();
  }

  _syncFromGizmo() {
    const art = this.selected;
    if (!art) return;
    const p = art.group.position;
    art.config.position = [round(p.x), round(p.y), round(p.z)];
    const posEl = this.panel.querySelector('.pos');
    if (posEl) posEl.textContent = `position : [${art.config.position.join(', ')}]`;
  }

  /* ------------------------------------------------------------ panneau --- */

  _renderPanel() {
    if (!this.enabled) return;
    const art = this.selected;

    if (!art) {
      this.panel.innerHTML = `
        <h3>Mode édition</h3>
        <p class="muted">Cliquez sur une œuvre pour la sélectionner et la déplacer.
        Les sphères matérialisent les rayons audio.</p>
        <button data-action="export-all">Tout exporter (works.json)</button>
        <p class="muted">Le fichier exporté remplace <code>public/works/works.json</code>
        et prend le pas sur les fichiers individuels.</p>`;
      this._wire();
      return;
    }

    const cfg = art.config;
    const stemsHtml = (cfg.stems ?? []).map((stem, i) => `
      <h4>Stem ${i + 1} — ${stem.file.split('/').pop()}</h4>
      <div class="row">
        <label>rayon</label>
        <input type="range" min="1" max="45" step="0.5" value="${stem.radius ?? 12}"
               data-stem="${i}" data-prop="radius">
        <output>${stem.radius ?? 12}</output>
      </div>
      <div class="row">
        <label>gain</label>
        <input type="range" min="0" max="1.5" step="0.05" value="${stem.gain ?? 1}"
               data-stem="${i}" data-prop="gain">
        <output>${stem.gain ?? 1}</output>
      </div>`).join('');

    const crossfade = (cfg.modules ?? []).find((m) => m.type === 'SpatialCrossfade');
    const crossfadeHtml = crossfade ? `
      <h4>SpatialCrossfade</h4>
      <div class="row">
        <label>rayon</label>
        <input type="range" min="1" max="45" step="0.5" value="${crossfade.params?.radius ?? 15}"
               data-crossfade="radius">
        <output>${crossfade.params?.radius ?? 15}</output>
      </div>` : '';

    this.panel.innerHTML = `
      <h3>${cfg.title ?? cfg.id}</h3>
      <p class="pos">position : [${(cfg.position ?? []).join(', ')}]</p>
      <div class="row">
        <label>rotation Y</label>
        <input type="range" min="-180" max="180" step="1" value="${cfg.rotationY ?? 0}" data-rotation>
        <output>${cfg.rotationY ?? 0}°</output>
      </div>
      ${stemsHtml}
      ${crossfadeHtml}
      <button data-action="export-one">Exporter ${cfg.id}.json</button>
      <button data-action="export-all">Tout exporter</button>
      <p class="muted">Glissez le gizmo pour déplacer l'œuvre. E pour quitter l'édition.</p>`;
    this._wire();
  }

  _wire() {
    const art = this.selected;

    this.panel.querySelectorAll('input[data-stem]').forEach((input) => {
      input.addEventListener('input', () => {
        const stem = art.config.stems[Number(input.dataset.stem)];
        const value = Number(input.value);
        stem[input.dataset.prop] = value;
        input.nextElementSibling.textContent = value;
        if (input.dataset.prop === 'radius') this._updateSphere(art, stem, value);
      });
    });

    const rot = this.panel.querySelector('input[data-rotation]');
    rot?.addEventListener('input', () => {
      const deg = Number(rot.value);
      art.config.rotationY = deg;
      art.group.rotation.y = THREE.MathUtils.degToRad(deg);
      rot.nextElementSibling.textContent = `${deg}°`;
    });

    const cf = this.panel.querySelector('input[data-crossfade]');
    cf?.addEventListener('input', () => {
      const value = Number(cf.value);
      const mod = art.config.modules.find((m) => m.type === 'SpatialCrossfade');
      mod.params.radius = value;
      cf.nextElementSibling.textContent = value;
      const holder = this._spheres.get(art);
      holder?.children.forEach((m) => {
        if (m.userData.crossfade) m.scale.setScalar(value);
      });
    });

    this.panel.querySelector('[data-action="export-all"]')
      ?.addEventListener('click', () => this.exportAll());
    this.panel.querySelector('[data-action="export-one"]')
      ?.addEventListener('click', () => this.exportOne(art));
  }

  _updateSphere(art, stem, radius) {
    const holder = this._spheres.get(art);
    holder?.children.forEach((m) => {
      if (m.userData.stem === stem) m.scale.setScalar(radius);
    });
  }

  /* ------------------------------------------------------------- export --- */

  exportAll() {
    const data = this.app.artworks.map((a) => a.config);
    download('works.json', JSON.stringify(data, null, 2));
  }

  exportOne(art) {
    download(`${art.config.id}.json`, JSON.stringify(art.config, null, 2));
  }
}

function round(v) {
  return Math.round(v * 100) / 100;
}

function download(filename, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

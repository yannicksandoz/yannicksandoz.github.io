import * as THREE from 'three';
import { registry } from './ModuleRegistry.js';
import { buildPrimitive, isPrimitive } from './primitives.js';
import { loadModel, fitModel, modelKind } from './modelLoaders.js';
import { buildVoxelMesh, buildVoxelMeshMerged, buildVoxelCollider } from './voxel.js';
import { EDITOR_AVAILABLE } from '../editorLoader.js';
import { isWalkable } from './utils.js';
import { scaleObjetUV } from './textures.js';
import { jeuDeSurface } from './matieres.js';
import { creerCartel, tournerVersCamera, disposerCartel } from './cartels.js';

// crossOrigin « anonymous » : indispensable pour les médias distants, dont
// les pixels doivent être lisibles par WebGL (l'hôte doit autoriser le CORS).
/** Applique position / rotation (degrés XYZ) / échelle (XYZ) d'une config v2. */
export function applyTransform(object3d, config) {
  object3d.position.fromArray(config.position ?? [0, 1.8, 0]);
  const r = config.rotation ?? [0, 0, 0];
  object3d.rotation.set(
    THREE.MathUtils.degToRad(r[0] ?? 0),
    THREE.MathUtils.degToRad(r[1] ?? 0),
    THREE.MathUtils.degToRad(r[2] ?? 0)
  );
  const s = config.scale ?? [1, 1, 1];
  object3d.scale.set(s[0] ?? 1, s[1] ?? 1, s[2] ?? 1);
}

/**
 * Durée du fondu d'extinction d'une source, en secondes. Assez court pour
 * que le vol de voix reste instantané à l'oreille, assez long pour qu'une
 * nappe grave ne claque pas.
 */
const EXTINCTION = 0.12;

const textureLoader = new THREE.TextureLoader();
textureLoader.setCrossOrigin('anonymous');

/**
 * Couche des objets « selfLit » : une lumière n'éclaire un objet que si
 * leurs couches se croisent. Celle-ci n'appartient à aucune lumière — la
 * caméra, elle, la rend (voir App). C'est ainsi qu'une lanterne s'éclaire
 * toute seule sans se brûler.
 */
export const COUCHE_AUTO_ECLAIREE = 3;

/** Libère géométries, matériaux et textures d'une sous-arborescence. */
function disposeObject3D(root) {
  root.traverse((o) => {
    o.geometry?.dispose();
    if (o.material) {
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
        m.map?.dispose();
        m.emissiveMap?.dispose();
        m.dispose();
      });
    }
  });
}

/**
 * Cadre d'un panneau : quatre montants, pas un bloc plein.
 *
 * Le plan porte déjà sa texture sur ses DEUX faces (side: DoubleSide) —
 * mais un cadre plein posé derrière le masquait, et l'œuvre paraissait
 * noire quand on passait de l'autre côté. Un cadre évidé laisse voir
 * l'image en miroir depuis l'arrière, ce qui est exactement ce qu'on
 * attend d'une toile suspendue dans un espace traversable.
 */
function buildFrame(w, h) {
  const t = 0.09;  // épaisseur du montant
  const d = 0.08;  // profondeur, centrée sur le plan : visible des deux côtés
  const group = new THREE.Group();
  // même métal brossé que les chambranles de portail et les dormants de
  // baie : l'huisserie de la galerie est d'une seule main
  const surface = jeuDeSurface('metal');
  const mat = new THREE.MeshStandardMaterial({
    color: 0x14141c,
    map: surface?.map ?? null,
    bumpMap: surface?.bumpMap ?? null,
    bumpScale: surface?.bumpScale ?? 1,
    roughness: surface?.roughness ?? 0.4,
    metalness: surface?.metalness ?? 0.7
  });
  const bars = [
    [w + t * 2, t, 0, (h + t) / 2],
    [w + t * 2, t, 0, -(h + t) / 2],
    [t, h, -(w + t) / 2, 0],
    [t, h, (w + t) / 2, 0]
  ];
  for (const [bw, bh, x, y] of bars) {
    const geo = new THREE.BoxGeometry(bw, bh, d);
    if (surface) scaleObjetUV(geo, surface.metres);
    const bar = new THREE.Mesh(geo, mat);
    bar.position.set(x, y, 0);
    group.add(bar);
  }
  return group;
}

/** Redimensionne une texture au plafond du profil (mémoire GPU mobile). */
function capTextureSize(texture, maxSize) {
  const img = texture.image;
  if (!img || Math.max(img.width, img.height) <= maxSize) return texture;
  const scale = maxSize / Math.max(img.width, img.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  texture.image = canvas;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Une œuvre = un groupe Three.js positionné dans une pièce + un bus audio +
 * une liste de modules de comportement instanciés depuis sa configuration.
 *
 * Visuels possibles : image (plan texturé), vidéo (plan + VideoTexture,
 * playsinline/muted pour iOS, son routé dans le bus spatialisé via
 * MediaElementSource), modèle GLTF, ou primitive shader « monolith ».
 *
 * Cycle des assets : chargement sous `loadDistance`, libération au-delà de
 * 1,6 × ; les pièces lointaines forcent la libération (forceUnload) et les
 * pièces adjacentes préchargent sans jouer (setStemsActive / setVideoPlaying
 * pilotés par App et RoomManager).
 */
export class Artwork {
  constructor(config, app) {
    this.config = config;
    this.app = app;
    this.room = null; // renseigné par App.addArtwork

    this.group = new THREE.Group();
    applyTransform(this.group, config);
    this.group.userData.artwork = this;

    this.mesh = null;          // mesh final (visuel)
    this.hitMesh = null;       // cible du raycast (défini dès le placeholder)
    this.baseScale = 1;        // échelle du mesh (la pulsation la module)
    this.audioLevel = 0;       // alimenté par AudioReactive

    // état audio : source → gainStem → voie spatiale (ou direct) → entrée
    //              (lointain) → bus → master
    this.bus = null;
    this.entreeSon = null;    // là où les voies arrivent (voir Lointain.js)
    this._lointain = 0;
    this.stems = [];           // [{ cfg, gain, source, buffer, voie }]
    this._spatialOverride = null; // module HRTFPanner : distances d'œuvre
    this.audioReady = false;
    this._stemsActive = false;
    // Position MONDE, réévaluée chaque frame : c'est la seule qui vaille
    // pour l'audio (voir update). Un vecteur réutilisé, pas d'allocation.
    this._worldPos = new THREE.Vector3();

    this._video = null;
    this._mediaSrc = null;
    this.mediaError = null; // message si un média est illisible (CORS, 404…)

    this._visualRequested = false;
    this._visualLoaded = false;
    this._audioRequested = false;
    this._distance = Infinity;

    this._buildPlaceholder();

    // Lumière d'appoint propre à l'œuvre (pilotable par AudioReactive) —
    // créée SEULEMENT si elle éclaire. Chaque PointLight de la scène se
    // paie sur chaque pixel de chaque surface : les onze masses du
    // belvédère, éteintes (intensité 0), coûtaient quand même onze
    // lumières au shader.
    this.light = null;
    this.lightBaseIntensity = config.lightIntensity ?? 4;
    if (this.lightBaseIntensity > 0) this._buildLight();

    // instanciation des modules déclarés dans la config
    this.modules = (config.modules ?? [])
      .map((m) => registry.create(m.type, this, m.params, app))
      .filter(Boolean);
    for (const m of this.modules) m.init();

    // Balise de découverte : une petite lueur au-dessus des ŒUVRES que le
    // visiteur n'a pas encore rencontrées — un repère, pas une enseigne.
    // Elle s'éteint d'elle-même à la découverte (état lu chaque frame).
    // Les membres d'un ensemble (partOf) n'en portent pas : une lueur par
    // œuvre, pas une par objet.
    this._beacon = null;
    if (!app.headless && config.role !== 'decor' && !config.partOf) {
      this._buildBeacon();
    }

    // LE CARTEL — la plaque d'identification, comme au musée. Toute œuvre
    // (pas le décor) porte son titre dans le monde, pas seulement dans la
    // fiche cliquable : une galerie sans cartels demande au visiteur de
    // cliquer pour savoir DEVANT QUOI il se tient. `"cartel": false` dans
    // le JSON y renonce pour une œuvre qui veut rester anonyme.
    this._cartel = null;
    this._cartelPivote = false;
    if (!app.headless && config.role !== 'decor' && !config.partOf
      && config.title && config.cartel !== false) {
      this._buildCartel();
    }
  }

  /**
   * La pose suit la norme d'accrochage des musées :
   *
   *   • une œuvre MURALE (image, vidéo) reçoit sa plaque dans le PLAN du
   *     panneau, à sa droite, centrée à 1,45 m du sol — là où toutes les
   *     galeries du monde la mettent, là où la main irait la chercher ;
   *
   *   • une œuvre en VOLUME (sculpture, scan, primitive) reçoit une plaque
   *     posée à côté d'elle, plus basse (1,15 m, la hauteur d'un pupitre),
   *     qui PIVOTE vers le visiteur — une plaque de socle, pas une enseigne.
   *
   * Taille des lettres : 4,5 cm — lisible à deux ou trois mètres, la
   * distance d'un cartel réel ; il faut s'approcher pour lire, et c'est le
   * geste muséal voulu, celui qui rapproche aussi de l'œuvre (et du son).
   */
  _buildCartel() {
    const cfg = this.config;
    const auteur = cfg.credit?.author;
    const texte = auteur && auteur !== 'Galerie'
      ? `${cfg.title}\n${auteur}` : cfg.title;
    const cartel = creerCartel({
      texte, taille: 0.045, largeur: 1.7,
      ancrageX: 'center', ancrageY: 'middle', opacite: 0.92
    });
    if (!cartel) return;
    const posY = (cfg.position ?? [0, 0, 0])[1] ?? 0;
    const mural = Boolean(cfg.image || cfg.video);
    if (mural) {
      const largeur = (cfg.size ?? [2, 2])[0] * ((cfg.scale ?? [1, 1, 1])[0] ?? 1);
      cartel.position.set((largeur / 2) + 0.35, 1.45 - posY, 0.02);
    } else {
      // à côté du VOLUME, pas dedans : l'écart se mesure sur la boîte
      // englobante réelle (le hitMesh existe dès la construction), plus la
      // demi-largeur du texte — la plaque pivote autour de son origine, et
      // c'est cette origine qui doit être hors de l'œuvre
      let demiX = 0.5;
      const geo = this.hitMesh?.geometry;
      if (geo) {
        geo.computeBoundingBox();
        demiX = Math.max(demiX, (geo.boundingBox.max.x - geo.boundingBox.min.x) / 2);
      }
      const sx = (cfg.scale ?? [1, 1, 1])[0] || 1;
      cartel.position.set(demiX + ((0.3 + 0.85) / sx), 1.15 - posY, 0);
      this._cartelPivote = true;
    }
    // le groupe de l'œuvre porte parfois une échelle (une stèle est une
    // boîte étirée) : la plaque la compense, ses lettres restent des lettres
    const s = cfg.scale ?? [1, 1, 1];
    cartel.scale.set(1 / (s[0] || 1), 1 / (s[1] || 1), 1 / (s[2] || 1));
    cartel.renderOrder = 2;
    this._cartel = cartel;
    this.group.add(cartel);
  }

  _buildBeacon() {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: beaconTexture(),
      color: 0xcbb4ff,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    }));
    s.scale.setScalar(0.85);
    s.position.set(0, 2.3, 0);
    s.visible = false;
    s.raycast = () => {}; // jamais une cible de clic
    this.group.add(s);
    this._beacon = s;
  }

  _buildLight() {
    this.light = new THREE.PointLight(
      new THREE.Color(this.config.lightColor ?? '#7a6cff'),
      this.lightBaseIntensity, 14, 1.8);
    this.group.add(this.light);
    this._poserLumiere();
  }

  /** Portée, décroissance et position de la lampe — relues de la config. */
  _poserLumiere() {
    const cfg = this.config;
    const n = (v, repli) => (Number.isFinite(v) ? v : repli);
    this.light.distance = Math.max(0, n(cfg.lightDistance, 14));
    this.light.decay = Math.max(0, n(cfg.lightDecay, 1.8));
    const off = Array.isArray(cfg.lightOffset) ? cfg.lightOffset : [];
    this.light.position.set(n(off[0], 0), n(off[1], 0.4), n(off[2], 1.6));
  }

  /**
   * Relit couleur et intensité depuis la config — le chemin vif de
   * l'éditeur. La lumière naît ici si l'auteur allume une œuvre éteinte ;
   * repassée à zéro, elle disparaît vraiment (une PointLight à intensité
   * nulle coûte encore son poste dans le shader).
   */
  applyLight() {
    this.lightBaseIntensity = this.config.lightIntensity ?? 4;
    if (this.lightBaseIntensity > 0 && !this.light) this._buildLight();
    if (!this.light) return;
    if (this.lightBaseIntensity <= 0) {
      this.group.remove(this.light);
      this.light.dispose();
      this.light = null;
      return;
    }
    this.light.color.set(this.config.lightColor ?? '#7a6cff');
    this.light.intensity = this.lightBaseIntensity;
    this._poserLumiere();
  }

  /** Chemin de config → URL réelle (les imports de l'éditeur sont des blobs). */
  _resolve(path) {
    return this.app.resolveAsset(path);
  }

  /* ----------------------------------------------------------- visuel --- */

  _buildPlaceholder() {
    // En cas de média illisible, le placeholder vire au rouge sourd :
    // repère visuel immédiat dans l'éditeur, discret en visite.
    const mat = new THREE.MeshStandardMaterial({
      color: this.mediaError ? 0x1c0c10 : 0x101018,
      roughness: 0.8, metalness: 0.2,
      emissive: this.mediaError ? 0x4a1020 : 0x1a1a2e,
      emissiveIntensity: this.mediaError ? 0.6 : 0.4
    });
    // Un modèle PROCÉDURAL (primitive, monolithe, voxel) se construit en
    // une frame : montrer un panneau sombre en attendant, c'est un carré
    // noir qui clignote à chaque (re)chargement — le monolithe glitchait
    // ainsi. Le placeholder reste (cible de clic), mais invisible ; seuls
    // les médias RÉSEAU (image, vidéo, GLTF) gardent leur silhouette
    // d'attente, qui dit « ça charge ».
    const m0 = this.config.model;
    if (m0 && (m0.shape || m0.type === 'voxel')) mat.visible = false;
    // Un SCAN n'a pas de silhouette d'attente : le panneau sombre prévu
    // pour les images devenait un plan noir d'une face planté dans le
    // nuage de taches. La cible de clic prend la taille du pavé de
    // préhension, et reste invisible — le splat arrive sans écran devant.
    if (this.config.scan) mat.visible = false;
    const size = this.config.size ?? [4, 4];
    const m = this.config.model;
    let geo;
    if (this.config.scan) {
      const t = Array.isArray(this.config.scanTaille)
        && this.config.scanTaille.length === 3
        ? this.config.scanTaille : [2, 2, 2];
      geo = new THREE.BoxGeometry(...t);
    } else if (m?.type === 'voxel') {
      // Une construction vide se signale par un socle mince à l'emprise
      // exacte de sa grille : un bloc au centre masquerait le quadrillage
      // et gênerait la visée.
      const cell = m.cell ?? 0.25;
      const dims = m.dims ?? [16, 16, 16];
      geo = new THREE.BoxGeometry(dims[0] * cell, 0.04, dims[2] * cell);
    } else if (m) {
      geo = new THREE.BoxGeometry(1.2, m.height ?? m.size ?? 1.5, 1.2);
    } else {
      geo = new THREE.PlaneGeometry(size[0], size[1]);
    }
    this.hitMesh = new THREE.Mesh(geo, mat);
    if (m?.type === 'voxel') this.hitMesh.position.y = 0.02;
    this.group.add(this.hitMesh);
    this._placeholder = this.hitMesh;
  }

  async _loadVisual() {
    const cfg = this.config;
    try {
      if (cfg.scan) {
        // un SCAN gaussien (splatting) : la bibliothèque de rendu vit dans
        // son propre morceau et n'est téléchargée qu'ici, à la première
        // œuvre qui en a besoin — voir `core/scans.js`
        const { creerScan } = await import('./scans.js');
        const holder = await this.app.loading.track(
          creerScan(this._resolve(cfg.scan), { taille: cfg.scanTaille })
        );
        this._setMesh(holder);
      } else if (cfg.image) {
        const tex = await this.app.loading.track(
          textureLoader.loadAsync(this._resolve(cfg.image))
        );
        capTextureSize(tex, this.app.quality.profile.maxTextureSize);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = this.app.quality.profile.anisotropy ?? 4;
        this._setMesh(this._buildPanelMesh(tex));
      } else if (cfg.video) {
        this._setMesh(this._buildVideoMesh());
      } else if (cfg.model?.type === 'voxel') {
        // Grille vide : on garde le placeholder, sinon l'objet deviendrait
        // invisible ET impossible à sélectionner — donc impossible à remplir.
        // Build visiteur : la grille est figée, pavés fusionnés (~1 % des
        // instances, deux passes de rendu économisées). Build auteur :
        // version cellule-par-cellule, la seule qui se pique au rayon —
        // même si l'éditeur n'est pas encore OUVERT, car il peut l'être
        // à tout moment et les œuvres déjà chargées doivent rester
        // éditables. Le drapeau vient du chargeur substitué par Vite.
        const mesh = EDITOR_AVAILABLE
          ? buildVoxelMesh(cfg.model)
          : buildVoxelMeshMerged(cfg.model);
        if (mesh) this._setMesh(mesh);
      } else if (cfg.model?.url) {
        this._setMesh(await this._loadModelMesh(cfg.model));
      } else if (cfg.model?.shape === 'monolith') {
        this._setMesh(this._buildMonolith(cfg.model));
      } else if (isPrimitive(cfg.model?.shape)) {
        this._setMesh(buildPrimitive(cfg.model, cfg.scale));
      } else {
        console.warn(`[galerie] Œuvre ${cfg.id} : ni image, ni vidéo, ni scan, ni modèle reconnu.`);
      }
      this._visualLoaded = true;
      this._clearMediaError();
      this.app.notifyVisualLoaded?.(this);
    } catch (err) {
      // échec non fatal : l'œuvre garde son placeholder, la visite continue.
      // Cause fréquente pour une URL distante : CORS refusé, 404 ou réseau.
      console.error(`[galerie] Visuel de « ${cfg.id} » impossible à charger :`, err);
      this.setMediaError(`visuel illisible (${cfg.image ?? cfg.video ?? cfg.model?.url ?? '?'})`);
    }
  }

  /**
   * Modèle importé (GLB / glTF / OBJ). Les animations éventuelles sont
   * jouées en boucle ; l'échelle est normalisée si la config le demande
   * (`fit`), ce qui évite qu'un modèle en centimètres soit invisible.
   */
  async _loadModelMesh(model) {
    const { object3d, animations, triangles } = await this.app.loading.track(
      loadModel(this._resolve(model.url), {
        kind: model.type ?? modelKind(model.url),
        mtlUrl: model.mtl ? this._resolve(model.mtl) : undefined
      })
    );
    this.modelTriangles = triangles;
    if (triangles > 150000) {
      // on n'empêche rien : c'est votre scène. Mais autant le savoir avant
      // de constater les saccades sur un portable.
      this.modelWarning = `${triangles.toLocaleString('fr-FR')} triangles — lourd pour un laptop`;
      console.warn(`[galerie] « ${this.config.id} » : ${this.modelWarning}`);
    }

    if (model.fit !== false) fitModel(object3d, model.fit ?? 2);
    if (Number.isFinite(model.scale)) object3d.scale.multiplyScalar(model.scale);

    if (animations.length) {
      this._mixer = new THREE.AnimationMixer(object3d);
      for (const clip of animations) this._mixer.clipAction(clip).play();
      this.modelAnimations = animations.length;
    }
    // Groupe porteur : _setMesh écrase l'échelle du mesh reçu (baseScale,
    // pulsation d'AudioReactive). Sans cette enveloppe, cette écriture
    // annulait la normalisation `fit` calculée juste au-dessus — tous les
    // modèles revenaient à leur taille brute.
    const holder = new THREE.Group();
    holder.add(object3d);
    return holder;
  }

  /**
   * Reconstruit le seul maillage voxel, sur place.
   *
   * Chemin rapide de l'éditeur : recréer toute l'œuvre à chaque cellule posée
   * rechargerait ses stems et couperait le son. Ici on ne touche qu'à
   * l'InstancedMesh — le bus audio, les modules et le groupe restent intacts.
   * Renvoie false si l'œuvre n'est pas une construction voxel.
   */
  refreshVoxel() {
    if (this.config.model?.type !== 'voxel') return false;
    if (this.mesh) {
      this.group.remove(this.mesh);
      disposeObject3D(this.mesh);
      this.mesh = null;
      this.hitMesh = null;
    }
    const fresh = buildVoxelMesh(this.config.model);
    if (fresh) this._setMesh(fresh);
    else if (!this._placeholder) this._buildPlaceholder();
    this._visualRequested = true;
    this._visualLoaded = true;
    return true;
  }

  /** Signale un média illisible : placeholder rouge + message pour l'éditeur. */
  setMediaError(message) {
    this.mediaError = message;
    if (this._placeholder) {
      this._placeholder.material.color.set(0x1c0c10);
      this._placeholder.material.emissive.set(0x4a1020);
      this._placeholder.material.emissiveIntensity = 0.6;
    }
  }

  _clearMediaError() {
    this.mediaError = null;
  }

  _unloadVisual() {
    if (!this.mesh) return;
    if (this._video) {
      this._video.pause();
      this._mediaSrc?.disconnect();
      this._mediaSrc = null;
      this._video.removeAttribute('src');
      this._video.load();
      this._video = null;
    }
    this.group.remove(this.mesh);
    disposeObject3D(this.mesh);
    this._mixer?.stopAllAction();
    this._mixer = null;
    this.modelAnimations = 0;
    this.mesh = null;
    this._reactiveMaterial = null;
    this._visualLoaded = false;
    this._visualRequested = false;
    this._buildPlaceholder();
  }

  _buildPanelMesh(texture) {
    const [w, h] = this.config.size ?? [4, 4];
    const holder = new THREE.Group();

    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshStandardMaterial({
        map: texture,
        roughness: 0.85,
        emissive: 0xffffff,
        emissiveMap: texture,
        emissiveIntensity: 0.55, // l'image « éclaire » doucement — base du bloom
        side: THREE.DoubleSide
      })
    );
    holder.add(panel);
    holder.add(buildFrame(w, h));

    this._reactiveMaterial = panel.material;
    this._baseEmissive = panel.material.emissiveIntensity;
    return holder;
  }

  /**
   * Plan vidéo : playsinline + muted autorisent l'autoplay iOS. Si
   * `videoSound` est vrai, le son est routé dans le bus spatialisé de
   * l'œuvre (MediaElementSource) après le déblocage audio.
   */
  _buildVideoMesh() {
    const video = document.createElement('video');
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.preload = 'auto';
    video.crossOrigin = 'anonymous';
    video.src = this._resolve(this.config.video);
    this._video = video;
    if (!this.room || this.room.isCurrent) {
      video.play().catch(() => { /* rejouera au prochain setVideoPlaying */ });
    }

    const texture = new THREE.VideoTexture(video);
    texture.colorSpace = THREE.SRGBColorSpace;
    const mesh = this._buildPanelMesh(texture);
    this._tryAttachVideoAudio();
    return mesh;
  }

  _tryAttachVideoAudio() {
    if (!this.config.videoSound || !this._video || this._mediaSrc) return;
    if (!this.bus || !this.app.audio.unlocked) return;
    try {
      this._mediaSrc = this.app.audio.ctx.createMediaElementSource(this._video);
      // par l'entrée, comme les pistes : une vidéo lointaine l'est aussi
      this._mediaSrc.connect(this.entreeSon ?? this.bus);
      this._video.muted = false;
    } catch (err) {
      console.warn(`[galerie] Son vidéo de « ${this.config.id} » indisponible :`, err);
    }
  }

  /** Lecture/pause de la vidéo selon la pièce active (batterie + décodeur). */
  setVideoPlaying(active) {
    if (!this._video) return;
    if (active) this._video.play().catch(() => {});
    else this._video.pause();
  }

  _buildMonolith(params) {
    const height = params.height ?? 4;
    const color = new THREE.Color(params.color ?? '#66f0d8');
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uAudio: { value: 0 },
        uColor: { value: color }
      },
      vertexShader: /* glsl */ `
        uniform float uTime, uAudio;
        varying vec3 vPos, vNormal, vView;
        void main() {
          vPos = position;
          vNormal = normalize(normalMatrix * normal);
          vec3 p = position + normal * uAudio * 0.06 * sin(position.y * 5.0 + uTime * 2.5);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          vView = -mv.xyz;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime, uAudio;
        uniform vec3 uColor;
        varying vec3 vPos, vNormal, vView;
        void main() {
          float bands = smoothstep(0.42, 0.5, abs(fract(vPos.y * 1.6 - uTime * 0.12) - 0.5));
          float fresnel = pow(1.0 - abs(dot(normalize(vView), normalize(vNormal))), 2.2);
          vec3 col = uColor * 0.05
                   + uColor * bands * (0.25 + uAudio * 2.8)
                   + uColor * fresnel * (0.25 + uAudio * 1.4);
          gl_FragColor = vec4(col, 1.0);
        }`
    });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.1, height, 1.1, 1, 24, 1), mat);
    this._reactiveMaterial = mat;
    return mesh;
  }

  _setMesh(mesh) {
    if (this._placeholder) {
      this.group.remove(this._placeholder);
      this._placeholder.geometry.dispose();
      this._placeholder.material.dispose();
      this._placeholder = null;
    }
    this.mesh = mesh;
    this.hitMesh = mesh;
    // Une masse foulable (escalier, palier) reçoit un maillage de collision
    // en pavés : la même forme, mais quelques dizaines de boîtes au lieu de
    // milliers de cellules — c'est lui que les rayons de marche interrogent.
    this.collider = null;
    if (isWalkable(this.config) && this.config.model?.type === 'voxel') {
      const c = buildVoxelCollider(this.config.model);
      if (c) {
        mesh.add(c);           // enfant du mesh : il en hérite la transformation
        this.collider = c;
      }
    }
    mesh.scale.setScalar(this.baseScale);
    // Chaque œuvre se pose au sol par son ombre (lumière clé de la pièce).
    // Recevoir aussi : un modèle s'ombre lui-même, un socle reçoit l'œuvre.
    mesh.traverse?.((o) => {
      if (o.isMesh && !o.userData.sansOmbre) { o.castShadow = true; o.receiveShadow = true; }
    });
    // « selfLit » : l'objet ÉCLAIRE, il n'est pas éclairé. Une lanterne
    // porte sa lampe à quelques décimètres de sa propre paroi : avec une
    // décroissance en 1/d^1.8, elle se recevait plusieurs fois la pleine
    // intensité, virait au blanc pur et fleurissait dans le bloom — une
    // tache aveuglante là où l'on voulait une veilleuse. On l'écarte donc
    // de TOUTES les lumières (couche dédiée, que la caméra rend) : il ne
    // lui reste que son émission et le rebond d'image. La lampe, elle,
    // continue d'éclairer la pièce.
    if (this.config.selfLit) {
      mesh.traverse?.((o) => {
        o.layers.set(COUCHE_AUTO_ECLAIREE);
        if (o.isMesh) o.castShadow = false;
      });
    }
    this.group.add(mesh);
  }

  /**
   * Position MONDE de l'œuvre — la seule que partagent l'auditeur (placé
   * depuis la matrice monde de la caméra) et les sources. Recalculée à
   * chaque lecture : un vecteur mémorisé se serait périmé au premier
   * glissement de gizmo, et le coût se réduit à remonter deux parents.
   */
  get worldPosition() {
    return this.group.getWorldPosition(this._worldPos);
  }

  /* ------------------------------------------------------------ audio --- */

  async _loadAudio() {
    const engine = this.app.audio;
    const stemCfgs = this.config.stems ?? [];
    if (!stemCfgs.length && !this.config.videoSound) return;

    try {
      const buffers = await Promise.all(
        stemCfgs.map((s) => this.app.loading.track(engine.load(this._resolve(s.file))))
      );
      const ctx = engine.ctx;

      this.bus = ctx.createGain();
      this.bus.gain.value = this.config.baseGain ?? 1;
      // Une TRANCHE de la table : le bus n'arrive pas nu à la somme, il
      // passe par l'encodage Console (voir Console.js).
      // …et son départ vers la pièce. `audio.envoi` la garde sèche si elle
      // doit l'être : une voix intime ne veut pas de la salle autour.
      engine.brancherCanal(this.bus, {
        envoi: Number.isFinite(this.config.audio?.envoi) ? this.config.audio.envoi : 1
      });
      // …et, en amont du bus, l'insertion du LOINTAIN : `audio.lointain` dit
      // qu'une œuvre doit sonner comme si on ne pouvait jamais l'atteindre
      // (voir Lointain.js). Les voies s'y branchent au lieu du bus ; le bus
      // reste la clé de la console et le départ de réverbe.
      this._lointain = this.config.audio?.lointain ?? 0;
      this.entreeSon = engine.lointain?.inserer(this.bus, this._lointain) ?? this.bus;

      this.stems = stemCfgs.map((cfg, i) => {
        const gain = ctx.createGain();
        gain.gain.value = cfg.gain ?? 1;
        // Chaque piste passe par sa VOIE spatiale (panner HRTF + gain de
        // distance, voir Spatialisation.js) — sauf les nappes stéréo
        // (`"spatial": false`), branchées en direct, canaux intacts.
        const voie = this.app.spatial?.creerVoie(this, cfg, gain, this.entreeSon) ?? null;
        if (!voie) gain.connect(this.entreeSon);
        return { cfg, gain, source: null, buffer: buffers[i], voie };
      });

      // Les modules branchent panner/analyser et prennent la main sur les
      // gains avant tout démarrage de source (évite toute bouffée sonore).
      this.audioReady = true;
      for (const m of this.modules) m.onAudioReady?.();
      this._tryAttachVideoAudio();
      // Le démarrage effectif est décidé par le budget de stems de l'App.
    } catch (err) {
      // idem visuel : on n'interrompt pas la visite pour un stem manquant
      console.error(`[galerie] Audio de « ${this.config.id} » impossible à charger :`, err);
      this.setMediaError('son illisible (réseau, CORS ou format)');
    }
  }

  /**
   * Active/suspend les sources (appelé par App._updateStemBudget). Les stems
   * d'une même œuvre démarrent au même instant pour rester en phase.
   */
  setStemsActive(active) {
    if (!this.audioReady || active === this._stemsActive) return;
    this._stemsActive = active;
    const ctx = this.app.audio.ctx;

    if (active) {
      const t0 = ctx.currentTime + 0.05;
      for (const s of this.stems) {
        // Le gain de la piste a été FONDU À ZÉRO à la suspension (voir
        // l'arrêt en fondu, ci-dessous) : sans le rendre ici, une œuvre
        // suspendue — budget de voix, pièce quittée — rejouait ses sources
        // dans un gain mort et restait muette pour toujours. C'était le
        // monolithe qui « ne revient pas » : seul un mélangeur de couches,
        // qui reconduit les gains chaque frame, masquait le défaut.
        s.gain.gain.cancelScheduledValues(t0);
        s.gain.gain.setTargetAtTime(s.cfg.gain ?? 1, t0, 0.12);
        const src = ctx.createBufferSource();
        src.buffer = s.buffer;
        src.loop = true;
        src.connect(s.gain);
        src.start(t0);
        s.source = src;
      }
    } else {
      // ARRÊT EN FONDU. `stop()` tranche l'onde où elle se trouve : sur une
      // nappe grave, c'est un claquement franc. Or le budget de voix en
      // arrête toutes les demi-secondes, dès qu'une œuvre plus proche
      // réclame sa place — le visiteur entendait la mécanique.
      const t = ctx.currentTime;
      for (const s of this.stems) {
        s.gain.gain.cancelScheduledValues(t);
        s.gain.gain.setTargetAtTime(0, t, EXTINCTION / 3);
        const src = s.source;
        s.source = null;
        if (!src) continue;
        try { src.stop(t + EXTINCTION); } catch { /* déjà arrêtée */ }
        // la déconnexion attend la fin du fondu, sinon elle le coupe
        src.onended = () => { try { src.disconnect(); } catch { /* déjà */ } };
      }
    }
  }

  _unloadAudio() {
    this.setStemsActive(false);
    for (const m of this.modules) m.onAudioReleased?.();
    for (const s of this.stems) {
      s.gain.disconnect();
      this.app.spatial?.libererVoie(s.voie);
      this.app.audio.release(this._resolve(s.cfg.file));
    }
    if (this.bus) {
      this.app.audio.debrancherCanal(this.bus);
      this.app.audio.lointain?.liberer(this.bus);
    }
    this.bus?.disconnect();
    this.bus = null;
    this.entreeSon = null;
    this.stems = [];
    this.audioReady = false;
    this._audioRequested = false;
  }

  /** Libération totale (pièce lointaine ou suppression). */
  forceUnload() {
    if (this._visualLoaded) this._unloadVisual();
    if (this.audioReady) this._unloadAudio();
  }

  /** Rayon au-delà duquel l'œuvre est inaudible (pour le budget de stems). */
  get maxAudibleRadius() {
    let r = 0;
    for (const s of this.config.stems ?? []) {
      r = Math.max(r, s.radius ?? 12);
      // une piste qui déclare SES distances spatiales porte loin
      const spa = s.spatial;
      if (spa && typeof spa === 'object'
        && [spa.refDistance, spa.rolloff, spa.maxDistance].some(Number.isFinite)) {
        r = Math.max(r, spa.maxDistance ?? 60);
      }
    }
    for (const m of this.config.modules ?? []) {
      if (m.type === 'SpatialCrossfade') r = Math.max(r, m.params?.radius ?? 15);
      if (m.type === 'HRTFPanner') r = Math.max(r, m.params?.maxDistance ?? 60);
    }
    // Les modules injectés à l'exécution (visite audio) ne figurent pas dans
    // la config : sans ce second parcours, le budget de stems couperait des
    // œuvres que leur panner injecté devait garder audibles.
    for (const m of this.modules ?? []) {
      if (m.moduleType === 'SpatialCrossfade') r = Math.max(r, m.params?.radius ?? 15);
      if (m.moduleType === 'HRTFPanner') r = Math.max(r, m.params?.maxDistance ?? 60);
    }
    return r || 15;
  }

  /* ------------------------------------------------------------ cycle --- */

  update(dt, ctx) {
    const roomState = this.room?.state ?? 'current';
    if (roomState === 'far') {
      this.forceUnload();
      return;
    }

    // Distance mesurée en coordonnées MONDE, jamais locales. Une pièce
    // « Escher » est pivotée ET translatée par RoomManager.orientRoom : dans
    // le belvédère, la position locale d'une œuvre n'est pas celle que le
    // visiteur occupe, et toute la spatialisation — portée, budget de voix,
    // panoramique binaural — raisonnait sur un point qui n'existe pas.
    this._distance = ctx.cameraPos.distanceTo(this.worldPosition);

    // la plaque d'une œuvre en volume pivote vers le visiteur — autour de
    // la verticale seulement, comme les étiquettes de portail
    if (this._cartel && this._cartelPivote && this._distance < 30) {
      tournerVersCamera(this._cartel, this.app.camera);
    }

    // chargement paresseux à l'approche, libération au-delà
    const loadDist = this.config.loadDistance ?? 50;
    const unloadDist = loadDist * 1.6;
    // Sans WebGL (visite audio en repli), aucun visuel n'est jamais chargé :
    // ni textures, ni modèles — seul l'audio compte, et il suit son cours.
    if (!this._visualRequested && !this.app.headless && this._distance < loadDist) {
      this._visualRequested = true;
      this._loadVisual();
    }
    if (!this._audioRequested && this.app.audio.unlocked && this._distance < loadDist) {
      this._audioRequested = true;
      this._loadAudio();
    }
    if (this._distance > unloadDist) {
      if (this._visualLoaded) this._unloadVisual();
      if (this.audioReady) this._unloadAudio();
    }

    // Le curseur « lointain » de l'inspecteur doit s'entendre pendant qu'on
    // le traîne : deux nombres comparés par frame, et rien d'autre tant qu'il
    // ne bouge pas.
    if (this.audioReady) {
      const l = this.config.audio?.lointain ?? 0;
      if (l !== this._lointain) {
        this._lointain = l;
        this.app.audio.lointain?.regler(this.bus, l);
      }
      if (l > 0 && this.bus) this._tenirLointain();
    }

    if (roomState !== 'current') {
      if (this._beacon) this._beacon.visible = false;
      return; // pièce adjacente : préchargée, inactive
    }

    if (this._beacon) {
      const prog = this.app.progression;
      this._beacon.visible = Boolean(prog) && !prog.estDecouverte(this);
      if (this._beacon.visible && !this.app.quality.reducedMotion) {
        this._beacon.position.y = 2.3 + Math.sin(ctx.time * 1.6) * 0.15;
      }
    }

    if (this._reactiveMaterial?.uniforms?.uTime) {
      this._reactiveMaterial.uniforms.uTime.value = ctx.time;
    }
    // animations du modèle importé (immobiles si prefers-reduced-motion)
    if (this._mixer && !this.app.quality.reducedMotion) this._mixer.update(dt);

    for (const m of this.modules) m.update(dt, { ...ctx, distance: this._distance });
  }

  /**
   * Tient le point de fonctionnement du lointain (voir Lointain.js).
   *
   * Distance2 n'est pas linéaire : ses seuils sont absolus, et il faut donc
   * lui présenter la source à son niveau d'écriture, pas au niveau où la
   * distance l'a laissée. Reste à savoir de combien la distance l'a
   * atténuée — et la réponse ne se trouve pas à un seul endroit : selon
   * l'œuvre, elle vit dans le gain de distance de la voie (pistes qui
   * portent leurs distances) OU dans le gain de la piste, écrit par
   * SpatialCrossfade ou StemMixer. On la lit donc là où elle est vraiment :
   * sur les nœuds, en rapportant le gain courant au gain d'écriture.
   *
   * C'est la piste la MOINS atténuée qui décide, comme pour la réverbe :
   * c'est elle qui donne à l'œuvre sa présence.
   */
  _tenirLointain() {
    // Une œuvre suspendue (budget de voix, pièce quittée) a ses gains fondus
    // à zéro : suivre CE niveau ferait monter le rattrapage à son maximum
    // pendant l'extinction, et le worklet recevrait vingt fois la queue du
    // fondu. On laisse le dernier point posé, il sera juste au retour.
    if (!this._stemsActive) return;
    let attenuation = 0;
    for (const s of this.stems) {
      const nominal = s.cfg.gain ?? 1;
      const relatif = nominal > 0 ? (s.gain.gain.value / nominal) : 0;
      attenuation = Math.max(attenuation, relatif * (s.voie?.gainDistance ?? 1));
    }
    if (!Number.isFinite(attenuation) || attenuation <= 0) return;
    this.app.audio.lointain?.compenser(this.bus, attenuation,
      this.app.audio.ctx.currentTime);
  }

  get distance() {
    return this._distance;
  }

  /**
   * Point d'entrée unique pour la réactivité audio (module AudioReactive) :
   * pilote pulsation d'échelle, émission du matériau, uniform de shader
   * et intensité de la lumière d'appoint.
   */
  setAudioLevel(level, { pulseScale = 0, emissiveBoost = 0, lightBoost = 2.5 } = {}) {
    this.audioLevel = level;
    if (this.mesh && pulseScale) {
      this.mesh.scale.setScalar(this.baseScale * (1 + level * pulseScale));
    }
    const mat = this._reactiveMaterial;
    if (mat) {
      if (mat.uniforms?.uAudio) mat.uniforms.uAudio.value = level;
      if (mat.emissiveIntensity !== undefined && emissiveBoost) {
        mat.emissiveIntensity = (this._baseEmissive ?? 0.5) + level * emissiveBoost;
      }
    }
    if (this.light) {
      this.light.intensity = this.lightBaseIntensity * (1 + level * lightBoost);
    }
  }

  /** Transmis par le picker central de l'App (voir main.js). */
  handleClick() {
    for (const m of this.modules) {
      if (m.onClick?.()) return true;
    }
    return false;
  }

  dispose() {
    for (const m of this.modules) m.dispose();
    // la plaque d'abord : ses lettres partagent leurs ressources avec les
    // autres cartels — c'est disposerCartel qui sait quoi rendre à qui
    if (this._cartel) {
      disposerCartel(this._cartel);
      this._cartel = null;
    }
    this.forceUnload();
    this.group.traverse((o) => {
      o.geometry?.dispose();
      if (o.material) {
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
      }
    });
    this.group.removeFromParent();
  }
}

/**
 * Halo de balise, dessiné UNE fois et partagé par toutes les œuvres : un
 * point doux qui s'éteint vers les bords — la texture ne pèse rien et le
 * même objet GPU sert partout.
 */
let _beaconTex = null;
function beaconTexture() {
  if (_beaconTex) return _beaconTex;
  const S = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 2, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(230,220,255,0.65)');
  g.addColorStop(1, 'rgba(200,180,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  _beaconTex = new THREE.CanvasTexture(canvas);
  return _beaconTex;
}

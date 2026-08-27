import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { CopyShader } from 'three/addons/shaders/CopyShader.js';
import {
  BloomFleur, PasseSortie, tailleBloom, copieSceneNecessaire
} from './PasseSortie.js';
import { VistaManager } from './Vista.js';
import { FOG_DENSITY, suivreOmbre } from './RoomManager.js';
import { budgetLampes, coqueClose } from './ombres.js';
import { AudioEngine } from './AudioEngine.js';
import { Spatialisation } from './Spatialisation.js';
import { QualityManager } from './Quality.js';
import { LoadingTracker, assetUrl } from './utils.js';
import { setDefaultAnisotropy } from './textures.js';
import { setBudgetSourcesEtendues, setEclatLuminaires } from './primitives.js';
import { COUCHE_AUTO_ECLAIREE } from './Artwork.js';
import { WATER_TIME } from './primitives.js';
import { chauffer } from './cartels.js';
import { appliquerEnvironnement } from './environnements.js';
import * as lettrage from './lettrage.js';

const FOG_COLOR = 0x05050a;

/*
 * Le grain animé, le vignettage et l'aberration chromatique ne sont plus
 * une passe à eux : ils ont rejoint la courbe de tons et le bloom dans une
 * SEULE passe de sortie — voir `PasseSortie.js`, qui dit pourquoi.
 */

/**
 * Distorsion de franchissement de portail — un « warp » à la Minecraft :
 * l'image s'aspire vers le centre en tourbillonnant, les canaux rouge et
 * bleu se séparent (aberration chromatique), le pourtour s'assombrit
 * jusqu'au noir au pic — c'est là que la téléportation se produit, puis
 * tout se détend dans la pièce d'arrivée. `uWarp` va de 0 (repos) à 1 (pic).
 */
const WarpShader = {
  uniforms: {
    tDiffuse: { value: null },
    uWarp: { value: 0 },
    uTime: { value: 0 }
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uWarp, uTime;
    varying vec2 vUv;
    void main() {
      vec2 c = vUv - 0.5;
      float r = length(c);
      float a = atan(c.y, c.x);
      // aspiration radiale + vrille qui s'accentue vers le bord
      float pull = 1.0 - uWarp * 0.75 * r;
      float twist = uWarp * uWarp * 2.6 * r + uWarp * uTime * 1.2;
      vec2 warped = vec2(cos(a + twist), sin(a + twist)) * r * pull + 0.5;
      // aberration chromatique : R et B décalés le long du rayon
      float ca = uWarp * 0.02 * (0.3 + r);
      vec2 dir = r > 0.0001 ? normalize(c) : vec2(0.0);
      vec3 col = vec3(
        texture2D(tDiffuse, warped + dir * ca).r,
        texture2D(tDiffuse, warped).g,
        texture2D(tDiffuse, warped - dir * ca).b
      );
      // fermeture au noir : totale au pic, quel que soit le rayon
      float dark = smoothstep(0.0, 1.0, uWarp * (0.45 + r * 1.6));
      col *= 1.0 - min(1.0, dark + uWarp * uWarp);
      gl_FragColor = vec4(col, 1.0);
    }`
};

/**
 * Rendu de la scène dans une cible multi-échantillonnée (MSAA), résolue en
 * UNE fois vers la chaîne de post-traitement.
 *
 * Donner la cible MSAA au composer lui-même était une erreur coûteuse : il
 * la CLONE pour ses deux tampons ping-pong, et chaque passe plein écran
 * (bloom, warp, sortie, grain) rendait alors en multi-échantillonné et
 * payait une résolution complète du tampon à chaque lecture — d'où la
 * chute à ~35 fps sur un écran Retina. Or seule la SCÈNE a des silhouettes
 * à lisser ; un quad plein écran n'a pas d'arêtes. Ici : une passe MSAA,
 * une résolution (déclenchée par la lecture de la texture), et la chaîne
 * reste simple échantillon.
 */
class PasseSceneMSAA extends Pass {
  constructor(scene, camera, samples) {
    super();
    this.scene = scene;
    this.camera = camera;
    // HalfFloat : le bloom travaille sur des valeurs > 1 (l'émissif des
    // lanternes), qu'un tampon 8 bits écrêterait avant même de flouter.
    this.cible = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples
    });
    this._quad = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: this.cible.texture },
        opacity: { value: 1 }
      },
      vertexShader: CopyShader.vertexShader,
      fragmentShader: CopyShader.fragmentShader,
      depthTest: false,
      depthWrite: false
    }));
    // Faut-il vraiment recopier la cible dans la chaîne ? Voir `render`.
    // Prudent par défaut : l'App le remet à jour à chaque image.
    this.copieNecessaire = true;
  }

  setSize(w, h) {
    this.cible.setSize(w, h);
  }

  render(renderer, writeBuffer) {
    renderer.setRenderTarget(this.cible);
    renderer.render(this.scene, this.camera);
    // La résolution MSAA a lieu à la FIN de `renderer.render`, sur la cible
    // courante : `cible.texture` est prête dès cette ligne.
    //
    // LA COPIE QU'ON NE FAIT PLUS. Recopier la cible dans le ping-pong du
    // composer, c'est un quad plein écran de plus — une image entière lue
    // puis réécrite, à chaque trame. Elle n'a de sens que si QUELQU'UN lit
    // la chaîne entre nous et la sortie : l'occlusion ambiante (bureau) ou
    // le warp de portail (une seconde par franchissement). Au repos, la
    // passe de sortie sait aller chercher `cible.texture` directement — et
    // la copie disparaît (voir `_reglerCopieScene` et PasseSortie).
    if (!this.copieNecessaire && !this.renderToScreen) return;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this._quad.render(renderer);
  }

  dispose() {
    this.cible.dispose();
    this._quad.dispose();
  }
}

/**
 * Occlusion ambiante (GTAO) à DEMI-résolution : l'occlusion est un signal
 * basse fréquence, la calculer pour chaque pixel Retina serait du gâchis —
 * seules les cibles internes (normales + profondeur, AO, débruitage)
 * travaillent à moitié, le mélange final se fait plein cadre. Deux
 * aménagements pour cette scène :
 *   — les lutins (balises, étiquettes) sont écartés de la pré-passe : le
 *     matériau « normales » qui remplace tout ne sait pas les dessiner, et
 *     leurs quads auraient écrit de faux occulteurs dans la profondeur ;
 *   — normales en DoubleSide : les plans (tableaux, panneaux) doivent
 *     exister dans le G-buffer même vus de dos.
 */
class PasseGTAO extends GTAOPass {
  constructor(scene, camera, w, h) {
    super(scene, camera, Math.max(1, Math.ceil(w / 2)), Math.max(1, Math.ceil(h / 2)));
    this.normalMaterial.side = THREE.DoubleSide;
    // Rayon en mètres, à l'échelle des pièces : assez court pour ancrer
    // les objets au sol (bancs, pierres, marches) sans noircir les angles
    // de murs à distance. L'intensité reste douce — la galerie est sombre,
    // l'AO souligne, elle n'éteint pas.
    this.updateGtaoMaterial({ radius: 0.55, thickness: 1, scale: 1.1 });
    this.blendIntensity = 0.9;
  }

  setSize(w, h) {
    super.setSize(Math.max(1, Math.ceil(w / 2)), Math.max(1, Math.ceil(h / 2)));
  }

  /**
   * Masque, pour la pré-passe des normales, ce qui n'a rien à y faire.
   *
   * La version de three parcourt LE GRAPHE ENTIER et note la visibilité de
   * chaque nœud dans une Map, deux fois par frame (masquer, restaurer). Or
   * la galerie garde ses quinze pièces dans la scène et n'en montre qu'une :
   * 996 nœuds pour 75 visibles, soit deux mille écritures de Map par frame
   * pour rétablir un état que l'immense majorité n'avait jamais quitté.
   *
   * On ne descend donc que dans le VISIBLE — un sous-arbre éteint n'est pas
   * rendu, le masquer ne changerait rien — et l'on ne retient que ce qu'on a
   * effectivement éteint : quelques objets, dans un tableau. Le G-buffer
   * reçoit exactement les mêmes triangles qu'avant.
   */
  overrideVisibility() {
    this._masques ??= [];
    this._masques.length = 0;
    masquerPourAO(this.scene, this._masques);
  }

  restoreVisibility() {
    for (const o of this._masques ?? []) o.visible = true;
    if (this._masques) this._masques.length = 0;
    this._visibilityCache.clear();   // la classe de base la croit sienne
  }
}

/**
 * Éteint récursivement ce qui fausserait le G-buffer, et l'empile.
 *
 * Ni lutins ni traits — et rien de TRANSPARENT : un faisceau de lumière ou
 * un disque de portail rendu opaque dans la profondeur deviendrait un faux
 * occulteur, et l'AO assombrirait derrière lui.
 */
function masquerPourAO(o, pile) {
  if (!o.visible) return;          // sous-arbre non rendu : rien à masquer
  if (o.isPoints || o.isLine || o.isSprite
    || (o.isMesh && o.material?.transparent)) {
    o.visible = false;
    pile.push(o);
    return;                        // inutile de fouiller sous un nœud éteint
  }
  for (const enfant of o.children) masquerPourAO(enfant, pile);
}

/**
 * Cœur minimal : scène, caméra, rendu, post-processing, boucle d'animation.
 * Tout le reste (œuvres, contrôles, éditeur) s'enregistre via addArtwork()
 * et onUpdate(). Le profil de qualité (QualityManager) adapte le pipeline
 * à l'appareil et au framerate mesuré.
 */
export class App {
  /**
   * `headless: true` — pas de WebGL du tout : ni renderer, ni composer, ni
   * picking, ni décor. La scène, les pièces, les œuvres et surtout l'AUDIO
   * fonctionnent à l'identique — c'est ce qui permet à la visite audio de
   * servir de repli quand WebGL2 est indisponible, avec le même moteur.
   */
  constructor(container, { headless = false } = {}) {
    this.container = container;
    this.headless = headless;
    this.audio = new AudioEngine();
    this.quality = new QualityManager();
    this.spatial = new Spatialisation(this);
    this.loading = new LoadingTracker();
    this.artworks = [];
    // Fichiers importés dans l'éditeur : chemin de config → URL blob
    this.assetOverrides = new Map();
    this._updatables = [];
    this._clickHandlers = [];
    this._stemBudgetAcc = 0;
    this.clock = new THREE.Clock();

    const profile = this.quality.profile;

    // --- scène ---------------------------------------------------------
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(FOG_COLOR);
    // densité relue par pièce (RoomManager.applyFog) : une grande salle a
    // besoin d'un brouillard bien plus ténu pour laisser voir son fond
    this.scene.fog = new THREE.FogExp2(FOG_COLOR, FOG_DENSITY);

    this.camera = new THREE.PerspectiveCamera(
      60, window.innerWidth / window.innerHeight, 0.1, 220
    );
    this.camera.position.set(0, 2.2, 14);
    // les objets « selfLit » (lanternes) vivent sur leur propre couche,
    // qu'aucune lumière ne touche mais que la caméra rend — voir Artwork
    this.camera.layers.enable(COUCHE_AUTO_ECLAIREE);

    if (headless) {
      // ni rendu, ni décor : la boucle mettra à jour œuvres et auditeur
      this._setupVisibility();
      return;
    }

    // Les textures de glyphes se bâtissent ICI, pendant que le rendu
    // s'installe — quelques millisecondes, une fois. Voir `core/cartels.js`.
    chauffer();
    // Le module de lettrage et THREE, exposés sur l'app : les sondes de
    // test comparent les pixels du GPU à la référence CPU de l'algorithme,
    // et il leur faut les deux. Ce ne sont pas des points d'entrée du
    // moteur — rien dans `engine/` ne doit passer par là.
    this.lettrage = lettrage;
    this.THREE = THREE;

    // --- rendu ---------------------------------------------------------
    // `antialias` du canevas : inutile — l'image arrive par le composer,
    // déjà lissée par la passe de scène ; multi-échantillonner en plus le
    // tampon d'affichage ne ferait que payer deux fois.
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(profile.pixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    // Neutral (Khronos PBR) plutôt qu'ACES : comparés A/B pièce par pièce,
    // ACES tirait les néons violets vers le gris — un comble ici, où la
    // couleur EST le sujet. Neutral compresse les hautes lumières sans
    // désaturer : les huisseries gardent leur chroma, le ciel son bleu,
    // et les lanternes (calibrées contre l'éblouissement) ne rallument pas.
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    // Étalonné pour un écran à grande plage dynamique (Retina/XDR, OLED).
    // Sur une dalle standard (SDR — LCD d'entrée de gamme), les noirs
    // profonds de la galerie s'écrasent : on relève l'exposition. La
    // requête média est le meilleur signal auto disponible ; ce n'est pas
    // une mesure de luminosité, mais elle sépare bien les deux mondes.
    const hdr = window.matchMedia?.('(dynamic-range: high)').matches;
    this.renderer.toneMappingExposure = hdr ? 1.1 : 1.45;
    container.appendChild(this.renderer.domElement);
    this.quality.refineWithRenderer(this.renderer);
    // Anisotropie effective : le vœu du profil, borné par le matériel.
    this.quality.profile.anisotropy = Math.min(
      this.quality.profile.anisotropy ?? 4,
      this.renderer.capabilities.getMaxAnisotropy() || 1
    );
    setDefaultAnisotropy(this.quality.profile.anisotropy);
    // combien de sources étendues la machine peut porter (voir Quality)
    setBudgetSourcesEtendues(this.quality.profile.sourcesEtendues ?? 8);
    // le trait d'une fente compense ce que le bloom ne peut plus lui
    // donner : à un quart de résolution, une ligne de douze centimètres
    // sort de la passe de flou (voir setEclatLuminaires)
    const fleur = this.quality.profile.bloomResScale ?? 0.5;
    setEclatLuminaires(fleur >= 0.5 ? 1 : 0.5 / fleur * 0.85);
    // Ombres douces (PCF) — une seule source par pièce en projette (la
    // lumière clé, voir RoomManager) : le coût reste borné et prévisible.
    this.renderer.shadowMap.enabled = this.quality.profile.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // La carte d'ombre ne se re-rend qu'à 30 Hz (voir la boucle) : la
    // galerie est presque statique, une pénombre qui suit à 33 ms reste
    // imperceptible — et à 120 Hz, ce sont trois rendus de scène sur
    // quatre d'économisés.
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    this._ombreAcc = 0;

    // --- post-traitement : scène (MSAA) + AO + warp + sortie -----------
    //
    // Tout le rendu passe par le composer, donc hors écran — c'est la
    // passe de scène qui porte l'anticrénelage (voir PasseSceneMSAA) ;
    // les tampons du composer, eux, restent simple échantillon.
    //
    // Deux passes seulement au repos, là où il y en avait cinq : le bloom,
    // la courbe de tons, le grain et le vignettage tiennent désormais dans
    // la SORTIE (voir PasseSortie.js), et la passe de scène n'a plus besoin
    // de recopier sa cible dans la chaîne.
    //
    // Mesuré sous profil mobile, même caméra, deux campagnes concordantes :
    // −47 % de temps d'image à l'entrée, −45 % au labo, −13 % au belvédère.
    // L'économie est un FORFAIT — le même nombre d'images plein écran en
    // moins partout — donc elle pèse d'autant plus que la salle est légère ;
    // au belvédère c'est la scène elle-même qui tient la trame.
    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(this.quality.profile.pixelRatio);
    this.scenePass = new PasseSceneMSAA(this.scene, this.camera,
      this.quality.profile.msaa ?? 0);
    this.composer.addPass(this.scenePass);
    // Occlusion ambiante — profil desktop seulement ; le gouverneur la
    // coupe juste après l'anticrénelage si les images se font attendre.
    if (this.quality.profile.gtao) {
      const taille = this.renderer.getDrawingBufferSize(new THREE.Vector2());
      this.gtao = new PasseGTAO(this.scene, this.camera, taille.width, taille.height);
      this.composer.addPass(this.gtao);
    }
    // Warp de portail : inséré avant la sortie, inactif au repos (une passe
    // désactivée ne coûte rien au composer). Il vient AVANT la sortie, donc
    // avant le bloom : la fleur se calcule sur l'image déjà tordue, et le
    // halo suit la distorsion au lieu de flotter à côté.
    this.warpPass = new ShaderPass(WarpShader);
    this.warpPass.enabled = false;
    this.composer.addPass(this.warpPass);

    // LA SORTIE — bloom, courbe de tons, sRGB, grain et vignettage réunis
    // en une seule passe plein écran au lieu de trois (voir PasseSortie.js).
    this.bloom = new BloomFleur(
      tailleBloom(this.quality.profile),
      this.quality.profile.bloomStrength,
      0.7,   // rayon
      0.55   // seuil : seules les zones émissives fleurissent
    );
    this.bloom.echelle = this.quality.profile.bloomResScale;
    this.sortie = new PasseSortie(this.bloom, this.scenePass);
    this.sortie.grainActif = this.quality.profile.grain;
    this.composer.addPass(this.sortie);

    this._buildEnvironment();
    this._setupPicking();
    this._setupVisibility();
    // Apparitions (pièces d'ailleurs sur un plan) — après le renderer :
    // leur rendu vivant dépend de lui et du palier de qualité.
    this.vistas = new VistaManager(this);

    window.addEventListener('resize', () => this._resize());
  }

  /* ------------------------------------------------------------------ */

  _buildEnvironment() {
    // Éclairage d'image (IBL), à la façon du mode Material Preview d'EEVEE :
    // une pièce neutre pré-filtrée (PMREM) sert d'environnement à tous les
    // matériaux standard. C'est elle qui donne aux surfaces leurs reflets et
    // leur modelé — un caillou n'est plus une silhouette plate, un métal
    // accroche la lumière. L'intensité vient du profil de qualité et peut
    // être modulée par pièce (envIntensity, voir RoomManager).
    // Le studio neutre reste le défaut ; deux panoramas réels (CC0) se
    // choisissent dans reglages.json — voir `core/environnements.js`.
    appliquerEnvironnement(this, 'studio');
    this._envApplique = 'studio';
    this.envBaseIntensity = this.quality.profile.envIntensity ?? 0.5;
    this.scene.environmentIntensity = this.envBaseIntensity;

    // L'hémisphérique ne fait plus que teinter (voûte violette / sol sombre) :
    // le remplissage vient de l'environnement, qui modèle bien mieux.
    this.scene.add(new THREE.HemisphereLight(0x2a2a44, 0x0a0a12, 0.5));

    // Le sol appartient désormais aux PIÈCES (RoomManager.buildFloor) :
    // réglable par pièce, désactivable. L'ancien plan global de la scène
    // se superposait au leur — deux surfaces au même y, scintillement
    // garanti. Il n'en reste que la poussière, qui est bien à la scène.

    // Poussière en suspension (densité selon le profil)
    const count = this.quality.profile.dustCount;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = 8 + Math.random() * 55;
      const a = Math.random() * Math.PI * 2;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = 0.3 + Math.random() * 11;
      pos[i * 3 + 2] = Math.sin(a) * r;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.dust = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0x8890c8, size: 0.055, transparent: true, opacity: 0.4,
      depthWrite: false, sizeAttenuation: true
    }));
    this.scene.add(this.dust);
  }

  /**
   * La passe de scène doit-elle recopier sa cible dans la chaîne ?
   *
   * Seulement si une passe ACTIVE se tient entre elle et la sortie — c'est
   * elle qui lira le tampon. Au repos il n'y en a aucune (le warp dort,
   * l'occlusion ambiante n'existe que sur bureau), et la sortie va lire la
   * cible directement : une image entière de moins à recopier par trame.
   * On le recalcule à chaque image plutôt qu'une fois pour toutes — la
   * question tient en trois comparaisons, et le gouverneur de qualité comme
   * le franchissement de portail changent la réponse en cours de visite.
   */
  _reglerCopieScene() {
    this.scenePass.copieNecessaire = copieSceneNecessaire(
      this.composer.passes, this.scenePass, this.sortie);
  }

  /**
   * Change le nombre d'échantillons (MSAA) de la passe de scène, à chaud.
   * `dispose()` est indispensable : le nombre d'échantillons se fixe à la
   * création du tampon côté GPU — sans lui, la nouvelle valeur resterait
   * une intention. La cible se reconstruit d'elle-même au rendu suivant.
   */
  setMsaa(samples) {
    const rt = this.scenePass?.cible;
    if (!rt || rt.samples === samples) return;
    rt.samples = samples;
    rt.dispose();
  }

  /**
   * Active/coupe les ombres à chaud (gouverneur de FPS, éditeur). Les
   * matériaux compilent des variantes différentes avec/sans ombre : il faut
   * les invalider, sinon le changement ne se voit qu'aux prochains objets.
   */
  setShadowsEnabled(on) {
    if (!this.renderer || this.renderer.shadowMap.enabled === on) return;
    this.renderer.shadowMap.enabled = on;
    if (on) this.renderer.shadowMap.needsUpdate = true;
    this.scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
  }

  /**
   * Cibles cliquables de la pièce courante (œuvres + portails).
   * Le sol et les repères ne sont PAS des cibles, et un objet marqué
   * `role: "decor"` non plus — un banc se contourne, il ne s'ouvre pas.
   * En édition, tout redevient sélectionnable : le décor s'édite aussi.
   */
  _pickTargets() {
    const editing = this.editor?.enabled;
    const meshes = this.artworks
      .filter((a) => !a.room || a.room.state === 'current')
      // un membre d'ensemble (partOf) reste cliquable : son clic ouvre
      // l'œuvre maîtresse (voir le routage dans main.js)
      .filter((a) => editing || a.config.role !== 'decor' || a.config.partOf)
      .map((a) => a.hitMesh)
      .filter(Boolean);
    if (this.rooms?.current) meshes.push(...this.rooms.current.portalMeshes);
    return meshes;
  }

  /** Première œuvre ou portail sous un point écran, ou null. */
  pickAt(x, y, raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2()) {
    ndc.set((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, this.camera);
    const intersections = raycaster.intersectObjects(this._pickTargets(), true);
    let obj = intersections[0]?.object ?? null;
    while (obj && !obj.userData.artwork && !obj.userData.portal) obj = obj.parent;
    if (obj?.userData.artwork) return { type: 'artwork', artwork: obj.userData.artwork };
    if (obj?.userData.portal) return { type: 'portal', portal: obj.userData.portal };
    return null;
  }

  /**
   * « Action » — ce que vise le centre de l'écran, activé au clavier.
   *
   * Le clic exige de pointer ; en marchant à la première personne on
   * regarde déjà l'œuvre, et c'est ce regard qui doit suffire. La barre
   * d'espace passe donc par le MÊME circuit que le clic (mêmes handlers,
   * donc même fiche, même travelling, même priorité à l'éditeur) : rien
   * n'est dupliqué, et Échap ferme comme avant.
   *
   * Une tolérance : si le centre exact ne touche rien, on essaie une
   * petite couronne autour — viser à la souris est précis, viser en
   * marchant ne l'est pas.
   */
  triggerAction() {
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    const r = Math.min(window.innerWidth, window.innerHeight) * 0.06;
    const offsets = [[0, 0], [0, -r], [0, r], [-r, 0], [r, 0]];
    for (const [dx, dy] of offsets) {
      const hit = this.pickAt(cx + dx, cy + dy);
      if (!hit) continue;
      for (const h of this._clickHandlers) {
        if (h(hit, { source: 'action' })) return true;
      }
    }
    return false;
  }

  _setupPicking() {
    // Distinction clic / drag d'orbite : on mesure le déplacement du pointeur.
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let downX = 0, downY = 0;

    this.renderer.domElement.addEventListener('pointerdown', (e) => {
      downX = e.clientX; downY = e.clientY;
    });
    this.renderer.domElement.addEventListener('pointerup', (e) => {
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) return;
      const hit = this.pickAt(e.clientX, e.clientY, raycaster, ndc);
      for (const h of this._clickHandlers) {
        if (h(hit, e)) return; // un handler peut consommer le clic
      }
    });

    // Action au clavier : la barre d'espace agit sur ce que vise le centre
    // de l'écran. Ignorée pendant la saisie, en visite audio (qui a sa
    // propre navigation) et quand un bouton a le focus — sinon Espace
    // l'activerait au lieu d'agir sur l'œuvre.
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Space' || e.repeat) return;
      if (this.audioTour?.active) return;
      const el = document.activeElement;
      if (el instanceof Element
          && el.matches('input, textarea, select, button, a, [tabindex]')) return;
      if (this.triggerAction()) e.preventDefault();
    });
  }

  /** Chemin de config → URL réelle (les imports de l'éditeur sont des blobs). */
  resolveAsset(path) {
    return this.assetOverrides.get(path) ?? assetUrl(path);
  }

  /** Onglet masqué → boucle en pause + audio suspendu (économie de batterie). */
  _setupVisibility() {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this._stopLoop();
        this.audio.suspend();
      } else {
        this.clock.getDelta(); // purge le delta accumulé pendant la pause
        if (this._started) this._runLoop();
        this.audio.resume();
      }
    });
  }

  _stopLoop() {
    if (this.headless) {
      cancelAnimationFrame(this._raf);
      this._raf = null;
    } else {
      this.renderer.setAnimationLoop(null);
    }
  }

  _resize() {
    if (this.headless) return;
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
  }

  /* ------------------------------------------------------------------ */

  /** Module FocusCamera actuellement en avant-plan (ou null). */
  setActiveFocus(module) {
    this.activeFocus = module;
    // approcher une œuvre, c'est la découvrir — sans attendre le palier
    if (module?.artwork) this.progression?.marquer(module.artwork);
  }

  /** Ajoute une œuvre, dans une pièce si le système de rooms est actif. */
  addArtwork(artwork, room = null) {
    this.artworks.push(artwork);
    if (room) {
      artwork.room = room;
      room.artworks.push(artwork);
      room.group.add(artwork.group);
    } else {
      this.scene.add(artwork.group);
    }
  }

  removeArtwork(artwork) {
    const i = this.artworks.indexOf(artwork);
    if (i >= 0) this.artworks.splice(i, 1);
    if (artwork.room) {
      const j = artwork.room.artworks.indexOf(artwork);
      if (j >= 0) artwork.room.artworks.splice(j, 1);
    }
    artwork.dispose();
  }

  /** Enregistre un callback appelé à chaque frame : fn(dt, ctx).
   *  Renvoie la fonction de désabonnement. */
  onUpdate(fn) {
    this._updatables.push(fn);
    return () => {
      const i = this._updatables.indexOf(fn);
      if (i >= 0) this._updatables.splice(i, 1);
    };
  }

  /** Prévient les abonnés qu'une œuvre vient de charger son visuel. */
  onVisualLoaded(fn) {
    (this._visualListeners ??= []).push(fn);
  }

  notifyVisualLoaded(artwork) {
    // un maillage vient d'apparaître : son ombre doit exister à l'image
    // suivante, pas au prochain filet de 500 ms
    this.ombresSales = true;
    for (const fn of this._visualListeners ?? []) fn(artwork);
  }

  /** Enregistre un handler de clic : fn(artworkOuNull, event) → bool (consommé). */
  onArtworkClick(fn) {
    this._clickHandlers.push(fn);
  }

  /**
   * Budget global de stems simultanés (« voice stealing » par distance) :
   * les œuvres les plus proches gardent leurs pistes, les plus lointaines
   * sont suspendues quand le plafond du profil est atteint.
   */
  _updateStemBudget() {
    const budget = this.quality.profile.maxStems;
    const candidates = this.artworks
      .filter((a) => a.audioReady && a.stems.length
        && (!a.room || a.room.state === 'current'))
      .map((a) => ({ a, d: a.distance }))
      .filter((x) => x.d < x.a.maxAudibleRadius + 6)
      .sort((p, q) => p.d - q.d);

    const keep = new Set();
    let used = 0;
    for (const { a } of candidates) {
      if (used + a.stems.length <= budget) {
        keep.add(a);
        used += a.stems.length;
      }
    }
    for (const a of this.artworks) {
      if (a.audioReady) {
        const inCurrentRoom = !a.room || a.room.state === 'current';
        a.setStemsActive(inCurrentRoom && keep.has(a));
      }
    }
  }

  start() {
    this._started = true;
    this._runLoop();
  }

  _runLoop() {
    if (this.headless) {
      // Même cycle que la boucle rendue, sans composer : mise à jour des
      // œuvres (chargement paresseux, modules), budget de stems, auditeur.
      const camPos = new THREE.Vector3();
      const tick = () => {
        this._raf = requestAnimationFrame(tick);
        const dt = Math.min(this.clock.getDelta(), 0.1);
        const t = this.clock.elapsedTime;
        this.camera.updateMatrixWorld(true);
        this.camera.getWorldPosition(camPos);
        const ctx = { app: this, camera: this.camera, cameraPos: camPos, time: t };
        for (const fn of this._updatables) fn(dt, ctx);
        for (const a of this.artworks) a.update(dt, ctx);
        this._stemBudgetAcc += dt;
        if (this._stemBudgetAcc > 0.5) {
          this._stemBudgetAcc = 0;
          this._updateStemBudget();
        }
        this.spatial.update(dt);
        this.audio.updateListener(this.camera);
        this.audio.appliquerLimiteur(this.reglages?.audio?.limiteur);
        this.audio.appliquerHygiene(this.reglages?.audio?.hygiene);
        this.audio.appliquerPupitre(this.reglages?.audio?.pupitre);
        this.audio.appliquerCouleurs(this.reglages?.audio?.couleurs);
        this.audio.appliquerBande(this.reglages?.audio?.bande);
        this.audio.appliquerConsole(this.reglages?.audio?.console);
      };
      tick();
      return;
    }

    const camPos = new THREE.Vector3();
    this.renderer.setAnimationLoop(() => {
      const dt = Math.min(this.clock.getDelta(), 0.1);
      const t = this.clock.elapsedTime;
      this.camera.getWorldPosition(camPos);
      const ctx = { app: this, camera: this.camera, cameraPos: camPos, time: t };

      for (const fn of this._updatables) fn(dt, ctx);
      for (const a of this.artworks) a.update(dt, ctx);

      this._stemBudgetAcc += dt;
      if (this._stemBudgetAcc > 0.5) {
        this._stemBudgetAcc = 0;
        this._updateStemBudget();
      }

      this.spatial.update(dt);
      this.audio.updateListener(this.camera);
      this.audio.appliquerLimiteur(this.reglages?.audio?.limiteur);
      this.audio.appliquerHygiene(this.reglages?.audio?.hygiene);
      this.audio.appliquerPupitre(this.reglages?.audio?.pupitre);
      this.audio.appliquerCouleurs(this.reglages?.audio?.couleurs);
      this.audio.appliquerBande(this.reglages?.audio?.bande);
      this.audio.appliquerConsole(this.reglages?.audio?.console);
      // l'environnement suit reglages.json, comme l'audio — un simple
      // compare de chaîne par frame, le vrai travail n'a lieu qu'au
      // changement (voir environnements.js)
      const env = this.reglages?.environnement ?? 'studio';
      if (env !== this._envApplique) {
        this._envApplique = env;
        appliquerEnvironnement(this, env);
      }

      // Visite audio ouverte : le panneau opaque couvre tout — rendre des
      // images derrière ne ferait que chauffer la machine (et le lecteur
      // d'écran est gourmand). L'audio et les modules continuent, l'image
      // reste sur la dernière trame.
      if (this.audioTour?.active) return;

      if (!this.quality.reducedMotion) this.dust.rotation.y += dt * 0.004;
      // l'eau ondule : UNE horloge partagée par tous les bassins de la
      // scène, bornée pour que sin(t) reste précis sur tous les GPU
      if (!this.quality.reducedMotion) WATER_TIME.value = t % 3600;
      this.sortie.uniforms.uTime.value = t;
      if (this.warpPass.enabled) this.warpPass.uniforms.uTime.value = t;
      this.quality.tick(dt, this);

      // LA CARTE D'OMBRE NE SE REDESSINE QUE SI QUELQUE CHOSE A CHANGÉ.
      //
      // À 30 Hz inconditionnels, la carte 4096 re-rendait TOUTE la scène
      // une frame sur deux — pour une galerie où rien ne bouge. C'est ce
      // qui a mis un M1 Max sous 30 fps au belvédère. Désormais elle ne se
      // redessine que : quand la fenêtre a suivi le visiteur (salles sans
      // coque), quand une œuvre vient de charger son maillage (drapeau
      // `ombresSales`, posé par notifyVisualLoaded et au changement de
      // salle), et sinon à 2 Hz — le filet pour les maillages qui pulsent
      // avec l'audio, dont l'ombre peut suivre à un demi-souffle près.
      this._ombreAcc += dt;
      this._ombreFilet = (this._ombreFilet ?? 0) + dt;
      if (this.renderer.shadowMap.enabled && this._ombreAcc >= 1 / 30) {
        this._ombreAcc = 0;
        const cle = this.rooms?.current?.keyLight;
        const bouge = cle ? suivreOmbre(cle, camPos) : false;
        if (bouge || this.ombresSales || this._ombreFilet >= 0.5) {
          this._ombreFilet = 0;
          this.ombresSales = false;
          this.renderer.shadowMap.needsUpdate = true;
        }
      }

      // le budget de lampes proches (voir ombres.js) : trois fois par
      // seconde, pas à chaque image — trier dix lampes est gratuit, mais
      // il n'y a aucune raison de le faire à 120 Hz
      this._lampesAcc = (this._lampesAcc ?? 1) + dt;
      if (this._lampesAcc >= 0.35) {
        this._lampesAcc = 0;
        const salle = this.rooms?.current;
        if (salle) {
          // dans une coque close, les accents les plus proches deviennent
          // les projeteurs de la salle (voir ombres.budgetLampes) : sans
          // eux, plus rien n'y porte d'ombre. Un changement d'attribution
          // salit les cartes — elles se redessinent à la frame suivante.
          const clos = this.quality.profile.shadows && coqueClose(salle.config);
          const change = budgetLampes(salle, camPos, {
            ...this.quality.profile.lampesProches,
            projecteurs: clos ? (this.quality.profile.projecteursOmbre ?? 0) : 0
          });
          if (change) this.ombresSales = true;
        }
      }

      this.vistas?.update(dt); // la pièce apparue se rend avant la vraie
      this._reglerCopieScene();
      this.composer.render();
    });
  }
}

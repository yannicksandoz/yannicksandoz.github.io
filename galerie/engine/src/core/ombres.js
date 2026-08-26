import * as THREE from 'three';

/**
 * LE MOTEUR D'OMBRES — un seul endroit, quatre canaux, une doctrine.
 *
 * Le rendu temps réel n'a pas UNE ombre mais quatre, et les confondre
 * produit exactement les défauts qu'on a vus (objets qui flottent, jour
 * entre l'objet et son ombre, salles qui restent dégradées). La doctrine,
 * calquée sur la pratique des moteurs de production (et sur ce que fait
 * three.js dans ses propres exemples) :
 *
 *   1. L'OMBRE PORTÉE — la carte d'ombre de la lumière clé, UNE par pièce.
 *      Fenêtre cadrée sur la coque entière (jamais coupée en plein sol),
 *      4096 texels sur bureau, redessinée UNIQUEMENT quand quelque chose a
 *      changé (voir la boucle de l'App). C'est elle qui dit « le soleil est
 *      là » ; elle part de la silhouette, jamais du contact.
 *
 *   2. L'OMBRE DE CONTACT — le canal qui manquait. Un objet arrondi posé
 *      au sol SURPLOMBE son contact : sa silhouette s'arrête 10 à 20 cm
 *      avant le point où il touche, l'ombre portée commence SOUS le
 *      renflement, et l'œil lit un jour entre l'objet et son ombre — même
 *      quand la carte est parfaite (mesuré au cube-étalon : 2 cm de biais,
 *      pas plus). Ce qui ancre un objet, c'est l'occlusion à son pied.
 *      L'occlusion ambiante (GTAO) la donne sur bureau… quand elle tourne.
 *      `ombreDeContact` la garantit : un dégradé radial cuit une fois,
 *      posé sous l'objet, zéro coût par frame, identique sur tous les
 *      profils. C'est la technique des « contact shadows » de drei et des
 *      exemples three.js.
 *
 *   3. L'OCCLUSION D'AMBIANCE — la GTAO (App), demi-résolution, bureau.
 *      Elle nuance ce que le contact affirme ; elle n'est jamais la seule
 *      chose qui ancre.
 *
 *   4. LE BUDGET — les lampes vivent dans le groupe de LEUR pièce, et seule
 *      la pièce courante est visible : le shader n'intègre jamais les
 *      lampes d'une salle où l'on n'est pas. Les sources de confort
 *      (corniches, flaques de seuil) passent par `budgetSourcesEtendues`.
 */

/**
 * Lumière clé de la pièce — le « soleil » de la scène, comme la lampe
 * principale d'un rendu EEVEE. Une seule directionnelle par pièce, la seule
 * source à projeter des ombres : les œuvres se posent au sol au lieu de
 * flotter, et le coût reste celui d'UNE carte d'ombre.
 *
 * Réglable par pièce dans le JSON, et absente si on la refuse :
 *   "keyLight": false
 *   "keyLight": { "color": "#b8c2ff", "intensity": 2, "azimuth": 35, "elevation": 55 }
 *
 * azimuth (°, 0 = +Z, sens horaire vu de dessus) et elevation (° au-dessus
 * de l'horizon) décrivent la direction, comme le soleil de Blender.
 */
export const KEYLIGHT_DEFAULTS = { color: '#b8c2ff', intensity: 2, azimuth: 35, elevation: 55 };

export function buildKeyLight(config, profile) {
  if (config?.keyLight === false) return null;
  const opt = { ...KEYLIGHT_DEFAULTS, ...(config?.keyLight ?? {}) };

  const light = new THREE.DirectionalLight(new THREE.Color(opt.color), opt.intensity);
  light.name = 'lumiere-cle';

  if (profile?.shadows && opt.shadows !== false) {
    light.castShadow = true;
    light.shadow.mapSize.setScalar(profile.shadowMapSize ?? 1024);
    light.shadow.bias = -0.0002;
    // le biais normal se règle avec la fenêtre : voir frameKeyLightShadow
  }

  const group = new THREE.Group();
  group.name = 'lumiere-cle-groupe';
  group.add(light, light.target);
  group.userData.light = light;
  group.userData.ombres = light.castShadow;
  orientKeyLight(group, config);
  frameKeyLightShadow(group, config);
  return group;
}

/**
 * LA CARTE D'OMBRE : une fenêtre serrée qui SUIT le visiteur.
 *
 * Elle était cadrée sur le `floor.size` — le grand plan décoratif, pas la
 * pièce. À l'entrée, 140 m de sol : 144 m étalés sur 2048 texels, soit
 * **7 cm par texel**. Un pied de banc large de huit centimètres tenait dans
 * un texel : son ombre de contact n'existait pas. Mesuré partout, ça
 * donnait 7 cm à l'entrée, 6,1 à l'annexe, 4,6 au jardin — d'où des objets
 * posés nulle part, qui flottaient au-dessus du sol. C'est le premier
 * défaut qu'on lit comme « pas fini ».
 *
 * On plafonne donc la fenêtre à `PORTEE_OMBRE` mètres autour du VISITEUR :
 * 1,7 cm par texel quelle que soit la taille de la pièce, du couloir au
 * belvédère de cinquante mètres. Ce qui sort de la fenêtre n'a pas d'ombre
 * portée — mais c'est le lointain, où l'ombre ne se lit plus de toute
 * façon, et l'occlusion ambiante continue d'y ancrer les objets.
 *
 * Le CALAGE SUR LA GRILLE (texel snapping) n'est pas une coquetterie : une
 * fenêtre qui glisse en continu fait grouiller le bord des ombres à chaque
 * pas. On arrondit donc le centre au texel près, DANS LE REPÈRE DE LA
 * LUMIÈRE — arrondir en x/z du monde ne calerait rien, la lumière étant
 * oblique.
 */
// La demi-fenêtre d'ombre, en mètres. 17 m était trop court : à l'entrée
// (coque de 60 m), l'ombre du grand mur nord se COUPAIT NET au bord de la
// fenêtre — une bande sombre qui s'arrête au milieu du sol, pire que pas
// d'ombre du tout. La fenêtre doit couvrir la COQUE ENTIÈRE de chaque
// salle ; la finesse se paie en résolution de carte (4096 sur bureau, voir
// Quality), pas en couverture. À 32 m de demi-fenêtre et 4096 texels, le
// pire cas (entrée, 64 m couverts) tient à 1,6 cm par texel — mieux que
// les 1,7 cm de l'ancienne fenêtre courte. Le suivi du visiteur ne sert
// plus qu'aux salles SANS coque (annexe, allée), dont le sol décoratif
// dépasse la fenêtre.
export const PORTEE_OMBRE = 32;   // demi-fenêtre, en mètres

/** L'étendue utile d'une pièce : sa coque si elle en a une, sinon son sol. */
function etendueUtile(config) {
  const s = config?.shell;
  if (Number(s?.width) > 0 && Number(s?.depth) > 0) {
    return Math.max(Number(s.width), Number(s.depth));
  }
  return Number(config?.floor?.size) > 0 ? config.floor.size : 80; // défaut du sol
}

/** Cadre la caméra d'ombre (recadrable à chaud). */
export function frameKeyLightShadow(group, config) {
  const light = group.userData.light;
  if (!light.castShadow) return;
  const etendue = etendueUtile(config);
  const half = Math.min(etendue / 2 + 2, PORTEE_OMBRE);
  const cam = light.shadow.camera;
  cam.left = -half; cam.right = half;
  cam.top = half; cam.bottom = -half;
  // la fenêtre suit le visiteur : la profondeur doit couvrir toute la
  // pièce derrière lui, pas seulement la boîte cadrée
  cam.near = 1; cam.far = etendue * 2 + 40;
  cam.updateProjectionMatrix();
  group.userData.demiOmbre = half;
  group.userData.suit = etendue / 2 + 2 > PORTEE_OMBRE;

  // LE BIAIS SUIT LA FINESSE. Le biais normal décale le point testé le long
  // de sa normale pour éviter l'acné d'auto-ombrage ; il doit valoir un peu
  // plus d'un texel, pas davantage — sinon il décolle l'ombre de l'objet et
  // le banc se remet à flotter. Il était figé à 5 cm, taillé pour les
  // texels de 7 cm de l'entrée ; à 1,7 cm il mangeait trois texels.
  const texel = (half * 2) / (light.shadow.mapSize.x || 1024);
  light.shadow.normalBias = Math.min(0.05, Math.max(0.008, texel * 1.4));
}

const _centre = new THREE.Vector3();
const _axe = new THREE.Vector3();
const _base = new THREE.Matrix4();
const _inverse = new THREE.Matrix4();
const _origine = new THREE.Vector3(0, 0, 0);
const _hautY = new THREE.Vector3(0, 1, 0);
const _hautZ = new THREE.Vector3(0, 0, 1);

/**
 * Recentre la fenêtre d'ombre sur un point (la position du visiteur),
 * calée sur la grille de texels. Ne fait rien si la pièce tient déjà
 * entière dans la fenêtre. Renvoie true si quelque chose a bougé — la
 * carte n'a alors besoin d'être redessinée que dans ce cas.
 */
export function suivreOmbre(group, cible) {
  const light = group?.userData?.light;
  if (!light?.castShadow || !group.userData.suit) return false;

  const half = group.userData.demiOmbre ?? PORTEE_OMBRE;
  const texel = (half * 2) / (light.shadow.mapSize.x || 1024);

  // le repère de la lumière : on y arrondit, sinon le calage ne cale rien
  _axe.copy(light.position).sub(light.target.position);
  const dist = _axe.length() || 1;
  _axe.divideScalar(dist);
  // une lumière au zénith rend `lookAt` dégénéré (axe parallèle au haut) :
  // on change alors de vecteur haut, le repère reste orthonormé
  const haut = Math.abs(_axe.y) > 0.999 ? _hautZ : _hautY;
  _base.lookAt(_axe, _origine, haut);            // colonnes = droite, haut, axe
  _centre.set(cible.x, 0, cible.z);
  _centre.applyMatrix4(_inverse.copy(_base).invert());
  _centre.x = Math.round(_centre.x / texel) * texel;
  _centre.y = Math.round(_centre.y / texel) * texel;
  _centre.applyMatrix4(_base);

  if (light.target.position.distanceToSquared(_centre) < 1e-8) return false;
  light.target.position.copy(_centre);
  light.position.copy(_centre).addScaledVector(_axe, dist);
  light.target.updateMatrixWorld();
  return true;
}

/** (Ré)oriente et re-règle la lumière clé depuis la config, sans recréer. */
export function orientKeyLight(group, config) {
  const opt = { ...KEYLIGHT_DEFAULTS, ...(config?.keyLight ?? {}) };
  const light = group.userData.light;
  light.color.set(opt.color);
  light.intensity = opt.intensity;
  const az = THREE.MathUtils.degToRad(opt.azimuth);
  const el = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(opt.elevation, 5, 89));
  const size = Number(config?.floor?.size) > 0 ? config.floor.size : 80;
  const dist = size * 0.75 + 10;
  light.position.set(
    Math.sin(az) * Math.cos(el) * dist,
    Math.sin(el) * dist,
    Math.cos(az) * Math.cos(el) * dist
  );
  light.target.position.set(0, 0, 0);
}

export function disposeKeyLight(group) {
  const light = group.userData.light;
  light.shadow?.map?.dispose();
  light.dispose();
}

/* ------------------------------------------------------ ombre de contact --- */

let _texContact = null;

/** Le dégradé radial partagé : dessiné une fois, servi à tous. */
function texContact() {
  if (_texContact || typeof document === 'undefined') return _texContact;
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  // dense au centre, fondu en douceur : la courbe d'une vraie occlusion,
  // pas un disque dur
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.28)');
  g.addColorStop(0.85, 'rgba(0,0,0,0.07)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  _texContact = new THREE.CanvasTexture(c);
  return _texContact;
}

/**
 * L'ombre de contact d'un objet posé : une ellipse douce à son pied.
 *
 * `rx`/`rz` : demi-empreinte au sol, en mètres (légèrement gonflée par
 * l'appelant). `y` : la hauteur LOCALE du sol sous l'objet. Le maillage ne
 * projette ni ne reçoit — c'est une ombre, pas une surface — et il ignore
 * le raycast : on ne clique pas une ombre, on ne marche pas dessus.
 */
export function ombreDeContact(rx, rz, y = 0.02) {
  const tex = texContact();
  if (!tex) return null;
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(rx * 2, rz * 2),
    new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthWrite: false,
      // le dégradé est noir : c'est son alpha qui assombrit, quel que soit
      // le ton du sol — et le brouillard ne doit pas l'éclaircir
      fog: false
    })
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = y;
  m.renderOrder = 1;            // après le sol, sans écrire la profondeur
  m.userData.ignoreRaycast = true;
  m.userData.sansOmbre = true;  // jamais dans la carte d'ombre
  m.raycast = () => {};
  return m;
}

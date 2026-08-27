import * as THREE from 'three';

/**
 * Ciel — un dôme au-dessus des pièces à ciel ouvert.
 *
 * Tout est PROCÉDURAL, dans un seul fragment shader : dégradé zénith →
 * horizon, nuages en bruit de valeur (3 octaves) projetés à plat comme sur
 * les dômes de jeu classiques, brume d'horizon, et un soleil (disque +
 * halo) aligné sur la lumière clé de la pièce. Aucune texture, aucun
 * téléchargement, un seul appel de dessin — et le dôme se dessine APRÈS
 * l'opaque (renderOrder), si bien que le early-z ne paie que les pixels de
 * ciel réellement visibles, jamais ceux que l'architecture recouvre.
 *
 * Par pièce, dans le JSON :
 *   "sky": { "zenith": "#2f66c9", "horizon": "#bcd8f4",
 *            "cloudColor": "#eef3fa", "clouds": 0.45, "haze": 0.55,
 *            "stars": 0 }
 *
 * `clouds` est la couverture (0 = aucun, 1 = couvert), `haze` l'épaisseur
 * de la brume d'horizon, `stars` la densité du champ d'étoiles (0 le jour,
 * ~0,8 pour une nuit claire). Les nuages dérivent lentement (uTime, poussé par
 * RoomManager) — immobiles si l'utilisateur préfère le mouvement réduit.
 *
 * Les couleurs sont auteurées AVANT le tone mapping ACES : le moteur les
 * compresse comme le reste de la scène, c'est ce qui garde le ciel dans la
 * même lumière que les œuvres. Leur luminance reste sous le seuil du bloom
 * (0,55) pour que le bleu ne « fleurisse » pas ; seuls les nuages le
 * frôlent — un léger halo qui participe de la brume demandée.
 *
 * Repère : le dôme vit dans le groupe de la pièce. Dans une pièce Escher
 * qui bascule, il tournerait avec elle — les pièces à ciel n'ont pas de
 * bascules aujourd'hui, et un ciel qui pivote serait de toute façon un
 * choix d'auteur, pas un bogue.
 */

/**
 * Couleurs par défaut, calibrées CONTRE le pipeline : leur luminance
 * linéaire reste sous le seuil du bloom (0,55) pour que le ciel ne
 * s'embrase pas — seul le soleil le dépasse, et son halo est voulu.
 * L'exposition ACES (1,1 à 1,45 selon l'écran) les remonte ensuite.
 */
export const SKY_DEFAULTS = {
  zenith: '#1e4da6',
  horizon: '#92b8e2',
  cloudColor: '#aebfd2',
  clouds: 0.38,
  haze: 0.55,
  stars: 0
};

const SkyShader = {
  vertexShader: /* glsl */ `
    varying vec3 vDir;
    void main() {
      vDir = position;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 uZenith, uHorizon, uCloud, uSunDir, uSunColor;
    uniform float uClouds, uHaze, uTime, uStars;
    varying vec3 vDir;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
                 mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
    }
    float fbm(vec2 p) {
      float v = 0.50 * noise(p);
      v += 0.27 * noise(p * 2.03 + 17.0);
      v += 0.15 * noise(p * 4.11 + 43.0);
      v += 0.08 * noise(p * 8.23 + 71.0); // le grain des bords de nuage
      return v;
    }

    /* Les étoiles : une grille sur la direction du regard, une étoile par
       cellule, posée au hasard DANS la cellule — sinon elles s'alignent et
       le ciel devient un damier. La taille vient du même hash, si bien que
       quelques-unes dominent : c'est ce qui fait une constellation plutôt
       qu'un grain uniforme. Elles scintillent lentement, chacune à son
       rythme, et s'éteignent près de l'horizon comme derrière la brume. */
    float etoiles(vec3 d, float densite) {
      if (densite < 0.001 || d.y < 0.02) return 0.0;
      vec2 uv = vec2(atan(d.z, d.x) * 2.6, asin(clamp(d.y, -1.0, 1.0)) * 4.2) * 9.0;
      vec2 i = floor(uv), f = fract(uv);
      float a = hash(i), b = hash(i + 37.3), c = hash(i + 91.7);
      if (a > densite * 0.34) return 0.0;              // la plupart des cases sont vides
      vec2 centre = vec2(b, c) * 0.7 + 0.15;
      float r = length(f - centre);
      float taille = 0.028 + a * 0.13;                 // quelques-unes plus grosses
      float lueur = smoothstep(taille, 0.0, r);
      float clignote = 0.72 + 0.28 * sin(uTime * (0.7 + b * 1.9) + c * 6.28);
      return lueur * clignote * smoothstep(0.02, 0.22, d.y);
    }

    void main() {
      vec3 d = normalize(vDir);
      float h = clamp(d.y, 0.0, 1.0);
      // dégradé : l'horizon remonte doucement vers le zénith
      vec3 col = mix(uHorizon, uZenith, pow(h, 0.6));

      // les étoiles AVANT les nuages : un nuage qui passe les efface
      col += vec3(0.86, 0.89, 1.0) * etoiles(d, uStars) * 0.62;

      // soleil : petit disque net + large halo doux
      float s = max(dot(d, uSunDir), 0.0);
      col += uSunColor * (pow(s, 900.0) * 0.9 + pow(s, 18.0) * 0.10);

      // nuages : projection à plat, dérive lente, fondu près de l'horizon
      if (d.y > 0.015 && uClouds > 0.001) {
        vec2 uv = d.xz / (max(d.y, 0.015) + 0.22);
        uv = uv * 1.2 + uTime * vec2(0.0075, 0.0028);
        float n = fbm(uv);
        float cov = smoothstep(1.0 - uClouds * 0.72, 1.06 - uClouds * 0.72, n + 0.18);
        float att = smoothstep(0.015, 0.16, d.y);
        // les bords des nuages prennent la teinte du ciel : pas de découpe
        col = mix(col, uCloud, cov * att * 0.85);
      }

      // brume d'horizon : épaisse en bas, dissoute au zénith
      col = mix(col, uHorizon, uHaze * pow(1.0 - h, 3.5));
      gl_FragColor = vec4(col, 1.0);
    }`
};

/**
 * Construit le dôme d'une pièce, ou null si elle n'en déclare pas.
 * Le rayon enveloppe le sol avec de la marge, sous le plan lointain de la
 * caméra (220) : le dôme reste un décor, jamais un plafond qu'on cogne.
 */
export function buildSky(config) {
  const cfg = config?.sky;
  if (!cfg) return null;
  const opt = { ...SKY_DEFAULTS, ...(cfg === true ? {} : cfg) };

  const floor = Number(config?.floor?.size) > 0 ? config.floor.size : 60;
  const shell = config?.shell && config.shell !== true ? config.shell : {};
  const span = Math.max(floor, Number(shell.width) || 0, Number(shell.depth) || 0);
  const radius = Math.min(190, span * 0.75 + 55);

  // sphère presque complète : vue par-dessus un bord de sol, une calotte
  // tronquée montrait sa tranche ouverte — quelques triangles de plus et
  // le dôme n'a plus de bord du tout (le shader peint l'horizon en bas)
  const geometry = new THREE.SphereGeometry(
    radius, 28, 16, 0, Math.PI * 2, 0, Math.PI * 0.85
  );

  const { sunDir, sunColor } = sunOf(config);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uZenith: { value: new THREE.Color(opt.zenith) },
      uHorizon: { value: new THREE.Color(opt.horizon) },
      uCloud: { value: new THREE.Color(opt.cloudColor) },
      uSunDir: { value: sunDir },
      uSunColor: { value: sunColor },
      uClouds: { value: THREE.MathUtils.clamp(Number(opt.clouds) || 0, 0, 1) },
      uHaze: { value: THREE.MathUtils.clamp(Number(opt.haze) || 0, 0, 1) },
      uStars: { value: THREE.MathUtils.clamp(Number(opt.stars) || 0, 0, 1) },
      uTime: { value: 0 }
    },
    vertexShader: SkyShader.vertexShader,
    fragmentShader: SkyShader.fragmentShader,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'ciel';
  // APRÈS l'opaque : l'early-z épargne tous les pixels déjà couverts
  mesh.renderOrder = 5;
  mesh.frustumCulled = false; // on est DEDANS : la sphère sort toujours du frustum
  mesh.userData.ignoreRaycast = true;
  return mesh;
}

/**
 * Direction et couleur du soleil, lues dans la lumière clé de la pièce —
 * le ciel et les ombres racontent la même heure. `keyLight: false` éteint
 * aussi le soleil du dôme : pas de lumière, pas de disque.
 */
function sunOf(config) {
  if (config?.keyLight === false) {
    return { sunDir: new THREE.Vector3(0, -1, 0), sunColor: new THREE.Color(0x000000) };
  }
  const kl = config?.keyLight ?? {};
  const az = THREE.MathUtils.degToRad(kl.azimuth ?? 35);
  const el = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(kl.elevation ?? 55, 5, 89));
  return {
    sunDir: new THREE.Vector3(
      Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)
    ),
    sunColor: new THREE.Color(kl.color ?? '#fff2d8')
  };
}

/**
 * Met à jour les uniforms d'un dôme EXISTANT depuis la config — couleurs,
 * couverture, brume, soleil. C'est le chemin vif de l'éditeur : aucun
 * matériau recréé, donc aucun shader recompilé pendant qu'on glisse un
 * curseur. La géométrie ne dépend que des dimensions de la pièce, qui ont
 * leur propre chemin (rebuild).
 */
export function updateSkyUniforms(mesh, config) {
  const cfg = config?.sky;
  if (!mesh || !cfg) return false;
  const opt = { ...SKY_DEFAULTS, ...(cfg === true ? {} : cfg) };
  const u = mesh.material.uniforms;
  u.uZenith.value.set(opt.zenith);
  u.uHorizon.value.set(opt.horizon);
  u.uCloud.value.set(opt.cloudColor);
  u.uClouds.value = THREE.MathUtils.clamp(Number(opt.clouds) || 0, 0, 1);
  u.uHaze.value = THREE.MathUtils.clamp(Number(opt.haze) || 0, 0, 1);
  u.uStars.value = THREE.MathUtils.clamp(Number(opt.stars) || 0, 0, 1);
  const { sunDir, sunColor } = sunOf(config);
  u.uSunDir.value.copy(sunDir);
  u.uSunColor.value.copy(sunColor);
  return true;
}

export function disposeSky(mesh) {
  mesh.geometry?.dispose();
  mesh.material?.dispose();
}

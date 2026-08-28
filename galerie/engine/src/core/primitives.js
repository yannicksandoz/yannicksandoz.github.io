import * as THREE from 'three';
import { estFluide } from './style.js';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { scaleObjetUV } from './textures.js';
import { jeuDeSurface } from './matieres.js';

/**
 * Les tables de `RectAreaLight` (BRDF pré-intégrée) ne se chargent qu'une
 * fois, et seulement si une corniche existe : une galerie sans lumière
 * d'architecte n'en paie rien. `init()` touche au contexte WebGL — d'où le
 * garde `document`, qui laisse les suites node importer ce module.
 */
let tablesPretes = false;
function preparerCorniches() {
  if (tablesPretes || typeof document === 'undefined') return;
  tablesPretes = true;
  RectAreaLightUniformsLib.init();
}

/**
 * COMBIEN DE SOURCES ÉTENDUES la machine peut porter — posé par l'App
 * depuis le profil de qualité (voir Quality).
 *
 * Ce n'est pas un réglage d'esthète : mesuré au belvédère, quatre bandeaux
 * de 46 m coûtaient 26 % du temps d'image, quand la gerbe et ses
 * quarante-deux rais n'en coûtaient que 8. Chaque pixel de chaque surface
 * intègre une LTC par lampe, et un cube de cinquante mètres présente
 * beaucoup de surface. Le TRAIT, lui, ne coûte presque rien.
 *
 * À zéro (mobile), les corniches gardent donc leur ligne de lumière et
 * perdent leur source : c'est le dégradé sur le mur qui s'en va, pas la
 * lumière de la salle — la clé et les ponctuelles restent.
 */
let budgetSourcesEtendues = 8;
export function setBudgetSourcesEtendues(n) {
  budgetSourcesEtendues = Number.isFinite(n) ? Math.max(0, n) : 8;
}

/** La machine peut-elle payer des sources de confort (lavis, flaques) ? */
export function aDesSourcesEtendues() { return budgetSourcesEtendues > 0; }

/**
 * COMBIEN LE TRAIT D'UNE FENTE DOIT BRÛLER — et pourquoi ça dépend de la
 * machine.
 *
 * Le bandeau d'une corniche est un TRAIT de douze centimètres. Ce qui en
 * fait un néon, ce n'est pas sa couleur : c'est la fleur du bloom autour
 * de lui. Or le bloom se calcule à une fraction de la résolution — la
 * moitié au bureau, le QUART sur téléphone — et à cette taille-là une
 * ligne de douze centimètres vue de vingt mètres ne couvre plus un texel :
 * elle disparaît de la passe de flou, et le néon redevient un fil gris.
 * C'est ce qu'on voyait à l'entrée sur mobile.
 *
 * On compense donc là où le bloom ne suit pas : le trait brûle un peu plus
 * fort quand il a moins de fleur à attendre. L'auteur garde la main —
 * `eclat` dans le JSON reste sa valeur de référence, celle du bureau.
 */
let eclatLuminaires = 1;
export function setEclatLuminaires(f) {
  eclatLuminaires = Number.isFinite(f) && f > 0 ? f : 1;
}

/**
 * Primitives paramétriques du mode Objets.
 *
 * Elles vivent dans le cœur (et non dans l'éditeur) parce que le runtime
 * doit savoir les reconstruire depuis le JSON d'une scène publiée :
 *     "model": { "shape": "torus", "color": "#66f0d8", "size": 1.4 }
 *
 * `monolith` reste géré à part dans Artwork : c'est un shader réactif à
 * l'audio, pas une simple géométrie.
 */
export const PRIMITIVES = {
  box:      { label: 'Cube',     build: (s) => new THREE.BoxGeometry(s, s, s) },
  sphere:   { label: 'Sphère',   build: (s) => new THREE.SphereGeometry(s * 0.6, 32, 20) },
  plane:    { label: 'Plan',     build: (s) => new THREE.PlaneGeometry(s * 1.6, s) },
  cylinder: { label: 'Cylindre', build: (s) => new THREE.CylinderGeometry(s * 0.5, s * 0.5, s * 1.6, 28) },
  cone:     { label: 'Cône',     build: (s) => new THREE.ConeGeometry(s * 0.6, s * 1.6, 28) },
  torus:    { label: 'Tore',     build: (s) => new THREE.TorusGeometry(s * 0.6, s * 0.22, 18, 40) },
  eau:      { label: 'Eau',      build: (s) => new THREE.PlaneGeometry(s * 1.6, s, 48, 32) },
  // fût ouvert, plus large au pied : un puits de lumière qui tombe.
  // (buildFaisceau construit sa propre géométrie — il lui faut sa hauteur
  // réelle et sa face source ; l'entrée reste ici pour le registre.)
  faisceau: { label: 'Faisceau', build: (s) => new THREE.CylinderGeometry(s * 0.25, s * 0.85, s * 6, 24, 1, true) },
  // bandeau lumineux d'architecte : une ligne de lumière indirecte, posée
  // dans une corniche ou le long d'un mur (buildCorniche fait le reste)
  corniche: { label: 'Corniche', build: (s) => new THREE.PlaneGeometry(s, s * 0.12) },
  // gerbe : des dizaines de rais partant d'UN point (buildGerbe fait le reste)
  gerbe: { label: 'Gerbe', build: (s) => new THREE.SphereGeometry(s * 0.1, 8, 6) },
  // la géométrie réelle (essaim de points) se construit dans buildPrimitive
  lucioles: { label: 'Lucioles', build: (s) => new THREE.BoxGeometry(s, s, s) },
  // ruban paramétrique : une coque balayée le long d'une courbe — l'outil
  // des formes fluides (buildRuban fait le vrai travail)
  ruban: { label: 'Ruban', build: (s) => new THREE.BoxGeometry(s, s * 0.1, s * 0.3) },
  // galet : une dalle posée au contour super-elliptique — lit de sable,
  // margelle (trouée), podium (buildGalet fait le vrai travail)
  galet: { label: 'Galet', build: (s) => new THREE.CylinderGeometry(s * 0.8, s * 0.8, s * 0.12, 32) }
};

/**
 * Horloge partagée des matériaux d'eau : UN objet uniform pour toutes les
 * étendues d'eau de la scène, avancé d'une ligne dans la boucle de l'App.
 * Ni registre, ni traverse — le coût est le même pour zéro ou cent bassins.
 */
export const WATER_TIME = { value: 0 };

/**
 * Matériau d'eau — un bassin de jardin japonais, pas un océan : une eau
 * sombre et calme, des vaguelettes procédurales qui froissent la normale
 * (deux trains d'ondes + un souffle de bruit), un fresnel qui éclaircit
 * l'eau rasante vers la teinte du ciel, et le reflet du soleil qui glisse
 * sur les rides. Tout est dans le shader : aucune texture, aucun rendu
 * supplémentaire — le reflet est suggéré, pas calculé.
 */
function buildWaterMaterial(model) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: WATER_TIME, // partagé : l'App n'avance qu'une horloge
      uDeep: { value: new THREE.Color(model.color ?? '#16324a') },
      uSkyTint: { value: new THREE.Color(model.skyTint ?? '#8fb6de') },
      uSunDir: { value: new THREE.Vector3(0.47, 0.79, -0.40).normalize() },
      uRipple: { value: Number.isFinite(model.ripple) ? model.ripple : 1 }
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      varying vec3 vNormalW;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        vNormalW = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uDeep, uSkyTint, uSunDir;
      uniform float uTime, uRipple;
      varying vec3 vWorld;
      varying vec3 vNormalW;

      // hash SANS sin(x·43758) : sur les GPU Apple (Metal), sin perd toute
      // précision au-delà de ~10^4 et le motif dégénère — celui-ci n'emploie
      // que fract et dot, il est stable partout.
      float hash(vec2 p) {
        vec3 q = fract(vec3(p.xyx) * 0.1031);
        q += dot(q, q.yzx + 33.33);
        return fract((q.x + q.y) * q.z);
      }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
                   mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
      }

      void main() {
        float t = uTime;
        vec2 p = vWorld.xz;
        // deux trains d'ondes croisés + un froissement de bruit
        float h = sin(p.x * 2.1 + t * 0.9) * 0.5
                + sin(dot(p, vec2(1.3, 1.7)) + t * 0.6) * 0.35
                + (noise(p * 1.4 + t * 0.12) - 0.5) * 0.9;
        float hx = cos(p.x * 2.1 + t * 0.9) * 1.05
                 + cos(dot(p, vec2(1.3, 1.7)) + t * 0.6) * 0.45;
        float hz = cos(dot(p, vec2(1.3, 1.7)) + t * 0.6) * 0.6;
        vec3 n = normalize(vNormalW + vec3(hx, 0.0, hz) * 0.045 * uRipple);

        vec3 view = normalize(cameraPosition - vWorld);
        // fresnel : l'eau vue de haut est profonde, rasante elle prend le
        // ciel. Cubique EXPLICITE, pas pow() : dot(view, n) dépasse 1.0
        // d'un chouia en flottant quand on regarde l'eau à l'aplomb, la
        // base devient négative et pow() est indéfini en GLSL — NaN, donc
        // noir, sur Metal (le bassin vu du dessus devenait un bloc noir).
        float fc = clamp(1.0 - dot(view, n), 0.0, 1.0);
        float fres = fc * fc * fc;
        vec3 col = mix(uDeep, uSkyTint, 0.15 + fres * 0.7);
        // le soleil glisse sur les rides (base clampée dans [0,1] : sûre)
        vec3 refl = reflect(-view, n);
        float sun = pow(clamp(dot(refl, uSunDir), 0.0, 1.0), 140.0);
        col += vec3(1.0, 0.95, 0.85) * sun * 0.9;
        // profondeur qui respire à peine avec la houle
        col *= 1.0 + h * 0.03;
        gl_FragColor = vec4(col, 1.0);
      }`
  });
}

export function isPrimitive(shape) {
  return Object.hasOwn(PRIMITIVES, shape);
}

/**
 * Construit le mesh d'une primitive depuis `config.model`.
 *
 * `echelle` est l'échelle que l'ŒUVRE applique ensuite à son groupe
 * (`config.scale`). Elle compte : un rayonnage est une boîte d'un mètre et
 * demi étirée à 0,5 × 3,2 × 3,6, et sans elle le motif du bois serait posé
 * à l'échelle de la boîte d'origine puis étiré sept fois en hauteur. On la
 * reçoit ici pour poser les UV à la taille FINALE de l'objet.
 */
export function buildPrimitive(model, echelle = null) {
  const def = PRIMITIVES[model.shape];
  if (!def) return null;
  const size = Number.isFinite(model.size) ? model.size : 1.5;

  if (model.shape === 'eau') {
    const mesh = new THREE.Mesh(def.build(size), buildWaterMaterial(model));
    mesh.rotation.x = -Math.PI / 2; // une étendue d'eau est horizontale
    return mesh;
  }
  if (model.shape === 'faisceau') return buildFaisceau(size, model);
  if (model.shape === 'corniche') return buildCorniche(size, model);
  if (model.shape === 'gerbe') return buildGerbe(size, model);
  if (model.shape === 'lucioles') return buildLucioles(size, model);
  if (model.shape === 'ruban') return buildRuban(size, model, echelle);
  if (model.shape === 'galet') return buildGalet(size, model, echelle);

  return finishPrimitive(def, size, model, echelle);
}

/**
 * Faisceau de lumière volumétrique — un puits de lumière suggéré, pas
 * calculé : un fût conique additif dont l'intensité est pleine quand le
 * regard TRAVERSE le volume (fresnel inversé) et s'évanouit sur la
 * tranche, avec un fondu vers le pied et une lente respiration. Aucune
 * vraie volumétrie, aucun coût : deux passes de triangles transparents.
 * `emissive` règle la force, `color` la teinte.
 */
function buildFaisceau(size, model) {
  // LE FAISCEAU A UNE SOURCE, ET ELLE SE VOIT. Le fût était un cylindre
  // ouvert aux deux bouts : en l'air, il se terminait par un anneau net
  // découpé sur le vide — un tube flottant, pas un rai de lumière. Un
  // faisceau naît toujours de QUELQUE CHOSE : une trémie, un plafonnier,
  // une fente. On lui donne donc sa face émettrice au sommet, et une
  // hauteur qui traverse réellement le volume (`hauteur`, en mètres, au
  // lieu des six fois la taille qu'il déduisait tout seul).
  const hauteur = Number.isFinite(model.hauteur) ? model.hauteur : size * 6;
  const rayonHaut = size * 0.25;
  const groupe = new THREE.Group();
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: WATER_TIME,
      uColor: { value: new THREE.Color(model.color ?? '#cbb4ff') },
      uForce: { value: model.emissive ?? 0.4 },
      uHauteur: { value: hauteur }
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      uniform float uHauteur;
      varying float vHaut;   // 0 au pied, 1 au sommet
      varying vec3 vN, vVue;
      void main() {
        vHaut = clamp(position.y / uHauteur + 0.5, 0.0, 1.0);
        vN = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vVue = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uForce, uTime;
      varying float vHaut;
      varying vec3 vN, vVue;
      void main() {
        // plein au cœur du fût, évanoui sur la tranche
        float coeur = pow(abs(dot(normalize(vN), normalize(vVue))), 1.6);
        // le pied se dissout ; le sommet aussi, mais sur trois fois moins
        // de course : c'est là que la face source prend le relais, et un
        // fût à pleine force contre elle ferait un bourrelet trop clair
        float fondu = smoothstep(0.0, 0.45, vHaut) * (1.0 - smoothstep(0.88, 1.0, vHaut) * 0.35);
        float vie = 1.0 + 0.08 * sin(uTime * 0.55 + vHaut * 5.0);
        gl_FragColor = vec4(uColor, coeur * fondu * uForce * vie);
      }`
  });
  const fut = new THREE.Mesh(
    new THREE.CylinderGeometry(rayonHaut, size * 0.85, hauteur, 24, 1, true), mat);
  groupe.add(fut);

  // LA FACE SOURCE — un disque plein au sommet, tourné vers le bas. C'est
  // lui qui donne au rai son origine : sans lui l'œil cherche d'où vient
  // la lumière et ne trouve qu'une découpe. Dégradé radial pour que le
  // bord ne fasse pas un cercle de carton.
  const source = new THREE.Mesh(
    new THREE.CircleGeometry(rayonHaut * 1.15, 32),
    new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(model.emissiveColor ?? model.color ?? '#cbb4ff') },
        uForce: { value: (model.emissive ?? 0.4) * 2.2 }
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uForce;
        varying vec2 vUv;
        void main() {
          float r = length(vUv - 0.5) * 2.0;      // 0 au centre, 1 au bord
          float chute = 1.0 - smoothstep(0.35, 1.0, r);
          gl_FragColor = vec4(uColor, chute * uForce);
        }`
    })
  );
  source.rotation.x = Math.PI / 2;   // la face regarde vers le bas
  source.position.y = hauteur / 2;
  groupe.add(source);

  for (const o of [fut, source]) {
    o.raycast = () => {};            // de la lumière : jamais une cible
    o.userData.sansOmbre = true;     // …et jamais un cône d'ombre
  }
  groupe.userData.sansOmbre = true;
  return groupe;
}

/**
 * LA CORNICHE — une ligne de lumière, pas une lampe.
 *
 * C'est le geste de l'architecture contemporaine (Hadid, et les images de
 * MIR qui l'ont mise en scène) : on ne voit JAMAIS la source, on voit la
 * surface qu'elle lèche. La lumière sort d'une fente, court le long d'un
 * mur, révèle la courbure d'un plan par un dégradé au lieu d'un point
 * chaud. Une lampe ponctuelle ne sait pas faire ça — elle fabrique une
 * tache et une ombre dure ; il faut une source ÉTENDUE.
 *
 * `RectAreaLight` en est une (three.js, MIT) : un rectangle qui émet par
 * sa face, avec la bonne décroissance. Elle ne projette pas d'ombre, ce
 * qui tombe bien — l'éclairage indirect n'en produit pas de franche.
 *
 * Dans le JSON :
 *   "model": { "shape": "corniche", "longueur": 8, "epaisseur": 0.14,
 *              "color": "#cfd8ff", "intensite": 12 }
 *
 * UNE CORNICHE ÉCLAIRE LÀ OÙ SA FACE REGARDE — c'est la `rotation` de
 * l'œuvre qui l'oriente, comme on braque un vrai luminaire, et rien
 * d'autre. Un premier essai séparait les deux (le bandeau à plat, la
 * lumière en bas par un drapeau) : posée à 80 cm d'un mur et braquée
 * droit vers le sol, elle ne le léchait qu'en rasant — deux points de
 * luminance gagnés sur soixante-dix-sept, mesurés. Un lavage de mur se
 * BRAQUE : `"rotation": [-55, 0, 0]` incline la ligne vers la paroi,
 * `[-90, 0, 0]` la couche à plat pour tomber sur le sol.
 */
/**
 * LA GERBE — un point qui éclate en quarante-deux rais.
 *
 * Un faisceau unique tombe d'un plafond ; une gerbe part d'un SOMMET et
 * traverse le volume vers celui d'en face. Dans un cube de 50 m, c'est la
 * grande diagonale — 86 m de lumière en travers de la pièce, qui donne
 * enfin à voir la profondeur de la boîte. Les rais s'écartent doucement :
 * de près on passe entre eux, de loin ils se referment en éventail.
 *
 * Dans le JSON :
 *   "model": { "shape": "gerbe", "nombre": 42, "portee": 86,
 *              "vers": [1, -1, 1], "ouverture": 13, "color": "#cbb4ff" }
 *
 * `vers` est une DIRECTION dans le repère de la salle : pour un cube, le
 * vecteur qui joint deux sommets opposés. La nommer ainsi évite d'avoir à
 * composer soi-même les angles d'Euler d'une diagonale — la même raison
 * qui a fait nommer le mur des corniches plutôt que leurs degrés.
 *
 * Les rais se répartissent en SPIRALE D'OR (l'angle d'or, ≈ 137,5°) : la
 * distribution est régulière sans être en grille, et surtout elle est
 * déterministe — un tirage au hasard aurait donné une gerbe différente à
 * chaque chargement, et à chaque photo path-tracée.
 *
 * Tous les rais sont FONDUS EN UNE SEULE GÉOMÉTRIE : quarante-deux
 * maillages, ce serait quarante-deux appels de rendu pour un objet qu'on
 * regarde d'un bloc.
 */
function buildGerbe(size, model) {
  // Sur une machine sans budget de sources étendues (mobile), la gerbe
  // s'éclaircit : ses rais sont additifs et transparents, donc chacun
  // repasse sur les pixels des autres — c'est du remplissage, exactement
  // ce qui manque à un GPU de téléphone. Vingt rais au lieu de quarante-
  // deux gardent l'éventail ; c'est sa forme qu'on lit, pas son compte.
  const demande = Math.round(model.nombre ?? 42);
  const nombre = Math.max(1, Math.min(
    budgetSourcesEtendues > 0 ? demande : Math.ceil(demande / 2), 200));
  const portee = Number.isFinite(model.portee) ? model.portee : size * 8;
  const ouverture = THREE.MathUtils.degToRad(model.ouverture ?? 12);
  const rApex = model.rayonApex ?? 0.05;
  const rBout = model.rayonBout ?? 0.55;
  const ANGLE_OR = Math.PI * (3 - Math.sqrt(5));

  const morceaux = [];
  for (let i = 0; i < nombre; i++) {
    // racine carrée : sans elle les rais s'entassent au centre de l'éventail
    const t = nombre === 1 ? 0 : i / (nombre - 1);
    const ecart = Math.sqrt(t) * ouverture;
    const azimut = i * ANGLE_OR;
    const direction = new THREE.Vector3(
      Math.sin(ecart) * Math.cos(azimut),
      Math.sin(ecart) * Math.sin(azimut),
      Math.cos(ecart)
    );
    const g = new THREE.CylinderGeometry(rApex, rBout, portee, 5, 1, true);
    g.translate(0, portee / 2, 0);      // la base du rai à l'apex
    // combien de chemin parcouru depuis l'apex : lu AVANT de coucher le rai,
    // quand la longueur est encore portée par l'axe Y
    const pos = g.attributes.position;
    const along = new Float32Array(pos.count);
    for (let v = 0; v < pos.count; v++) along[v] = pos.getY(v) / portee;
    g.setAttribute('aLong', new THREE.BufferAttribute(along, 1));
    g.rotateX(Math.PI / 2);             // l'axe du rai passe de Y à +Z
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 0, 1), direction));
    morceaux.push(g);
  }
  const geometrie = mergeGeometries(morceaux, false);
  for (const g of morceaux) g.dispose();

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: WATER_TIME,
      uColor: { value: new THREE.Color(model.color ?? '#cbb4ff') },
      uForce: { value: model.emissive ?? 0.5 }
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute float aLong;
      varying float vLong;
      varying vec3 vN, vVue;
      void main() {
        vLong = aLong;
        vN = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vVue = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uForce, uTime;
      varying float vLong;
      varying vec3 vN, vVue;
      void main() {
        // plein au cœur du rai, évanoui sur sa tranche
        float coeur = pow(abs(dot(normalize(vN), normalize(vVue))), 1.5);
        // franc au départ, dissous au loin — un rai s'épuise en avançant
        float chute = 1.0 - smoothstep(0.15, 1.0, vLong);
        // chaque rai respire à son rythme : l'éventail vit sans clignoter
        float vie = 1.0 + 0.07 * sin(uTime * 0.5 + vLong * 9.0);
        gl_FragColor = vec4(uColor, coeur * chute * uForce * vie);
      }`
  });

  const groupe = new THREE.Group();
  const rais = new THREE.Mesh(geometrie, mat);
  groupe.add(rais);

  // L'APEX — le point d'où tout part, et qu'on doit voir briller.
  const apex = new THREE.Mesh(
    new THREE.SphereGeometry(Math.max(rApex * 3, 0.35), 16, 12),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(model.emissiveColor ?? model.color ?? '#e8e0ff'),
      toneMapped: false
    })
  );
  groupe.add(apex);

  // orientée par `vers`, une direction de la salle — jamais des degrés
  const vers = Array.isArray(model.vers) && model.vers.length === 3
    ? new THREE.Vector3(...model.vers) : null;
  if (vers && vers.lengthSq() > 1e-6) {
    groupe.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 0, 1), vers.normalize());
    groupe.userData.orientationImposee = true;
  }

  for (const o of [rais, apex]) {
    o.raycast = () => {};
    o.userData.sansOmbre = true;
  }
  groupe.userData.sansOmbre = true;
  return groupe;
}

/** Lacet d'une corniche selon le mur qu'elle lave (comme les fenêtres). */
/**
 * Le lacet qui tourne une corniche vers LE MUR QU'ELLE LAVE.
 *
 * Est et ouest ont longtemps été INTERVERTIS ici, et la faute est restée
 * invisible pendant des mois : une corniche « est » braquée vers la pièce
 * lave le mur d'en face, et dans une salle de dix mètres ce lavage-là se
 * lit comme une lumière d'ambiance parfaitement plausible. C'est le labo
 * (36 m de large) qui l'a trahie — le 1/r² n'y laisse rien arriver — par
 * un déséquilibre net : murs nord/sud lavés, est/ouest éteints, à contenu
 * égal. Vérifié au calcul, pas à l'œil : l'éclairement d'un point de
 * chaque mur, avec la loi exacte du shader et les segments réellement
 * déclarés, donnait 6,5 au nord et au sud contre 2,4 à l'est et à
 * l'ouest ; et le dump des faces montrait nord/sud tournées vers leur mur
 * (juste) quand est/ouest regardaient la pièce (faux). La face émise vaut
 * R_lacet · (0, −√2/2, −√2/2) : il faut −π/2 pour braquer vers +x (mur
 * est) et +π/2 vers −x (mur ouest). `test-lignes-lumiere.mjs` épingle
 * désormais les quatre, par le calcul.
 */
const LACET_MUR = { nord: 0, sud: Math.PI, ouest: Math.PI / 2, est: -Math.PI / 2 };

function buildCorniche(size, model) {
  preparerCorniches();
  const longueur = Number.isFinite(model.longueur) ? model.longueur : size * 4;
  const epaisseur = Number.isFinite(model.epaisseur) ? model.epaisseur : 0.14;
  const couleur = new THREE.Color(model.color ?? '#d6dcff');
  const groupe = new THREE.Group();

  // LE BANDEAU VISIBLE : la fente elle-même, à peine plus qu'un trait.
  // Émissif pur (jamais éclairé) : c'est une source, elle ne reçoit pas.
  // L'ÉCLAT DE LA FENTE, séparé de la couleur de la lumière. Le bandeau
  // sort du tone mapping (une source ne se laisse pas compresser comme une
  // surface) et le bloom fleurit tout ce qui dépasse 0,55 : à pleine
  // couleur, le cœur de la ligne partait en blanc pur avec un halo. On le
  // pose donc juste au-dessus du seuil — assez pour qu'il rayonne, pas
  // assez pour qu'il brûle. La LUMIÈRE, elle, garde sa teinte entière.
  // …et 0,62 était encore trop. Mesuré au navigateur, la corniche
  // ressortait à 135/255 de clarté moyenne quand les ŒUVRES de la même
  // salle plafonnaient à 60-80 : le luminaire était DEUX FOIS plus clair
  // que ce qu'il éclaire. C'est l'inverse exact de ce que fait une salle
  // d'exposition, où l'on cache la source et où l'on ne voit que le lavis.
  // À 0,34 le bandeau passe sous le seuil du bloom (0,55) : il cesse de
  // fleurir en halo et redevient un TRAIT — la ligne de lumière de la DA
  // reste, la brûlure s'en va. La lampe, elle, ne bouge pas d'un lumen.
  const eclat = (Number.isFinite(model.eclat) ? model.eclat : 0.34) * eclatLuminaires;
  // en mode fluide, le trait est subdivisé : Artwork le pliera sur la
  // courbe du voile qu'il longe (voir Artwork._courberCorniche) — un plan
  // de deux triangles ne peut pas suivre une onde
  const bandeau = new THREE.Mesh(
    new THREE.PlaneGeometry(longueur, epaisseur, estFluide() ? 72 : 1, 1),
    new THREE.MeshBasicMaterial({
      color: couleur.clone().multiplyScalar(eclat),
      toneMapped: false, side: THREE.DoubleSide
    })
  );
  groupe.userData.bandeau = bandeau;
  // demi-tour : la face du bandeau regarde alors du MÊME côté que la
  // lumière (le -Z local). Invisible à l'œil — le bandeau se voit des deux
  // côtés — mais c'est ce qui rend vraie la phrase « elle éclaire là où sa
  // face regarde », et donc prévisible la rotation qu'on lui donne.
  bandeau.rotation.y = Math.PI;
  groupe.add(bandeau);

  // LA SOURCE ÉTENDUE, de la taille exacte de la fente : c'est ce qui fait
  // que le dégradé sur le mur suit la ligne, et pas un point.
  // Une RectAreaLight émet vers son -Z local : on la laisse telle quelle,
  // c'est le bandeau qu'on a retourné pour la rejoindre. Une rotation de
  // -45° sur X braque donc l'ensemble vers le bas ET vers l'arrière — un
  // lavage de mur depuis une corniche, exactement le geste voulu.
  // `"lampe": false` — LE TRAIT SANS LA SOURCE. Une ligne qui borde une
  // passerelle dans le vide travaille par son DESSIN : elle raconte le
  // chemin, elle n'a rien à éclairer autour d'elle (il n'y a rien). Lui
  // donner une source étendue coûterait une lampe de plus par passerelle
  // pour un effet que personne ne verrait. Les lavages de mur, eux, la
  // gardent : c'est la surface léchée qui fait tout leur travail.
  if (model.lampe !== false) {
    const force = model.intensite ?? 12;
    if (budgetSourcesEtendues > 0) {
      const lampe = new THREE.RectAreaLight(
        couleur, force, longueur, Math.max(epaisseur, 0.5));
      // légèrement en avant de la fente : la lampe ne s'éclaire pas elle-même
      lampe.position.z = -0.02;
      groupe.add(lampe);
      groupe.userData.lampeCorniche = lampe;
      // LA MARQUE, MÊME AVEC LA LAMPE. Une RectAreaLight est un rectangle
      // RIGIDE : sur un mur cintré au couronnement ondulé, le bandeau se
      // plie (Artwork._courberCorniche) mais elle non — son plan coupe le
      // voile, la moitié de la plaque passe derrière le mur, et le lavage
      // meurt. Mesuré au labo : murs est/ouest à 28–49 de luminance quand
      // les nord/sud tenaient 86–88. Quand la flexion constate que le
      // trait s'est vraiment plié, elle retire la lampe et déclare la
      // LIGNE à la place — celle-ci suit les sommets pliés. La marque
      // porte ce qu'il faut pour ce relais ; tant que la lampe survit,
      // Artwork ne déclare aucune ligne (pas de double éclairage).
      groupe.userData.ligneLumiere = {
        longueur, epaisseur, couleur: couleur.clone(), force
      };
    } else {
      // PROFIL SANS SOURCES ÉTENDUES (mobile) : la fente garderait son
      // trait mais n'éclairerait plus RIEN. Tant qu'un soleil traversait
      // la coque, cela passait ; depuis qu'une pièce close n'est éclairée
      // que par ses propres sources (voir ombres.coqueClose), la salle
      // serait NOIRE sur téléphone — et le bandeau, sans lavage à côté de
      // lui, se lit comme un fil gris au lieu d'un néon.
      //
      // Premier essai : trois ponctuelles réparties le long de la fente.
      // Raté, et pour deux raisons mesurées — une ponctuelle fait une
      // TACHE ronde, pas un dégradé de mur ; et le budget de lampes
      // proches (quatre points sur mobile) n'en gardait qu'une partie,
      // au hasard de la distance. On voyait trois halos violets sans
      // rapport avec la ligne.
      //
      // Deuxième essai, celui-ci : UN cône très ouvert, braqué comme la
      // source qu'il remplaçait. Raté aussi, et pour une raison de
      // géométrie qu'aucun réglage ne rattrape — un cône part d'un POINT.
      // Mesuré : la même puissance concentrée au milieu d'un bandeau de
      // 40 m donne 1,99 fois trop au centre du mur et presque rien aux
      // extrémités. Et le cône concourait pour trois emplacements
      // seulement : une salle à quatre corniches en perdait une.
      //
      // Ce qu'il fallait, c'est garder la LIGNE. L'éclairement d'un
      // segment uniforme a une forme close en une quinzaine d'opérations,
      // sans texture ni emplacement de lampe (voir `lignes-lumiere.js`).
      // On ne pose donc aucune lampe ici : on laisse la marque, et
      // `Artwork` déclarera le segment une fois le bandeau plié sur son
      // voile — la lumière suit alors exactement le trait qu'on voit.
      groupe.userData.ligneLumiere = { longueur, epaisseur, couleur: couleur.clone(), force };
    }
  }

  // LE MUR PLUTÔT QUE LES DEGRÉS. Poser vingt corniches en composant des
  // angles d'Euler à la main, c'est vingt occasions de braquer une lampe
  // vers le vide sans que rien ne le signale. On nomme donc le mur qu'elle
  // lave — le même vocabulaire que les fenêtres de coque — et l'inclinaison
  // se compose ici, une fois, en quaternions (sans ambiguïté d'ordre).
  if (LACET_MUR[model.mur] !== undefined) {
    const inclinaison = THREE.MathUtils.degToRad(model.inclinaison ?? 45);
    const lacet = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0), LACET_MUR[model.mur]);
    const bascule = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(1, 0, 0), -inclinaison);
    // basculée d'abord autour de sa propre longueur, puis tournée vers son mur
    groupe.quaternion.copy(lacet.multiply(bascule));
    groupe.userData.orientationImposee = true;
  }

  for (const o of [bandeau]) {
    o.raycast = () => {};
    o.userData.sansOmbre = true;
  }
  groupe.userData.sansOmbre = true;
  return groupe;
}

/**
 * Lucioles — un essaim de points dorés à dérive lente. Tout le mouvement
 * vit dans le shader (trois sinus déphasés par luciole) : zéro CPU, et
 * l'horloge partagée s'arrête d'elle-même en mouvement réduit. La graine
 * est déterministe : le même essaim à chaque visite.
 * `count`, `seed`, `color`, `emissive` (éclat) se règlent au modèle ;
 * `size` donne le côté du volume de vol.
 */
function buildLucioles(size, model) {
  const n = Math.max(1, Math.round(model.count ?? 36));
  let graine = ((model.seed ?? 7) >>> 0) || 7;
  const rand = () => {
    graine = (graine * 1664525 + 1013904223) >>> 0;
    return graine / 4294967296;
  };
  const pos = new Float32Array(n * 3);
  const phase = new Float32Array(n);
  const vitesse = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    pos[3 * i] = (rand() - 0.5) * size;
    pos[3 * i + 1] = (rand() - 0.5) * size;
    pos[3 * i + 2] = (rand() - 0.5) * size;
    phase[i] = rand() * Math.PI * 2;
    vitesse[i] = 0.35 + rand() * 0.75;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  geo.setAttribute('aVitesse', new THREE.BufferAttribute(vitesse, 1));
  // l'essaim déborde de ses positions de repos : la boîte de culling suit
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), size * 0.9 + 1.6);

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: WATER_TIME,
      uColor: { value: new THREE.Color(model.color ?? '#ffd97a') },
      uEclat: { value: model.emissive ?? 0.8 },
      uTaille: { value: model.dotSize ?? 0.14 }
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      uniform float uTime, uTaille;
      attribute float aPhase, aVitesse;
      varying float vVie;
      void main() {
        float t = uTime * aVitesse + aPhase;
        vec3 p = position
          + vec3(sin(t * 0.90), sin(t * 0.63 + 1.7), sin(t * 0.77 + 3.4)) * 0.9;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vVie = 0.45 + 0.55 * (0.5 + 0.5 * sin(t * 1.9)); // clignotement doux
        gl_PointSize = uTaille * 420.0 / max(1.0, -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uEclat;
      varying float vVie;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float lum = smoothstep(1.0, 0.0, length(c) * 2.0);
        gl_FragColor = vec4(uColor, lum * lum * vVie * uEclat);
      }`
  });
  const points = new THREE.Points(geo, mat);
  points.raycast = () => {};
  return points;
}

/**
 * LE RUBAN — l'outil de design des formes fluides (mode Hadid ou pas).
 *
 * Une coque balayée le long d'une courbe de Catmull-Rom, section
 * super-elliptique aplatie : c'est la brique des références — la rampe qui
 * devient garde-corps, le voile qui devient toit. Tout est dans le JSON :
 *
 *   "model": {
 *     "shape": "ruban",
 *     "points": [[-2,0,0], [-0.6,0.9,0.5], [0.8,1.7,-0.5], [2,2.6,0]],
 *     "largeur": 1.2,        // largeur de la section (m)
 *     "largeurFin": 0.5,     // …à l'arrivée (défaut : constante)
 *     "epaisseur": 0.14,     // épaisseur de la coque
 *     "torsion": 90,         // vrille totale le long du chemin (degrés)
 *     "ferme": false,        // true : la courbe se referme (anneau)
 *     "plat": false          // true : ruban AU SOL (chemin, rampe) —
 *   }                        //   largeur horizontale, épaisseur verticale
 *
 * La section n'est pas un rectangle : une super-ellipse d'exposant 4 —
 * des faces presque planes, des angles fondus, le profil d'une coque
 * moulée et non d'une planche. L'éditeur expose points et paramètres ;
 * les UV sont posés en MÈTRES (u le long du chemin, v autour), si bien
 * que les textures de la galerie s'y déroulent sans étirement.
 */
function buildRuban(size, model, echelle = null) {
  const brut = Array.isArray(model.points) && model.points.length >= 2
    ? model.points
    : [[-size, 0, 0], [-size * 0.3, size * 0.45, size * 0.3],
       [size * 0.4, size * 0.85, -size * 0.3], [size, size * 1.3, 0]];
  const pts = brut.map((q) => new THREE.Vector3(q[0] ?? 0, q[1] ?? 0, q[2] ?? 0));
  const ferme = model.ferme === true;
  const courbe = new THREE.CatmullRomCurve3(pts, ferme, 'centripetal');

  const SEG = Math.min(220, Math.max(32, pts.length * 24));
  const COTE = 20;                          // points de la section
  const larg0 = Math.max(0.05, model.largeur ?? size * 0.8);
  const larg1 = Math.max(0.05, model.largeurFin ?? larg0);
  const ep = Math.max(0.02, model.epaisseur ?? 0.14);
  const torsion = THREE.MathUtils.degToRad(model.torsion ?? 0);

  // ruban PLAT (chemin, rampe au sol) : les repères de Frenet d'une courbe
  // horizontale mettent la binormale à la VERTICALE — la largeur se
  // construirait debout, comme un mur. On fige donc le « haut » du monde :
  // côté = up × tangente, épaisseur = up. Pour un ruban aérien, Frenet.
  const plat = model.plat === true;
  const reperes = plat ? null : courbe.computeFrenetFrames(SEG, ferme);
  const pos = [], nrm = [], uv = [], idx = [];
  const centre = new THREE.Vector3();
  const q = new THREE.Vector3();
  const tang = new THREE.Vector3();
  const cote = new THREE.Vector3();
  const HAUT = new THREE.Vector3(0, 1, 0);

  // longueur cumulée : les UV comptent en mètres, pas en paramètre
  const longueurs = courbe.getLengths(SEG);

  for (let i = 0; i <= SEG; i++) {
    const t = i / SEG;
    courbe.getPointAt(t, centre);
    let N, B;
    if (plat) {
      courbe.getTangentAt(t, tang);
      tang.y = 0;
      if (tang.lengthSq() < 1e-8) tang.set(0, 0, 1);
      tang.normalize();
      cote.set(-tang.z, 0, tang.x);
      N = HAUT; B = cote;
    } else {
      N = reperes.normals[Math.min(i, SEG - 1)];
      B = reperes.binormals[Math.min(i, SEG - 1)];
    }
    const demiL = THREE.MathUtils.lerp(larg0, larg1, t) / 2;
    const demiE = ep / 2;
    const vrille = torsion * t;
    const cv = Math.cos(vrille), sv = Math.sin(vrille);
    for (let j = 0; j <= COTE; j++) {
      const a = (j / COTE) * Math.PI * 2;
      // super-ellipse n=4 : |cos|^(2/n) — faces planes, angles fondus
      const sgn = (x) => (x < 0 ? -1 : 1);
      const ca = Math.cos(a), sa = Math.sin(a);
      const px = sgn(ca) * Math.abs(ca) ** 0.5 * demiL;
      const py = sgn(sa) * Math.abs(sa) ** 0.5 * demiE;
      // vrille de la section dans le plan (N, B)
      const rx = px * cv - py * sv;
      const ry = px * sv + py * cv;
      q.copy(centre).addScaledVector(N, ry).addScaledVector(B, rx);
      pos.push(q.x, q.y, q.z);
      // normale approchée : radiale dans le plan de section (lissée ensuite)
      nrm.push(0, 0, 1);
      uv.push(longueurs[Math.min(i, SEG - 1)], (j / COTE) * (demiL * 2 + ep));
    }
  }
  const ligne = COTE + 1;
  for (let i = 0; i < SEG; i++) {
    for (let j = 0; j < COTE; j++) {
      const a1 = i * ligne + j, b1 = a1 + ligne;
      idx.push(a1, b1, a1 + 1, b1, b1 + 1, a1 + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(idx);
  geometry.computeVertexNormals();

  return finishPrimitive({ build: () => geometry }, size, model, echelle);
}

/**
 * LE GALET — une dalle posée, au contour qui n'est jamais droit.
 *
 * Une super-ellipse extrudée avec un chanfrein doux : le lit de sable d'un
 * jardin sec, la margelle d'un bassin (trouée), un podium. C'est la
 * réponse aux rectangles qui trahissaient le décor construit.
 *
 *   "model": {
 *     "shape": "galet",
 *     "size": 8,             // demi-grand axe ≈ size × 0,8
 *     "ratio": 0.72,         // demi-petit axe / demi-grand axe
 *     "exposant": 3,         // 2 = ellipse, 3–4 = rectangle fondu
 *     "epaisseur": 0.18,     // hauteur de la dalle
 *     "troue": 0             // 0 = pleine ; 0,84 = anneau (margelle)
 *   }
 */
function buildGalet(size, model, echelle = null) {
  const rx = Math.max(0.1, size * 0.8);
  const rz = rx * (model.ratio ?? 0.78);
  const n = Math.max(2, model.exposant ?? 3);
  const ep = Math.max(0.02, model.epaisseur ?? size * 0.1);
  const POINTS = 72;

  const contour = (forme, kx, kz) => {
    const sgn = (v) => (v < 0 ? -1 : 1);
    for (let i = 0; i <= POINTS; i++) {
      const a = (i / POINTS) * Math.PI * 2;
      const c = Math.cos(a), s2 = Math.sin(a);
      const x = sgn(c) * Math.abs(c) ** (2 / n) * rx * kx;
      const y = sgn(s2) * Math.abs(s2) ** (2 / n) * rz * kz;
      if (i === 0) forme.moveTo(x, y); else forme.lineTo(x, y);
    }
  };
  const forme = new THREE.Shape();
  contour(forme, 1, 1);
  const troue = Number(model.troue) || 0;
  if (troue > 0 && troue < 0.97) {
    const trou = new THREE.Path();
    contour(trou, troue, troue);
    forme.holes.push(trou);
  }
  const biseau = Math.min(ep * 0.35, 0.08);
  const geometry = new THREE.ExtrudeGeometry(forme, {
    depth: Math.max(0.01, ep - biseau * 2), curveSegments: 8,
    bevelEnabled: true, bevelThickness: biseau, bevelSize: biseau,
    bevelSegments: 3
  });
  // l'extrusion pousse en +z : on couche la dalle, base au sol
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, biseau, 0);
  return finishPrimitive({ build: () => geometry }, size, model, echelle);
}

/**
 * LA SURFACE D'UNE PRIMITIVE — là où le plastique disparaît.
 *
 * Une primitive n'avait qu'une couleur, une rugosité fixe et, au mieux, un
 * albédo pixel-art étiré sur tout l'objet. D'où l'aplat de plastique des
 * bancs, des lanternes, des stèles et de toutes les marches du belvédère,
 * juste à côté de murs qui, eux, avaient du grain. Trois changements :
 *
 *   • le style passe par `jeuDeSurface` — le MÊME robinet que le sol et les
 *     murs : relief, rugosité et métal viennent avec l'albédo, et une
 *     matière photographique (bois, damier…) est acceptée là aussi ;
 *
 *   • les UV sont mis à l'ÉCHELLE DU MONDE (`scaleObjetUV`). Les UV d'une
 *     boîte vont de zéro à un quelle que soit sa taille : les briques d'une
 *     stèle de quatre mètres étaient donc quatre fois plus grosses que
 *     celles du mur derrière. Désormais un motif garde sa taille physique,
 *     et deux objets voisins parlent la même langue ;
 *
 *   • sans style déclaré, la primitive reçoit tout de même un grain fin —
 *     `poli`, très doux et sans direction. Quatre-vingts objets de la
 *     galerie n'ont aucune texture dans leur JSON : leur donner un aplat
 *     parfait, c'est précisément ce qui les faisait lire comme du plastique.
 *     `"texture": "aucune"` rend l'aplat à qui le veut.
 */
function finishPrimitive(def, size, model, echelleObjet = null) {
  const style = model.texture === 'aucune' ? null : (model.texture ?? 'poli');
  const serrage = Number.isFinite(model.textureRepeat) && model.textureRepeat > 0
    ? model.textureRepeat : 1;
  const jeu = jeuDeSurface(style, serrage);
  const geometry = def.build(size);
  if (jeu) scaleObjetUV(geometry, jeu.metres, echelleObjet);

  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(model.color ?? '#8a7cff'),
    map: jeu?.map ?? null,
    bumpMap: jeu?.bumpMap ?? null,
    bumpScale: jeu?.bumpScale ?? 1,
    normalMap: jeu?.normalMap ?? null,
    normalScale: jeu?.normalScale
      ? new THREE.Vector2(jeu.normalScale, jeu.normalScale) : undefined,
    roughnessMap: jeu?.roughnessMap ?? null,
    // le JSON garde le dernier mot : une œuvre qui a réglé sa rugosité ne
    // doit pas changer d'aspect parce que le moteur a appris les surfaces
    roughness: model.roughness ?? jeu?.roughness ?? 0.5,
    metalness: model.metalness ?? jeu?.metalness ?? 0.15,
    // L'émission peut différer de la couleur du corps : une lanterne a une
    // paroi sombre et une lueur claire — les confondre donnait un objet
    // uniformément blanc, qui fleurissait dans le bloom.
    emissive: new THREE.Color(model.emissiveColor ?? model.color ?? '#8a7cff'),
    emissiveIntensity: model.emissive ?? 0.18,
    side: model.shape === 'plane' ? THREE.DoubleSide : THREE.FrontSide
  });
  // la texture teinte aussi l'émission, sinon la lueur gomme les sillons
  if (jeu?.map) material.emissiveMap = jeu.map;
  return new THREE.Mesh(geometry, material);
}

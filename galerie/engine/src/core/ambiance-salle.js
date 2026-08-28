import * as THREE from 'three';

/**
 * L'AMBIANCE D'UNE SALLE — le rebond que le téléphone ne calcule pas.
 *
 * CE QUI MANQUE, ET OÙ. Une pièce close reçoit `ENV_CLOS = 0.25` d'image
 * d'environnement (voir `ombres.js`) : un fond de radiosité PLAT, sans
 * direction ni couleur, identique dans les archives de brique chaude et
 * dans le labo bleu-nuit. Or le rebond d'une salle n'est pas plat. Il
 * vient d'où viennent ses lampes — du haut des murs, là où courent les
 * corniches — et il porte leur teinte. C'est ce qui reste noir sur
 * téléphone une fois les lignes de lumière posées : le labo à 0,44 de la
 * clarté du bureau, le belvédère à 0,60, avec un sol qui ne reçoit rien.
 *
 * CE QU'ON FAIT. La géométrie d'une salle ne bouge pas, ses lampes non
 * plus ; seul le visiteur se déplace. C'est le cas d'école du calcul
 * PRÉALABLE — ce que les moteurs de jeu appellent une sonde d'irradiance.
 * À l'entrée dans la salle, une fois, on échantillonne l'éclairement
 * direct en quelques points et dans toutes les directions, et l'on projette
 * le résultat sur les quatre premières harmoniques sphériques :
 *
 *     E(n) ≈ c₀ + c·n
 *
 * Quatre coefficients par couleur, douze flottants pour toute la salle.
 * À l'image, cela coûte un produit scalaire et une addition — moins qu'une
 * lampe, pour la lumière de toutes les lampes réunies.
 *
 * La projection est celle, classique, d'une fonction sur la sphère :
 * l'ordre 0 est la moyenne, l'ordre 1 vaut trois fois la moyenne pondérée
 * par la direction (le facteur 3 vient de la normalisation de la base
 * linéaire). Sur un jeu de directions réparties par la spirale de Fibonacci
 * — qui répartit sans pôle ni couture, contrairement à une grille en
 * latitude-longitude — la somme discrète converge très vite.
 *
 * CE QUE ÇA N'EST PAS. Aucune occlusion : la sonde ignore les murs, elle
 * dit ce qu'un point NU recevrait. C'est voulu — on ne s'en sert pas comme
 * d'une lumière directe (elle est déjà calculée, et exactement), mais comme
 * du REBOND qu'elle produirait sur les surfaces de la salle. On la
 * multiplie donc par un albédo de rebond : une pièce de galerie renvoie le
 * quart de ce qu'elle reçoit, et c'est ce quart qu'on ajoute. Sans ce
 * facteur, on éclairerait deux fois.
 *
 * PROFIL SEULEMENT. Comme les lignes, la sonde ne s'arme que là où les
 * sources étendues ne sont pas payables. Le bureau garde l'éclairage que
 * l'auteur a réglé à l'œil, salle par salle ; ce n'est pas au correctif du
 * téléphone de le redéfinir.
 */

/** Le quart de ce qu'une salle reçoit lui revient — un rebond, pas deux. */
export const ALBEDO_REBOND = 0.25;

/** Directions d'échantillonnage : la spirale de Fibonacci, sans pôle. */
const DIRECTIONS = (() => {
  const n = 64, or = Math.PI * (3 - Math.sqrt(5));
  const d = [];
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const t = or * i;
    d.push(new THREE.Vector3(Math.cos(t) * r, y, Math.sin(t) * r));
  }
  return d;
})();

const UNIFORMES = {
  // c₀ (constante) et c (vecteur), une couleur chacun, en espace VUE
  uAmbianceC0: { value: new THREE.Color(0, 0, 0) },
  uAmbianceCx: { value: new THREE.Color(0, 0, 0) },
  uAmbianceCy: { value: new THREE.Color(0, 0, 0) },
  uAmbianceCz: { value: new THREE.Color(0, 0, 0) }
};

/**
 * La sonde est calculée EN MONDE — c'est là que sont les lampes — mais le
 * shader lit sa normale en espace vue. L'ordre 0 est invariant par
 * rotation ; l'ordre 1 est un vecteur par couleur, et il faut le tourner.
 * On garde donc les coefficients du monde ici, et l'on transporte à chaque
 * image : trois rotations de vecteur, le prix de rien, et cela suit aussi
 * les bascules de gravité où la pièce tourne sous le visiteur.
 */
const MONDE = { c0: new THREE.Color(0, 0, 0), c: [null, null, null] };
for (let i = 0; i < 3; i++) MONDE.c[i] = new THREE.Vector3();
const _rot = new THREE.Vector3();
/**
 * La part rotation de la vue, en 3×3. On NE PASSE PAS par
 * `Vector3.transformDirection` : elle normalise, et l'ordre 1 d'une
 * harmonique n'est pas une direction — c'est un coefficient dont
 * l'amplitude EST l'information. Le test du halo isotrope attrape
 * précisément cette faute : l'ordre 1 y remontait à 0,99 quand il devait
 * tendre vers zéro.
 */
const _vue3 = new THREE.Matrix3();

export function uniformesAmbiance() { return UNIFORMES; }

export function oublierAmbiance() {
  for (const u of Object.values(UNIFORMES)) u.value.setRGB(0, 0, 0);
  MONDE.c0.setRGB(0, 0, 0);
  for (const v of MONDE.c) v.set(0, 0, 0);
}

/**
 * Transporte l'ordre 1 en espace vue. À appeler une fois par image, comme
 * `majLignes` — la sonde ne change pas, le repère si.
 */
export function orienterAmbiance(camera) {
  if (!camera) return;
  UNIFORMES.uAmbianceC0.value.copy(MONDE.c0);
  _vue3.setFromMatrix4(camera.matrixWorldInverse);
  const vues = [];
  for (let i = 0; i < 3; i++) {
    vues.push(_rot.copy(MONDE.c[i]).applyMatrix3(_vue3).clone());
  }
  UNIFORMES.uAmbianceCx.value.setRGB(vues[0].x, vues[1].x, vues[2].x);
  UNIFORMES.uAmbianceCy.value.setRGB(vues[0].y, vues[1].y, vues[2].y);
  UNIFORMES.uAmbianceCz.value.setRGB(vues[0].z, vues[1].z, vues[2].z);
}

const _p = new THREE.Vector3();
const _l = new THREE.Vector3();
const _v = new THREE.Vector3();
const _cible = new THREE.Vector3();

/**
 * Les points où l'on sonde : le centre à hauteur d'œil, et quatre écarts à
 * mi-chemin des murs. Un seul point au centre suffirait pour une petite
 * salle ; il mentirait dans un belvédère de vingt-quatre mètres, où les
 * corniches d'un mur ne portent pas jusqu'à l'autre.
 */
function pointsDeSonde(shell) {
  const w = (Number(shell?.width) || 20) * 0.28;
  const d = (Number(shell?.depth) || 20) * 0.28;
  const y = Math.min(1.6, (Number(shell?.height) || 5) * 0.45);
  return [[0, y, 0], [-w, y, -d], [w, y, -d], [-w, y, d], [w, y, d]]
    .map((p) => new THREE.Vector3(...p));
}

/**
 * Calcule la sonde d'une salle et remplit les uniformes.
 *
 * `lignes` : les segments déjà déclarés (voir `lignes-lumiere.js`), donnés
 * en monde avec leur couleur — ce sont eux qui portent l'essentiel de la
 * lumière d'une salle close, il serait absurde de les omettre.
 */
export function majAmbiance(salle, lignes = []) {
  oublierAmbiance();
  if (!salle?.group) return null;

  // les lampes ponctuelles et coniques de la salle, en monde
  const lampes = [];
  salle.group.updateWorldMatrix(true, true);
  salle.group.traverse((o) => {
    if (!o.isLight || !o.visible || !(o.intensity > 0)) return;
    if (o.isPointLight || o.isSpotLight) {
      lampes.push({
        p: o.getWorldPosition(new THREE.Vector3()),
        c: o.color.clone().multiplyScalar(o.intensity),
        // Un cône n'éclaire que dans son ouverture ; on ne le modélise pas
        // finement, on le pénalise d'un demi — sa contribution au rebond
        // est diffuse et la sonde n'a pas à être un second moteur.
        k: o.isSpotLight ? 0.5 : 1
      });
    }
  });

  const points = pointsDeSonde(salle.config?.shell);
  const c0 = [0, 0, 0];
  const cx = [0, 0, 0], cy = [0, 0, 0], cz = [0, 0, 0];
  let echantillons = 0;

  for (const P of points) {
    // la sonde vit dans le repère de la salle : on passe en monde
    _p.copy(P).applyMatrix4(salle.group.matrixWorld);
    for (const n of DIRECTIONS) {
      let r = 0, g = 0, b = 0;
      for (const L of lampes) {
        _l.copy(L.p).sub(_p);
        const d2 = Math.max(_l.lengthSq(), 0.25);
        const cos = _l.normalize().dot(n);
        if (cos <= 0) continue;
        const f = (cos / d2) * L.k;
        r += L.c.r * f; g += L.c.g * f; b += L.c.b * f;
      }
      for (const S of lignes) {
        const E = irradianceSegment(_p, n, S.a, S.b, S.face);
        if (E <= 0) continue;
        r += S.couleur.r * E; g += S.couleur.g * E; b += S.couleur.b * E;
      }
      c0[0] += r; c0[1] += g; c0[2] += b;
      cx[0] += r * n.x; cx[1] += g * n.x; cx[2] += b * n.x;
      cy[0] += r * n.y; cy[1] += g * n.y; cy[2] += b * n.y;
      cz[0] += r * n.z; cz[1] += g * n.z; cz[2] += b * n.z;
      echantillons++;
    }
  }
  if (!echantillons) return null;

  const k = ALBEDO_REBOND / echantillons;
  MONDE.c0.setRGB(c0[0] * k, c0[1] * k, c0[2] * k);
  // l'ordre 1 vaut TROIS fois la moyenne pondérée : c'est la normalisation
  // de la base linéaire sur la sphère. Un vecteur par canal de couleur.
  for (let ch = 0; ch < 3; ch++) {
    MONDE.c[ch].set(cx[ch] * k * 3, cy[ch] * k * 3, cz[ch] * k * 3);
  }
  return {
    echantillons, lampes: lampes.length, lignes: lignes.length,
    c0: [+MONDE.c0.r.toFixed(4), +MONDE.c0.g.toFixed(4), +MONDE.c0.b.toFixed(4)],
    // la direction dominante du rebond, pour la lire dans une sonde
    dominante: MONDE.c[1].clone().normalize().toArray().map((n) => +n.toFixed(2))
  };
}

/**
 * L'éclairement d'un segment, en monde — la même loi qu'en GLSL, réécrite
 * ici pour la sonde. Elle est éprouvée par `test-lignes-lumiere.mjs` ; on
 * la garde à part pour que la sonde n'ait pas besoin de la caméra.
 */
function irradianceSegment(P, N, A, B, face) {
  const ax = A.x - P.x, ay = A.y - P.y, az = A.z - P.z;
  const bx = B.x - P.x, by = B.y - P.y, bz = B.z - P.z;
  let a0 = ax, a1 = ay, a2 = az, b0 = bx, b1 = by, b2 = bz;
  const na = N.x * a0 + N.y * a1 + N.z * a2;
  const nb = N.x * b0 + N.y * b1 + N.z * b2;
  if (na <= 0 && nb <= 0) return 0;
  if (na < 0) { const t = na / (na - nb); a0 += (b0 - a0) * t; a1 += (b1 - a1) * t; a2 += (b2 - a2) * t; }
  else if (nb < 0) { const t = nb / (nb - na); b0 += (a0 - b0) * t; b1 += (a1 - b1) * t; b2 += (a2 - b2) * t; }
  const dx = b0 - a0, dy = b1 - a1, dz = b2 - a2;
  const L = Math.hypot(dx, dy, dz);
  if (L < 1e-4) return 0;
  const hx = dx / L, hy = dy / L, hz = dz / L;
  const s0 = -(a0 * hx + a1 * hy + a2 * hz);
  const px = a0 + hx * s0, py = a1 + hy * s0, pz = a2 + hz * s0;
  const h2 = Math.max(px * px + py * py + pz * pz, 1e-6);
  const ra = Math.max(Math.hypot(a0, a1, a2), 1e-4);
  const rb = Math.max(Math.hypot(b0, b1, b2), 1e-4);
  const m = ((L - s0) / rb + s0 / ra) / h2;
  const q = 1 / ra - 1 / rb;
  const E = N.x * (px * m + hx * q) + N.y * (py * m + hy * q) + N.z * (pz * m + hz * q);
  if (E <= 0) return 0;
  if (!face) return E;
  // la face de la fente, comme en GLSL : au point le plus proche
  const t = Math.min(Math.max(s0, 0), L);
  const qx = -(a0 + hx * t), qy = -(a1 + hy * t), qz = -(a2 + hz * t);
  const ql = Math.hypot(qx, qy, qz) || 1;
  const cosE = Math.max(0, (face.x * qx + face.y * qy + face.z * qz) / ql);
  return E * cosE;
}

export const DECLARATION_AMBIANCE = /* glsl */`
uniform vec3 uAmbianceC0;
uniform vec3 uAmbianceCx;
uniform vec3 uAmbianceCy;
uniform vec3 uAmbianceCz;

// E(n) ≈ c₀ + c·n, borné à zéro : une harmonique d'ordre 1 peut passer
// sous zéro du côté opposé à la lumière, et un éclairement négatif
// creuserait un trou noir là où il ne devrait y avoir que peu de lumière.
vec3 ambianceSalle(vec3 N) {
  return max(uAmbianceC0 + uAmbianceCx * N.x + uAmbianceCy * N.y
    + uAmbianceCz * N.z, vec3(0.0));
}
`;

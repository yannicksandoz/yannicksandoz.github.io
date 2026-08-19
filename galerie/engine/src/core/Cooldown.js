import * as THREE from 'three';

/**
 * DÉLAI DE RÉARMEMENT des passages (portails et anneaux de gravité).
 *
 * Un passage franchi se ferme quelques secondes : le temps de regarder où
 * l'on a atterri plutôt que de rebondir aussitôt d'où l'on vient. Pendant
 * ce délai le passage devient ROUGE, affiche le signe du sens interdit et
 * décompte les secondes qui restent — l'attente est lisible, jamais une
 * porte muette qui refuse sans dire pourquoi.
 *
 * Le délai se règle dans les réglages généraux (`content/reglages.json`,
 * champ `cooldown`, en secondes) et peut être surchargé passage par
 * passage (`"cooldown": 8` sur un portail ou une bascule).
 */

const ROUGE = 0xff3b30;
const TAILLE = 256;

/** Le délai qui s'applique à ce passage : sa surcharge, sinon le général. */
export function delaiDe(cfg, app) {
  const g = app?.reglages?.cooldown;
  const v = cfg?.cooldown ?? g ?? 0;
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * Ferme un passage pour `duree` secondes. `mesh` est le groupe du portail
 * ou l'anneau de bascule ; l'état vit dans son userData, si bien qu'une
 * pièce libérée emporte ses compteurs avec elle.
 */
export function fermer(mesh, duree) {
  if (!mesh || !(duree > 0)) return false;
  // Une ÉCHÉANCE, pas un compteur d'images : « cinq secondes » doit valoir
  // cinq secondes, que la machine rende à 120 images par seconde ou à
  // trois — le `dt` de la boucle, lui, est plafonné et mentirait.
  mesh.userData.cooldownFin = performance.now() + duree * 1000;
  mesh.userData.cooldownTotal = duree;
  _peindre(mesh, duree);   // rouge et décompte dès la première frame
  return true;
}

/** Secondes restantes avant réouverture (0 si le passage est libre). */
export function resteDe(mesh) {
  const fin = mesh?.userData.cooldownFin ?? 0;
  return Math.max(0, (fin - performance.now()) / 1000);
}

/** Ce passage est-il fermé en ce moment ? */
export function estFerme(mesh) {
  return resteDe(mesh) > 0;
}

/**
 * Fait courir les délais d'un ensemble de passages et tient leur apparence
 * à jour. Les passages rouverts sortent de l'ensemble d'eux-mêmes.
 */
export function tick(meshes) {
  for (const mesh of meshes) {
    const reste = resteDe(mesh);
    _peindre(mesh, reste);
    if (reste <= 0) {
      mesh.userData.cooldownFin = 0;
      meshes.delete?.(mesh);
    }
  }
}

/* ------------------------------------------------------------ interne --- */

/** Matériaux du passage, mémorisés à la première fermeture (couleur d'origine). */
function _materiaux(mesh) {
  if (mesh.userData._matsCd) return mesh.userData._matsCd;
  const liste = [];
  mesh.traverse((o) => {
    const m = o.material;
    if (!m || !m.emissive) return;
    liste.push({ mat: m, emissive: m.emissive.clone(), color: m.color?.clone() });
  });
  mesh.userData._matsCd = liste;
  return liste;
}

/** Le panneau du décompte, créé à la première fermeture seulement. */
function _panneau(mesh) {
  if (mesh.userData._cdSprite) return mesh.userData._cdSprite;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = TAILLE;
  const tex = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthWrite: false, depthTest: false
  }));
  sprite.scale.set(1.1, 1.1, 1);
  // au-dessus d'un portail (haut : 2,8 m), au centre d'un anneau (à plat)
  sprite.position.set(0, mesh.userData.portal ? 2.1 : 0, mesh.userData.portal ? 0 : 0.5);
  sprite.renderOrder = 10;
  mesh.add(sprite);
  mesh.userData._cdSprite = { sprite, canvas, tex, dernier: -1 };
  return mesh.userData._cdSprite;
}

/** Dessine le sens interdit et les secondes restantes. */
function _dessiner(p, secondes) {
  const g = p.canvas.getContext('2d');
  const c = TAILLE / 2;
  g.clearRect(0, 0, TAILLE, TAILLE);
  // disque plein + barre : le signe du sens interdit, lisible de loin
  g.fillStyle = 'rgba(255, 59, 48, 0.92)';
  g.beginPath();
  g.arc(c, c, 92, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#fff';
  g.fillRect(c - 62, c - 15, 124, 30);
  // les secondes, sous le signe
  g.font = '600 60px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 6;
  g.strokeStyle = 'rgba(0, 0, 0, 0.55)';
  g.strokeText(`${secondes} s`, c, c + 128 - 34);
  g.fillStyle = '#ffd7d4';
  g.fillText(`${secondes} s`, c, c + 128 - 34);
  p.tex.needsUpdate = true;
}

function _peindre(mesh, reste) {
  const mats = _materiaux(mesh);
  // On ne montre PAS le délai du passage dans lequel on se tient : en
  // débouchant d'une porte, on l'a dans le nez — un panneau rouge en plein
  // cadre à l'instant même où l'on découvre la pièce. Le passage reste
  // fermé (il compte en silence), il ne se signale qu'une fois quitté,
  // c'est-à-dire quand on pourrait vouloir y revenir. `disarmed` dit
  // exactement cela : le visiteur est encore dedans.
  if (reste > 0 && mesh.userData.disarmed) {
    const p = mesh.userData._cdSprite;
    if (p) p.sprite.visible = false;
    for (const m of mats) {
      m.mat.emissive.copy(m.emissive);
      if (m.color) m.mat.color.copy(m.color);
    }
    return;
  }
  if (reste > 0) {
    for (const m of mats) {
      m.mat.emissive.setHex(ROUGE);
      m.mat.color?.setHex(0x2a0d0c);
    }
    const p = _panneau(mesh);
    p.sprite.visible = true;
    const s = Math.ceil(reste);
    if (s !== p.dernier) {          // on ne redessine qu'au changement de seconde
      p.dernier = s;
      _dessiner(p, s);
    }
    return;
  }
  // réouverture : couleurs d'origine, panneau rangé
  for (const m of mats) {
    m.mat.emissive.copy(m.emissive);
    if (m.color) m.mat.color.copy(m.color);
  }
  const p = mesh.userData._cdSprite;
  if (p) { p.sprite.visible = false; p.dernier = -1; }
}

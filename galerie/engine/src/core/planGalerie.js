/**
 * Plan de la galerie — poser les pièces à plat, à partir du seul graphe.
 *
 * Aucune pièce ne porte de coordonnée dans un plan : le contenu décrit une
 * TOPOLOGIE (« ce portail mène là ») et non une géographie. Demander à
 * l'auteur de tenir en plus un plan 2D à jour aurait été une seconde vérité
 * à maintenir, et la première à mentir.
 *
 * On le déduit donc, et le contenu en dit assez pour que ce soit juste :
 *
 *   1. chaque pièce a une EMPREINTE (`shell.width × shell.depth`) ;
 *   2. chaque portail a une POSITION dans sa pièce et une ORIENTATION ;
 *   3. franchir un portail, c'est sortir par sa face extérieure.
 *
 * D'où : on part de l'entrée, et pour chaque portail on pose la pièce
 * voisine DE L'AUTRE CÔTÉ de la porte, à distance de sa propre demi-
 * empreinte. Deux portes sur le même mur donnent deux voisines côte à côte,
 * puisque la porte, elle, a une position le long de ce mur.
 *
 * Le résultat n'est pas un plan d'architecte : la galerie est un espace
 * d'Escher, une pièce y mène à elle-même et six chambres tiennent dans un
 * cube. C'est un plan de MÉTRO — les distances mentent, les liens disent
 * vrai. Une relaxation finale écarte ce qui se chevauche, sans jamais
 * couper un lien.
 *
 * Module pur : ni Three.js, ni DOM. Il se teste au nœud.
 */

const LARGEUR_DEFAUT = 26;   // SHELL_DEFAULTS.width
const PROFONDEUR_DEFAUT = 20; // SHELL_DEFAULTS.depth
const ECART = 8;             // couloir laissé entre deux pièces, en mètres
const RELAXATIONS = 80;

/** Empreinte au sol d'une pièce, en mètres. */
export function empreinte(cfg) {
  const shell = cfg?.shell && cfg.shell !== true ? cfg.shell : null;
  const taille = Number(cfg?.floor?.size);
  const w = Number(shell?.width) || (Number.isFinite(taille) ? taille : LARGEUR_DEFAUT);
  const d = Number(shell?.depth) || (Number.isFinite(taille) ? taille : PROFONDEUR_DEFAUT);
  return { w: Math.max(4, w), d: Math.max(4, d) };
}

/**
 * Direction de SORTIE d'un portail, dans le repère de sa pièce.
 *
 * La rotation d'un portail l'oriente vers l'intérieur — c'est ce qui rend
 * sa face visible depuis la pièce. Sortir, c'est donc aller à l'opposé.
 * Sans rotation (les portails du belvédère n'en ont pas tous), la position
 * du portail dans la pièce donne le cap : une porte est sur un bord.
 */
export function sortie(portal, taille) {
  const deg = Array.isArray(portal?.rotation) ? Number(portal.rotation[1]) : 0;
  const parRotation = () => {
    const r = ((Number.isFinite(deg) ? deg : 0) * Math.PI) / 180;
    return { x: -Math.sin(r), z: -Math.cos(r) };
  };
  // Zéro veut dire deux choses : « mur nord » et « rotation non renseignée »
  // (le schéma la pose à 0 quand elle manque). Dans ce doute-là, la position
  // de la porte tranche mieux que le zéro — elle, elle est toujours écrite.
  if (!deg) return estSurUnMur(portal, taille) ?? parRotation();
  return parRotation();
}

/** Cap donné par la position de la porte, si elle est franchement sur un bord. */
function estSurUnMur(portal, taille) {
  const p = Array.isArray(portal?.position) ? portal.position : null;
  if (!p || !taille) return null;
  const rx = (Number(p[0]) || 0) / (taille.w / 2);
  const rz = (Number(p[2]) || 0) / (taille.d / 2);
  if (Math.abs(rx) < 0.55 && Math.abs(rz) < 0.55) return null; // porte au milieu
  return Math.abs(rx) > Math.abs(rz)
    ? { x: Math.sign(rx), z: 0 }
    : { x: 0, z: Math.sign(rz) };
}

/** Demi-encombrement d'une pièce dans une direction donnée. */
function demiPortee(taille, u) {
  return (Math.abs(u.x) * taille.w + Math.abs(u.z) * taille.d) / 2;
}

/**
 * Plan complet.
 *
 * @param {Array} rooms  configurations de pièce (déjà migrées : les portails
 *                       portent `rotation`, pas `rotationY`)
 * @param {string} depart id de la pièce d'où l'on part (défaut : la première)
 * @returns {{ pieces: Array, portes: Array, bornes: object }}
 *          pièces : { id, titre, x, z, w, d } — x/z au CENTRE, en mètres ;
 *          portes : { a, b } — une par paire, sans doublon ni boucle.
 */
export function planGalerie(rooms, depart = null) {
  const liste = (rooms ?? []).filter((r) => r && r.id);
  const par = new Map(liste.map((r) => [r.id, r]));
  const tailles = new Map(liste.map((r) => [r.id, empreinte(r)]));
  const pose = new Map();

  const racine = depart && par.has(depart) ? depart : liste[0]?.id;
  if (!racine) return { pieces: [], portes: [], bornes: { x0: 0, z0: 0, x1: 0, z1: 0 } };

  /* 1. parcours en largeur : chaque porte pose sa voisine de l'autre côté */
  pose.set(racine, { x: 0, z: 0 });
  const file = [racine];
  while (file.length) {
    const id = file.shift();
    const ici = pose.get(id);
    const taille = tailles.get(id);
    for (const p of par.get(id)?.portals ?? []) {
      const cible = p?.to;
      if (!cible || cible === id || !par.has(cible) || pose.has(cible)) continue;
      const u = sortie(p, taille);
      const pos = Array.isArray(p.position) ? p.position : [0, 0, 0];
      const porte = { x: ici.x + (Number(pos[0]) || 0), z: ici.z + (Number(pos[2]) || 0) };
      const d = ECART + demiPortee(tailles.get(cible), u);
      pose.set(cible, { x: porte.x + u.x * d, z: porte.z + u.z * d });
      file.push(cible);
    }
  }

  /* 2. les inatteignables (aucun portail n'y mène) : une rangée à l'écart */
  let x = 0;
  const zOrphelines = Math.max(0, ...[...pose.values()].map((p) => p.z)) + 60;
  for (const r of liste) {
    if (pose.has(r.id)) continue;
    const taille = tailles.get(r.id);
    pose.set(r.id, { x: x + taille.w / 2, z: zOrphelines });
    x += taille.w + ECART;
  }

  /* 3. relaxation : on rapproche ce que relie une porte, on écarte ce qui se
   *    recouvre, et la racine ne bouge jamais — c'est le repère du plan.
   *    Sans le premier terme, une pièce posée loin (un grand jardin au bout
   *    d'un petit couloir) tirait un trait à travers toute la carte. */
  const ids = liste.map((r) => r.id);
  const liens = [];
  for (const r of liste) {
    for (const p of r.portals ?? []) {
      if (p?.to && p.to !== r.id && par.has(p.to)) liens.push([r.id, p.to]);
    }
  }
  for (let n = 0; n < RELAXATIONS; n++) {
    let bouge = false;
    // Le rapprochement s'arrête aux deux tiers : les dernières passes ne
    // font plus qu'écarter, sinon on finirait sur une pièce tirée DANS sa
    // voisine, et une carte où deux salles se recouvrent ne se lit plus.
    for (const [ia, ib] of (n < RELAXATIONS * 0.66 ? liens : [])) {
      const a = pose.get(ia), b = pose.get(ib);
      const ta = tailles.get(ia), tb = tailles.get(ib);
      const dx = b.x - a.x, dz = b.z - a.z;
      // le long de l'axe dominant du lien : la distance juste est celle qui
      // laisse les deux empreintes se frôler, plus un couloir
      const parX = Math.abs(dx) > Math.abs(dz);
      const ecart = parX ? Math.abs(dx) : Math.abs(dz);
      const juste = (parX ? (ta.w + tb.w) : (ta.d + tb.d)) / 2 + ECART;
      if (ecart <= juste * 1.05) continue;
      const pas = (ecart - juste) * 0.12 * (parX ? Math.sign(dx) : Math.sign(dz));
      const figeA = ia === racine, figeB = ib === racine;
      const pa = figeA ? 0 : figeB ? 1 : 0.5, pb = figeB ? 0 : figeA ? 1 : 0.5;
      if (parX) { a.x += pas * 2 * pa; b.x -= pas * 2 * pb; }
      else { a.z += pas * 2 * pa; b.z -= pas * 2 * pb; }
      bouge = true;
    }
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = pose.get(ids[i]), b = pose.get(ids[j]);
        const ta = tailles.get(ids[i]), tb = tailles.get(ids[j]);
        const dx = b.x - a.x, dz = b.z - a.z;
        const chx = (ta.w + tb.w) / 2 + ECART - Math.abs(dx);
        const chz = (ta.d + tb.d) / 2 + ECART - Math.abs(dz);
        if (chx <= 0 || chz <= 0) continue;
        bouge = true;
        // on repousse selon l'axe le MOINS enfoncé : le déplacement minimal
        const parX = chx < chz;
        const signe = parX ? (dx === 0 ? 1 : Math.sign(dx)) : (dz === 0 ? 1 : Math.sign(dz));
        const pas = ((parX ? chx : chz) / 2) * signe;
        const figeA = ids[i] === racine, figeB = ids[j] === racine;
        const partA = figeA ? 0 : figeB ? 1 : 0.5;
        const partB = figeB ? 0 : figeA ? 1 : 0.5;
        if (parX) { a.x -= pas * 2 * partA; b.x += pas * 2 * partB; }
        else { a.z -= pas * 2 * partA; b.z += pas * 2 * partB; }
      }
    }
    if (!bouge) break;
  }

  /* 4. mise en forme */
  const pieces = liste.map((r) => {
    const p = pose.get(r.id), t = tailles.get(r.id);
    return {
      id: r.id, titre: r.title ?? r.id,
      x: Math.round(p.x * 10) / 10, z: Math.round(p.z * 10) / 10, w: t.w, d: t.d
    };
  });

  const vues = new Set();
  const portes = [];
  for (const r of liste) {
    for (const p of r.portals ?? []) {
      if (!p?.to || p.to === r.id || !par.has(p.to)) continue;
      const cle = r.id < p.to ? `${r.id}|${p.to}` : `${p.to}|${r.id}`;
      if (vues.has(cle)) continue;
      vues.add(cle);
      portes.push({ a: r.id, b: p.to, cle });
    }
  }

  const bornes = {
    x0: Math.min(...pieces.map((p) => p.x - p.w / 2)),
    z0: Math.min(...pieces.map((p) => p.z - p.d / 2)),
    x1: Math.max(...pieces.map((p) => p.x + p.w / 2)),
    z1: Math.max(...pieces.map((p) => p.z + p.d / 2))
  };
  return { pieces, portes, bornes };
}

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

  /* 0. le graphe d'abord : qui touche qui, une fois par paire */
  const voisins = new Map(liste.map((r) => [r.id, new Set()]));
  for (const r of liste) {
    for (const p of r.portals ?? []) {
      if (p?.to && p.to !== r.id && par.has(p.to)) {
        voisins.get(r.id).add(p.to);
        voisins.get(p.to).add(r.id);
      }
    }
  }

  /* 0b. les SATELLITES — les pièces qui ne tiennent qu'à UNE voisine.
   *
   * Les six faces du cube en sont l'exemple même : leurs portes vivent dans
   * un espace d'Escher, leurs directions de sortie ne veulent RIEN dire à
   * plat — posées au fil des portes puis bousculées par la relaxation,
   * elles finissaient éparpillées aux quatre coins du plan, loin du
   * belvédère qui est pourtant leur seule attache. Une pièce-feuille n'a
   * qu'une information de position : SON MOYEU. On les range donc en
   * anneau ordonné autour de lui, après que tout le monde est placé.
   * Il faut au moins deux feuilles au même moyeu pour former une grappe :
   * une feuille seule (l'annexe au bout du labo) suit le fil des portes,
   * qui la pose très bien. */
  const satellites = new Map();  // id -> moyeu
  const grappes = new Map();     // moyeu -> [ids]
  for (const r of liste) {
    const v = voisins.get(r.id);
    if (v.size !== 1 || r.id === racine) continue;
    const moyeu = [...v][0];
    // deux pièces seules au monde, reliées entre elles : aucun moyeu à
    // orbiter — le fil des portes s'en charge
    if ((voisins.get(moyeu)?.size ?? 0) < 2) continue;
    satellites.set(r.id, moyeu);
    grappes.set(moyeu, [...(grappes.get(moyeu) ?? []), r.id]);
  }
  for (const [moyeu, ids] of [...grappes]) {
    if (ids.length >= 2) continue;
    grappes.delete(moyeu);
    for (const id of ids) satellites.delete(id);
  }

  /* 1. parcours en largeur : chaque porte pose sa voisine de l'autre côté */
  pose.set(racine, { x: 0, z: 0 });
  const file = [racine];
  while (file.length) {
    const id = file.shift();
    const ici = pose.get(id);
    const taille = tailles.get(id);
    for (const p of par.get(id)?.portals ?? []) {
      const cible = p?.to;
      if (!cible || cible === id || !par.has(cible) || pose.has(cible)
        || satellites.has(cible)) continue;
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
    if (pose.has(r.id) || satellites.has(r.id)) continue;
    const taille = tailles.get(r.id);
    pose.set(r.id, { x: x + taille.w / 2, z: zOrphelines });
    x += taille.w + ECART;
  }

  /* 3. relaxation : on rapproche ce que relie une porte, on écarte ce qui se
   *    recouvre, et la racine ne bouge jamais — c'est le repère du plan.
   *    Sans le premier terme, une pièce posée loin (un grand jardin au bout
   *    d'un petit couloir) tirait un trait à travers toute la carte. */
  // Les satellites n'y participent pas : ils seront posés en anneau à la
  // fin, et les laisser dans la mêlée les aurait de nouveau éparpillés.
  const ids = liste.map((r) => r.id).filter((id) => !satellites.has(id));
  const liens = [];
  for (const r of liste) {
    for (const p of r.portals ?? []) {
      if (p?.to && p.to !== r.id && par.has(p.to)
        && !satellites.has(r.id) && !satellites.has(p.to)) liens.push([r.id, p.to]);
    }
  }

  // Écarter ce qui se recouvre — le déplacement minimal, la racine figée.
  const ecarte = () => {
    let bouge = false;
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
    return bouge;
  };

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
      const ecartLien = parX ? Math.abs(dx) : Math.abs(dz);
      const juste = (parX ? (ta.w + tb.w) : (ta.d + tb.d)) / 2 + ECART;
      if (ecartLien <= juste * 1.05) continue;
      const pas = (ecartLien - juste) * 0.12 * (parX ? Math.sign(dx) : Math.sign(dz));
      const figeA = ia === racine, figeB = ib === racine;
      const pa = figeA ? 0 : figeB ? 1 : 0.5, pb = figeB ? 0 : figeA ? 1 : 0.5;
      if (parX) { a.x += pas * 2 * pa; b.x -= pas * 2 * pb; }
      else { a.z += pas * 2 * pa; b.z -= pas * 2 * pb; }
      bouge = true;
    }
    if (ecarte()) bouge = true;
    if (!bouge) break;
  }

  /* 3b. alignement doux : un lien PRESQUE droit le devient tout à fait.
   *     Deux salles décalées de quelques mètres donnaient un trait de
   *     guingois qui se lisait comme un détour ; on aligne alors la moins
   *     reliée des deux sur l'autre (jamais la racine), puis on écarte ce
   *     que l'alignement aurait fait se toucher. */
  const ALIGNE = 7;
  for (const [ia, ib] of liens) {
    const a = pose.get(ia), b = pose.get(ib);
    if (ia === racine && ib === racine) continue;
    const bougeB = ib !== racine
      && ((voisins.get(ib)?.size ?? 0) < (voisins.get(ia)?.size ?? 0)
        || (ia === racine)
        || ((voisins.get(ib)?.size ?? 0) === (voisins.get(ia)?.size ?? 0) && ib > ia));
    const [fixe, mobile] = bougeB ? [a, b] : [b, a];
    const dx = mobile.x - fixe.x, dz = mobile.z - fixe.z;
    if (dx !== 0 && Math.abs(dx) < ALIGNE && Math.abs(dz) > Math.abs(dx)) mobile.x = fixe.x;
    else if (dz !== 0 && Math.abs(dz) < ALIGNE && Math.abs(dx) > Math.abs(dz)) mobile.z = fixe.z;
  }
  for (let n = 0; n < 30 && ecarte(); n++) { /* jusqu'au repos */ }

  /* 3c. les grappes de satellites, en anneau ordonné autour de leur moyeu.
   *     Les créneaux sont réguliers sur le cercle, tournés pour s'écarter
   *     au mieux des directions déjà prises par les vraies voisines du
   *     moyeu ; les feuilles s'y rangent par titre (Face 1, Face 2, …),
   *     en tournant depuis le nord — l'ordre de lecture d'une horloge. */
  const TAU = Math.PI * 2;
  const titreDe = (id) => String(par.get(id)?.title ?? id);
  for (const [moyeu, feuilles] of grappes) {
    const c = pose.get(moyeu);
    if (!c) continue;
    const tMoyeu = tailles.get(moyeu);
    const tri = [...feuilles].sort((a, b) =>
      titreDe(a).localeCompare(titreDe(b), 'fr', { numeric: true }));
    const k = tri.length;
    // Le moyeu est rarement seul : ses vraies voisines occupent déjà des
    // pans entiers de l'horizon (au belvédère, le nord, l'est et l'ouest).
    // Un anneau complet forcerait des feuilles À TRAVERS ces salles — on
    // cherche donc, à rayon croissant, le plus grand ARC de ciel libre, et
    // les feuilles s'y serrent côte à côte, à rayon constant, dans l'ordre
    // de leurs titres en tournant à l'écran comme une montre.
    let rayonBase = 0;
    for (const id of tri) {
      for (let a = 0; a < 8; a++) {
        const u = { x: Math.cos((a * TAU) / 8), z: Math.sin((a * TAU) / 8) };
        rayonBase = Math.max(rayonBase,
          demiPortee(tMoyeu, u) + demiPortee(tailles.get(id), u) + ECART);
      }
    }
    const grand = Math.max(...tri.map((id) =>
      Math.max(tailles.get(id).w, tailles.get(id).d)));
    const libre = (ang, R) => {
      const px = c.x + Math.cos(ang) * R, pz = c.z + Math.sin(ang) * R;
      return ![...pose.entries()].some(([autre, pa]) => {
        const ta = tailles.get(autre);
        return Math.abs(px - pa.x) < (grand + ta.w) / 2 + 1
          && Math.abs(pz - pa.z) < (grand + ta.d) / 2 + 1;
      });
    };
    const N = 96;
    // l'écart angulaire entre deux feuilles voisines : la corde doit tenir
    // leur gabarit MÊME en diagonale (× √2 — l'écart en x et en z se
    // partage la corde), plus un souffle
    const pas = (R) => 2 * Math.asin(Math.min(0.99, ((grand + ECART) * 0.71) / R));
    let place = null;
    for (let R = rayonBase; R <= rayonBase + 160 && !place; R += 4) {
      const libres = Array.from({ length: N }, (_, i) => libre((i / N) * TAU, R));
      let long = 0, debut = 0, meilleurL = 0, meilleurD = 0;
      for (let i = 0; i < 2 * N; i++) {
        if (libres[i % N]) {
          if (long === 0) debut = i;
          long = Math.min(long + 1, N);
        } else long = 0;
        if (long > meilleurL) { meilleurL = long; meilleurD = debut; }
      }
      const besoin = k * pas(R);
      const arc = (meilleurL / N) * TAU;
      if (arc >= besoin) {
        // les feuilles serrées, centrées dans l'arc trouvé
        const depart = (meilleurD / N) * TAU + (arc - besoin) / 2;
        place = { R, depart, pas: pas(R) };
      }
    }
    // horizon bouché de partout (rare) : un anneau complet, tant pis
    if (!place) place = { R: rayonBase + 160, depart: -TAU / 4, pas: TAU / k };
    for (let i = 0; i < k; i++) {
      const ang = place.depart + place.pas * (i + 0.5);
      pose.set(tri[i], {
        x: c.x + Math.cos(ang) * place.R,
        z: c.z + Math.sin(ang) * place.R
      });
    }
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

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
// Le couloir laissé entre deux pièces, en mètres. Généreux À DESSEIN :
// les empreintes meublées ont rapetissé les salles, et cet air est ce qui
// loge les NOMS sous les pièces et les CHEMINS des liens entre elles.
const ECART = 14;
const RELAXATIONS = 80;

/**
 * Empreinte au sol d'une pièce, en mètres.
 *
 * La coque fait foi quand elle existe : c'est la pièce telle qu'on la
 * parcourt. SANS coque, `floor.size` ne décrit qu'un TERRAIN — le parvis
 * de l'entrée fait 140 m de sol pour un hall de 60, et l'allée du jardin
 * étale 64 m de pelouse sous un chemin de 8 m de large. Dessiner le
 * terrain mentait sur la pièce vécue. Si l'appelant fournit les positions
 * des œuvres (`oeuvres` : [[x, z], …]), l'empreinte d'une pièce sans coque
 * devient l'ÉTENDUE MEUBLÉE plus une marge de passage, bornée par le
 * terrain — l'allée redevient une allée.
 */
export function empreinte(cfg, oeuvres = null) {
  const shell = cfg?.shell && cfg.shell !== true ? cfg.shell : null;
  const taille = Number(cfg?.floor?.size);
  const w = Number(shell?.width) || (Number.isFinite(taille) ? taille : LARGEUR_DEFAUT);
  const d = Number(shell?.depth) || (Number.isFinite(taille) ? taille : PROFONDEUR_DEFAUT);
  const brute = { w: Math.max(4, w), d: Math.max(4, d) };
  if (Number(shell?.width) > 0 || !Array.isArray(oeuvres) || !oeuvres.length) return brute;
  const xs = oeuvres.map((p) => Number(p[0]) || 0);
  const zs = oeuvres.map((p) => Number(p[1]) || 0);
  const MARGE_MEUBLEE = 10;
  return {
    w: Math.min(brute.w, Math.max(12, Math.max(...xs) - Math.min(...xs) + MARGE_MEUBLEE)),
    d: Math.min(brute.d, Math.max(12, Math.max(...zs) - Math.min(...zs) + MARGE_MEUBLEE))
  };
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
 * @param {object} options `oeuvres` : { idPiece: [[x, z], …] } — positions
 *                 des œuvres par pièce, pour l'empreinte meublée des pièces
 *                 sans coque (voir `empreinte`).
 * @returns {{ pieces: Array, portes: Array, bornes: object }}
 *          pièces : { id, titre, x, z, w, d } — x/z au CENTRE, en mètres ;
 *          portes : { a, b, chemin } — une par paire, sans doublon ni
 *          boucle ; `chemin` : la polyligne [[x, z], …] qui CONTOURNE les
 *          salles, de bord à bord.
 */
export function planGalerie(rooms, depart = null, options = {}) {
  const liste = (rooms ?? []).filter((r) => r && r.id);
  const par = new Map(liste.map((r) => [r.id, r]));
  const tailles = new Map(liste.map((r) =>
    [r.id, empreinte(r, options.oeuvres?.[r.id])]));
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

  /* 0c. la COURONNE de chaque moyeu se calcule d'avance : rayon d'anneau
   * où les feuilles tiendront côte à côte, et GABARIT gonflé du moyeu —
   * pendant toute la mise en page, le moyeu occupe virtuellement moyeu
   * plus anneau, et les autres salles s'écartent d'elles-mêmes. C'est ce
   * qui permet, à la fin, un cercle complet serré contre le moyeu, sans
   * chercher de trouée dans un horizon encombré. */
  const TAU = Math.PI * 2;
  const anneaux = new Map();   // moyeu -> { rayon, feuilles triées }
  const gabarits = new Map(tailles);
  const titreDe = (id) => String(par.get(id)?.title ?? id);
  for (const [moyeu, feuilles] of grappes) {
    const tMoyeu = tailles.get(moyeu);
    const tri = [...feuilles].sort((a, b) =>
      titreDe(a).localeCompare(titreDe(b), 'fr', { numeric: true }));
    const grand = Math.max(...tri.map((id) =>
      Math.max(tailles.get(id).w, tailles.get(id).d)));
    // le rayon : moyeu contre feuille au pire azimut, ET la corde entre
    // deux feuilles voisines doit tenir leur gabarit même en diagonale
    let rayon = 0;
    for (const id of tri) {
      for (let a = 0; a < 8; a++) {
        const u = { x: Math.cos((a * TAU) / 8), z: Math.sin((a * TAU) / 8) };
        rayon = Math.max(rayon,
          demiPortee(tMoyeu, u) + demiPortee(tailles.get(id), u) + 4);
      }
    }
    rayon = Math.max(rayon, ((grand + 3) * 1.42) / (2 * Math.sin(Math.PI / tri.length)));
    anneaux.set(moyeu, { rayon, tri });
    const cote = 2 * (rayon + grand / 2 + 3);
    gabarits.set(moyeu, { w: cote, d: cote });
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
      const d = ECART + demiPortee(gabarits.get(cible), u);
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
        const ta = gabarits.get(ids[i]), tb = gabarits.get(ids[j]);
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
      const ta = gabarits.get(ia), tb = gabarits.get(ib);
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

  /* 3c. les grappes de satellites : le CERCLE COMPLET, serré contre le
   *     moyeu. La couronne a été réservée dès la mise en page (0c — le
   *     moyeu occupait virtuellement moyeu + anneau), l'horizon est donc
   *     libre tout autour : les feuilles se posent au rayon calculé, en
   *     tournant depuis le nord comme une horloge, par ordre de titre. */
  for (const [moyeu, { rayon, tri }] of anneaux) {
    const c = pose.get(moyeu);
    if (!c) continue;
    for (let i = 0; i < tri.length; i++) {
      const ang = -TAU / 4 + (i * TAU) / tri.length;
      pose.set(tri[i], {
        x: c.x + Math.cos(ang) * rayon,
        z: c.z + Math.sin(ang) * rayon
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

  /* 5. le tracé des liens : chaque porte reçoit son CHEMIN, une polyligne
   *    qui contourne les salles au lieu de les traverser — un trait qui
   *    barre une pièce se lit comme une porte qui n'existe pas. */
  const parPiece = new Map(pieces.map((p) => [p.id, p]));
  for (const porte of portes) {
    porte.chemin = traceChemin(parPiece.get(porte.a), parPiece.get(porte.b), pieces);
  }

  return { pieces, portes, bornes };
}

/* ------------------------------------------------- routage des liens --- */

const PAS_GRILLE_LIEN = 3;   // mètres par case de la grille de routage
const GONFLE = 2.5;          // marge gardée autour des salles par les liens

/** Le point où la demi-droite centre → direction quitte le rectangle. */
function bordDe(p, vx, vz) {
  const ax = Math.abs(vx) / (p.w / 2 || 1), az = Math.abs(vz) / (p.d / 2 || 1);
  const k = 1 / Math.max(ax, az, 1e-6);
  return { x: p.x + vx * k, z: p.z + vz * k };
}

/**
 * Chemin d'une salle à l'autre en CONTOURNANT toutes les autres : A* sur
 * une grille à huit directions, puis lissage par visées directes. Les deux
 * salles reliées ne comptent pas comme obstacles (on en sort, on y entre) ;
 * si le routage échoue (horizon clos), on rend le trait direct — un lien
 * doit toujours se dessiner.
 */
function traceChemin(a, b, pieces) {
  if (!a || !b) return null;
  const dx = b.x - a.x, dz = b.z - a.z;
  const depart = bordDe(a, dx, dz);
  const arrivee = bordDe(b, -dx, -dz);
  const direct = [[depart.x, depart.z], [arrivee.x, arrivee.z]];

  const obstacles = pieces
    .filter((p) => p.id !== a.id && p.id !== b.id)
    .map((p) => ({
      x0: p.x - p.w / 2 - GONFLE, x1: p.x + p.w / 2 + GONFLE,
      z0: p.z - p.d / 2 - GONFLE, z1: p.z + p.d / 2 + GONFLE
    }));
  const bouche = (x, z) => obstacles.some((o) =>
    x > o.x0 && x < o.x1 && z > o.z0 && z < o.z1);
  const segmentLibre = (x0, z0, x1, z1) => {
    const long = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.ceil(long / 1.5));
    for (let i = 0; i <= n; i++) {
      if (bouche(x0 + ((x1 - x0) * i) / n, z0 + ((z1 - z0) * i) / n)) return false;
    }
    return true;
  };
  if (segmentLibre(depart.x, depart.z, arrivee.x, arrivee.z)) return direct;

  // la grille couvre le plan entier, avec une lisière pour contourner large
  const x0 = Math.min(...pieces.map((p) => p.x - p.w / 2)) - 14;
  const z0 = Math.min(...pieces.map((p) => p.z - p.d / 2)) - 14;
  const x1 = Math.max(...pieces.map((p) => p.x + p.w / 2)) + 14;
  const z1 = Math.max(...pieces.map((p) => p.z + p.d / 2)) + 14;
  const nx = Math.max(2, Math.ceil((x1 - x0) / PAS_GRILLE_LIEN));
  const nz = Math.max(2, Math.ceil((z1 - z0) / PAS_GRILLE_LIEN));
  const enX = (i) => x0 + (i + 0.5) * PAS_GRILLE_LIEN;
  const enZ = (j) => z0 + (j + 0.5) * PAS_GRILLE_LIEN;
  const caseDe = (x, z) => ({
    i: Math.max(0, Math.min(nx - 1, Math.floor((x - x0) / PAS_GRILLE_LIEN))),
    j: Math.max(0, Math.min(nz - 1, Math.floor((z - z0) / PAS_GRILLE_LIEN)))
  });
  // une case bouchée près du départ ou de l'arrivée glisse vers la plus
  // proche case libre — les portes s'ouvrent parfois dans un angle serré
  const caseLibre = (x, z) => {
    const c = caseDe(x, z);
    if (!bouche(enX(c.i), enZ(c.j))) return c;
    for (let r = 1; r <= 4; r++) {
      for (let di = -r; di <= r; di++) {
        for (let dj = -r; dj <= r; dj++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          const i = c.i + di, j = c.j + dj;
          if (i < 0 || j < 0 || i >= nx || j >= nz) continue;
          if (!bouche(enX(i), enZ(j))) return { i, j };
        }
      }
    }
    return c;
  };
  const dep = caseLibre(depart.x, depart.z);
  const arr = caseLibre(arrivee.x, arrivee.z);

  // A* huit directions, coût diagonal √2, départ figé — déterministe
  const clef = (i, j) => j * nx + i;
  const couts = new Map([[clef(dep.i, dep.j), 0]]);
  const vientDe = new Map();
  const ouverts = [{ i: dep.i, j: dep.j, f: 0 }];
  const h = (i, j) => Math.hypot(i - arr.i, j - arr.j);
  let atteint = false;
  while (ouverts.length) {
    let meilleur = 0;
    for (let k = 1; k < ouverts.length; k++) {
      if (ouverts[k].f < ouverts[meilleur].f) meilleur = k;
    }
    const ici = ouverts.splice(meilleur, 1)[0];
    if (ici.i === arr.i && ici.j === arr.j) { atteint = true; break; }
    const dIci = couts.get(clef(ici.i, ici.j));
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        if (!di && !dj) continue;
        const i = ici.i + di, j = ici.j + dj;
        if (i < 0 || j < 0 || i >= nx || j >= nz) continue;
        if (bouche(enX(i), enZ(j))) continue;
        const d = dIci + (di && dj ? Math.SQRT2 : 1);
        const c = clef(i, j);
        if (d < (couts.get(c) ?? Infinity)) {
          couts.set(c, d);
          vientDe.set(c, clef(ici.i, ici.j));
          ouverts.push({ i, j, f: d + h(i, j) });
        }
      }
    }
  }
  if (!atteint) return direct;

  // remonter le fil, puis LISSER : depuis chaque point, viser le plus loin
  // qu'une ligne droite libre atteint — le chemin en marches d'escalier
  // devient trois ou quatre segments francs
  const brut = [];
  let c = clef(arr.i, arr.j);
  while (c !== undefined) {
    brut.unshift([enX(c % nx), enZ(Math.floor(c / nx))]);
    c = vientDe.get(c);
  }
  const points = [[depart.x, depart.z], ...brut, [arrivee.x, arrivee.z]];
  const lisse = [points[0]];
  let i = 0;
  while (i < points.length - 1) {
    let j = points.length - 1;
    while (j > i + 1
      && !segmentLibre(points[i][0], points[i][1], points[j][0], points[j][1])) j--;
    lisse.push(points[j]);
    i = j;
  }
  return lisse.map(([x, z]) => [Math.round(x * 10) / 10, Math.round(z * 10) / 10]);
}

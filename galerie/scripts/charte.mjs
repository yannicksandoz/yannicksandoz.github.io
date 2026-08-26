/**
 * LA CHARTE — la direction artistique, écrite en règles mesurables.
 *
 * Une DA qui vit dans la tête de son auteur dérive à chaque salle ajoutée :
 * une teinte choisie un soir, une intensité relevée pour dépanner, et deux
 * ans plus tard la galerie n'a plus d'unité — ce qui s'était exactement
 * produit ici (quatre salles avaient un mur PLUS SOMBRE que leur sol,
 * l'inverse de ce que fait un musée, et la bibliothèque saturait à 56 %
 * quand les autres tenaient sous 45).
 *
 * Les règles ci-dessous viennent de la muséographie, pas d'un goût :
 *
 *   1. LE MUR EST PLUS CLAIR QUE LE SOL. C'est ce que fait toute salle
 *      d'exposition : le sol absorbe, le mur renvoie, et l'œil garde le
 *      haut du champ lumineux. Écart visé : +8 en clarté L*.
 *
 *   2. LES SURFACES SONT PEU SATURÉES. Le contraste d'une galerie vient de
 *      la LUMIÈRE, jamais de murs colorés qui se disputeraient l'attention
 *      avec les œuvres. Plafond : 45 % de saturation.
 *
 *   3. UNE SALLE = UNE TEINTE. Sol et mur restent dans la même famille
 *      (≤ 15° d'écart de teinte) : c'est ce qui fait qu'une salle se lit
 *      comme un lieu et non comme deux décors empilés.
 *
 *   4. UNE SEULE LUMIÈRE DE RÉFÉRENCE. Intensité 2,4 (± 0,4) et élévation
 *      55° (± 12) : l'éclairage muséal frappe l'œuvre à une trentaine de
 *      degrés de la verticale, assez haut pour ne pas éblouir, assez
 *      oblique pour ne pas laver le relief.
 *
 *   5. LES ŒUVRES MURALES SE CENTRENT À 1,50 m — la hauteur d'œil, la
 *      norme d'accrochage de tous les musées. Les très grands formats font
 *      exception : on garde alors leur bas à 0,90 m du sol.
 *
 * Les EXTÉRIEURS (jardin, allée) sont exemptés des règles 1 et 3 : leur
 * « mur » est un muret ou un lointain, et leur lumière est le ciel.
 *
 *     node scripts/charte.mjs        → le rapport, salle par salle
 *
 * `test-charte.mjs` en fait des assertions : la DA ne peut plus dériver
 * sans que la chaîne rougisse.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ici = dirname(fileURLToPath(import.meta.url));
const RACINE = join(ici, '..', 'content');

/**
 * Formes qui SONT une lumière : elles portent la leur et ne reçoivent pas
 * d'accent. Doit rester identique à `LUMINAIRES` dans `core/Artwork.js` —
 * `test-charte.mjs` vérifie que les deux listes ne divergent pas.
 */
export const LUMINAIRES = new Set(['corniche', 'faisceau', 'gerbe']);

/** Salles à ciel ouvert : leur lumière est le ciel, pas une salle. */
export const EXTERIEURS = new Set(['jardin', 'allee', 'annexe']);

/**
 * Salles dont TOUTES les faces se marchent — la gravité y bascule, et ce
 * que le JSON appelle « plafond » est un sol comme les autres. La règle du
 * plafond en creux n'y a aucun sens : on n'assombrit pas un sol parce
 * qu'il se trouve en haut quand on le regarde d'en bas.
 */
export const FACES_HABITEES = new Set(['belvedere']);

/**
 * CHAMBRES CLOSES : quatre murs, un plafond, et pour tout luminaire leur
 * propre lanterne. Dans un volume clos, un « soleil » n'a aucun droit
 * d'exister — la lumière clé y peignait trois pans depuis une direction
 * impossible, et l'œil le lit immédiatement comme un décor truqué. Règle :
 * `keyLight: false`, la lanterne porte la chambre. Les salles closes de la
 * galerie (archives, bibliothèque…) gardent leur clé : elle y joue le rôle
 * des rails de spots d'un plafond de musée, un artifice assumé QUE des
 * luminaires visibles (corniches) justifient. Ici il n'y a rien à voir qui
 * l'excuse.
 */
export const CHAMBRES_CLOSES = new Set(
  ['face-1', 'face-2', 'face-3', 'face-4', 'face-5', 'face-6']);

export const CHARTE = {
  ecartMurSol: { vise: 8, tolerance: 6 },   // L* : le mur au-dessus du sol
  // L* : le plafond SOUS le sol. Quatre salles murées sur quatre côtés
  // n'avaient pas de plafond — une pièce fermée à ciel noir, c'est un
  // décor de plateau, et le mur s'y coupait net sur du vide. En les
  // couvrant, il a fallu dire ce qu'est un bon plafond : plus sombre que
  // ses murs et que son sol. Sans rebond, un plafond clair ne rend aucune
  // lumière — il ne fait que se voir, et il écrase la salle.
  ecartPlafondSol: { vise: -8, tolerance: 5 },
  saturationMax: 45,                        // %
  ecartTeinteMax: 15,                       // degrés
  // LA LUMIÈRE CLÉ, recalibrée sur une mesure et non sur une intention.
  //
  // On rend deux fois la même image, avec et sans ombres portées : les
  // pixels qui s'éclaircissent quand on coupe les ombres SONT les pixels
  // d'ombre, et leur rapport donne la PROFONDEUR D'OMBRE. Un rendu
  // d'intérieur tient la sienne entre 0,35 et 0,55 ; la galerie était à
  // 0,64–0,90, avec 0 à 2 % de l'image ombrée au lieu de 10 à 30. Autrement
  // dit : des ombres calculées, puis noyées par le remplissage.
  //
  // Deux corrections, mesurées salle par salle : le remplissage (IBL)
  // divisé par deux à cinq, et la clé remontée d'autant qu'il faut pour que
  // la salle garde son niveau — mais PAS davantage, c'est le contraste
  // qu'on vient chercher. D'où une clé qui vit désormais autour de 3,5.
  //
  // L'ÉLÉVATION descend de 55° à 40°. Une lumière proche du zénith écrase
  // tout : les ombres tombent sous les objets et ne disent rien, les murs
  // reçoivent la lumière de face et redeviennent des aplats. Une lumière
  // RASANTE allonge les ombres — mesuré, la surface ombrée double entre 52°
  // et 30° — et surtout elle accroche le relief des matières, la seule
  // chose qui distingue un mur de pierre d'un rectangle gris.
  lumiere: { intensite: 3.5, marge: 0.8, elevation: 40, margeElevation: 8 },
  accrochage: { centre: 1.5, basMinimum: 0.9 },
  // L'ANGLE MINIMAL d'une œuvre depuis un point d'arrivée, en degrés.
  // Il se DÉDUIT de la règle de recul : on regarde une œuvre entre 1,5 et
  // 3 diagonales, ce qui la fait occuper de 37° à 19° du champ. Au-delà de
  // 3 diagonales elle sort du confort ; on laisse une fois et demie cette
  // distance — 5 diagonales, soit 11,4°, arrondi à 12 — avant de dire
  // qu'elle a cessé d'être un sujet pour devenir un détail du décor.
  angleMinimal: 12
};

/* ------------------------------------------------------------ couleurs -- */

const canal = (c) => (c <= 0.04045 ? c / 12.92 : (((c + 0.055) / 1.055) ** 2.4));

/** Clarté perceptuelle L* (CIE) d'une couleur hexadécimale : 0 noir, 100 blanc. */
export function clarte(hexa) {
  const [r, g, b] = composantes(hexa);
  const y = (0.2126 * canal(r)) + (0.7152 * canal(g)) + (0.0722 * canal(b));
  return y > 0.008856 ? (116 * (y ** (1 / 3))) - 16 : 903.3 * y;
}

/** Teinte (0-360) et saturation (0-100) d'une couleur hexadécimale. */
export function teinteEtSaturation(hexa) {
  const [r, g, b] = composantes(hexa);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = ((b - r) / d) + 2;
    else h = ((r - g) / d) + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { teinte: h, saturation: max === 0 ? 0 : (d / max) * 100 };
}

function composantes(hexa) {
  const h = String(hexa ?? '').replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
}

/** Écart angulaire entre deux teintes, en degrés (0-180). */
export function ecartTeinte(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/* ------------------------------------------------------------- lecture -- */

/** Les salles du contenu, ou [] si le contenu n'est pas là. */
export function salles() {
  const dossier = join(RACINE, 'rooms');
  if (!existsSync(dossier)) return [];
  return readdirSync(dossier)
    .filter((n) => n.endsWith('.json') && n !== 'index.json')
    .map((n) => ({ id: n.slice(0, -5), ...JSON.parse(readFileSync(join(dossier, n), 'utf8')) }));
}

/** Les œuvres murales (image ou vidéo) du contenu. */
export function oeuvresMurales() {
  const dossier = join(RACINE, 'works');
  if (!existsSync(dossier)) return [];
  return readdirSync(dossier)
    .filter((n) => n.endsWith('.json') && n !== 'index.json')
    .map((n) => ({ id: n.slice(0, -5), ...JSON.parse(readFileSync(join(dossier, n), 'utf8')) }))
    .filter((w) => w.image || w.video);
}

/* -------------------------------------------------------------- bilan --- */

/** Ce que la charte dit de chaque salle : les écarts, nommés. */
export function auditSalles() {
  const rapport = [];
  for (const s of salles()) {
    const sol = typeof s.floor === 'object' ? s.floor?.color : null;
    const mur = s.shell?.color;
    const dehors = EXTERIEURS.has(s.id);
    const ligne = { id: s.id, dehors, fautes: [] };
    if (sol && mur) {
      ligne.clarteSol = clarte(sol);
      ligne.clarteMur = clarte(mur);
      ligne.ecart = ligne.clarteMur - ligne.clarteSol;
      const ts = teinteEtSaturation(sol), tm = teinteEtSaturation(mur);
      ligne.saturation = Math.max(ts.saturation, tm.saturation);
      ligne.ecartTeinte = ecartTeinte(ts.teinte, tm.teinte);
      if (!dehors) {
        const { vise, tolerance } = CHARTE.ecartMurSol;
        if (Math.abs(ligne.ecart - vise) > tolerance) {
          ligne.fautes.push(`écart mur/sol ${ligne.ecart.toFixed(1)} (visé ${vise})`);
        }
        if (ligne.ecartTeinte > CHARTE.ecartTeinteMax) {
          ligne.fautes.push(`teintes distantes de ${ligne.ecartTeinte.toFixed(0)}°`);
        }
      }
      if (ligne.saturation > CHARTE.saturationMax) {
        ligne.fautes.push(`saturation ${ligne.saturation.toFixed(0)} %`);
      }
      // LES FACES AUSSI. `wallColors` peint chaque paroi séparément — et
      // l'audit ne lisait que `shell.color`. Les cinq faces du belvédère
      // ont vécu là des mois entre 51 et 61 % de saturation, sous un
      // plafond de 45, sans que rien ne le dise : la DA avait dérivé
      // exactement là où l'on ne regardait pas. Une couleur posée dans la
      // galerie est jugée, quel que soit le champ qui la porte.
      for (const [face, teinteFace] of Object.entries(s.shell?.wallColors ?? {})) {
        const tf = teinteEtSaturation(teinteFace);
        ligne.saturation = Math.max(ligne.saturation, tf.saturation);
        if (tf.saturation > CHARTE.saturationMax) {
          ligne.fautes.push(`face ${face} à ${tf.saturation.toFixed(0)} % de saturation`);
        }
        if (!dehors) {
          const ecartFace = clarte(teinteFace) - ligne.clarteSol;
          // UN PLAFOND N'EST PAS UN MUR. La règle « le mur au-dessus du
          // sol » vient de la muséographie : un mur plus clair que le sol
          // fait monter le regard vers les œuvres. Un plafond, lui, doit
          // rester SOUS ses murs — sinon il renvoie l'œil vers le haut et
          // écrase la salle, et c'est d'autant plus vrai ici où il n'y a
          // pas de rebond : un plafond clair ne rend rien, il ne fait que
          // se voir. Il a donc sa propre borne, en creux.
          if (face === 'plafond' && FACES_HABITEES.has(s.id)) continue;
          const { vise, tolerance } = face === 'plafond'
            ? CHARTE.ecartPlafondSol : CHARTE.ecartMurSol;
          if (Math.abs(ecartFace - vise) > tolerance) {
            ligne.fautes.push(`face ${face} : écart au sol ${ecartFace.toFixed(1)}`);
          }
        }
      }
    }
    if (CHAMBRES_CLOSES.has(s.id) && s.keyLight !== false) {
      ligne.fautes.push('chambre close avec un soleil');
    }
    const k = s.keyLight || {};
    const { intensite, marge, elevation, margeElevation } = CHARTE.lumiere;
    if (Number.isFinite(k.intensity) && Math.abs(k.intensity - intensite) > marge) {
      ligne.fautes.push(`intensité ${k.intensity}`);
    }
    if (Number.isFinite(k.elevation) && !dehors
      && Math.abs(k.elevation - elevation) > margeElevation) {
      ligne.fautes.push(`élévation ${k.elevation}°`);
    }
    rapport.push(ligne);
  }
  return rapport;
}

/** Les œuvres murales mal accrochées, avec la hauteur qu'elles devraient avoir. */
/**
 * LE DÉCOR SE TAIT — audit des couleurs hors pièce.
 *
 * La charte tenait les salles à 45 % de saturation… mais n'auditait que
 * les couleurs de PIÈCE. Les objets, eux, posaient des primaires saturées
 * en toute impunité : un tabouret vert/bleu/rose, une tour verte — et
 * l'unité défendue partout ailleurs se cassait au premier objet posé.
 *
 * La règle a une exemption de principe : une ŒUVRE a le droit d'être la
 * seule couleur saturée de la salle — c'est le sujet. C'est le DÉCOR qui
 * doit se taire : lui est jugé à la même borne que les murs. Les
 * luminaires y échappent (leur couleur est une lumière, pas une surface),
 * comme tout ce qui est auto-éclairé (les lanternes : leur teinte EST
 * leur lueur).
 */
export function auditDecor() {
  const dossier = join(RACINE, 'works');
  if (!existsSync(dossier)) return [];
  const lignes = [];
  for (const nom of readdirSync(dossier)) {
    if (!nom.endsWith('.json') || nom === 'index.json') continue;
    const w = JSON.parse(readFileSync(join(dossier, nom), 'utf8'));
    if (!w || typeof w !== 'object' || Array.isArray(w)) continue;
    if (w.role !== 'decor' || w.selfLit) continue;
    const m = w.model ?? {};
    if (LUMINAIRES.has(m.shape)) continue;
    // les lucioles sont des lueurs (leur couleur EST leur lumière), et
    // l'eau tire sa couleur d'une profondeur optique, pas d'une peinture
    if (m.shape === 'lucioles' || m.shape === 'eau') continue;
    const teintes = [];
    if (typeof m.color === 'string') teintes.push(m.color);
    for (const c of m.palette ?? []) if (typeof c === 'string') teintes.push(c);
    const fautes = [];
    for (const t of teintes) {
      const { saturation } = teinteEtSaturation(t);
      if (saturation > CHARTE.saturationMax) {
        fautes.push(`${t} à ${saturation.toFixed(0)} %`);
      }
    }
    if (teintes.length) lignes.push({ id: w.id ?? nom.slice(0, -5), fautes });
  }
  return lignes;
}

export function auditAccrochage() {
  const { centre, basMinimum } = CHARTE.accrochage;
  return oeuvresMurales().map((w) => {
    const y = (w.position ?? [0, 0, 0])[1];
    const hauteur = (w.size ?? [2, 2])[1] * ((w.scale ?? [1, 1, 1])[1] ?? 1);
    // le centre à 1,50 m — sauf si l'œuvre est si grande qu'elle traînerait
    // au sol : on garde alors son bas à 0,90 m
    const vise = Math.max(centre, basMinimum + (hauteur / 2));
    return { id: w.id, y, hauteur, vise, ecart: y - vise };
  });
}

/* ------------------------------------------- muséographie, second étage -- */

/** Toutes les œuvres du contenu, id compris, ou []. */
function toutesLesOeuvres() {
  const dossier = join(RACINE, 'works');
  if (!existsSync(dossier)) return [];
  return readdirSync(dossier)
    .filter((n) => n.endsWith('.json') && n !== 'index.json')
    .map((n) => ({ id: n.slice(0, -5), ...JSON.parse(readFileSync(join(dossier, n), 'utf8')) }));
}

/** Largeur/profondeur utiles d'une salle : la coque, à défaut le sol. */
function dimensionsSalle(s) {
  if (s.shell && typeof s.shell === 'object') {
    return { w: s.shell.width ?? 26, d: s.shell.depth ?? 20 };
  }
  const taille = (typeof s.floor === 'object' ? s.floor?.size : null) ?? 40;
  return { w: taille, d: taille };
}

/**
 * LE RECUL — la règle des galeristes : on regarde une œuvre depuis 1,5 à
 * 3 fois sa diagonale. Une œuvre murale doit donc avoir AU MOINS 1,5
 * diagonale d'espace libre devant elle ; sinon le visiteur ne peut
 * physiquement pas la voir en entier. On mesure la distance de l'œuvre à
 * la paroi d'en face le long de sa normale (la rotation Y du panneau).
 */
export function auditRecul() {
  const parId = new Map(salles().map((s) => [s.id, s]));
  const salleDe = new Map();
  for (const s of parId.values()) {
    for (const w of s.works ?? []) salleDe.set(w, s);
  }
  return oeuvresMurales().map((w) => {
    const s = salleDe.get(w.id);
    if (!s) return null;
    const { w: lw, d: ld } = dimensionsSalle(s);
    const [px, , pz] = w.position ?? [0, 0, 0];
    const ry = ((w.rotation ?? [0, 0, 0])[1] ?? 0) * (Math.PI / 180);
    // normale d'un plan : +z dans son repère, tournée par la rotation Y
    const nx = Math.sin(ry), nz = Math.cos(ry);
    // distance au bord de la salle le long de la normale (x ±w/2, z ±d/2)
    const borne = (p, n, demi) => (Math.abs(n) < 1e-4 ? Infinity
      : ((n > 0 ? demi : -demi) - p) / n);
    const libre = Math.min(borne(px, nx, lw / 2), borne(pz, nz, ld / 2));
    const [sw, sh] = w.size ?? [2, 2];
    const diagonale = Math.hypot(sw * ((w.scale ?? [1, 1, 1])[0] ?? 1),
      sh * ((w.scale ?? [1, 1, 1])[1] ?? 1));
    return { id: w.id, salle: s.id, libre, diagonale,
      requis: 1.5 * diagonale, manque: (1.5 * diagonale) - libre };
  }).filter(Boolean);
}

/**
 * LA HIÉRARCHIE LUMINEUSE — dans un musée, l'accent le plus fort va aux
 * ŒUVRES ; la circulation et le décor forment un fond qui soutient sans
 * rivaliser. Une salle où une lanterne ou une lune de décor éclaire plus
 * fort que la pièce maîtresse inverse la lecture : l'œil va au décor.
 */
export function auditHierarchie() {
  const oeuvres = new Map(toutesLesOeuvres().map((w) => [w.id, w]));
  const rapport = [];
  for (const s of salles()) {
    const habitants = (s.works ?? []).map((n) => oeuvres.get(n)).filter(Boolean);
    // Le même défaut que le moteur, luminaires compris (voir Artwork :
    // `accentParDefaut`). Si les deux divergent, c'est la charte qui ment :
    // elle jugerait une lampe que la scène n'allume pas — ou l'inverse.
    const accent = (w) => (Number.isFinite(w.lightIntensity) ? w.lightIntensity
      : (LUMINAIRES.has(w.model?.shape) ? 0 : 4));
    const majeures = habitants.filter((w) => w.role !== 'decor' && !w.partOf);
    const decor = habitants.filter((w) => w.role === 'decor');
    if (!majeures.length) continue;      // salle de circulation : rien à juger
    const maxOeuvre = Math.max(...majeures.map(accent));
    const maxDecor = Math.max(0, ...decor.map(accent));
    rapport.push({ id: s.id, maxOeuvre, maxDecor, inversee: maxDecor > maxOeuvre });
  }
  return rapport;
}

/**
 * LA VISTA — le premier regard du visiteur (le moteur cadre l'œuvre la plus
 * proche du point d'arrivée) doit avoir quelque chose à cadrer : une œuvre
 * ni collée au spawn (< 2 m : on apparaît dessus) ni perdue au-delà de 80 %
 * de la diagonale de la salle (on cadre un point dans la brume).
 */
export function auditVista() {
  const oeuvres = new Map(toutesLesOeuvres().map((w) => [w.id, w]));
  const rapport = [];
  for (const s of salles()) {
    const habitants = (s.works ?? []).map((n) => oeuvres.get(n)).filter(Boolean)
      .filter((w) => w.role !== 'decor' && !w.partOf);
    if (!habitants.length) continue;
    const { w: lw, d: ld } = dimensionsSalle(s);
    const diag = Math.hypot(lw, ld);
    const [sx, , sz] = s.spawn ?? [0, 2.2, 10];
    const distances = habitants.map((w) => {
      const [x, , z] = w.position ?? [0, 0, 0];
      return Math.hypot(x - sx, z - sz);
    });
    const plusProche = Math.min(...distances);
    rapport.push({ id: s.id, plusProche, plafond: 0.8 * diag,
      cadrable: plusProche >= 2 && plusProche <= 0.8 * diag });
  }
  return rapport;
}

/**
 * L'AMPLEUR d'une œuvre : sa plus grande diagonale apparente, en mètres,
 * échelle comprise. Chaque type de contenu la porte à sa façon — c'est
 * l'endroit unique qui sait les lire tous.
 *
 * Rendue avec un drapeau `estimee` : un modèle importé sans `fit` n'annonce
 * sa taille nulle part dans le JSON (elle est dans le .glb), on suppose
 * alors 1,5 m et on le dit plutôt que de faire passer une supposition pour
 * une mesure.
 */
export function ampleurOeuvre(w) {
  const s = w.scale ?? [1, 1, 1];
  const [sx, sy, sz] = [s[0] ?? 1, s[1] ?? 1, s[2] ?? 1];
  // largeur = la plus grande des deux emprises horizontales : une œuvre se
  // regarde de face, mais on ne sait pas d'où l'on arrive
  const horizontal = Math.max(sx, sz);
  const diag = (l, h) => Math.hypot(l * horizontal, h * sy);

  if (Array.isArray(w.size) && w.size.length === 2) {
    return { metres: diag(w.size[0], w.size[1]), estimee: false };
  }
  if (Array.isArray(w.scanTaille) && w.scanTaille.length === 3) {
    const [x, y, z] = w.scanTaille;
    return { metres: diag(Math.max(x, z), y), estimee: false };
  }
  const m = w.model ?? {};
  if (m.shape === 'monolith') {
    // BoxGeometry(1.1, height, 1.1) — voir Artwork._buildMonolith
    return { metres: diag(1.1, m.height ?? 4), estimee: false };
  }
  if (m.type === 'voxel') {
    const [dx, dy] = m.dims ?? [16, 16, 16];
    const cell = m.cell ?? 0.25;
    return { metres: diag(dx * cell, dy * cell), estimee: false };
  }
  if (m.shape) {
    // emprises des primitives, telles que `primitives.js` les construit
    const t = Number.isFinite(m.size) ? m.size : 1.5;
    const EMPRISES = {
      box: [1, 1], sphere: [1.2, 1.2], plane: [1.6, 1],
      cylinder: [1, 1.6], cone: [1.2, 1.6], torus: [1.64, 1.64],
      eau: [1.6, 1], faisceau: [1.7, 6], lucioles: [1, 1]
    };
    const [l, h] = EMPRISES[m.shape] ?? [1, 1];
    return { metres: diag(l * t, h * t), estimee: false };
  }
  if (m.url) {
    // `fit` normalise le modèle à tant de mètres — c'est sa taille réelle
    if (Number.isFinite(m.fit)) return { metres: diag(m.fit, m.fit), estimee: false };
    return { metres: diag(1.5, 1.5), estimee: true };
  }
  return { metres: diag(1.5, 1.5), estimee: true };
}

/** Angle apparent (degrés) d'une ampleur donnée, vue de `distance` mètres. */
export function angleApparent(metres, distance) {
  if (!(distance > 0)) return 180;
  return 2 * Math.atan(metres / (2 * distance)) * (180 / Math.PI);
}

/**
 * TOUS LES POINTS D'ARRIVÉE d'une salle : son `spawn`, et le point de
 * dépose de chaque portail qui y mène. On n'entre pas toujours par la
 * grande porte, et une salle qui n'a de vue que depuis son spawn ment sur
 * la moitié de ses entrées.
 */
export function arriveesDe(salleId, toutes) {
  const points = [];
  const s = toutes.find((r) => r.id === salleId);
  if (s?.spawn) points.push({ nom: 'spawn', p: s.spawn });
  for (const autre of toutes) {
    for (const portail of autre.portals ?? []) {
      if (portail.to !== salleId || !Array.isArray(portail.arrival)) continue;
      points.push({ nom: `depuis ${autre.id}`, p: portail.arrival });
    }
  }
  return points;
}

/**
 * L'AMPLEUR À L'ARRIVÉE — ce qui manquait à la charte.
 *
 * La règle de recul dit « pas trop PRÈS » : une œuvre a besoin d'au moins
 * 1,5 diagonale d'espace devant elle pour se voir en entier. Rien ne
 * disait « pas trop LOIN », et c'est exactement ce qui s'est produit : le
 * scan gaussien du labo, 4 m de nuage, se retrouvait cadré en plein centre
 * du champ… à 28 m, dans une salle de 36 × 44. Il occupait 8° — une tache
 * de quarante pixels entre deux grandes œuvres. Rien ne le signalait,
 * puisqu'il passait le recul, la vista et la hiérarchie.
 *
 * On mesure donc, pour CHAQUE point d'arrivée d'une salle, l'angle de la
 * plus ample de ses œuvres. Il en faut au moins UNE au-dessus du seuil :
 * en arrivant quelque part, on doit avoir quelque chose à regarder.
 */
export function auditAmpleur() {
  const oeuvres = new Map(toutesLesOeuvres().map((w) => [w.id, w]));
  const toutes = salles();
  const rapport = [];
  for (const s of toutes) {
    const habitants = (s.works ?? []).map((n) => oeuvres.get(n)).filter(Boolean)
      .filter((w) => w.role !== 'decor' && !w.partOf);
    if (!habitants.length) continue;
    for (const arrivee of arriveesDe(s.id, toutes)) {
      const [ax, , az] = arrivee.p;
      let meilleure = null;
      for (const w of habitants) {
        const [x, , z] = w.position ?? [0, 0, 0];
        const distance = Math.hypot(x - ax, z - az);
        const { metres, estimee } = ampleurOeuvre(w);
        const angle = angleApparent(metres, distance);
        if (!meilleure || angle > meilleure.angle) {
          meilleure = { oeuvre: w.id, angle, distance, metres, estimee };
        }
      }
      rapport.push({
        id: s.id, arrivee: arrivee.nom, ...meilleure,
        suffisant: meilleure.angle >= CHARTE.angleMinimal
      });
    }
  }
  return rapport;
}

/**
 * LE RYTHME DU PARCOURS — la respiration des salles.
 *
 * La scénographie alterne COMPRESSION et DILATATION : un couloir bas qui
 * débouche sur un grand hall rend le hall immense — c'est le contraste qui
 * fait l'échelle, pas les mètres. Une suite de salles de même gabarit,
 * elle, s'oublie en marchant.
 *
 * On mesure chaque passage (chaque portail) par le rapport des surfaces
 * des deux salles qu'il relie : 1 = aucun changement, 3 = le souffle
 * coupé. Deux exigences douces : qu'il existe au moins UN grand geste
 * (rapport ≥ 3 quelque part), et que la galerie respire en moyenne
 * (rapport moyen ≥ 1,5) — rien qui dicte le plan, tout qui interdit la
 * monotonie silencieuse.
 */
export function auditRythme() {
  const toutes = salles();
  const surfaces = new Map(toutes.map((s) => {
    const { w, d } = dimensionsSalle(s);
    return [s.id, w * d];
  }));
  const passages = [];
  const vus = new Set();
  for (const s of toutes) {
    for (const p of s.portals ?? []) {
      if (!surfaces.has(p.to)) continue;
      const cle = [s.id, p.to].sort().join('↔');
      if (vus.has(cle)) continue;          // l'aller-retour est UN passage
      vus.add(cle);
      const a = surfaces.get(s.id), b = surfaces.get(p.to);
      passages.push({ de: s.id, vers: p.to,
        rapport: Math.max(a, b) / Math.max(1, Math.min(a, b)) });
    }
  }
  const rapports = passages.map((p) => p.rapport);
  return { passages,
    plusGrand: rapports.length ? Math.max(...rapports) : 0,
    moyen: rapports.length
      ? rapports.reduce((x, y) => x + y, 0) / rapports.length : 0 };
}

/**
 * LES BANCS — la zone de repos regarde quelque chose.
 *
 * Un banc de musée n'est jamais posé au hasard : il offre une ASSISE à la
 * contemplation — face à une œuvre, à la bonne distance. Un banc qui
 * tourne le dos à tout transforme le repos en salle d'attente.
 *
 * Pour chaque banc posé à plat (les bancs des faces de gravité vivent dans
 * une autre géométrie), on cherche une œuvre à moins de 25 m dont la
 * direction fait ≤ 45° avec l'axe d'assise (±Z local tourné par la
 * rotation Y — une assise a deux côtés, l'angle est pris des deux). Le
 * banc-œuvre (banc d'écoute) est jugé comme les autres, contre les AUTRES
 * œuvres de sa salle ; s'il est la seule, il n'a rien à regarder et la
 * règle se tait.
 */
export function auditBancs() {
  const oeuvres = new Map(toutesLesOeuvres().map((w) => [w.id, w]));
  const rapport = [];
  for (const s of salles()) {
    const habitants = (s.works ?? []).map((n) => oeuvres.get(n)).filter(Boolean);
    const cibles = habitants.filter((w) => w.role !== 'decor' && !w.partOf);
    for (const banc of habitants.filter((w) => w.id.startsWith('banc'))) {
      const [rx, ry, rz] = banc.rotation ?? [0, 0, 0];
      if (rx || rz) continue;              // face de gravité : autre géométrie
      const autres = cibles.filter((w) => w.id !== banc.id);
      if (!autres.length) continue;        // seul au monde : rien à regarder
      const [bx, , bz] = banc.position ?? [0, 0, 0];
      const a = (ry ?? 0) * (Math.PI / 180);
      const fx = Math.sin(a), fz = Math.cos(a);   // ±Z local, tourné
      let meilleur = null;
      for (const w of autres) {
        const [wx, , wz] = w.position ?? [0, 0, 0];
        const dx = wx - bx, dz = wz - bz;
        const d = Math.hypot(dx, dz);
        if (d < 0.5 || d > 25) continue;
        const cos = Math.abs(((dx * fx) + (dz * fz)) / d);  // les deux côtés
        const angle = Math.acos(Math.min(1, cos)) * (180 / Math.PI);
        if (!meilleur || angle < meilleur.angle) {
          meilleur = { vers: w.id, angle, distance: d };
        }
      }
      rapport.push({ id: banc.id, salle: s.id, ...(meilleur ?? {}),
        regarde: Boolean(meilleur && meilleur.angle <= 45) });
    }
  }
  return rapport;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log('\nLES SALLES\n');
  console.log('  salle           sol    mur   écart  sat.  teinte  verdict');
  for (const l of auditSalles()) {
    const n = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d).padStart(5) : '    –');
    console.log(`  ${l.id.padEnd(14)}${n(l.clarteSol)} ${n(l.clarteMur)} ${n(l.ecart)}`
      + ` ${n(l.saturation, 0)} ${n(l.ecartTeinte, 0)}°  `
      + (l.fautes.length ? `✗ ${l.fautes.join(' · ')}` : (l.dehors ? '· extérieur' : '✓')));
  }
  console.log('\nL’ACCROCHAGE\n');
  for (const a of auditAccrochage()) {
    console.log(`  ${a.id.padEnd(14)} y=${a.y.toFixed(2)} m  (haut ${a.hauteur} m)`
      + `  visé ${a.vise.toFixed(2)} m  `
      + (Math.abs(a.ecart) > 0.25 ? `✗ ${a.ecart > 0 ? '+' : ''}${a.ecart.toFixed(2)} m` : '✓'));
  }
  console.log('\nLE RECUL (≥ 1,5 × la diagonale de l’œuvre)\n');
  for (const r of auditRecul()) {
    console.log(`  ${r.id.padEnd(14)} ${r.libre.toFixed(1)} m libres devant`
      + ` (diag ${r.diagonale.toFixed(1)} m, requis ${r.requis.toFixed(1)} m)  `
      + (r.manque > 0 ? `✗ manque ${r.manque.toFixed(1)} m` : '✓'));
  }
  console.log('\nLA HIÉRARCHIE LUMINEUSE (l’accent va aux œuvres)\n');
  for (const h of auditHierarchie()) {
    console.log(`  ${h.id.padEnd(14)} œuvre ${h.maxOeuvre} / décor ${h.maxDecor}  `
      + (h.inversee ? '✗ le décor éclipse les œuvres' : '✓'));
  }
  console.log('\nLA VISTA (le premier regard a une œuvre à cadrer)\n');
  for (const v of auditVista()) {
    console.log(`  ${v.id.padEnd(14)} plus proche à ${v.plusProche.toFixed(1)} m`
      + ` (plafond ${v.plafond.toFixed(0)} m)  ` + (v.cadrable ? '✓' : '✗'));
  }
  console.log(`\nL'AMPLEUR À L'ARRIVÉE (au moins ${CHARTE.angleMinimal}° de champ)\n`);
  for (const a of auditAmpleur()) {
    console.log(`  ${a.id.padEnd(12)} ${a.arrivee.padEnd(20)}`
      // une décimale : à l'unité près, 11,9 et 12,0 s'affichaient tous deux
      // « 12° », l'un fautif et l'autre non — un rapport qui se contredit
      + ` ${a.angle.toFixed(1).padStart(5)}°  ${a.oeuvre.padEnd(20)}`
      + ` ${a.metres.toFixed(1)} m à ${a.distance.toFixed(0)} m`
      + `${a.estimee ? ' (ampleur estimée)' : ''}  ` + (a.suffisant ? '✓' : '✗'));
  }
  console.log('\nLES BANCS (le repos regarde une œuvre)\n');
  for (const b of auditBancs()) {
    console.log(`  ${b.id.padEnd(18)} ${b.vers
      ? `→ ${b.vers} (${b.angle.toFixed(0)}°, ${b.distance.toFixed(1)} m)`
      : 'aucune œuvre à portée'}  ${b.regarde ? '✓' : '✗'}`);
  }
  const rythme = auditRythme();
  console.log('\nLE RYTHME (compression → dilatation, par passage)\n');
  for (const p of rythme.passages.sort((a, b) => b.rapport - a.rapport)) {
    console.log(`  ${(p.de + ' ↔ ' + p.vers).padEnd(28)} ×${p.rapport.toFixed(1)}`);
  }
  console.log(`\n  plus grand geste ×${rythme.plusGrand.toFixed(1)}`
    + `   respiration moyenne ×${rythme.moyen.toFixed(2)}`);
  console.log();
}

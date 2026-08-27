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
import { setStyle, loiCouronne } from '../engine/src/core/style.js';

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
 * `keyLight: false`, la lanterne porte la chambre. La règle vaut pour TOUTE
 * coque close (plafond + quatre murs), plus seulement les six faces : la
 * doctrine « la clé joue les rails de spots » est abandonnée — un soleil
 * dans une boîte scellée fabriquait des ombres impossibles (le jeton du
 * labo), et le moteur l'éteint désormais lui-même (ombres.coqueClose).
 * La charte tient le CONTENU au même niveau d'honnêteté que le moteur.
 */
export function coqueCloseContenu(s) {
  const coque = s?.shell;
  if (!coque || coque === false) return false;
  const o = coque === true ? {} : coque;
  if (!o.ceiling) return false;
  return !Array.isArray(o.walls) || o.walls.length >= 4;
}

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
  angleMinimal: 12,
  // LE PASSAGE SUR UNE LIGNE DE FORCE, en mètres.
  // Une ligne de force est l'axe qu'un visiteur emprunte sans y penser :
  // son point d'arrivée vers une porte, une porte vers la suivante. Les
  // urbanistes l'appellent « desire line », la syntaxe spatiale « ligne
  // axiale ». Rien ne doit s'y planter : ou l'axe est franc, ou l'objet
  // s'écarte assez pour qu'on le CONTOURNE en le regardant — il devient
  // alors un incident du parcours, ce que Cullen appelle la vision
  // sérielle, et non un obstacle. 1,20 m : la largeur d'un passage à deux,
  // et le double de l'épaule d'un visiteur.
  passageLigne: 1.2
};

/**
 * Salles-LABYRINTHE : l'obstruction y est le sujet. Mesurer la franchise
 * d'un axe entre deux portails du belvédère reviendrait à reprocher à un
 * dédale d'être un dédale.
 */
export const LABYRINTHES = new Set(['belvedere']);

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
    if (coqueCloseContenu(s) && s.keyLight !== false) {
      ligne.fautes.push('chambre close avec un soleil');
    }
    if (coqueCloseContenu(s) && (s.envIntensity ?? 1) > 0.3) {
      ligne.fautes.push(`coque close à l'IBL de plein ciel (${s.envIntensity})`);
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

/**
 * EMPRISE AU SOL d'une œuvre : demi-largeur horizontale et hauteur.
 *
 * `ampleurOeuvre` rend une DIAGONALE — bonne pour l'angle apparent, muette
 * sur la place que l'objet prend par terre. Ici on veut les deux mesures
 * séparément : de quoi savoir si l'on passe à côté, et si l'objet est au
 * sol plutôt que suspendu ou peint à plat.
 */
export function empriseAuSol(w) {
  const s = w.scale ?? [1, 1, 1];
  const [sx, sy, sz] = [s[0] ?? 1, s[1] ?? 1, s[2] ?? 1];
  const h = Math.max(sx, sz);
  // `bas` et `haut` sont RELATIFS à la position : la plupart des formes se
  // centrent sur elle, un voxel repose dessus.
  // `demiX`/`demiZ` : l'emprise PAR AXE. Un rayon unique prend la plus
  // grande des deux, ce qui fait d'une volée de sept mètres de long un
  // disque de sept mètres de diamètre — et condamne des portails qu'elle
  // ne touche pas. Les règles qui visent juste ont besoin du rectangle.
  const centre = (largeur, hauteur) => ({
    rayon: (largeur * h) / 2, demiX: (largeur * sx) / 2, demiZ: (largeur * sz) / 2,
    bas: -(hauteur * sy) / 2, haut: (hauteur * sy) / 2
  });

  const m = w.model ?? {};
  // Une nappe d'EAU est horizontale : large au sol, sans épaisseur. Comptée
  // comme un volume, le bassin du jardin barrait trois lignes de force
  // qu'on longe en réalité sans même ralentir.
  if (m.shape === 'eau') {
    const t = Number.isFinite(m.size) ? m.size : 1.5;
    return { rayon: (1.6 * t * h) / 2, demiX: (1.6 * t * sx) / 2,
      demiZ: (1.6 * t * sz) / 2, bas: -0.05, haut: 0.05 };
  }
  // Un GALET est une dalle : large comme sa `size`, épaisse de quelques
  // centimètres (`epaisseur`). Comptée cubique, la margelle du bassin —
  // 7,4 m de large, 24 cm d'épais — barrait deux lignes de force qu'on
  // enjambe sans y penser.
  if (m.shape === 'galet') {
    const t = Number.isFinite(m.size) ? m.size : 1.5;
    const ep = Math.max(0.02, Number(m.epaisseur) || t * 0.1);
    return { rayon: (1.6 * t * h) / 2, demiX: (1.6 * t * sx) / 2,
      demiZ: (1.6 * t * sz) / 2, bas: -(ep * sy) / 2, haut: (ep * sy) / 2 };
  }
  if (Array.isArray(w.size) && w.size.length === 2) return centre(w.size[0], w.size[1]);
  if (Array.isArray(w.scanTaille) && w.scanTaille.length === 3) {
    const [x, y, z] = w.scanTaille;
    return centre(Math.max(x, z), y);
  }
  if (m.shape === 'monolith') return centre(1.1, m.height ?? 4);
  if (m.type === 'voxel') {
    // On lit les CELLULES PLEINES, pas la grille : une grille de 16³ à
    // 0,25 m fait quatre mètres de large, mais la sculpture du labo n'en
    // occupe qu'une poignée — comptée pleine, elle serrait une ligne
    // qu'elle laisse en fait entièrement libre.
    const occ = occupationVoxel(m);
    if (occ) {
      return { rayon: (occ.largeur * h) / 2,
        demiX: (occ.largeurX * sx) / 2, demiZ: (occ.largeurZ * sz) / 2,
        bas: occ.bas * sy, haut: occ.haut * sy };
    }
    const [dx, dy, dz] = m.dims ?? [16, 16, 16];
    const cell = m.cell ?? 0.25;
    return { rayon: (Math.max(dx, dz) * cell * h) / 2,
      demiX: (dx * cell * sx) / 2, demiZ: (dz * cell * sz) / 2,
      bas: 0, haut: dy * cell * sy };
  }
  if (m.shape) {
    const t = Number.isFinite(m.size) ? m.size : 1.5;
    const EMPRISES = {
      box: [1, 1], sphere: [1.2, 1.2], plane: [1.6, 1],
      cylinder: [1, 1.6], cone: [1.2, 1.6], torus: [1.64, 1.64],
      faisceau: [1.7, 6], lucioles: [1, 1]
    };
    const [l, ha] = EMPRISES[m.shape] ?? [1, 1];
    return centre(l * t, ha * t);
  }
  if (m.url && Number.isFinite(m.fit)) return centre(m.fit, m.fit);
  return centre(1.5, 1.5);
}

/**
 * L'emprise RÉELLE d'un modèle voxel : les bornes de ses cellules pleines,
 * lues dans le RLE (`voxel.js` : longueur, valeur, longueur, valeur…, et
 * l'indice linéaire vaut x + dims[0]·(y + dims[1]·z)). En mètres, dans le
 * repère de l'objet — la grille est centrée en x/z, posée en y.
 */
export function occupationVoxel(m) {
  const dims = m.dims ?? [16, 16, 16];
  const cell = m.cell ?? 0.25;
  const total = dims[0] * dims[1] * dims[2];
  const rle = m.cells ?? [];
  let i = 0, vu = false;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  let z0 = Infinity, z1 = -Infinity;
  for (let k = 0; k + 1 < rle.length && i < total; k += 2) {
    const run = rle[k], valeur = rle[k + 1];
    if (valeur) {
      for (let n = 0; n < run && i + n < total; n++) {
        const idx = i + n;
        const x = idx % dims[0];
        const y = Math.floor(idx / dims[0]) % dims[1];
        const z = Math.floor(idx / (dims[0] * dims[1]));
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (z < z0) z0 = z; if (z > z1) z1 = z;
        vu = true;
      }
    }
    i += run;
  }
  if (!vu) return null;
  return {
    largeur: Math.max(x1 - x0 + 1, z1 - z0 + 1) * cell,
    largeurX: (x1 - x0 + 1) * cell, largeurZ: (z1 - z0 + 1) * cell,
    bas: y0 * cell, haut: (y1 + 1) * cell
  };
}

/**
 * LES LIGNES DE FORCE : d'un point d'arrivée à chaque porte, et d'une porte
 * à l'autre. Pour chacune, le passage le plus serré que laisse un objet
 * planté à moins de `passageLigne` de l'axe.
 *
 * On ne juge que ce qui BARRE : un tapis (haut < 0,35 m) se traverse, une
 * suspension (bas > 2 m) se passe dessous, un luminaire d'ambiance n'est
 * pas de la matière. Et on ne juge pas les deux mètres qui touchent les
 * extrémités : à l'aplomb d'une porte, tout objet est « sur l'axe ».
 */
export function auditLignes() {
  const oeuvres = new Map(toutesLesOeuvres().map((w) => [w.id, w]));
  const rapport = [];
  for (const s of salles()) {
    if (LABYRINTHES.has(s.id)) continue;
    const noeuds = [];
    if (s.spawn) noeuds.push({ nom: 'départ', p: s.spawn });
    for (const p of s.portals ?? []) {
      noeuds.push({ nom: p.to ?? 'portail', p: p.position ?? [0, 0, 0] });
    }
    const corps = (s.works ?? []).map((n) => oeuvres.get(n)).filter(Boolean)
      .filter((w) => !LUMINAIRES.has(w.model?.shape) && w.model?.shape !== 'lucioles')
      .map((w) => {
        const { rayon, bas, haut } = empriseAuSol(w);
        const [x, y, z] = w.position ?? [0, 0, 0];
        return { id: w.id, x, z, rayon, bas: y + bas, haut: y + haut };
      })
      .filter((c) => c.haut >= 0.35 && c.bas <= 2.0);

    for (let i = 0; i < noeuds.length; i++) {
      for (let j = i + 1; j < noeuds.length; j++) {
        const A = noeuds[i], B = noeuds[j];
        const dx = B.p[0] - A.p[0], dz = B.p[2] - A.p[2];
        const L = Math.hypot(dx, dz);
        if (L < 3) continue;
        const ux = dx / L, uz = dz / L;
        let pire = null;
        for (const c of corps) {
          const t = (c.x - A.p[0]) * ux + (c.z - A.p[2]) * uz;
          if (t < 1.2 || t > L - 1.2) continue;
          const ex = A.p[0] + ux * t - c.x, ez = A.p[2] + uz * t - c.z;
          const passage = Math.hypot(ex, ez) - c.rayon;
          if (!pire || passage < pire.passage) pire = { id: c.id, passage };
        }
        rapport.push({
          salle: s.id, ligne: `${A.nom} → ${B.nom}`, longueur: L,
          objet: pire?.id ?? null,
          passage: pire ? pire.passage : Infinity,
          franche: !pire || pire.passage >= CHARTE.passageLigne
        });
      }
    }
  }
  return rapport;
}

/**
 * RIEN NE DÉPASSE LE COURONNEMENT.
 *
 * Un mur à ciel ouvert n'a pas de sommet droit : il ondule (style.js,
 * `loiCouronne`). Ce qui s'y accroche — une baie, une apparition — doit
 * donc rester SOUS la ligne, à l'endroit précis où il est posé, sinon il
 * sort du mur et flotte sur le ciel. C'est arrivé à l'écran du milieu de
 * l'entrée : son haut culminait à 8,80 m là où le voile ne montait qu'à
 * 8,01. Personne ne pouvait le voir venir — la loi est dans le moteur, le
 * contenu ne parle qu'en appuis et en hauteurs. Elle est mesurée ici.
 *
 * `WALL_T` (0,35 m) : les murs nord/sud portent sur la largeur PLUS
 * l'épaisseur, est/ouest sur la profondeur MOINS — voir `planMur`.
 */
export const GARDE_COURONNE = 0.4;      // mètres de dégagement exigés
const WALL_T = 0.35;

export function auditCouronnement() {
  setStyle('fluide');
  const rapport = [];
  for (const s of salles()) {
    const coque = s.shell;
    if (!coque || coque === true || coque.ceiling) continue;   // couvert : pas de crête
    const murs = Array.isArray(coque.walls) ? coque.walls : ['nord', 'sud', 'est', 'ouest'];
    const h = Number(coque.height) || 4;
    const longueurDe = (mur) => (mur === 'nord' || mur === 'sud'
      ? (Number(coque.width) || 20) + WALL_T
      : (Number(coque.depth) || 20) - WALL_T);
    const accroches = [
      ...(coque.windows ?? []).map((o) => ({ quoi: `baie ${o.wall}`, ...o })),
      ...(s.vistas ?? []).map((v) => ({ quoi: `apparition ${v.room}`, ...v }))
    ];
    for (const a of accroches) {
      const mur = a.wall ?? 'nord';
      if (!murs.includes(mur)) continue;
      const length = longueurDe(mur);
      const creux = loiCouronne({ length, height: h });
      const x = a.offset ?? 0;
      const sommet = h - creux(x);
      const haut = (a.sill ?? 1.1) + (a.height ?? 1.8);
      rapport.push({
        salle: s.id, quoi: a.quoi, mur, offset: x,
        haut: +haut.toFixed(2), sommet: +sommet.toFixed(2),
        degagement: +(sommet - haut).toFixed(2),
        sous: sommet - haut >= GARDE_COURONNE
      });
    }
  }
  return rapport;
}

/**
 * UN PORTAIL N'EST PAS DANS UN ESCALIER.
 *
 * Une porte se franchit : il faut de l'air devant, à hauteur de corps. Rien
 * ne le vérifiait, et la même faute revenait à chaque fois qu'on déplaçait
 * une volée ou qu'on redimensionnait une salle — au belvédère, deux portails
 * ouvraient dans la masse d'un escalier. On mesure donc l'ENCOMBREMENT du
 * seuil : tout objet dont le rectangle au sol touche le portail, et dont la
 * tranche verticale recoupe celle d'un passant, est une faute.
 *
 * `AIR_SEUIL` : le rayon d'air exigé autour de l'axe du portail, en plus de
 * l'emprise de l'objet. Un visiteur fait trente-cinq centimètres de large ;
 * on demande le double, pour passer sans raser.
 */
export const AIR_SEUIL = 0.7;
const CORPS = { bas: 0.2, haut: 2.1 };

export function auditSeuils() {
  const oeuvres = new Map(toutesLesOeuvres().map((w) => [w.id, w]));
  const rapport = [];
  for (const s of salles()) {
    const corps = (s.works ?? []).map((n) => oeuvres.get(n)).filter(Boolean)
      .filter((w) => !LUMINAIRES.has(w.model?.shape) && w.model?.shape !== 'lucioles'
        && w.solid !== false)
      .map((w) => {
        const e = empriseAuSol(w);
        const [x, y, z] = w.position ?? [0, 0, 0];
        return { id: w.id, x, z, demiX: e.demiX, demiZ: e.demiZ,
          bas: y + e.bas, haut: y + e.haut };
      });
    for (const p of s.portals ?? []) {
      const [px, py, pz] = p.position ?? [0, 0, 0];
      const bas = py + CORPS.bas, haut = py + CORPS.haut;
      for (const c of corps) {
        if (c.haut <= bas || c.bas >= haut) continue;        // pas à hauteur d'homme
        const dx = Math.max(0, Math.abs(c.x - px) - c.demiX - AIR_SEUIL);
        const dz = Math.max(0, Math.abs(c.z - pz) - c.demiZ - AIR_SEUIL);
        if (dx > 0 || dz > 0) continue;                      // il reste de l'air
        rapport.push({
          salle: s.id, portail: p.to ?? '?', objet: c.id,
          position: [px, py, pz],
          air: +Math.min(Math.abs(c.x - px) - c.demiX, Math.abs(c.z - pz) - c.demiZ)
            .toFixed(2)
        });
      }
    }
  }
  return rapport;
}

/**
 * UNE CORNICHE NE TRAVERSE PAS UNE BAIE.
 *
 * Le bandeau lumineux court au sommet d'un mur ; une baie ou une apparition
 * posée trop haut le coupe en deux, et la lumière semble sortir du verre.
 * En mode fluide la corniche SUIT le couronnement (Artwork courbe le
 * bandeau de `loiCouronne`) : sa hauteur dépend donc de l'endroit, et c'est
 * là qu'elle plongeait sur les trois écrans de l'entrée. On la mesure au
 * décalage de chaque accroche, pas au milieu du mur.
 */
export const GARDE_CORNICHE = 0.3;

export function auditCorniches() {
  setStyle('fluide');
  const oeuvres = new Map(toutesLesOeuvres().map((w) => [w.id, w]));
  const rapport = [];
  for (const s of salles()) {
    const coque = s.shell && s.shell !== true ? s.shell : null;
    if (!coque) continue;
    const h = Number(coque.height) || 4;
    const decouvert = !coque.ceiling;
    const longueurDe = (mur) => (mur === 'nord' || mur === 'sud'
      ? (Number(coque.width) || 20) + WALL_T
      : (Number(coque.depth) || 20) - WALL_T);
    const bandeaux = (s.works ?? []).map((n) => oeuvres.get(n)).filter(Boolean)
      .filter((w) => w.model?.shape === 'corniche' && w.model?.mur);
    const accroches = [
      ...(coque.windows ?? []).map((o) => ({ quoi: `baie ${o.wall}`, ...o })),
      ...(s.vistas ?? []).map((v) => ({ quoi: `apparition ${v.room}`, ...v }))
    ];
    for (const b of bandeaux) {
      const mur = b.model.mur;
      const length = longueurDe(mur);
      // en mode fluide et à ciel ouvert, le bandeau descend avec la crête
      const creux = decouvert ? loiCouronne({ length, height: h }) : () => 0;
      const ep = (Number(b.model.epaisseur) || 0.12) * (b.scale?.[1] ?? 1);
      for (const a of accroches) {
        if ((a.wall ?? 'nord') !== mur) continue;
        const x = a.offset ?? 0;
        const yBandeau = (b.position?.[1] ?? h) - creux(x);
        const haut = (a.sill ?? 1.1) + (a.height ?? 1.8);
        rapport.push({
          salle: s.id, corniche: b.id, quoi: a.quoi, offset: x,
          bandeau: +(yBandeau - ep / 2).toFixed(2), haut: +haut.toFixed(2),
          degagement: +(yBandeau - ep / 2 - haut).toFixed(2),
          libre: yBandeau - ep / 2 - haut >= GARDE_CORNICHE
        });
      }
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
  console.log(`\nLES LIGNES DE FORCE (≥ ${CHARTE.passageLigne} m de passage)\n`);
  for (const l of auditLignes()) {
    if (l.franche && !l.objet) continue;      // rien à dire d'un axe vide
    console.log(`  ${l.salle.padEnd(13)} ${l.ligne.padEnd(26)}`
      + ` ${l.longueur.toFixed(0).padStart(3)} m  `
      + (l.objet ? `${l.objet.padEnd(20)} passage ${l.passage.toFixed(2)} m  ` : '')
      + (l.franche ? '✓' : '✗'));
  }
  const serrees = auditLignes().filter((l) => !l.franche);
  console.log(`\n  ${serrees.length} ligne(s) serrée(s)`);

  const cour = auditCouronnement();
  if (cour.length) {
    console.log(`\nLE COURONNEMENT (≥ ${GARDE_COURONNE} m sous la crête)\n`);
    for (const c of cour) {
      console.log(`  ${c.salle.padEnd(13)} ${c.quoi.padEnd(24)} ${c.mur.padEnd(6)}`
        + ` x=${String(c.offset).padStart(5)}  haut ${c.haut} m`
        + `  crête ${c.sommet} m  dégagement ${c.degagement} m  ${c.sous ? '✓' : '✗'}`);
    }
  }

  const seuils = auditSeuils();
  console.log(`\nLES SEUILS (≥ ${AIR_SEUIL} m d’air autour de l’axe d’un portail)\n`);
  if (!seuils.length) console.log('  aucun portail encombré ✓');
  for (const f of seuils) {
    console.log(`  ${f.salle.padEnd(13)} → ${f.portail.padEnd(13)}`
      + ` ${f.objet.padEnd(20)} air ${f.air.toFixed(2)} m  ✗`);
  }

  const corn = auditCorniches();
  const coupees = corn.filter((c) => !c.libre);
  console.log(`\nLES CORNICHES (≥ ${GARDE_CORNICHE} m au-dessus d’une baie)\n`);
  if (!coupees.length) console.log(`  ${corn.length} croisements, aucun traversé ✓`);
  for (const c of coupees) {
    console.log(`  ${c.salle.padEnd(13)} ${c.corniche.padEnd(24)} ${c.quoi.padEnd(24)}`
      + ` x=${String(c.offset).padStart(5)}  bandeau ${c.bandeau} m`
      + `  sommet ${c.haut} m  dégagement ${c.degagement} m  ✗`);
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

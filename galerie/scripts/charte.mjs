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

/** Salles à ciel ouvert : leur lumière est le ciel, pas une salle. */
export const EXTERIEURS = new Set(['jardin', 'allee', 'annexe']);

export const CHARTE = {
  ecartMurSol: { vise: 8, tolerance: 6 },   // L* : le mur au-dessus du sol
  saturationMax: 45,                        // %
  ecartTeinteMax: 15,                       // degrés
  lumiere: { intensite: 2.4, marge: 0.4, elevation: 55, margeElevation: 12 },
  accrochage: { centre: 1.5, basMinimum: 0.9 }
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
    }
    const k = s.keyLight ?? {};
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
    const accent = (w) => w.lightIntensity ?? 4;
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
  const rythme = auditRythme();
  console.log('\nLE RYTHME (compression → dilatation, par passage)\n');
  for (const p of rythme.passages.sort((a, b) => b.rapport - a.rapport)) {
    console.log(`  ${(p.de + ' ↔ ' + p.vers).padEnd(28)} ×${p.rapport.toFixed(1)}`);
  }
  console.log(`\n  plus grand geste ×${rythme.plusGrand.toFixed(1)}`
    + `   respiration moyenne ×${rythme.moyen.toFixed(2)}`);
  console.log();
}

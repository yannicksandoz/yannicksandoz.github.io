/**
 * UN LECTEUR TRUETYPE, juste assez grand pour le lettrage.
 *
 * Lit le `.woff` d'Inter livré avec la galerie et en tire ce que l'algorithme
 * Slug consomme : les CONTOURS QUADRATIQUES de chaque glyphe (la table
 * `glyf` de TrueType est déjà en Béziers quadratiques — c'est ce qui rend le
 * couple TrueType/Slug si naturel), les avances (`hmtx`), le crénage
 * (`GPOS`, type 2) et les métriques verticales (`hhea`, `OS/2`).
 *
 * Outil de GÉNÉRATION, jamais embarqué : il tourne au nœud, dans
 * `genere-lettrage.mjs` et dans les tests. Le navigateur ne reçoit que les
 * courbes déjà extraites (`engine/src/core/lettrage-inter.js`).
 *
 * On ne lit QUE ce dont on a besoin, et l'on échoue BRUYAMMENT sur ce qu'on
 * ne comprend pas : une police silencieusement mal lue ferait des lettres
 * silencieusement fausses sur toutes les portes.
 */
import { inflateSync } from 'node:zlib';

/* ------------------------------------------------------------- le woff -- */

/** Déballe un `.woff` : rend `{ tables: Map<tag, Buffer>, flavor }`. */
export function ouvrirWoff(buf) {
  if (buf.toString('latin1', 0, 4) !== 'wOFF') {
    throw new Error('pas un fichier woff');
  }
  const flavor = buf.readUInt32BE(4);
  const n = buf.readUInt16BE(12);
  const tables = new Map();
  for (let i = 0; i < n; i++) {
    const e = 44 + (i * 20);
    const tag = buf.toString('latin1', e, e + 4);
    const offset = buf.readUInt32BE(e + 4);
    const compLength = buf.readUInt32BE(e + 8);
    const origLength = buf.readUInt32BE(e + 12);
    const brut = buf.subarray(offset, offset + compLength);
    tables.set(tag, compLength < origLength ? inflateSync(brut) : Buffer.from(brut));
  }
  return { tables, flavor };
}

/* ------------------------------------------------- les petites tables -- */

export function lireHead(t) {
  const b = t.get('head');
  return {
    unitesParEm: b.readUInt16BE(18),
    formatLoca: b.readInt16BE(50)      // 0 : uint16×2 ; 1 : uint32
  };
}

export function lireHhea(t) {
  const b = t.get('hhea');
  return {
    ascendant: b.readInt16BE(4),
    descendant: b.readInt16BE(6),      // négatif chez Inter
    interligne: b.readInt16BE(8),
    nbMetriques: b.readUInt16BE(34)
  };
}

export function lireOS2(t) {
  const b = t.get('OS/2');
  // sCapHeight n'existe qu'à partir de la version 2 de la table
  return { hauteurCapitales: b.length >= 90 ? b.readInt16BE(88) : 0 };
}

/** char (code point) → identifiant de glyphe, via cmap format 4. */
export function lireCmap(t) {
  const b = t.get('cmap');
  const nb = b.readUInt16BE(2);
  let sous = -1;
  for (let i = 0; i < nb; i++) {
    const o = b.readUInt32BE(4 + (i * 8) + 4);
    if (b.readUInt16BE(o) === 4) { sous = o; break; }
  }
  if (sous < 0) throw new Error('aucun sous-tableau cmap au format 4');
  const segX2 = b.readUInt16BE(sous + 6);
  const seg = segX2 / 2;
  const fins = sous + 14;
  const debuts = fins + segX2 + 2;
  const deltas = debuts + segX2;
  const decalages = deltas + segX2;
  return (codePoint) => {
    for (let s = 0; s < seg; s++) {
      const fin = b.readUInt16BE(fins + (s * 2));
      if (codePoint > fin) continue;
      const debut = b.readUInt16BE(debuts + (s * 2));
      if (codePoint < debut) return 0;
      const delta = b.readInt16BE(deltas + (s * 2));
      const dec = b.readUInt16BE(decalages + (s * 2));
      if (dec === 0) return (codePoint + delta) & 0xffff;
      const p = decalages + (s * 2) + dec + ((codePoint - debut) * 2);
      if (p + 1 >= b.length) return 0;
      const g = b.readUInt16BE(p);
      return g === 0 ? 0 : (g + delta) & 0xffff;
    }
    return 0;
  };
}

export function lireHmtx(t, nbMetriques) {
  const b = t.get('hmtx');
  return (glyphe) => {
    const i = Math.min(glyphe, nbMetriques - 1);
    return b.readUInt16BE(i * 4);
  };
}

/* --------------------------------------------------------------- glyf -- */

function lireLoca(t, formatLoca) {
  const b = t.get('loca');
  return (glyphe) => (formatLoca === 0
    ? [b.readUInt16BE(glyphe * 2) * 2, b.readUInt16BE((glyphe + 1) * 2) * 2]
    : [b.readUInt32BE(glyphe * 4), b.readUInt32BE((glyphe + 1) * 4)]);
}

/**
 * Les points d'un glyphe SIMPLE : contours de `{ x, y, sur }` — `sur` dit si
 * le point est SUR la courbe (extrémité) ou hors d'elle (point de contrôle).
 */
function lireGlypheSimple(b, o, nbContours) {
  const fins = [];
  for (let i = 0; i < nbContours; i++) fins.push(b.readUInt16BE(o + 10 + (i * 2)));
  const nbPoints = fins[nbContours - 1] + 1;
  let p = o + 10 + (nbContours * 2);
  p += 2 + b.readUInt16BE(p);          // les instructions de hinting, sautées

  // les drapeaux, avec leur compression par répétition
  const drapeaux = [];
  while (drapeaux.length < nbPoints) {
    const f = b.readUInt8(p++);
    drapeaux.push(f);
    if (f & 0x08) {                    // REPEAT
      let n = b.readUInt8(p++);
      while (n-- > 0) drapeaux.push(f);
    }
  }

  // les x, en deltas ; puis les y
  const xs = new Array(nbPoints);
  let x = 0;
  for (let i = 0; i < nbPoints; i++) {
    const f = drapeaux[i];
    if (f & 0x02) {                    // X_SHORT : un octet, signe au bit 4
      const d = b.readUInt8(p++);
      x += (f & 0x10) ? d : -d;
    } else if (!(f & 0x10)) {          // ni court ni « pareil » : int16
      x += b.readInt16BE(p); p += 2;
    }
    xs[i] = x;
  }
  const ys = new Array(nbPoints);
  let y = 0;
  for (let i = 0; i < nbPoints; i++) {
    const f = drapeaux[i];
    if (f & 0x04) {
      const d = b.readUInt8(p++);
      y += (f & 0x20) ? d : -d;
    } else if (!(f & 0x20)) {
      y += b.readInt16BE(p); p += 2;
    }
    ys[i] = y;
  }

  const contours = [];
  let debut = 0;
  for (const fin of fins) {
    const c = [];
    for (let i = debut; i <= fin; i++) {
      c.push({ x: xs[i], y: ys[i], sur: (drapeaux[i] & 0x01) !== 0 });
    }
    contours.push(c);
    debut = fin + 1;
  }
  return contours;
}

/**
 * Les contours d'un glyphe, COMPOSITES RÉSOLUS — les accentuées d'Inter
 * (É, à, ç…) sont des assemblages « lettre + accent », chacun placé par une
 * translation et parfois une échelle. On applique la transformation et l'on
 * rend des contours plats : l'algorithme n'a pas à savoir d'où ils viennent.
 */
export function lireContours(t, formatLoca, glyphe, profondeur = 0) {
  if (profondeur > 5) throw new Error('composite trop profond');
  const loca = lireLoca(t, formatLoca);
  const [debut, fin] = loca(glyphe);
  if (debut === fin) return [];        // l'espace : aucun contour
  const b = t.get('glyf');
  const nbContours = b.readInt16BE(debut);
  if (nbContours >= 0) return lireGlypheSimple(b, debut, nbContours);

  // composite : une suite de composants transformés
  const contours = [];
  let p = debut + 10;
  for (;;) {
    const drapeaux = b.readUInt16BE(p);
    const composant = b.readUInt16BE(p + 2);
    p += 4;
    let dx, dy;
    if (drapeaux & 0x0001) {           // ARG_1_AND_2_ARE_WORDS
      dx = b.readInt16BE(p); dy = b.readInt16BE(p + 2); p += 4;
    } else {
      dx = b.readInt8(p); dy = b.readInt8(p + 1); p += 2;
    }
    if (!(drapeaux & 0x0002)) {
      // des numéros de POINTS et non des décalages : Inter n'en a pas, et
      // les gérer sans les éprouver serait pire que d'échouer franchement
      throw new Error(`composant à appariement de points (glyphe ${glyphe})`);
    }
    let a = 1, bxy = 0, cyx = 0, d = 1;
    const f2 = (v) => v / 16384;       // F2Dot14
    if (drapeaux & 0x0008) {           // WE_HAVE_A_SCALE
      a = d = f2(b.readInt16BE(p)); p += 2;
    } else if (drapeaux & 0x0040) {    // X_AND_Y_SCALE
      a = f2(b.readInt16BE(p)); d = f2(b.readInt16BE(p + 2)); p += 4;
    } else if (drapeaux & 0x0080) {    // TWO_BY_TWO
      a = f2(b.readInt16BE(p)); bxy = f2(b.readInt16BE(p + 2));
      cyx = f2(b.readInt16BE(p + 4)); d = f2(b.readInt16BE(p + 6)); p += 8;
    }
    for (const c of lireContours(t, formatLoca, composant, profondeur + 1)) {
      contours.push(c.map((pt) => ({
        x: (a * pt.x) + (cyx * pt.y) + dx,
        y: (bxy * pt.x) + (d * pt.y) + dy,
        sur: pt.sur
      })));
    }
    if (!(drapeaux & 0x0020)) break;   // MORE_COMPONENTS
  }
  return contours;
}

/* --------------------------------------------------------------- GPOS -- */

function lireCouverture(b, o) {
  const format = b.readUInt16BE(o);
  const map = new Map();               // glyphe → index de couverture
  if (format === 1) {
    const n = b.readUInt16BE(o + 2);
    for (let i = 0; i < n; i++) map.set(b.readUInt16BE(o + 4 + (i * 2)), i);
  } else if (format === 2) {
    const n = b.readUInt16BE(o + 2);
    for (let i = 0; i < n; i++) {
      const debut = b.readUInt16BE(o + 4 + (i * 6));
      const fin = b.readUInt16BE(o + 6 + (i * 6));
      const premier = b.readUInt16BE(o + 8 + (i * 6));
      for (let g = debut; g <= fin; g++) map.set(g, premier + (g - debut));
    }
  } else {
    throw new Error(`couverture au format ${format}`);
  }
  return map;
}

function lireClasses(b, o) {
  const format = b.readUInt16BE(o);
  const map = new Map();               // glyphe → classe (absent = 0)
  if (format === 1) {
    const debut = b.readUInt16BE(o + 2);
    const n = b.readUInt16BE(o + 4);
    for (let i = 0; i < n; i++) map.set(debut + i, b.readUInt16BE(o + 6 + (i * 2)));
  } else if (format === 2) {
    const n = b.readUInt16BE(o + 2);
    for (let i = 0; i < n; i++) {
      const d = b.readUInt16BE(o + 4 + (i * 6));
      const f = b.readUInt16BE(o + 6 + (i * 6));
      const c = b.readUInt16BE(o + 8 + (i * 6));
      for (let g = d; g <= f; g++) map.set(g, c);
    }
  } else {
    throw new Error(`classes au format ${format}`);
  }
  return map;
}

/** Taille d'un ValueRecord : deux octets par bit posé dans le format. */
function tailleValeur(format) {
  let n = 0;
  for (let f = format; f; f >>= 1) n += f & 1;
  return n * 2;
}

/** L'avance horizontale (XAdvance) d'un ValueRecord, si le format la porte. */
function lireXAdvance(b, o, format) {
  if (!(format & 0x0004)) return 0;
  // XPlacement (0x1) et YPlacement (0x2) précèdent XAdvance dans l'ordre
  let saut = 0;
  if (format & 0x0001) saut += 2;
  if (format & 0x0002) saut += 2;
  return b.readInt16BE(o + saut);
}

/**
 * Le crénage de la fonte : `(glypheGauche, glypheDroit) → ajustement` en
 * unités de fonte, lu dans les lookups GPOS de type 2 (PairPos) que le
 * feature `kern` référence. Les autres types (ancrages de diacritiques…) ne
 * concernent pas des étiquettes latines et sont ignorés sans bruit.
 */
export function lireCrenage(t) {
  const b = t.get('GPOS');
  if (!b) return () => 0;
  const listeFeatures = b.readUInt16BE(6);
  const listeLookups = b.readUInt16BE(8);

  // les indices de lookup du feature « kern », tous scripts confondus
  const indices = new Set();
  const nbFeatures = b.readUInt16BE(listeFeatures);
  for (let i = 0; i < nbFeatures; i++) {
    const e = listeFeatures + 2 + (i * 6);
    if (b.toString('latin1', e, e + 4) !== 'kern') continue;
    const table = listeFeatures + b.readUInt16BE(e + 4);
    const n = b.readUInt16BE(table + 2);
    for (let k = 0; k < n; k++) indices.add(b.readUInt16BE(table + 4 + (k * 2)));
  }

  // chaque lookup retenu, sous-table par sous-table
  const paires = new Map();            // 'g1,g2' → unités
  const classes = [];                  // { couverture, c1, c2, matrice }
  const nbLookups = b.readUInt16BE(listeLookups);
  for (const idx of indices) {
    if (idx >= nbLookups) continue;
    const lookup = listeLookups + b.readUInt16BE(listeLookups + 2 + (idx * 2));
    let type = b.readUInt16BE(lookup);
    const nbSous = b.readUInt16BE(lookup + 4);
    for (let s = 0; s < nbSous; s++) {
      let sous = lookup + b.readUInt16BE(lookup + 6 + (s * 2));
      if (type === 9) {                // extension : un pointeur 32 bits
        const vrai = b.readUInt16BE(sous + 2);
        sous = sous + b.readUInt32BE(sous + 4);
        if (vrai !== 2) continue;
      } else if (type !== 2) {
        continue;
      }
      const format = b.readUInt16BE(sous);
      const couverture = lireCouverture(b, sous + b.readUInt16BE(sous + 2));
      const vf1 = b.readUInt16BE(sous + 4);
      const vf2 = b.readUInt16BE(sous + 6);
      const t1 = tailleValeur(vf1), t2 = tailleValeur(vf2);
      if (format === 1) {
        const nbJeux = b.readUInt16BE(sous + 8);
        for (const [g1, iCouv] of couverture) {
          if (iCouv >= nbJeux) continue;
          const jeu = sous + b.readUInt16BE(sous + 10 + (iCouv * 2));
          const nb = b.readUInt16BE(jeu);
          for (let k = 0; k < nb; k++) {
            const e = jeu + 2 + (k * (2 + t1 + t2));
            const g2 = b.readUInt16BE(e);
            const cle = `${g1},${g2}`;
            if (!paires.has(cle)) paires.set(cle, lireXAdvance(b, e + 2, vf1));
          }
        }
      } else if (format === 2) {
        classes.push({
          couverture,
          c1: lireClasses(b, sous + b.readUInt16BE(sous + 8)),
          c2: lireClasses(b, sous + b.readUInt16BE(sous + 10)),
          nb2: b.readUInt16BE(sous + 14),
          base: sous + 16, t1, t2, vf1, b
        });
      }
    }
  }

  return (g1, g2) => {
    const direct = paires.get(`${g1},${g2}`);
    if (direct !== undefined) return direct;
    for (const c of classes) {
      if (!c.couverture.has(g1)) continue;
      const k1 = c.c1.get(g1) ?? 0;
      const k2 = c.c2.get(g2) ?? 0;
      const e = c.base + (((k1 * c.nb2) + k2) * (c.t1 + c.t2));
      const v = lireXAdvance(c.b, e, c.vf1);
      if (v !== 0) return v;
    }
    return 0;
  };
}

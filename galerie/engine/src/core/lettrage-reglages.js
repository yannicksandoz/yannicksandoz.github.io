/**
 * LE LETTRAGE — tout ce qui se décide, et rien de ce qui se dessine.
 *
 * D'après l'algorithme **Slug** d'Eric Lengyel : « GPU-Centered Font
 * Rendering Directly from Glyph Outlines », Journal of Computer Graphics
 * Techniques vol. 6 n° 2, 2017 (https://jcgt.org/published/0006/02/02/), et
 * les shaders de référence publiés par l'auteur
 * (https://github.com/EricLengyel/Slug, licence MIT OU Apache-2.0, brevet
 * versé au domaine public — le crédit est obligatoire, et il est ici :
 * Slug shader code Copyright 2017 by Eric Lengyel).
 *
 * Ce module tient QUATRE décisions, toutes éprouvables au nœud :
 *
 *   1. des points TrueType aux COURBES quadratiques (les points « hors
 *      courbe » consécutifs cachent un point implicite à mi-chemin) ;
 *   2. les BANDES : pour chaque glyphe, quelles courbes un rayon horizontal
 *      ou vertical peut rencontrer selon la tranche où il part — c'est le
 *      cœur de Slug, ce qui borne le travail du pixel ;
 *   3. l'EMBALLAGE : les mêmes octets que liront les deux textures du
 *      shader, à l'adresse près ;
 *   4. la MISE EN PAGE : où poser chaque glyphe d'un texte, crénage compris.
 *
 * Et une RÉFÉRENCE CPU du calcul de couverture, transcription ligne à ligne
 * du pixel shader de Lengyel : les tests comparent son intégrale à l'aire
 * géométrique des contours, et le navigateur comparera ses valeurs aux
 * pixels du GPU. Quand deux implémentations indépendantes et un théorème
 * tombent d'accord, on peut poser des lettres sur les portes.
 */

/* ----------------------------------------------- 1 · points → courbes -- */

/**
 * Un contour TrueType (`{x, y, sur}`) → des Béziers quadratiques
 * `[x1, y1, x2, y2, x3, y3]`, extrémités SUR la courbe aux deux bouts.
 *
 * Deux subtilités, toutes deux du format :
 *   • deux points hors courbe qui se suivent impliquent une extrémité à
 *     mi-chemin entre eux — c'est ainsi que TrueType enchaîne les arcs ;
 *   • un segment DROIT s'écrit `{p1, p2, p2}` — le point de contrôle
 *     confondu avec la seconde extrémité, comme le recommande Lengyel
 *     (un contrôle au milieu rendrait la solution du polynôme instable).
 */
export function contourEnCourbes(points) {
  if (!points || points.length < 2) return [];
  // on insère les extrémités implicites entre deux contrôles consécutifs
  const plat = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const s = points[(i + 1) % points.length];
    plat.push(p);
    if (!p.sur && !s.sur) {
      plat.push({ x: (p.x + s.x) / 2, y: (p.y + s.y) / 2, sur: true });
    }
  }
  // on tourne la liste pour commencer sur une extrémité
  const premier = plat.findIndex((p) => p.sur);
  if (premier < 0) return [];          // un contour sans extrémité : dégénéré
  const liste = [...plat.slice(premier), ...plat.slice(0, premier)];
  liste.push(liste[0]);                // referme le contour

  const courbes = [];
  for (let i = 0; i < liste.length - 1;) {
    const a = liste[i];
    const b = liste[i + 1];
    if (b.sur) {
      if (a.x !== b.x || a.y !== b.y) {
        courbes.push([a.x, a.y, b.x, b.y, b.x, b.y]);
      }
      i += 1;
    } else {
      const c = liste[i + 2];
      courbes.push([a.x, a.y, b.x, b.y, c.x, c.y]);
      i += 2;
    }
  }
  return courbes;
}

/* ------------------------------------------------------- 2 · les bandes -- */

/** L'epsilon de recouvrement des bandes : 1/1024 d'em, celui de Lengyel. */
export const EPSILON_BANDE = 1 / 1024;

/**
 * Découpe les courbes d'un glyphe en bandes horizontales et verticales.
 *
 * Rend `{ h, v, boite, nH, nV }` où `h[i]` est la liste des INDICES de
 * courbes que peut rencontrer un rayon horizontal parti de la tranche i, et
 * `v[j]` la même chose pour un rayon vertical.
 *
 * Trois règles, toutes de la référence :
 *   • un segment horizontal ne va jamais dans une bande horizontale (un
 *     rayon parallèle ne le croise pas), et de même pour les verticaux ;
 *   • les bandes se recouvrent d'un epsilon, pour qu'une extrémité posée
 *     pile sur une frontière ne tombe pas entre deux chaises ;
 *   • dans chaque bande horizontale les courbes se trient par x maximal
 *     DÉCROISSANT (le shader s'arrête dès qu'une courbe est toute à gauche
 *     du pixel), et par y maximal décroissant dans les verticales.
 */
export function construireBandes(courbes, nH, nV) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of courbes) {
    x0 = Math.min(x0, c[0], c[2], c[4]); x1 = Math.max(x1, c[0], c[2], c[4]);
    y0 = Math.min(y0, c[1], c[3], c[5]); y1 = Math.max(y1, c[1], c[3], c[5]);
  }
  if (!courbes.length) { x0 = y0 = 0; x1 = y1 = 1; }
  const maxX = (c) => Math.max(c[0], c[2], c[4]);
  const maxY = (c) => Math.max(c[1], c[3], c[5]);
  const minX = (c) => Math.min(c[0], c[2], c[4]);
  const minY = (c) => Math.min(c[1], c[3], c[5]);

  const h = [];
  const pasY = (y1 - y0) / nH || 1;
  for (let i = 0; i < nH; i++) {
    const bas = y0 + (i * pasY) - EPSILON_BANDE;
    const haut = y0 + ((i + 1) * pasY) + EPSILON_BANDE;
    const dans = [];
    for (let k = 0; k < courbes.length; k++) {
      const c = courbes[k];
      if (c[1] === c[3] && c[3] === c[5]) continue;   // segment horizontal
      if (maxY(c) < bas || minY(c) > haut) continue;
      dans.push(k);
    }
    dans.sort((a, b) => maxX(courbes[b]) - maxX(courbes[a]));
    h.push(dans);
  }
  const v = [];
  const pasX = (x1 - x0) / nV || 1;
  for (let j = 0; j < nV; j++) {
    const gauche = x0 + (j * pasX) - EPSILON_BANDE;
    const droite = x0 + ((j + 1) * pasX) + EPSILON_BANDE;
    const dans = [];
    for (let k = 0; k < courbes.length; k++) {
      const c = courbes[k];
      if (c[0] === c[2] && c[2] === c[4]) continue;   // segment vertical
      if (maxX(c) < gauche || minX(c) > droite) continue;
      dans.push(k);
    }
    dans.sort((a, b) => maxY(courbes[b]) - maxY(courbes[a]));
    v.push(dans);
  }
  return { h, v, boite: [x0, y0, x1, y1], nH, nV };
}

/** Combien de bandes pour un glyphe : ≈ racine du nombre de courbes. */
export function nombreDeBandes(nbCourbes) {
  return Math.max(1, Math.min(8, Math.round(Math.sqrt(nbCourbes || 1))));
}

/* ---------------------------------------------------- 3 · l'emballage -- */

/** La largeur des deux textures — celle de la référence : 4096 texels. */
export const LARGEUR_TEXTURE = 4096;

/**
 * Emballe un jeu de glyphes dans les deux textures du shader.
 *
 * `glyphes` : Map<clé, { courbes }>. Rend :
 *   • `courbesTexels`  — Float32Array, 4 canaux : chaque courbe occupe DEUX
 *     texels, [x1 y1 x2 y2] puis [x3 y3 0 0]. Une courbe ne chevauche
 *     JAMAIS une fin de ligne : le shader lit « le texel d'à côté » sans
 *     replier, donc on saute un texel plutôt que de couper une courbe ;
 *   • `bandesTexels`   — Uint16Array, 2 canaux. Par glyphe, à `loc` : les
 *     en-têtes des bandes horizontales (nombre, décalage) puis verticales,
 *     puis les listes — chaque entrée est l'ADRESSE (x, y) du premier texel
 *     d'une courbe dans la texture des courbes. Les décalages se replient
 *     en fin de ligne, comme le CalcBandLoc du shader ;
 *   • `infos`          — par clé : { loc: [x,y], bandesMax: [nV-1, nH-1],
 *     transformation: [sx, sy, ox, oy], boite }.
 */
export function emballerGlyphes(glyphes) {
  const courbes = [];                  // texels RGBA, à plat
  const bandes = [];                   // texels RG, à plat
  const infos = new Map();

  const posCourbe = () => courbes.length / 4;
  const ecrireCourbe = (c) => {
    // jamais à cheval sur une fin de ligne (lecture « x+1 » sans repli)
    if ((posCourbe() % LARGEUR_TEXTURE) === LARGEUR_TEXTURE - 1) {
      courbes.push(0, 0, 0, 0);
    }
    const p = posCourbe();
    courbes.push(c[0], c[1], c[2], c[3]);
    courbes.push(c[4], c[5], 0, 0);
    return [p % LARGEUR_TEXTURE, Math.floor(p / LARGEUR_TEXTURE)];
  };

  for (const [cle, g] of glyphes) {
    const nb = nombreDeBandes(g.courbes.length);
    const { h, v, boite } = construireBandes(g.courbes, nb, nb);

    // les courbes de CE glyphe, d'abord, pour connaître leurs adresses
    const adresses = g.courbes.map(ecrireCourbe);

    // puis le bloc de bandes : en-têtes (h puis v), puis les listes.
    // LES EN-TÊTES NE SE REPLIENT PAS : le shader les lit à
    // « glyphLoc.x + indice » sans passer par CalcBandLoc — seules les
    // LISTES se replient. Un bloc d'en-têtes à cheval sur une fin de ligne
    // ferait donc lire n'importe quoi ; on saute à la ligne suivante avant.
    const nbEntetes = h.length + v.length;
    while (((bandes.length / 2) % LARGEUR_TEXTURE) + nbEntetes > LARGEUR_TEXTURE) {
      bandes.push(0, 0);
    }
    const loc = bandes.length / 2;
    const listes = [...h, ...v];
    const decalages = [];
    let curseur = nbEntetes;
    for (const liste of listes) {
      decalages.push(curseur);
      curseur += liste.length;
    }
    for (let i = 0; i < listes.length; i++) {
      bandes.push(listes[i].length, decalages[i]);
    }
    for (const liste of listes) {
      for (const k of liste) bandes.push(adresses[k][0], adresses[k][1]);
    }

    const [x0, y0, x1, y1] = boite;
    infos.set(cle, {
      loc: [loc % LARGEUR_TEXTURE, Math.floor(loc / LARGEUR_TEXTURE)],
      bandesMax: [v.length - 1, h.length - 1],
      transformation: [
        v.length / Math.max(x1 - x0, 1e-6), h.length / Math.max(y1 - y0, 1e-6),
        -x0 * (v.length / Math.max(x1 - x0, 1e-6)),
        -y0 * (h.length / Math.max(y1 - y0, 1e-6))
      ],
      boite
    });
  }

  // On rend les tableaux SANS le remplissage de fin de ligne : c'est celui
  // qui les recevra (le générateur, puis le navigateur) qui les posera dans
  // des textures aux lignes pleines. Sérialiser des milliers de zéros de
  // bourrage doublait le poids du fichier généré, pour rien.
  const lignesC = Math.max(1, Math.ceil(courbes.length / 4 / LARGEUR_TEXTURE));
  const lignesB = Math.max(1, Math.ceil(bandes.length / 2 / LARGEUR_TEXTURE));
  return { courbes, bandes, lignesC, lignesB, infos };
}

/* --------------------------------------- la référence CPU du shader -- */

/**
 * Le code d'éligibilité des racines — transcription du CalcRootCode de
 * Lengyel. Trois signes (les y des trois points de contrôle) forment un
 * index de trois bits dans la table 0x2E74, qui dit lesquelles des deux
 * racines comptent dans le nombre d'enroulement. C'est CETTE table qui
 * remplace les huit cas d'équation du papier, et c'est elle qui rend
 * l'algorithme insensible aux extrémités posées pile sur le rayon.
 */
export function codeRacines(y1, y2, y3) {
  const i1 = (y1 < 0 || Object.is(y1, -0)) ? 1 : 0;
  const i2 = ((y2 < 0 || Object.is(y2, -0)) ? 1 : 0) << 1;
  const i3 = ((y3 < 0 || Object.is(y3, -0)) ? 1 : 0) << 2;
  const decal = i3 | i2 | i1;
  return (0x2E74 >> decal) & 0x0101;
}

/** Les x où la courbe (relative à l'échantillon) croise y = 0. */
export function racinesHorizontales(c) {
  const [x1, y1, x2, y2, x3, y3] = c;
  const ay = y1 - (2 * y2) + y3;
  const by = y1 - y2;
  const ax = x1 - (2 * x2) + x3;
  const bx = x1 - x2;
  const d = Math.sqrt(Math.max((by * by) - (ay * y1), 0));
  let t1 = (by - d) / ay;
  let t2 = (by + d) / ay;
  if (Math.abs(ay) < 1 / 65536) { t1 = t2 = y1 / (2 * by); }
  return [
    (((ax * t1) - (bx * 2)) * t1) + x1,
    (((ax * t2) - (bx * 2)) * t2) + x1
  ];
}

const borner01 = (v) => Math.min(1, Math.max(0, v));

/**
 * La couverture d'un échantillon, les deux axes combinés — le SlugRender du
 * pixel shader, au CPU. `echelle` : pixels par em (les deux axes).
 *
 * Sert d'oracle : le navigateur comparera les pixels du GPU à cette
 * fonction, et les tests du nœud comparent son intégrale à l'aire des
 * contours. Elle n'utilise PAS les bandes — elle parcourt tout : c'est sa
 * lenteur qui fait son indépendance.
 */
export function couvertureCPU(courbes, sx, sy, px, py) {
  let xcov = 0, xwgt = 0, ycov = 0, ywgt = 0;
  for (const c of courbes) {
    const rel = [c[0] - sx, c[1] - sy, c[2] - sx, c[3] - sy, c[4] - sx, c[5] - sy];
    // le rayon horizontal
    let code = codeRacines(rel[1], rel[3], rel[5]);
    if (code !== 0) {
      const r = racinesHorizontales(rel).map((x) => x * px);
      if (code & 1) {
        xcov += borner01(r[0] + 0.5);
        xwgt = Math.max(xwgt, borner01(1 - (Math.abs(r[0]) * 2)));
      }
      if (code > 1) {
        xcov -= borner01(r[1] + 0.5);
        xwgt = Math.max(xwgt, borner01(1 - (Math.abs(r[1]) * 2)));
      }
    }
    // le rayon vertical : les axes échangés
    const relV = [rel[1], rel[0], rel[3], rel[2], rel[5], rel[4]];
    code = codeRacines(relV[1], relV[3], relV[5]);
    if (code !== 0) {
      const r = racinesHorizontales(relV).map((y) => y * py);
      if (code & 1) {
        ycov -= borner01(r[0] + 0.5);
        ywgt = Math.max(ywgt, borner01(1 - (Math.abs(r[0]) * 2)));
      }
      if (code > 1) {
        ycov += borner01(r[1] + 0.5);
        ywgt = Math.max(ywgt, borner01(1 - (Math.abs(r[1]) * 2)));
      }
    }
  }
  const c = Math.max(
    Math.abs((xcov * xwgt) + (ycov * ywgt)) / Math.max(xwgt + ywgt, 1 / 65536),
    Math.min(Math.abs(xcov), Math.abs(ycov))
  );
  return borner01(c);
}

/* -------------------------------------------------- 4 · mise en page -- */

/**
 * Pose un texte : rend la liste des glyphes placés, `{ cle, x, y }` en em,
 * l'origine au POINT D'ANCRAGE demandé.
 *
 * `mesures` : { avance: (clé) → em, crenage: (clé1, clé2) → em,
 *              ascendant, descendant } — tout en em.
 * Retours à la ligne sur `\n`, repli doux sur les espaces quand une ligne
 * dépasse `largeurMax`, lignes centrées entre elles (`textAlign: center`,
 * le seul usage de la galerie).
 */
export function poserTexte(texte, mesures, {
  interligne = 1.25, largeurMax = Infinity,
  ancrageX = 'center', ancrageY = 'middle'
} = {}) {
  const lignes = [];
  for (const brute of String(texte ?? '').split('\n')) {
    // repli doux : on coupe aux espaces, jamais dans un mot
    const mots = brute.split(' ');
    let courante = '';
    const largeur = (s) => {
      let l = 0;
      const cs = [...s];
      for (let i = 0; i < cs.length; i++) {
        l += mesures.avance(cs[i]);
        if (i + 1 < cs.length) l += mesures.crenage(cs[i], cs[i + 1]);
      }
      return l;
    };
    for (const mot of mots) {
      const essai = courante ? `${courante} ${mot}` : mot;
      if (courante && largeur(essai) > largeurMax) {
        lignes.push(courante);
        courante = mot;
      } else {
        courante = essai;
      }
    }
    lignes.push(courante);
  }

  const largeurs = lignes.map((l) => {
    let x = 0;
    const cs = [...l];
    for (let i = 0; i < cs.length; i++) {
      x += mesures.avance(cs[i]);
      if (i + 1 < cs.length) x += mesures.crenage(cs[i], cs[i + 1]);
    }
    return x;
  });
  const plusLarge = Math.max(0, ...largeurs);

  // la hauteur du bloc : de l'ascendant de la première ligne au descendant
  // de la dernière (le descendant de la fonte est négatif)
  const hauteur = ((lignes.length - 1) * interligne)
    + mesures.ascendant - mesures.descendant;

  const glyphes = [];
  // ancrage : y = 0 au point demandé, x = 0 au point demandé
  let yBase = ancrageY === 'top' ? -mesures.ascendant
    : ancrageY === 'bottom' ? hauteur + mesures.descendant
      : (hauteur / 2) - mesures.ascendant;    // middle
  for (let li = 0; li < lignes.length; li++) {
    const cs = [...lignes[li]];
    let x = ancrageX === 'left' ? 0
      : ancrageX === 'right' ? -largeurs[li]
        : -largeurs[li] / 2;                  // center
    for (let i = 0; i < cs.length; i++) {
      glyphes.push({ cle: cs[i], x, y: yBase });
      x += mesures.avance(cs[i]);
      if (i + 1 < cs.length) x += mesures.crenage(cs[i], cs[i + 1]);
    }
    yBase -= interligne;
  }
  return { glyphes, lignes: lignes.length, largeur: plusLarge, hauteur };
}

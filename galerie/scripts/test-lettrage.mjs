/**
 * LE LETTRAGE — l'algorithme de Slug éprouvé au nœud, avant tout pixel.
 *
 * Trois oracles indépendants, et c'est leur INDÉPENDANCE qui vaut preuve :
 *
 *   1. L'AIRE. L'intégrale de la couverture sur un glyphe doit égaler
 *      l'aire géométrique de ses contours (théorème de Green, calculée par
 *      un tout autre chemin : l'intégrale de ∮x·dy sur les courbes
 *      aplaties). Si le calcul de couverture se trompait quelque part —
 *      une racine de trop, un signe — l'encre totale ne tomberait pas
 *      juste.
 *
 *   2. LES BANDES. La couverture calculée avec les SEULES courbes de la
 *      bande de l'échantillon doit égaler celle calculée avec toutes. C'est
 *      exactement le pari du shader — et si `construireBandes` oubliait une
 *      courbe, c'est ici que ça se verrait, pas sur une porte au fond de la
 *      galerie.
 *
 *   3. LA TOPOLOGIE. Le centre du trou d'un « O » est blanc, le milieu d'un
 *      « H » est noir, l'extérieur est blanc. Bête, lisible, et le genre de
 *      choses qu'un bogue de signe inverse en silence.
 *
 * Plus l'emballage (aller-retour texels → courbes, règles d'adressage du
 * shader), la mise en page (crénage, centrage, repli) et le DÉTERMINISME du
 * fichier généré — un `lettrage-inter.js` qui divergerait de sa police
 * ferait échouer la chaîne plutôt que d'afficher des lettres d'hier.
 *
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contourEnCourbes, construireBandes, nombreDeBandes, emballerGlyphes,
  codeRacines, couvertureCPU, poserTexte, LARGEUR_TEXTURE, EPSILON_BANDE }
  from '../engine/src/core/lettrage-reglages.js';
import { LETTRAGE } from '../engine/src/core/lettrage-inter.js';
import { genererLettrage } from './genere-lettrage.mjs';
import { GLYPHES_COURANTS } from '../engine/src/core/cartels-reglages.js';

let ok = 0, ko = 0;
const test = (nom, fn) => {
  try { fn(); ok++; console.log(`  ✓ ${nom}`); }
  catch (e) { ko++; console.log(`  ✗ ${nom}\n    ${e.message}`); }
};
const titre = (t) => console.log(`\n${t}`);

/** Les courbes d'un caractère, en EM. */
function courbesDe(c) {
  const g = LETTRAGE.glyphes[c];
  assert.ok(g, `pas de glyphe pour « ${c} »`);
  const plat = LETTRAGE.formes[g.forme];
  const em = [];
  for (let i = 0; i < plat.length; i += 6) {
    em.push(plat.slice(i, i + 6).map((v) => v / LETTRAGE.upm));
  }
  return em;
}

function boiteDe(courbes) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of courbes) {
    x0 = Math.min(x0, c[0], c[2], c[4]); x1 = Math.max(x1, c[0], c[2], c[4]);
    y0 = Math.min(y0, c[1], c[3], c[5]); y1 = Math.max(y1, c[1], c[3], c[5]);
  }
  return [x0, y0, x1, y1];
}

/** L'aire d'encre par Green : ∮ x·dy sur les courbes aplaties. */
function aireEncre(courbes, pas = 64) {
  let somme = 0;
  for (const [x1, y1, x2, y2, x3, y3] of courbes) {
    let px = x1, py = y1;
    for (let i = 1; i <= pas; i++) {
      const t = i / pas;
      const u = 1 - t;
      const x = (u * u * x1) + (2 * t * u * x2) + (t * t * x3);
      const y = (u * u * y1) + (2 * t * u * y2) + (t * t * y3);
      somme += ((px + x) / 2) * (y - py);
      px = x; py = y;
    }
  }
  return Math.abs(somme);
}

/** L'intégrale de la couverture sur une grille — l'encre vue par Slug. */
function aireCouverture(courbes, n = 100) {
  const [x0, y0, x1, y1] = boiteDe(courbes);
  const marge = 0.05;
  const X0 = x0 - marge, Y0 = y0 - marge, X1 = x1 + marge, Y1 = y1 + marge;
  const dx = (X1 - X0) / n, dy = (Y1 - Y0) / n;
  // l'échelle « pixels par em » alignée sur la grille : une cellule = un pixel
  const px = 1 / dx, py = 1 / dy;
  let somme = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      somme += couvertureCPU(courbes,
        X0 + ((i + 0.5) * dx), Y0 + ((j + 0.5) * dy), px, py);
    }
  }
  return somme * dx * dy;
}

/* ------------------------------------------------------- le code table -- */
titre('la table de racines de Lengyel');
test('une traversée descendante compte par la première racine', () => {
  // y passe de + à − : signes (0, 1, 1) → décalage 6
  assert.equal(codeRacines(1, -1, -1), 0x0001);
});
test('…une montante par la seconde', () => {
  assert.equal(codeRacines(-1, 1, 1), 0x0100);
});
test('un segment posé sur le rayon ne compte pas', () => {
  assert.equal(codeRacines(0, 0, 0), 0);
});
test('un arc qui traverse deux fois compte deux fois', () => {
  // ∪ au-dessus du rayon, contrôle en dessous : signes (0, 1, 0) → décalage 2
  const code = codeRacines(1, -1, 1);
  assert.equal(code, 0x0101);
});

/* ------------------------------------------------------- la topologie -- */
titre('la topologie des lettres');
test('le milieu du H est de l’encre', () => {
  const c = courbesDe('H');
  const [x0, y0, x1, y1] = boiteDe(c);
  const v = couvertureCPU(c, (x0 + x1) / 2, (y0 + y1) / 2, 256, 256);
  assert.ok(v > 0.99, `couverture ${v}`);
});
test('le trou du O est blanc, son anneau est noir', () => {
  const c = courbesDe('O');
  const [x0, y0, x1, y1] = boiteDe(c);
  const centre = couvertureCPU(c, (x0 + x1) / 2, (y0 + y1) / 2, 256, 256);
  assert.ok(centre < 0.01, `trou à ${centre}`);
  // l'anneau : à mi-hauteur, tout près du bord gauche intérieur
  const anneau = couvertureCPU(c, x0 + ((x1 - x0) * 0.06), (y0 + y1) / 2, 256, 256);
  assert.ok(anneau > 0.99, `anneau à ${anneau}`);
});
test('l’extérieur est blanc, tout autour', () => {
  const c = courbesDe('g');
  const [x0, y0, x1, y1] = boiteDe(c);
  for (const [sx, sy] of [[x0 - 0.1, (y0 + y1) / 2], [x1 + 0.1, y0],
    [(x0 + x1) / 2, y1 + 0.1], [(x0 + x1) / 2, y0 - 0.1]]) {
    const v = couvertureCPU(c, sx, sy, 256, 256);
    assert.ok(v < 0.01, `${v} en (${sx.toFixed(2)}, ${sy.toFixed(2)})`);
  }
});
test('l’accent de l’é est bien là — les composites sont résolus', () => {
  const e = courbesDe('e');
  const eAigu = courbesDe('é');
  assert.ok(eAigu.length > e.length, `${eAigu.length} contre ${e.length}`);
  const [, , , y1] = boiteDe(eAigu);
  const [, , , y1e] = boiteDe(e);
  assert.ok(y1 > y1e + 0.1, 'l’accent devrait dépasser le e');
});

/* ------------------------------------------------ l'oracle des aires -- */
titre('l’encre de Slug égale l’aire des contours (Green)');
for (const c of ['H', 'O', 'a', 'g', 'é', 'B', '•', '3', 'œ']) {
  test(`« ${c} »`, () => {
    const courbes = courbesDe(c);
    const geo = aireEncre(courbes);
    const slug = aireCouverture(courbes);
    const ecart = Math.abs(geo - slug) / geo;
    assert.ok(ecart < 0.02,
      `aire ${geo.toFixed(4)} em², couverture ${slug.toFixed(4)} em²`
      + ` — écart ${(ecart * 100).toFixed(2)} %`);
  });
}

/* ---------------------------------------------------------- les bandes -- */
titre('les bandes disent la vérité');

/** La couverture EN NE REGARDANT QUE LES BANDES, comme le fera le shader. */
function couvertureBandee(courbes, bandes, sx, sy, px, py) {
  const [x0, y0, x1, y1] = boiteDe(courbes);
  const iH = Math.max(0, Math.min(bandes.h.length - 1,
    Math.floor((sy - y0) / ((y1 - y0) / bandes.h.length))));
  const iV = Math.max(0, Math.min(bandes.v.length - 1,
    Math.floor((sx - x0) / ((x1 - x0) / bandes.v.length))));
  // l'axe horizontal ne lit que sa bande, le vertical que la sienne : on
  // rejoue couvertureCPU en deux passes restreintes
  const seulH = bandes.h[iH].map((k) => courbes[k]);
  const seulV = bandes.v[iV].map((k) => courbes[k]);
  // même combinaison que CalcCoverage, mais chaque axe sur son sous-ensemble
  const total = couvertureAxes(seulH, seulV, sx, sy, px, py);
  return total;
}

// les deux axes de couvertureCPU, mais chacun sur sa propre liste
function couvertureAxes(courbesH, courbesV, sx, sy, px, py) {
  const un = (l) => couvertureCPU(l, sx, sy, px, py);
  // Pas d'accès direct aux moitiés : on recompose par le même code, en
  // passant des listes où l'AUTRE axe ne voit rien. Une courbe entièrement
  // sous le rayon horizontal (tous y < 0) ne contribue pas à xcov ; on
  // fabrique donc deux appels où l'axe non concerné reçoit du vide.
  // Plus simple et plus honnête : recopier ici la combinaison.
  let xcov = 0, xwgt = 0, ycov = 0, ywgt = 0;
  for (const c of courbesH) {
    const rel = [c[0] - sx, c[1] - sy, c[2] - sx, c[3] - sy, c[4] - sx, c[5] - sy];
    const code = codeRacines(rel[1], rel[3], rel[5]);
    if (code !== 0) {
      const r = racines(rel).map((x) => x * px);
      if (code & 1) { xcov += borne(r[0] + 0.5); xwgt = Math.max(xwgt, borne(1 - (Math.abs(r[0]) * 2))); }
      if (code > 1) { xcov -= borne(r[1] + 0.5); xwgt = Math.max(xwgt, borne(1 - (Math.abs(r[1]) * 2))); }
    }
  }
  for (const c of courbesV) {
    const rel = [c[1] - sy, c[0] - sx, c[3] - sy, c[2] - sx, c[5] - sy, c[4] - sx];
    const code = codeRacines(rel[1], rel[3], rel[5]);
    if (code !== 0) {
      const r = racines(rel).map((y) => y * py);
      if (code & 1) { ycov -= borne(r[0] + 0.5); ywgt = Math.max(ywgt, borne(1 - (Math.abs(r[0]) * 2))); }
      if (code > 1) { ycov += borne(r[1] + 0.5); ywgt = Math.max(ywgt, borne(1 - (Math.abs(r[1]) * 2))); }
    }
  }
  const c = Math.max(
    Math.abs((xcov * xwgt) + (ycov * ywgt)) / Math.max(xwgt + ywgt, 1 / 65536),
    Math.min(Math.abs(xcov), Math.abs(ycov))
  );
  return borne(c);
}
const borne = (v) => Math.min(1, Math.max(0, v));
function racines(rel) {
  const [x1, y1, x2, y2, x3, y3] = rel;
  const ay = y1 - (2 * y2) + y3, by = y1 - y2;
  const ax = x1 - (2 * x2) + x3, bx = x1 - x2;
  const d = Math.sqrt(Math.max((by * by) - (ay * y1), 0));
  let t1 = (by - d) / ay, t2 = (by + d) / ay;
  if (Math.abs(ay) < 1 / 65536) { t1 = t2 = y1 / (2 * by); }
  return [(((ax * t1) - (bx * 2)) * t1) + x1, (((ax * t2) - (bx * 2)) * t2) + x1];
}

for (const ch of ['O', 'g', 'B', '§'.includes('§') ? 'a' : 'a', 'M']) {
  test(`bande ou pas, même couverture — « ${ch} »`, () => {
    const courbes = courbesDe(ch);
    const nb = nombreDeBandes(courbes.length);
    const bandes = construireBandes(courbes, nb, nb);
    const [x0, y0, x1, y1] = boiteDe(courbes);
    let graine = 1234567;
    const alea = () => {
      graine = (graine * 1103515245 + 12345) & 0x7fffffff;
      return graine / 0x7fffffff;
    };
    let compares = 0;
    for (let k = 0; k < 400; k++) {
      const sx = x0 + (alea() * (x1 - x0));
      const sy = y0 + (alea() * (y1 - y0));
      const plein = couvertureCPU(courbes, sx, sy, 128, 128);
      const bande = couvertureBandee(courbes, bandes, sx, sy, 128, 128);
      assert.ok(Math.abs(plein - bande) < 1e-9,
        `écart ${Math.abs(plein - bande)} en (${sx.toFixed(3)}, ${sy.toFixed(3)})`);
      compares++;
    }
    assert.equal(compares, 400);
  });
}
test('les tris de bandes respectent l’arrêt anticipé du shader', () => {
  const courbes = courbesDe('B');
  const nb = nombreDeBandes(courbes.length);
  const { h, v } = construireBandes(courbes, nb, nb);
  const maxX = (c) => Math.max(c[0], c[2], c[4]);
  const maxY = (c) => Math.max(c[1], c[3], c[5]);
  for (const liste of h) {
    for (let i = 1; i < liste.length; i++) {
      assert.ok(maxX(courbes[liste[i - 1]]) >= maxX(courbes[liste[i]]), 'tri h');
    }
  }
  for (const liste of v) {
    for (let i = 1; i < liste.length; i++) {
      assert.ok(maxY(courbes[liste[i - 1]]) >= maxY(courbes[liste[i]]), 'tri v');
    }
  }
});

/* -------------------------------------------------------- l'emballage -- */
titre('l’emballage parle la langue du shader');
test('aller-retour : les texels rendent exactement les courbes', () => {
  const jeu = new Map([['O', { courbes: courbesDe('O') }],
    ['H', { courbes: courbesDe('H') }]]);
  const { courbes, bandes, infos } = emballerGlyphes(jeu);
  for (const [cle, g] of jeu) {
    const info = infos.get(cle);
    const nbH = info.bandesMax[1] + 1;
    const nbV = info.bandesMax[0] + 1;
    const locLin = (info.loc[1] * LARGEUR_TEXTURE) + info.loc[0];
    // relit CHAQUE bande par le protocole du shader : en-tête à
    // glyphLoc.x + i (sans repli), liste via le repli de CalcBandLoc
    const vues = new Set();
    for (let i = 0; i < nbH + nbV; i++) {
      const compte = bandes[(locLin + i) * 2];
      const dec = bandes[((locLin + i) * 2) + 1];
      for (let k = 0; k < compte; k++) {
        // CalcBandLoc : repli en fin de ligne
        let bx = info.loc[0] + dec + k;
        let by = info.loc[1] + (bx >> 12);
        bx &= LARGEUR_TEXTURE - 1;
        const lin = (by * LARGEUR_TEXTURE) + bx;
        const cx = bandes[lin * 2];
        const cy = bandes[(lin * 2) + 1];
        const t = ((cy * LARGEUR_TEXTURE) + cx) * 4;
        const courbe = [courbes[t], courbes[t + 1], courbes[t + 2],
          courbes[t + 3], courbes[t + 4], courbes[t + 5]];
        const trouve = g.courbes.some((c) => c.every((v, j) => v === courbe[j]));
        assert.ok(trouve, `courbe inconnue via la bande ${i} de ${cle}`);
        vues.add(t);
      }
    }
    assert.ok(vues.size > 0, `aucune courbe lue pour ${cle}`);
  }
});
test('aucune courbe à cheval sur une fin de ligne', () => {
  // le shader lit « le texel d'à côté » sans replier : x+1 doit exister
  const jeu = new Map();
  for (const c of ['A', 'B', 'O', 'g', 'M', 'W']) jeu.set(c, { courbes: courbesDe(c) });
  const { courbes } = emballerGlyphes(jeu);
  for (let t = 0; t + 4 < courbes.length; t += 4) {
    const estDebut = courbes.slice(t, t + 4).some((v) => v !== 0);
    if (!estDebut) continue;
  }
  // la garantie structurelle : emballer pose chaque courbe sur deux texels
  // consécutifs de la MÊME ligne — vérifié en re-emballant un jeu qui force
  // le passage de ligne
  const gros = new Map();
  for (let i = 0; i < 400; i++) {
    gros.set(String(i), { courbes: courbesDe('O') });
  }
  const e = emballerGlyphes(gros);
  assert.ok(e.lignesC > 1, 'le jeu devait déborder d’une ligne');
  // chaque adresse de courbe relue par les bandes doit avoir p3 sur la même ligne
  for (const [cle, info] of e.infos) {
    const locLin = (info.loc[1] * LARGEUR_TEXTURE) + info.loc[0];
    const nb = info.bandesMax[0] + info.bandesMax[1] + 2;
    for (let i = 0; i < nb; i++) {
      const compte = e.bandes[(locLin + i) * 2];
      const dec = e.bandes[((locLin + i) * 2) + 1];
      for (let k = 0; k < compte; k++) {
        let bx = info.loc[0] + dec + k;
        let by = info.loc[1] + (bx >> 12);
        bx &= LARGEUR_TEXTURE - 1;
        const lin = (by * LARGEUR_TEXTURE) + bx;
        const cx = e.bandes[lin * 2];
        assert.ok(cx < LARGEUR_TEXTURE - 1, `courbe en fin de ligne (${cle})`);
      }
    }
  }
});
test('les en-têtes d’un glyphe tiennent sur une seule ligne', () => {
  const gros = new Map();
  for (let i = 0; i < 700; i++) gros.set(String(i), { courbes: courbesDe('g') });
  const e = emballerGlyphes(gros);
  for (const [, info] of e.infos) {
    const nb = info.bandesMax[0] + info.bandesMax[1] + 2;
    assert.ok(info.loc[0] + nb <= LARGEUR_TEXTURE, 'en-têtes à cheval');
  }
});

/* ----------------------------------------------------- la mise en page -- */
titre('la mise en page');
const mesures = {
  avance: (c) => (LETTRAGE.glyphes[c]?.avance ?? 0) / LETTRAGE.upm,
  crenage: (a, b) => (LETTRAGE.crenage[a + b] ?? 0) / LETTRAGE.upm,
  ascendant: LETTRAGE.metriques.ascendant / LETTRAGE.upm,
  descendant: LETTRAGE.metriques.descendant / LETTRAGE.upm
};
test('le crénage resserre AV', () => {
  const avec = poserTexte('AV', mesures).largeur;
  const sans = mesures.avance('A') + mesures.avance('V');
  assert.ok(avec < sans - 0.01, `${avec.toFixed(4)} contre ${sans.toFixed(4)}`);
});
test('le centrage est symétrique', () => {
  const { glyphes } = poserTexte('OO', mesures);
  assert.equal(glyphes.length, 2);
  const centre = (glyphes[0].x + glyphes[1].x + mesures.avance('O')) / 2;
  assert.ok(Math.abs(centre) < 1e-9, String(centre));
});
test('deux lignes, la seconde plus bas', () => {
  const { glyphes, lignes } = poserTexte('Aa\nBb', mesures);
  assert.equal(lignes, 2);
  assert.ok(glyphes[2].y < glyphes[0].y - 1);
});
test('le repli doux coupe aux espaces, jamais dans un mot', () => {
  const { lignes } = poserTexte('un nom de salle vraiment long', mesures,
    { largeurMax: 5 });
  assert.ok(lignes >= 2, String(lignes));
  const jamais = poserTexte('Bibliothèque', mesures, { largeurMax: 2 });
  assert.equal(jamais.lignes, 1);      // un seul mot : il dépasse, tant pis
});
test('l’ancrage top pose l’ascendant sous l’origine', () => {
  const haut = poserTexte('A', mesures, { ancrageY: 'top' });
  assert.ok(haut.glyphes[0].y < 0);
  const milieu = poserTexte('A', mesures, { ancrageY: 'middle' });
  assert.ok(milieu.glyphes[0].y > haut.glyphes[0].y);
});

/* ------------------------------------------------------ le déterminisme -- */
titre('le fichier généré dit la vérité');
test('régénérer rend EXACTEMENT le fichier commité', () => {
  const d = genererLettrage();
  const ici = dirname(fileURLToPath(import.meta.url));
  const commite = readFileSync(join(ici, '..', 'engine', 'src', 'core',
    'lettrage-inter.js'), 'utf8');
  assert.ok(commite.includes(JSON.stringify(d)),
    'lettrage-inter.js diverge de la police : relancer genere-lettrage.mjs');
});
test('chaque glyphe du jeu courant est là, avec une avance saine', () => {
  for (const c of GLYPHES_COURANTS) {
    const g = LETTRAGE.glyphes[c];
    assert.ok(g, `« ${c} » absent`);
    assert.ok(g.avance > 0 || c === ' ', `avance nulle pour « ${c} »`);
    assert.ok(LETTRAGE.formes[g.forme] !== undefined, `forme absente pour « ${c} »`);
  }
});
test('l’espace n’a pas de contours, les lettres en ont', () => {
  assert.equal(LETTRAGE.formes[LETTRAGE.glyphes[' '].forme].length, 0);
  assert.ok(LETTRAGE.formes[LETTRAGE.glyphes.A.forme].length >= 6 * 3);
});
test('l’epsilon des bandes est celui de Lengyel', () => {
  assert.equal(EPSILON_BANDE, 1 / 1024);
});

console.log(`\n${ok} ✓ / ${ko} ✗`);
process.exit(ko ? 1 : 0);

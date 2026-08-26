/**
 * LA CHARTE — la direction artistique, éprouvée.
 *
 * Une DA ne se maintient pas à l'œil : elle dérive salle par salle, un
 * choix à la fois, et l'on s'en aperçoit deux ans plus tard. Les règles de
 * `charte.mjs` (le mur plus clair que le sol, des surfaces peu saturées,
 * une salle une teinte, une lumière de référence, l'accrochage à hauteur
 * d'œil) deviennent ici des assertions : ajouter une salle qui jure fait
 * rougir la chaîne, et l'auteur sait pourquoi avant de publier.
 *
 * Ce n'est pas un test de goût — les règles viennent de la muséographie, et
 * chacune est chiffrée dans CHARTE. Ce qu'on interdit, c'est l'écart
 * silencieux.
 *
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHARTE, EXTERIEURS, clarte, teinteEtSaturation, ecartTeinte,
  auditSalles, auditAccrochage, auditRecul, auditHierarchie, auditVista,
  salles } from './charte.mjs';

let ok = 0, ko = 0;
const test = (nom, fn) => {
  try { fn(); ok++; console.log(`  ✓ ${nom}`); }
  catch (e) { ko++; console.log(`  ✗ ${nom}\n    ${e.message}`); }
};
const titre = (t) => console.log(`\n${t}`);

const ici = dirname(fileURLToPath(import.meta.url));
const rapport = auditSalles();

titre('les mesures de couleur disent vrai');
test('la clarté L* est celle de la norme', () => {
  assert.equal(Math.round(clarte('#000000')), 0);
  assert.equal(Math.round(clarte('#ffffff')), 100);
  // le gris moyen 50 % perceptuel est autour de #777777, pas de #808080
  assert.ok(Math.abs(clarte('#777777') - 50) < 1.5, clarte('#777777'));
});
test('teinte et saturation aussi', () => {
  const rouge = teinteEtSaturation('#ff0000');
  assert.equal(Math.round(rouge.teinte), 0);
  assert.equal(Math.round(rouge.saturation), 100);
  assert.equal(Math.round(teinteEtSaturation('#00ff00').teinte), 120);
  assert.equal(Math.round(teinteEtSaturation('#808080').saturation), 0);
  // l'écart de teinte est ANGULAIRE : 350° et 10° sont voisins
  assert.equal(ecartTeinte(350, 10), 20);
});

titre('chaque salle respecte la charte');
if (!rapport.length) {
  console.log('    (pas de contenu — sauté)');
} else {
  for (const l of rapport) {
    test(`${l.id}${l.dehors ? ' (extérieur)' : ''}`, () => {
      assert.deepEqual(l.fautes, [], l.fautes.join(' · '));
    });
  }
}

titre('les règles gardent leur sens');
test('le mur est plus clair que le sol, partout à l’intérieur', () => {
  const dedans = rapport.filter((l) => !l.dehors && Number.isFinite(l.ecart));
  if (!dedans.length) return;
  for (const l of dedans) {
    assert.ok(l.ecart > 0,
      `${l.id} : mur ${l.clarteMur.toFixed(1)} sous le sol ${l.clarteSol.toFixed(1)}`);
  }
});
test('aucune surface ne dispute l’attention aux œuvres', () => {
  for (const l of rapport) {
    if (!Number.isFinite(l.saturation)) continue;
    assert.ok(l.saturation <= CHARTE.saturationMax,
      `${l.id} : ${l.saturation.toFixed(0)} % de saturation`);
  }
});
test('les œuvres murales sont accrochées à hauteur d’œil', () => {
  const murs = auditAccrochage();
  if (!murs.length) { console.log('    (aucune œuvre murale — sauté)'); return; }
  for (const a of murs) {
    assert.ok(Math.abs(a.ecart) <= 0.25,
      `${a.id} : ${a.y.toFixed(2)} m au lieu de ${a.vise.toFixed(2)} m`);
  }
});
test('le mobilier se détache du mur sans l’égaler', () => {
  // les stèles étaient à L*14 sur un mur à L*45 : des trous noirs, où aucun
  // grain ne pouvait se voir. Un objet de galerie vit dans la même échelle
  // de valeurs que la salle qui le porte.
  const archives = salles().find((s) => s.id === 'archives');
  if (!archives) { console.log('    (pas de contenu — sauté)'); return; }
  const mur = clarte(archives.shell.color);
  const stele = JSON.parse(readFileSync(join(ici, '..', 'content', 'works',
    'stele-archives-1.json'), 'utf8'));
  const objet = clarte(stele.model.color);
  assert.ok(objet > mur - 20 && objet < mur + 10,
    `stèle L*${objet.toFixed(0)} contre un mur L*${mur.toFixed(0)}`);
});
test('la charte est documentée là où on la lit', () => {
  const readme = readFileSync(join(ici, '..', 'README.md'), 'utf8');
  assert.ok(readme.includes('La charte'), 'la charte doit vivre dans le README');
  assert.ok(readme.includes('plus clair que le sol'));
});

titre('les extérieurs restent exemptés, et le disent');
test('jardin et allée ne sont pas jugés sur leurs murs', () => {
  assert.ok(EXTERIEURS.has('jardin') && EXTERIEURS.has('allee'));
  const jardin = rapport.find((l) => l.id === 'jardin');
  if (jardin) assert.ok(jardin.dehors, 'le jardin doit être reconnu extérieur');
});

titre('muséographie, second étage : recul, hiérarchie, vista');
test('chaque œuvre murale a son recul — 1,5 fois sa diagonale', () => {
  // la règle des galeristes : on regarde une œuvre depuis 1,5 à 3 fois sa
  // diagonale ; sans cet espace libre devant elle, le visiteur ne peut
  // physiquement pas la voir en entier
  const recul = auditRecul();
  if (!recul.length) { console.log('    (aucune œuvre murale — sauté)'); return; }
  for (const r of recul) {
    assert.ok(r.manque <= 0,
      `${r.id} (${r.salle}) : ${r.libre.toFixed(1)} m libres pour `
      + `${r.requis.toFixed(1)} m requis`);
  }
});
test('l’accent le plus fort va aux œuvres, jamais au décor', () => {
  // la lune du labo éclairait à 6 quand les œuvres plafonnaient à 4 :
  // l'œil allait au décor. Dans un musée, la hiérarchie lumineuse EST la
  // hiérarchie du propos.
  const h = auditHierarchie();
  if (!h.length) { console.log('    (pas de contenu — sauté)'); return; }
  for (const s of h) {
    assert.ok(!s.inversee,
      `${s.id} : décor à ${s.maxDecor} au-dessus des œuvres à ${s.maxOeuvre}`);
  }
});
test('le premier regard a une œuvre à cadrer, à bonne distance', () => {
  // le moteur cadre l'œuvre la plus proche du point d'arrivée ; encore
  // faut-il qu'elle existe, ni collée au spawn ni perdue dans la brume
  const v = auditVista();
  if (!v.length) { console.log('    (pas de contenu — sauté)'); return; }
  for (const s of v) {
    assert.ok(s.cadrable,
      `${s.id} : œuvre la plus proche à ${s.plusProche.toFixed(1)} m `
      + `(fenêtre : 2 m à ${s.plafond.toFixed(0)} m)`);
  }
});

console.log(`\n${ok} ✓ / ${ko} ✗`);
process.exit(ko ? 1 : 0);

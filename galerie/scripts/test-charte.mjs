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
import { CHARTE, EXTERIEURS, LUMINAIRES, clarte, teinteEtSaturation, ecartTeinte,
  auditSalles, auditAccrochage, auditRecul, auditHierarchie, auditVista,
  auditRythme, auditBancs, auditAmpleur, ampleurOeuvre, angleApparent,
  arriveesDe, salles, auditDecor } from './charte.mjs';

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
/**
 * L'AMPLEUR À L'ARRIVÉE, et le cliquet qui la tient.
 *
 * Trois salles arrivent en DETTE sur cette règle — elle est neuve, et elle
 * dit d'elles quelque chose de vrai. Les corriger demande des choix qui
 * appartiennent à l'auteur (agrandir une œuvre, en ajouter une, déplacer
 * une porte), pas au test. Elles sont donc nommées ici, avec leur raison :
 *
 *   • couloir-est — sa seule œuvre est un anneau d'1,2 m à 21 m du seuil,
 *     soit 3° de champ. Un couloir est un passage, mais celui-là ne montre
 *     RIEN de ce qu'il contient tant qu'on ne l'a pas traversé ;
 *   • entree, jardin — leur seule œuvre est un banc d'écoute de 2,5 m ;
 *     vu depuis les portes lointaines il tombe à 11°, tout juste sous le
 *     seuil. C'est une salle sans œuvre dominante, pas une faute de pose.
 *
 * Le test n'exige pas qu'elles soient réparées ; il exige que la dette ne
 * GRANDISSE PAS — aucune salle de plus, aucune arrivée de plus. Et il
 * vérifie que les salles listées échouent ENCORE : le jour où l'auteur les
 * répare, la liste devient fausse et le test le dit, plutôt que de laisser
 * dormir une exemption qui ne protège plus rien.
 */
const DETTE_AMPLEUR = new Map([
  ['couloir-est', ['spawn', 'depuis archives', 'depuis bibliotheque']],
  ['entree', ['depuis archives', 'depuis jardin', 'depuis labo']],
  ['jardin', ['depuis allee', 'depuis belvedere']]
]);

test('la charte et le moteur s’accordent sur ce qu’est un luminaire', () => {
  // Deux listes qui divergent, c'est une charte qui juge une lampe que la
  // scène n'allume pas. C'est arrivé dans l'autre sens : quatorze corniches
  // recevaient du moteur une lampe ponctuelle de 4 que personne n'avait
  // demandée, et l'audit de hiérarchie l'a signalée — d'où cette garde.
  const src = readFileSync(join(ici, '..', 'engine', 'src', 'core',
    'Artwork.js'), 'utf8');
  const m = src.match(/const LUMINAIRES = new Set\(\[([^\]]*)\]\)/);
  assert.ok(m, 'LUMINAIRES introuvable dans Artwork.js');
  const duMoteur = m[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean).sort();
  assert.deepEqual(duMoteur, [...LUMINAIRES].sort(),
    'les listes de luminaires du moteur et de la charte ont divergé');
  assert.ok(src.includes('LUMINAIRES.has(config.model?.shape) ? 0 : 4'),
    'le moteur doit refuser l’accent par défaut à un luminaire');
});

test('l’ampleur se mesure juste, quel que soit le type d’œuvre', () => {
  // un panneau mural : sa diagonale, échelle comprise
  assert.equal(
    ampleurOeuvre({ size: [3, 4] }).metres.toFixed(2), '5.00');
  assert.equal(
    ampleurOeuvre({ size: [3, 4], scale: [2, 2, 2] }).metres.toFixed(2), '10.00');
  // un scan : l'emprise horizontale la plus large et sa hauteur
  assert.equal(
    ampleurOeuvre({ scanTaille: [3, 4, 3] }).metres.toFixed(2), '5.00');
  // un modèle importé normalisé par `fit` connaît sa taille
  assert.equal(ampleurOeuvre({ model: { url: 'x.glb', fit: 3 } }).estimee, false);
  // sans `fit`, elle est SUPPOSÉE — et le dit
  assert.equal(ampleurOeuvre({ model: { url: 'x.glb' } }).estimee, true);
  // l'angle : 1 m vu de 1 m couvre deux fois 26,57°
  assert.equal(angleApparent(1, 1).toFixed(2), '53.13');
  assert.ok(angleApparent(4, 28) < 9, 'le scan du labo faisait bien moins de 9°');
});

test('les points d’arrivée comptent le spawn ET chaque portail entrant', () => {
  const toutes = salles();
  if (!toutes.length) { console.log('    (pas de contenu — sauté)'); return; }
  for (const s of toutes) {
    const points = arriveesDe(s.id, toutes);
    const entrants = toutes.flatMap((a) => (a.portals ?? [])
      .filter((p) => p.to === s.id && Array.isArray(p.arrival)).length ? [a.id] : []);
    assert.equal(points.length, (s.spawn ? 1 : 0) + entrants.length,
      `${s.id} : ${points.length} arrivées pour ${entrants.length} portails entrants`);
  }
});

test('en arrivant quelque part, on a quelque chose à regarder', () => {
  const rapport = auditAmpleur();
  if (!rapport.length) { console.log('    (pas de contenu — sauté)'); return; }
  const enDette = new Map();
  for (const a of rapport.filter((x) => !x.suffisant)) {
    if (!enDette.has(a.id)) enDette.set(a.id, []);
    enDette.get(a.id).push(a.arrivee);
  }
  // aucune salle de plus que la dette connue
  for (const [id, arrivees] of enDette) {
    const connues = DETTE_AMPLEUR.get(id);
    assert.ok(connues, `${id} tombe sous ${CHARTE.angleMinimal}° et n’était pas en dette`
      + ` (${arrivees.join(', ')}) — voir DETTE_AMPLEUR`);
    for (const a of arrivees) {
      assert.ok(connues.includes(a),
        `${id} : nouvelle arrivée en dette « ${a} »`);
    }
  }
  // et la dette listée est encore RÉELLE : une exemption périmée ment
  for (const [id] of DETTE_AMPLEUR) {
    assert.ok(enDette.has(id),
      `${id} passe désormais la règle : retirez-la de DETTE_AMPLEUR`);
  }
});

test('les salles hors dette tiennent la règle à chaque porte', () => {
  const rapport = auditAmpleur();
  if (!rapport.length) { console.log('    (pas de contenu — sauté)'); return; }
  const saines = rapport.filter((a) => !DETTE_AMPLEUR.has(a.id));
  assert.ok(saines.length >= 20, `trop peu de salles auditées (${saines.length})`);
  for (const a of saines) {
    assert.ok(a.suffisant, `${a.id} (${a.arrivee}) : ${a.oeuvre} n’occupe que`
      + ` ${a.angle.toFixed(1)}° (minimum ${CHARTE.angleMinimal}°)`);
  }
});

test('le scan habite l’annexe, à la bonne ampleur', () => {
  const annexe = salles().find((s) => s.id === 'annexe');
  if (!annexe) { console.log('    (pas de contenu — sauté)'); return; }
  assert.ok(annexe.works?.includes('onde-stationnaire'),
    'le scan doit vivre dans l’annexe');
  const labo = salles().find((s) => s.id === 'labo');
  assert.ok(!labo?.works?.includes('onde-stationnaire'),
    'le scan ne doit plus être compté deux fois');
  // il domine son arrivée, sans écraser le recul (1,5 à 3 diagonales)
  for (const a of auditAmpleur().filter((x) => x.id === 'annexe')) {
    assert.equal(a.oeuvre, 'onde-stationnaire',
      `${a.arrivee} : le scan devrait être l’œuvre la plus ample`);
    assert.ok(a.angle >= 19 && a.angle <= 37,
      `${a.arrivee} : ${a.angle.toFixed(1)}° hors de la bande de confort 19–37°`);
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


titre('le rythme du parcours, et les cartels');
test('la galerie respire — compression et dilatation existent', () => {
  // la scénographie fait l'échelle par le CONTRASTE : un couloir qui
  // débouche sur un hall rend le hall immense. On exige au moins un grand
  // geste (rapport de surfaces ≥ 3 sur un passage) et une respiration
  // moyenne ≥ 1,5 — rien qui dicte le plan, tout qui interdit la monotonie.
  const r = auditRythme();
  if (!r.passages.length) { console.log('    (pas de contenu — sauté)'); return; }
  assert.ok(r.plusGrand >= 3,
    `plus grand geste ×${r.plusGrand.toFixed(1)} — aucun passage ne coupe le souffle`);
  assert.ok(r.moyen >= 1.5, `respiration moyenne ×${r.moyen.toFixed(2)}`);
});
test('toute œuvre porte son cartel dans le monde', () => {
  // la plaque d'identification du musée : dans le plan du panneau pour une
  // œuvre murale (centre à 1,45 m), posée à côté et pivotante pour un
  // volume (1,15 m). Le décor n'en porte pas ; « "cartel": false » y renonce.
  const art = readFileSync(join(ici, '..', 'engine', 'src', 'core',
    'Artwork.js'), 'utf8');
  assert.ok(art.includes('_buildCartel'), 'le cartel d’œuvre a disparu');
  assert.ok(art.includes('1.45 - posY'), 'plaque murale à 1,45 m');
  assert.ok(art.includes('1.15 - posY'), 'plaque de volume à 1,15 m');
  assert.ok(art.includes("config.cartel !== false"), 'l’opt-out doit exister');
  assert.ok(art.includes("config.role !== 'decor' && !config.partOf\n      && config.title")
    || /role !== 'decor'[\s\S]{0,120}config\.title/.test(art),
  'seules les œuvres titrées en portent un');
  assert.ok(art.includes('disposerCartel(this._cartel)'),
    'la plaque doit être libérée avec l’œuvre');
});
test('le quatuor des Archives est écoutable, et généré', () => {
  // quatre stèles, quatre voix d'un même accord de ré : chacune ne
  // s'entend qu'auprès de sa stèle, la salle est l'instrument
  const gen = readFileSync(join(ici, 'generate-assets.mjs'), 'utf8');
  for (const voix of ['grave', 'alto', 'tenor', 'souffle']) {
    assert.ok(gen.includes(`stele-voix-${voix}.wav`), `voix ${voix} absente du générateur`);
    const w = JSON.parse(readFileSync(join(ici, '..', 'content', 'works',
      `stele-archives-${['grave', 'alto', 'tenor', 'souffle'].indexOf(voix) + 1}.json`), 'utf8'));
    assert.ok(w.role !== 'decor', 'une stèle qui chante est une œuvre');
    assert.equal(w.stems?.[0]?.file, `audio/stele-voix-${voix}.wav`);
    assert.ok((w.stems?.[0]?.radius ?? 99) <= 10,
      'rayon court : chaque voix ne s’entend qu’auprès de sa stèle');
  }
});


titre('les salles habitées et les bancs');
test('chaque banc à plat regarde une œuvre', () => {
  // un banc de musée offre une assise à la contemplation — face à une
  // œuvre, pas dos à tout. ±45° sur l'axe d'assise, une œuvre à ≤ 25 m.
  const bancs = auditBancs();
  if (!bancs.length) { console.log('    (aucun banc à juger — sauté)'); return; }
  for (const b of bancs) {
    assert.ok(b.regarde, `${b.id} (${b.salle}) : ` + (b.vers
      ? `${b.angle.toFixed(0)}° vers ${b.vers}` : 'aucune œuvre à portée'));
  }
});
test('les rayonnages sont UN ensemble qui murmure', () => {
  // rayonnage-2 est l'œuvre maîtresse ; les cinq autres la rejoignent par
  // partOf (un cartel, une entrée de catalogue), et le murmure vit sur
  // TROIS d'entre eux en triangle — il n'a pas de source, il a un lieu
  const maitre = JSON.parse(readFileSync(join(ici, '..', 'content', 'works',
    'rayonnage-2.json'), 'utf8'));
  assert.ok(maitre.role !== 'decor' && !maitre.partOf);
  assert.equal(maitre.stems?.[0]?.file, 'audio/rayonnage-murmure.wav');
  let voix = 1;
  for (const i of [1, 3, 4, 5, 6]) {
    const m = JSON.parse(readFileSync(join(ici, '..', 'content', 'works',
      `rayonnage-${i}.json`), 'utf8'));
    assert.equal(m.partOf, 'rayonnage-2', `rayonnage-${i} hors de l’ensemble`);
    if (m.stems?.length) voix++;
  }
  assert.equal(voix, 3, 'le murmure vit sur trois rayonnages');
});
test('le carillon du couloir existe, salle ET index du combineur', () => {
  // la leçon de l'onde stationnaire : une œuvre absente de works/index.json
  // existe sur le disque et manque au build
  const w = JSON.parse(readFileSync(join(ici, '..', 'content', 'works',
    'carillon-fenetres.json'), 'utf8'));
  assert.equal(w.stems?.[0]?.file, 'audio/carillon-fenetres.wav');
  assert.equal(w.solid, false, 'un carillon suspendu ne bloque pas le pas');
  const salle = JSON.parse(readFileSync(join(ici, '..', 'content', 'rooms',
    'couloir-est.json'), 'utf8'));
  assert.ok(salle.works.includes('carillon-fenetres'));
  const idx = JSON.parse(readFileSync(join(ici, '..', 'content', 'works',
    'index.json'), 'utf8'));
  const noms = (Array.isArray(idx) ? idx : idx.works).map(String);
  assert.ok(noms.includes('carillon-fenetres.json'),
    'absent de works/index.json : œuvre fantôme au build');
});
test('les voix de la bibliothèque et du couloir sont générées', () => {
  const gen = readFileSync(join(ici, 'generate-assets.mjs'), 'utf8');
  assert.ok(gen.includes('rayonnage-murmure.wav'));
  assert.ok(gen.includes('carillon-fenetres.wav'));
});


titre('le décor se tait');
test('aucun objet de décor au-dessus de 45 % de saturation', () => {
  const fautifs = auditDecor().filter((l) => l.fautes.length);
  assert.deepEqual(fautifs.map((l) => `${l.id} : ${l.fautes.join(', ')}`), []);
});
test("l'exemption ne couvre que les lueurs et l'eau — pas un fourre-tout", () => {
  // le jour où quelqu'un exempte une forme de plus, ce test le fait dire
  const audite = auditDecor().map((l) => l.id);
  assert.ok(audite.includes('arbre-1-couronne'), 'la végétation reste auditée');
  assert.ok(!audite.includes('lucioles-bel-1'), 'les lucioles sont des lueurs');
});

console.log(`\n${ok} ✓ / ${ko} ✗`);
process.exit(ko ? 1 : 0);

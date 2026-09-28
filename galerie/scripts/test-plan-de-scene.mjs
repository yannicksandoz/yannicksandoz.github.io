/**
 * UN PLAN DE SCÈNE — l'assistant « Plan de scène », logique pure
 * (editor/state/PlanDeScene.js).
 *
 *   1. l'instrument se devine au nom de fichier, les ambiguïtés tranchées
 *      dans le bon sens (bass drum, backing vocals, lead guitar) ;
 *   2. un son rejoint le poste de son ensemble (la batterie en cinq
 *      pistes), un soliste ouvre le sien ; détacher, rattacher, retirer ;
 *   3. le placement classique : chacun à sa place, deux guitares de part
 *      et d'autre, une rangée pleine s'espace sans changer d'ordre ;
 *   4. la salle : la scène au nord, l'entrée au parterre face à elle, les
 *      musiciens sur le plateau, jamais hors de la scène ;
 *   5. la pièce complète : ids uniques, une œuvre par poste avec la clé
 *      `sync` de la pièce, les crédits reportés, le gabarit valide.
 *
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INSTRUMENTS, SCENE, BUDGET_VOIX, EQUIPEMENT, devinerInstrument, ajouterSon, retirerSon,
  detacherSon, rattacherSon, deplacerPoste, changerInstrument, nommerPoste, basculerPraticable,
  equipementDe, mobilierEquipement, porteeDansSalle, placementClassique,
  espacer, placeDeReference, normaliserScene, dimensionsSalle, positionDansSalle, titrePoste,
  musicienDepuisPoste, mobilierScene, pieceDepuisPlan, resumePlan, couleurLumiere }
  from '../engine/src/editor/state/PlanDeScene.js';
import { validerGabarit } from '../engine/src/editor/state/Gabarits.js';
import { estOeuvre } from '../engine/src/core/catalogue.js';

let ok = 0, ko = 0;
const test = (nom, fn) => {
  try { fn(); ok++; console.log(`  ✓ ${nom}`); }
  catch (e) { ko++; console.log(`  ✗ ${nom}\n    ${e.message}`); }
};
const titre = (t) => console.log(`\n${t}`);
const ici = dirname(fileURLToPath(import.meta.url));
const GABARIT = JSON.parse(readFileSync(
  join(ici, '..', 'engine', 'src', 'editor', 'gabarits', 'archives.json'), 'utf8'));

const son = (nom) => ({ path: `assets/${nom}`, name: nom });
const plan = (...noms) => noms.reduce((p, n) => ajouterSon(p, son(n)), []);

titre('deviner l\'instrument au nom du fichier');

test('les noms usuels des stems sont reconnus', () => {
  const attendu = {
    'kick.wav': 'batterie', 'Snare Top.wav': 'batterie', 'OH_L.wav': 'batterie', 'drums.wav': 'batterie',
    'Bass DI.wav': 'basse', 'basse.flac': 'basse', 'sub-808.wav': 'basse',
    'gtr_rhythm.wav': 'guitare', 'Lead Guitar.wav': 'guitare', 'acoustic.wav': 'guitare',
    'keys.wav': 'claviers', 'piano.mp3': 'claviers', 'synth pad.wav': 'claviers', 'Rhodes.wav': 'claviers',
    'trumpet.wav': 'cuivres', 'sax.wav': 'cuivres', 'horns.wav': 'cuivres',
    'strings.wav': 'cordes', 'violon.wav': 'cordes', 'harp.wav': 'cordes',
    'backing vocals.wav': 'choeurs', 'BVs.wav': 'choeurs', 'choir.wav': 'choeurs',
    'Lead Vox.wav': 'voix', 'vocals.wav': 'voix', 'chant.wav': 'voix', 'voix-alto.wav': 'voix',
    'shaker.wav': 'percussions', 'congas.wav': 'percussions',
    'marees.wav': 'autre', 'a.wav': 'autre', 'field-recording.wav': 'autre'
  };
  for (const [nom, ins] of Object.entries(attendu)) {
    assert.equal(devinerInstrument(nom), ins, `« ${nom} » → ${devinerInstrument(nom)}, attendu ${ins}`);
  }
});

test('les faux amis ne trompent plus : Acoustic Piano, Backing Track, Harmonica, Claves, Sidekick', () => {
  assert.equal(devinerInstrument('Acoustic Piano.wav'), 'claviers');
  assert.equal(devinerInstrument('Backing Track.wav'), 'autre');
  assert.equal(devinerInstrument('Harmonica.wav'), 'autre');
  assert.equal(devinerInstrument('Claves.wav'), 'autre');
  assert.equal(devinerInstrument('Clavinet.wav'), 'claviers');
  assert.equal(devinerInstrument('Sidekick Vox.wav'), 'voix');
  assert.equal(devinerInstrument('Vocal Harmony.wav'), 'choeurs');
  assert.equal(devinerInstrument('Bass Synth.wav'), 'basse');
});

test('les ambiguïtés se tranchent : bass drum, backing vocals, lead guitar', () => {
  assert.equal(devinerInstrument('bass drum.wav'), 'batterie');
  assert.equal(devinerInstrument('backing vocals.wav'), 'choeurs');
  assert.equal(devinerInstrument('lead guitar.wav'), 'guitare');
  assert.equal(devinerInstrument('lead.wav'), 'voix');
  assert.equal(devinerInstrument('assets/sons/02 - Bass.wav'), 'basse', 'le chemin ne compte pas, le nom si');
  assert.equal(devinerInstrument(''), 'autre');
  assert.equal(devinerInstrument(null), 'autre');
});

titre('les postes : ajouter, regrouper, détacher, retirer');

test('un ensemble regroupe ses pistes, un soliste ouvre son poste', () => {
  const p = plan('kick.wav', 'snare.wav', 'overheads.wav', 'bass.wav', 'vox.wav', 'gtr1.wav', 'gtr2.wav');
  assert.equal(p.length, 5, 'batterie (3 pistes), basse, voix, deux guitares');
  const batt = p.find((x) => x.instrument === 'batterie');
  assert.deepEqual(batt.sons.map((s) => s.name), ['kick.wav', 'snare.wav', 'overheads.wav']);
  assert.equal(p.filter((x) => x.instrument === 'guitare').length, 2, 'deux guitares, deux postes');
  assert.ok(p.every((x) => x.id && typeof x.x === 'number' && typeof x.y === 'number'));
  assert.equal(new Set(p.map((x) => x.id)).size, 5, 'identifiants uniques');
});

test('un son déjà sur le plan n\'y entre pas deux fois ; sans chemin, rien', () => {
  const p = plan('vox.wav');
  assert.equal(ajouterSon(p, son('vox.wav')).length, 1);
  assert.equal(ajouterSon(p, { name: 'x' }), p);
  assert.equal(ajouterSon(p, son('kick.wav'), 'voix').length, 2, 'l\'instrument imposé prime sur la devinette');
  assert.equal(ajouterSon(p, son('kick.wav'), 'voix')[1].instrument, 'voix');
});

test('retirer vide un poste et le fait disparaître ; détacher ouvre un poste à côté ; rattacher déplace', () => {
  let p = plan('kick.wav', 'snare.wav', 'bass.wav');
  p = retirerSon(p, 'assets/bass.wav');
  assert.equal(p.length, 1);
  p = detacherSon(p, 'assets/snare.wav');
  assert.equal(p.length, 2);
  assert.equal(p[1].instrument, 'batterie');
  assert.equal(p[1].sons[0].name, 'snare.wav');
  assert.notEqual(p[1].x, p[0].x, 'à côté, pas dessus');
  assert.equal(detacherSon(p, 'assets/kick.wav'), p, 'un poste d\'une piste ne se détache pas de lui-même');
  const r = rattacherSon(p, 'assets/snare.wav', p[0].id);
  assert.equal(r.length, 1);
  assert.equal(r[0].sons.length, 2);
  assert.equal(rattacherSon(p, 'assets/snare.wav', 'nulle-part'), p);
});

test('déplacer contraint au plateau ; changer d\'instrument et nommer', () => {
  let p = plan('vox.wav');
  p = deplacerPoste(p, p[0].id, 3, -2);
  assert.deepEqual([p[0].x, p[0].y], [1, 0]);
  p = deplacerPoste(p, p[0].id, -0.333, 0.777);
  assert.deepEqual([p[0].x, p[0].y], [-0.33, 0.78]);
  p = changerInstrument(p, p[0].id, 'cuivres');
  assert.equal(p[0].instrument, 'cuivres');
  assert.equal(changerInstrument(p, p[0].id, 'ukulele'), p);
  p = nommerPoste(p, p[0].id, '  Léa ');
  assert.equal(p[0].nom, 'Léa');
  assert.equal(titrePoste(p[0], p), 'Léa');
});

titre('le placement classique');

test('chacun à sa place : la batterie au fond au centre, le chant devant, la basse à jardin', () => {
  const p = placementClassique(plan('kick.wav', 'bass.wav', 'vox.wav', 'keys.wav'));
  const par = Object.fromEntries(p.map((x) => [x.instrument, x]));
  assert.deepEqual([par.batterie.x, par.batterie.y], [0, 0.82]);
  assert.deepEqual([par.voix.x, par.voix.y], [0, 0.15]);
  assert.ok(par.basse.x < 0 && par.basse.y > 0.5 && par.basse.y < 0.8);
  assert.ok(par.claviers.x > 0);
  assert.deepEqual(p.map((x) => x.instrument), ['batterie', 'basse', 'voix', 'claviers'], 'l\'ordre des postes est conservé');
});

test('deux guitares se répartissent de part et d\'autre ; la troisième recule', () => {
  const p = placementClassique(plan('gtr1.wav', 'gtr2.wav', 'gtr3.wav'));
  assert.ok(p[0].x < 0 && p[1].x > 0, `${p[0].x} / ${p[1].x}`);
  assert.equal(p[2].y, 0.42);
  assert.deepEqual(placeDeReference('guitare', 4), { x: -0.58, y: 0.38 }, 'au-delà des places, la rangée suivante recule');
});

test('une rangée trop pleine s\'espace régulièrement, sans changer l\'ordre', () => {
  assert.deepEqual(espacer([0, 0.58, -0.58]), [0, 0.58, -0.58], 'assez d\'écart : rien ne bouge');
  const xs = espacer([0, 0.1, -0.1, 0.05]);
  assert.equal(xs.length, 4);
  const tri = [...xs].sort((a, b) => a - b);
  for (let i = 1; i < tri.length; i++) assert.ok(tri[i] - tri[i - 1] >= 0.28 - 1e-9, `écart ${tri[i] - tri[i - 1]}`);
  assert.ok(xs[2] < xs[0] && xs[0] < xs[3] && xs[3] < xs[1], 'l\'ordre de gauche à droite est celui d\'avant');
  assert.ok(tri[0] >= -0.85 && tri[tri.length - 1] <= 0.85);
  const huit = espacer(new Array(8).fill(0));
  assert.ok(Math.max(...huit) <= 0.85 && Math.min(...huit) >= -0.85, 'huit sur une rangée tiennent dans la scène');
  assert.deepEqual(espacer([0.4]), [0.4]);
});

test('trois voix devant, trois chœurs au fond : deux rangées, chacune espacée', () => {
  const p = placementClassique(plan('vox1.wav', 'vox2.wav', 'vox3.wav', 'bv1.wav'));
  const voix = p.filter((x) => x.instrument === 'voix').map((x) => x.x).sort((a, b) => a - b);
  assert.ok(voix[1] - voix[0] >= 0.28 && voix[2] - voix[1] >= 0.28, `voix : ${voix}`);
  assert.equal(p.filter((x) => x.instrument === 'choeurs').length, 1, 'les chœurs, un ensemble : un seul poste');
});

titre('la salle et la scène');

test('la scène est bornée, la salle grandit avec elle, l\'entrée fait face à la scène', () => {
  assert.deepEqual(normaliserScene({}), { largeur: 10, profondeur: 6, hauteur: 0.5 });
  assert.deepEqual(normaliserScene({ largeur: 60, profondeur: 1 }), { largeur: 24, profondeur: 4, hauteur: 0.5 });
  assert.equal(normaliserScene({ profondeur: 24 }).profondeur, SCENE.maxProfondeur, 'la profondeur a sa propre borne');
  assert.deepEqual(normaliserScene({ largeur: 'abc', profondeur: '8' }), { largeur: 10, profondeur: 8, hauteur: 0.5 });
  const d = dimensionsSalle({ largeur: 10, profondeur: 6 });
  assert.equal(d.width, 16);
  assert.equal(d.depth, 19.2);
  assert.ok(d.scene.zFond < d.scene.zAvant && d.scene.zAvant < d.spawn[2], 'fond < bord de scène < entrée');
  assert.ok(d.spawn[2] < d.depth / 2 - 1, 'l\'entrée est dans la salle');
  assert.equal(d.regard[2], d.scene.zCentre, 'le regard tombe sur la scène');
  const large = dimensionsSalle({ largeur: 24, profondeur: 12 });
  assert.equal(large.width, 30);
  assert.ok(large.depth > d.depth);
});

test('du parterre, le fond de scène s\'entend : la portée suit la salle', () => {
  const petite = dimensionsSalle({ largeur: 10, profondeur: 6 });
  assert.equal(porteeDansSalle(petite), 16, 'jamais moins que la portée de base');
  const profonde = dimensionsSalle({ largeur: 10, profondeur: SCENE.maxProfondeur });
  const portee = porteeDansSalle(profonde);
  assert.ok(portee >= profonde.spawn[2] - profonde.scene.zFond, `l'entrée (${profonde.spawn[2]}) entend le fond (${profonde.scene.zFond}) : portée ${portee}`);
  assert.ok(portee + 6 >= profonde.spawn[2] - profonde.scene.zFond, 'et le budget de voix garde le fond');
  const r = pieceDepuisPlan({ postes: plan('kick.wav'), scene: { profondeur: SCENE.maxProfondeur } }, {});
  assert.equal(r.oeuvres[0].stems[0].radius, portee);
  assert.equal(r.portee, portee);
});

test('un poste se place sur le plateau, jamais hors de la scène', () => {
  const d = dimensionsSalle({ largeur: 10, profondeur: 6 });
  const p = (x, y, instrument = 'voix') => positionDansSalle({ x, y, instrument }, d);
  assert.deepEqual(p(0, 0), [0, 0.5, d.scene.zAvant - 0.4]);
  const coin = p(1, 1, 'batterie');
  assert.ok(coin[0] + 0.8 <= 5 && coin[2] - 0.7 >= d.scene.zFond, `la batterie tient dans le coin : ${coin}`);
  const bord = p(-1, 0.5);
  assert.ok(bord[0] - 0.25 >= -5, 'le corps ne dépasse pas à jardin');
  assert.equal(p(0, 0.5)[1], 0.5, 'posé sur le plateau');
});

titre('le musicien, le mobilier, la pièce');

test('un poste devient une œuvre debout sur la scène, à sa couleur, ses pistes portées, en phase', () => {
  const p = plan('kick.wav', 'snare.wav', 'vox.wav');
  const d = dimensionsSalle({});
  const o = musicienDepuisPoste(p[0], p, d, { morceau: 'Marées', sync: 'marees' });
  assert.equal(o.title, 'Batterie');
  assert.match(o.description, /« Marées » — la partie de batterie/);
  assert.match(o.description, /2 pistes : kick\.wav, snare\.wav/);
  assert.equal(o.model.shape, 'box');
  assert.equal(o.model.color, INSTRUMENTS.batterie.couleur);
  assert.ok(Math.abs(o.position[1] - (0.5 + EQUIPEMENT.praticable.hauteur + 0.95 / 2)) < 0.01, 'la batterie repose sur son praticable');
  assert.equal(o.stems.length, 2);
  assert.deepEqual(o.stems[0], { file: 'assets/kick.wav', radius: 16, gain: 0.9 });
  assert.equal(o.sync, 'marees');
  assert.equal(estOeuvre(o), true);
  assert.match(couleurLumiere('#000000'), /^#737373$/);
  const v = musicienDepuisPoste(p[1], p, d, {});
  assert.equal(v.sync, undefined);
  assert.doesNotMatch(v.description, /«/);
});

test('les crédits d\'une piste empruntée sont reportés ; le local sans auteur n\'en a pas', () => {
  const p = [{ id: 'a', instrument: 'voix', nom: '', x: 0, y: 0, sons: [
    { path: 'assets/freesound/voix-42.mp3', name: 'voix-42.mp3',
      meta: { source: 'freesound', author: 'A. Vento', license: 'Attribution', sourceUrl: 'https://freesound.org/s/42' } }
  ] }];
  const o = musicienDepuisPoste(p[0], p, dimensionsSalle({}), {});
  assert.equal(o.stems[0].source, 'freesound');
  assert.equal(o.stems[0].credit.author, 'A. Vento');
  assert.equal(o.credit.author, 'A. Vento');
  const l = musicienDepuisPoste({ ...p[0], sons: [son('vox.wav')] }, p, dimensionsSalle({}), {});
  assert.equal(l.stems[0].credit, undefined);
  assert.equal(l.credit, undefined);
});

test('le mobilier : le plateau aux cotes de la scène, deux projecteurs de face dans la salle', () => {
  const d = dimensionsSalle({ largeur: 10, profondeur: 6 });
  const m = mobilierScene(d);
  assert.equal(m.length, 3);
  assert.deepEqual(m[0].scale, [10, 0.5, 6]);
  assert.equal(m[0].position[2], d.scene.zCentre);
  assert.ok(m.every((x) => x.role === 'decor'));
  assert.ok(m[1].position[0] < -5 && m[2].position[0] > 5, 'les projecteurs encadrent la scène');
  assert.ok(m[1].position[2] > d.scene.zAvant, 'devant la scène');
  assert.equal(mobilierScene(d, { lanternes: false }).length, 1);
});

titre('l\'équipement de scène');

test('la batterie naît sur praticable ; un poste s\'y monte ou en descend', () => {
  const p = plan('kick.wav', 'vox.wav');
  assert.equal(p[0].praticable, true);
  assert.equal(p[1].praticable, false);
  assert.equal(basculerPraticable(p, p[1].id)[1].praticable, true);
  assert.equal(basculerPraticable(p, p[0].id, false)[0].praticable, false);
});

test('praticable sous la batterie, ampli derrière guitare et basse, retour devant le premier rang', () => {
  const p = placementClassique(plan('kick.wav', 'bass.wav', 'gtr.wav', 'vox.wav', 'keys.wav'));
  const e = equipementDe(p, { largeur: 10, profondeur: 6 });
  const types = e.map((x) => x.type).sort();
  assert.deepEqual(types, ['ampli', 'ampli', 'praticable', 'retour', 'retour'], `${types}`);
  const prat = e.find((x) => x.type === 'praticable');
  assert.equal(prat.poste, p[0].id);
  assert.ok(prat.largeur > 0 && prat.largeur <= 2 && prat.profondeur > 0 && prat.profondeur <= 1);
  const ampli = e.find((x) => x.type === 'ampli' && x.poste === p[1].id);
  assert.ok(ampli.y > p[1].y, 'l\'ampli est derrière la basse');
  assert.ok(!e.some((x) => x.type === 'ampli' && x.poste === p[4].id), 'pas d\'ampli pour les claviers');
  const retours = e.filter((x) => x.type === 'retour').map((x) => x.poste);
  assert.ok(retours.includes(p[3].id) && retours.includes(p[2].id), 'la voix et la guitare, au premier rang, ont un retour');
  assert.ok(!retours.includes(p[0].id), 'pas de retour pour la batterie au fond');
  const r = e.find((x) => x.type === 'retour' && x.poste === p[3].id);
  assert.ok(r.y >= 0 && r.y < p[3].y, 'le retour est devant, jamais hors scène');
});

test('l\'équipement suit la projection du musicien et reste sur le plateau', () => {
  const sc = { largeur: 10, profondeur: 6 };
  const d = dimensionsSalle(sc);
  let p = plan('kick.wav');
  p = deplacerPoste(p, p[0].id, 1, 1);                       // la batterie dans le coin du fond, à cour
  const [prat] = equipementDe(p, sc);
  const [xm, , zm] = positionDansSalle(p[0], d);
  assert.ok(prat.xm + prat.cotes[0] / 2 <= 5 + 1e-9 && prat.zm - prat.cotes[2] / 2 >= d.scene.zFond - 1e-9, `le praticable reste sur le plateau : ${JSON.stringify(prat)}`);
  assert.ok(Math.abs(prat.xm - xm) <= prat.cotes[0] / 2 && Math.abs(prat.zm - zm) <= prat.cotes[2] / 2, 'et la batterie est dessus');
  assert.ok(Math.abs(prat.x * 5 - prat.xm) < 0.02, 'le plan et la pièce disent la même place');
  let b = plan('bass.wav');
  b = deplacerPoste(b, b[0].id, 0, 1);                       // la basse collée au fond : l'ampli passe à côté
  const [ampli] = equipementDe(b, sc);
  const [bx, , bz] = positionDansSalle(b[0], d);
  assert.ok(ampli.zm - ampli.cotes[2] / 2 >= d.scene.zFond, 'l\'ampli ne traverse pas le mur du fond');
  assert.ok(Math.abs(ampli.zm - bz) < 0.01 && Math.abs(ampli.xm - bx) > 0.5, 'sans place derrière, il est à côté');
  let v = plan('vox.wav');
  v = deplacerPoste(v, v[0].id, 0, 0);                       // la voix au bord : le retour ne dépasse pas
  const [retour] = equipementDe(v, sc);
  assert.ok(retour.zm + retour.cotes[2] / 2 <= d.scene.zAvant, 'le retour reste sur le bord de scène');
});

test('sans équipement, le musicien redescend sur le plateau', () => {
  const p = plan('kick.wav');
  const d = dimensionsSalle({});
  const avec = musicienDepuisPoste(p[0], p, d, { equipement: true });
  const sans = musicienDepuisPoste(p[0], p, d, { equipement: false });
  assert.ok(Math.abs(avec.position[1] - sans.position[1] - EQUIPEMENT.praticable.hauteur) < 0.01);
  const r = pieceDepuisPlan({ postes: p, equipement: false }, {});
  assert.ok(Math.abs(r.oeuvres[0].position[1] - sans.position[1]) < 0.01, 'la pièce sans équipement ne fait pas flotter le batteur');
});

test('deux guitares sans nom : « Guitare 1 » et « Guitare 2 », comme dans la boîte', () => {
  const r = pieceDepuisPlan({ postes: placementClassique(plan('gtr1.wav', 'gtr2.wav')), nom: 'Duo' }, {});
  assert.deepEqual(r.oeuvres.map((o) => o.title), ['Guitare 1', 'Guitare 2']);
  assert.deepEqual(r.oeuvres.map((o) => o.id), ['duo-1-guitare-1', 'duo-1-guitare-2']);
});

test('l\'équipement en trois dimensions : décor sur le plateau, le musicien monte sur son praticable', () => {
  const p = placementClassique(plan('kick.wav', 'bass.wav', 'vox.wav'));
  const d = dimensionsSalle({ largeur: 10, profondeur: 6 });
  const m = mobilierEquipement(p, d);
  assert.deepEqual(m.map((x) => x.title).sort(), ['Ampli', 'Praticable', 'Retour']);
  assert.ok(m.every((x) => x.role === 'decor' && x.position[1] > d.scene.hauteur));
  const retour = m.find((x) => x.title === 'Retour');
  assert.equal(retour.rotation[0], -28, 'le retour est incliné vers le musicien');
  const batt = musicienDepuisPoste(p[0], p, d, {});
  const bas = musicienDepuisPoste(p[1], p, d, {});
  assert.ok(Math.abs((batt.position[1] - INSTRUMENTS.batterie.corps.cotes[1] / 2) - (d.scene.hauteur + EQUIPEMENT.praticable.hauteur)) < 0.01, 'la batterie repose sur le praticable');
  assert.ok(Math.abs((bas.position[1] - INSTRUMENTS.basse.corps.cotes[1] / 2) - d.scene.hauteur) < 0.01, 'la basse repose sur le plateau');
  const sans = pieceDepuisPlan({ postes: p, equipement: false }, {});
  assert.ok(!sans.meubles.some((x) => /Ampli|Praticable|Retour/.test(x.title)), 'sans équipement, rien de tout cela');
  const avec = pieceDepuisPlan({ postes: p }, {});
  assert.equal(avec.meubles.filter((x) => /Ampli|Praticable|Retour/.test(x.title)).length, 3);
});

test('la pièce complète : ids uniques contre le document, sync, entrée, gabarit valide', () => {
  const postes = placementClassique(plan('kick.wav', 'snare.wav', 'bass.wav', 'vox.wav', 'gtr.wav'));
  const rooms = [{ id: 'marees', title: 'Marées' }];
  const works = [{ id: 'marees-voix', title: 'Voix' }];
  const r = pieceDepuisPlan({ postes, scene: { largeur: 12, profondeur: 6 }, nom: 'Marées', gabarit: GABARIT }, { rooms, works });
  assert.equal(r.piece.id, 'marees-1', 'l\'identifiant est toujours suffixé, « marees » ou pas');
  assert.equal(r.piece.title, 'Marées');
  assert.equal(r.oeuvres.length, 4, 'un musicien par poste');
  assert.ok(r.oeuvres.every((o) => o.sync === 'marees-1'));
  assert.ok(r.oeuvres.every((o) => o.id.startsWith('marees-1-')));
  const ids = [...r.oeuvres, ...r.meubles].map((o) => o.id);
  assert.equal(new Set(ids).size, ids.length, 'identifiants uniques');
  assert.ok(!ids.includes('marees-voix'));
  assert.deepEqual(r.piece.works, ids);
  assert.deepEqual(r.piece.portals, []);
  assert.deepEqual(r.piece.spawn, r.dimensions.spawn);
  assert.deepEqual(r.piece.regard, r.dimensions.regard);
  assert.equal(r.piece.shell.width, 18);
  assert.deepEqual(r.piece.shell.windows, []);
  assert.equal(r.piece.reverb.taille, 0.55);
  assert.ok(r.piece.floor.texture, 'la finition s\'applique');
  assert.equal(r.voix, 4);
  // la pièce, débarrassée de son identité et de son contenu, est un gabarit valide
  const { id, title, works: w, portals, ...atmosphere } = r.piece;
  const v = validerGabarit({ nom: 'x', piece: atmosphere, meubles: [...r.oeuvres, ...r.meubles].map(({ id: _i, ...m }) => m) });
  assert.deepEqual(v, [], `gabarit valide : ${JSON.stringify(v)}`);
});

test('un plan sans poste ne fabrique rien ; le résumé compte et alerte au-delà du budget', () => {
  assert.throws(() => pieceDepuisPlan({ postes: [] }), /aucun poste/);
  assert.throws(() => pieceDepuisPlan({ postes: [{ id: 'a', instrument: 'voix', sons: [], x: 0, y: 0 }] }), /aucun poste/);
  const r = resumePlan(plan('kick.wav', 'snare.wav', 'bass.wav'), { largeur: 10, profondeur: 6 });
  assert.equal(r.texte, '2 postes, 3 pistes — scène de 10 × 6 m, salle de 16 × 19.2 m');
  assert.equal(r.alerte, null);
  const trop = resumePlan(plan(...Array.from({ length: BUDGET_VOIX + 1 }, (_, i) => `vox${i}.wav`)), {});
  assert.match(trop.alerte, /6 voix/);
  assert.equal(trop.voix, 7);
  assert.equal(SCENE.hauteur, 0.5);
});

console.log(`\n${ok} ✓  ${ko} ✗`);
if (ko) process.exit(1);

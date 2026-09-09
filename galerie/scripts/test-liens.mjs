/**
 * LES LIENS, LES SIGNAUX, LE DANCEFLOOR, LE PORTAIL PORTÉ — l'état pur.
 *
 *  - liens.js : normaliser, traduire l'ancien `model.audio`, résoudre une
 *    entrée depuis un signal (plage, bornes, bool), le portail `via` ;
 *  - signaux.js : les cases d'une bande, la moyenne d'une bande, la crête ;
 *  - dancefloor.js : les entrées ont la forme ISF, poser/appliquer/suivre
 *    poussent bien les uniforms (three au nœud, sans WebGL).
 *
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import { normaliserLien, liensDuModele, resoudreLien, resoudreLienSuivi, suivreEnveloppe, faconnerCourse, courseSuivie, portailPorte, courseDuSignal, fenetreObservee, normaliserHz, SIGNAUX, ENVELOPPE_DEFAUT, ENTREES_PIECE, multiplicateursPiece } from '../engine/src/core/liens.js';
import { casesDe, casesHz, niveauBande, crete, observer, niveauGlobal, BANDES } from '../engine/src/core/signaux.js';
import { creerDancefloor, ENTREES_DANCEFLOOR } from '../engine/src/core/dancefloor.js';

let ok = 0;
let ko = 0;
const groupe = (t) => console.log(`\n${t}`);
const test = (nom, fn) => {
  try { fn(); ok++; console.log(`  ✓ ${nom}`); }
  catch (e) { ko++; console.log(`  ✗ ${nom}\n      ${e.message}`); }
};

groupe('les liens : normaliser');

test('un lien complet garde entrée, œuvre, signal, plage, gain', () => {
  assert.deepEqual(normaliserLien({ entree: 'brightness', oeuvre: 'pulsation', signal: 'basse', min: 0.3, max: 1.2, gain: 2 }),
    { entree: 'brightness', oeuvre: 'pulsation', signal: 'basse', hz: undefined, min: 0.3, max: 1.2, bas: 0, haut: 1, gain: 2, ...ENVELOPPE_DEFAUT });
});

test('la fenêtre du signal : bas/haut bornés à 0..1, 0..1 si elle est vide ou à l\'envers', () => {
  const l = normaliserLien({ entree: 'a', oeuvre: 'x', bas: 0.55, haut: 0.9 });
  assert.equal(l.bas, 0.55); assert.equal(l.haut, 0.9);
  assert.deepEqual([normaliserLien({ entree: 'a', oeuvre: 'x', bas: 0.9, haut: 0.2 }).bas, normaliserLien({ entree: 'a', oeuvre: 'x', bas: 0.9, haut: 0.2 }).haut], [0, 1]);
  assert.deepEqual([normaliserLien({ entree: 'a', oeuvre: 'x', bas: -2, haut: 7 }).bas, normaliserLien({ entree: 'a', oeuvre: 'x', bas: -2, haut: 7 }).haut], [0, 1]);
  assert.deepEqual([normaliserLien({ entree: 'a', oeuvre: 'x', bas: 0.5, haut: 0.5 }).bas, normaliserLien({ entree: 'a', oeuvre: 'x', bas: 0.5, haut: 0.5 }).haut], [0, 1]);
});

test('sans entrée ou sans œuvre : null ; signal inconnu : niveau ; plage absente : undefined', () => {
  assert.equal(normaliserLien({ oeuvre: 'x' }), null);
  assert.equal(normaliserLien({ entree: 'a' }), null);
  assert.equal(normaliserLien('n/a'), null);
  const l = normaliserLien({ entree: ' a ', oeuvre: 'x', signal: 'voix', gain: -1 });
  assert.deepEqual(l, { entree: 'a', oeuvre: 'x', signal: 'niveau', hz: undefined, min: undefined, max: undefined, bas: 0, haut: 1, gain: 1, ...ENVELOPPE_DEFAUT });
});

test('les cinq signaux sont nommés, niveau d\'abord', () => {
  assert.deepEqual(SIGNAUX.map((s) => s.cle), ['niveau', 'basse', 'medium', 'aigu', 'crete', 'bande']);
});

test('liensDuModele : `liens` plus l\'ancien `audio` (le niveau de l\'œuvre elle-même), sans doublon', () => {
  const m = { liens: [{ entree: 'a', oeuvre: 'autre', signal: 'aigu' }], audio: { entree: 'b', gain: 0.5 } };
  const l = liensDuModele(m, 'moi');
  assert.equal(l.length, 2);
  assert.deepEqual(l[1], { entree: 'b', oeuvre: 'moi', signal: 'niveau', hz: undefined, min: undefined, max: undefined, bas: 0, haut: 1, gain: 0.5, ...ENVELOPPE_DEFAUT });
  // l'ancien n'ajoute rien si un lien nomme déjà son entrée
  assert.equal(liensDuModele({ liens: [{ entree: 'b', oeuvre: 'x' }], audio: { entree: 'b' } }, 'moi').length, 1);
  assert.deepEqual(liensDuModele(null, 'moi'), []);
});

groupe('les liens : résoudre');
const entree = { nom: 'brightness', type: 'float', defaut: 0.85, min: 0, max: 1.5 };

test('sans plage : du repos (le réglage) au maximum de l\'entrée', () => {
  const l = normaliserLien({ entree: 'brightness', oeuvre: 'p' });
  assert.equal(resoudreLien(l, entree, 0, 0.5), 0.5);
  assert.equal(resoudreLien(l, entree, 1, 0.5), 1.5);
  assert.ok(Math.abs(resoudreLien(l, entree, 0.5, 0.5) - 1.0) < 1e-9);
  // sans réglage : le défaut de l'entrée
  assert.equal(resoudreLien(l, entree, 0, undefined), 0.85);
});

test('avec plage : min → max, borné aux limites de l\'entrée, signal borné à [0,1] après gain', () => {
  const l = normaliserLien({ entree: 'brightness', oeuvre: 'p', min: 0.3, max: 2.0, gain: 2 });
  assert.equal(resoudreLien(l, entree, 0, 0.5), 0.3);
  assert.equal(resoudreLien(l, entree, 0.5, 0.5), 1.5);   // 0,5×2 = 1 → max 2,0 borné à 1,5
  assert.equal(resoudreLien(l, entree, 0.25, 0.5), 1.15); // 0,5 : 0,3 + 0,5·1,7
  assert.equal(resoudreLien(l, entree, -3, 0.5), 0.3);
});

test('une entrée bool bascule à mi-course ; une couleur ne se lie pas ; sans entrée : null', () => {
  const l = normaliserLien({ entree: 'animate', oeuvre: 'p' });
  assert.equal(resoudreLien(l, { nom: 'animate', type: 'bool', defaut: true }, 0.2, true), false);
  assert.equal(resoudreLien(l, { nom: 'animate', type: 'bool', defaut: true }, 0.7, true), true);
  assert.equal(resoudreLien(l, { nom: 'c', type: 'color', defaut: [1, 1, 1, 1] }, 1, null), null);
  assert.equal(resoudreLien(l, null, 1, 0), null);
});

test('la course du signal : 0 à bas, 1 à haut, bornée — le gain s\'applique avant', () => {
  const l = normaliserLien({ entree: 'a', oeuvre: 'x', bas: 0.5, haut: 0.9 });
  assert.equal(courseDuSignal(l, 0.5), 0);
  assert.equal(courseDuSignal(l, 0.9), 1);
  assert.ok(Math.abs(courseDuSignal(l, 0.7) - 0.5) < 1e-9);
  assert.equal(courseDuSignal(l, 0.2), 0);
  assert.equal(courseDuSignal(l, 1), 1);
  assert.equal(courseDuSignal(normaliserLien({ entree: 'a', oeuvre: 'x', gain: 2 }), 0.25), 0.5);
  assert.equal(courseDuSignal(null, 0.3), 0.3);
});

test('avec fenêtre : min à bas, max à haut — la pulsation (0,59–0,88) parcourt toute la plage', () => {
  const l = normaliserLien({ entree: 'brightness', oeuvre: 'p', min: 0.2, max: 1.0, bas: 0.59, haut: 0.88 });
  assert.ok(Math.abs(resoudreLien(l, entree, 0.59, 0.5) - 0.2) < 1e-9);
  assert.ok(Math.abs(resoudreLien(l, entree, 0.88, 0.5) - 1.0) < 1e-9);
  assert.equal(resoudreLien(l, entree, 0.3, 0.5), 0.2);
  // une bool bascule au milieu de la fenêtre
  const b = normaliserLien({ entree: 'animate', oeuvre: 'p', bas: 0.6, haut: 0.8 });
  assert.equal(resoudreLien(b, { nom: 'animate', type: 'bool', defaut: true }, 0.65, true), false);
  assert.equal(resoudreLien(b, { nom: 'animate', type: 'bool', defaut: true }, 0.75, true), true);
});

test('fenetreObservee : arrondie au centième, ouverte d\'un rien, jamais plus étroite que 0,05, dans 0..1', () => {
  assert.deepEqual(fenetreObservee(0.592, 0.877), { bas: 0.59, haut: 0.88 });
  assert.deepEqual(fenetreObservee(0.5, 0.5), { bas: 0.48, haut: 0.53 });
  assert.deepEqual(fenetreObservee(0, 0), { bas: 0, haut: 0.05 });
  assert.deepEqual(fenetreObservee(0.99, 1), { bas: 0.95, haut: 1 });
  assert.deepEqual(fenetreObservee(NaN, undefined), { bas: 0, haut: 0.05 });
});

groupe('le passe-bande (signal « bande », deux fréquences)');

test('normaliserHz : défaut 80–4 000, bornes 10–20 000, remise dans l\'ordre, jamais vide', () => {
  assert.deepEqual(normaliserHz(undefined), [80, 4000]);
  assert.deepEqual(normaliserHz([40, 120]), [40, 120]);
  assert.deepEqual(normaliserHz([120, 40]), [40, 120]);
  assert.deepEqual(normaliserHz([-5, 1e6]), [10, 20000]);
  assert.deepEqual(normaliserHz([500, 500]), [500, 501]);
  assert.deepEqual(normaliserHz(['a', 300]), [80, 300]);
});

test('un lien « bande » porte ses Hz normalisés ; les autres signaux n\'en portent pas', () => {
  const l = normaliserLien({ entree: 'a', oeuvre: 'x', signal: 'bande', hz: [6000, 12000] });
  assert.deepEqual(l.hz, [6000, 12000]);
  assert.deepEqual(normaliserLien({ entree: 'a', oeuvre: 'x', signal: 'bande' }).hz, [80, 4000]);
  assert.equal(normaliserLien({ entree: 'a', oeuvre: 'x', signal: 'basse', hz: [1, 2] }).hz, undefined);
});

test('casesHz : les cases entre deux fréquences, bornées au spectre, jamais à l\'envers', () => {
  assert.deepEqual(casesHz(40, 120, 48000, 512), [0, 2]);       // 93,75 Hz par case
  assert.deepEqual(casesHz(6000, 12000, 48000, 512), [64, 128]);
  assert.deepEqual(casesHz(30000, 40000, 48000, 512), [255, 255]);
  assert.deepEqual(casesDe('basse', 48000, 512), casesHz(20, 250, 48000, 512));
});

groupe('l\'enveloppe (Rise / Fall / courbe / inverse)');

test('normaliser : attaque et retombée en ms (≥ 0, bornées), courbe > 0, inverse booléen', () => {
  const l = normaliserLien({ entree: 'a', oeuvre: 'x', attaque: 5, retombee: 800, courbe: 0.5, inverse: true });
  assert.deepEqual([l.attaque, l.retombee, l.courbe, l.inverse], [5, 800, 0.5, true]);
  const d = normaliserLien({ entree: 'a', oeuvre: 'x', attaque: -3, retombee: 'vite', courbe: 0, inverse: 'oui' });
  assert.deepEqual([d.attaque, d.retombee, d.courbe, d.inverse], [ENVELOPPE_DEFAUT.attaque, ENVELOPPE_DEFAUT.retombee, 1, false]);
  assert.equal(normaliserLien({ entree: 'a', oeuvre: 'x', retombee: 1e9 }).retombee, 60000);
});

test('suivreEnveloppe : monte à la vitesse de l\'attaque, descend à celle de la retombée ; 0 = tout de suite', () => {
  const l = normaliserLien({ entree: 'a', oeuvre: 'x', attaque: 100, retombee: 1000 });
  // depuis rien : la cible
  assert.equal(suivreEnveloppe(undefined, 0.8, 0.016, l), 0.8);
  // montée : une constante de temps (100 ms) → 63 %
  const m = suivreEnveloppe(0, 1, 0.1, l);
  assert.ok(Math.abs(m - 0.632) < 0.01, `montée ${m}`);
  // descente : 100 ms sur une retombée de 1 s → n'a perdu que ~10 %
  const d = suivreEnveloppe(1, 0, 0.1, l);
  assert.ok(Math.abs(d - 0.905) < 0.01, `descente ${d}`);
  // instantané
  const i = normaliserLien({ entree: 'a', oeuvre: 'x', attaque: 0, retombee: 0 });
  assert.equal(suivreEnveloppe(0.2, 0.9, 0.016, i), 0.9);
  assert.equal(suivreEnveloppe(0.9, 0.2, 0.016, i), 0.2);
  // la cible est bornée
  assert.equal(suivreEnveloppe(undefined, 3, 0.1, l), 1);
});

test('faconnerCourse : courbe 1 droite, < 1 réagit tôt, > 1 tard ; inverse retourne', () => {
  assert.equal(faconnerCourse(normaliserLien({ entree: 'a', oeuvre: 'x' }), 0.5), 0.5);
  assert.ok(faconnerCourse(normaliserLien({ entree: 'a', oeuvre: 'x', courbe: 0.5 }), 0.25) > 0.49);
  assert.ok(faconnerCourse(normaliserLien({ entree: 'a', oeuvre: 'x', courbe: 2 }), 0.5) < 0.26);
  assert.equal(faconnerCourse(normaliserLien({ entree: 'a', oeuvre: 'x', inverse: true }), 0.2), 0.8);
  assert.equal(faconnerCourse(normaliserLien({ entree: 'a', oeuvre: 'x' }), 7), 1);
});

test('courseSuivie / resoudreLienSuivi : l\'état vit dans la Map de l\'appelant, par entrée', () => {
  const l = normaliserLien({ entree: 'brightness', oeuvre: 'p', attaque: 0, retombee: 1000, min: 0, max: 1 });
  const etats = new Map();
  assert.equal(courseSuivie(l, 1, etats, 0.016), 1);
  assert.equal(etats.get('brightness'), 1);
  // le signal tombe à 0 : la course tient (retombée 1 s)
  const c = courseSuivie(l, 0, etats, 0.1);
  assert.ok(c > 0.85 && c < 0.95, `tenue ${c}`);
  assert.ok(resoudreLienSuivi(l, entree, 0, 0.5, etats, 0.1) > 0.8);
  // sans Map : instantané, sans erreur
  assert.equal(resoudreLienSuivi(l, entree, 0, 0.5, null, 0.1), 0);
  // inverse : plein signal → min
  const inv = normaliserLien({ entree: 'b', oeuvre: 'p', inverse: true, min: 0.2, max: 1, attaque: 0 });
  assert.equal(resoudreLienSuivi(inv, { ...entree, nom: 'b' }, 1, 0.5, new Map(), 0.016), 0.2);
});

groupe('les lumières de la pièce');

test('ENTREES_PIECE : quatre multiplicateurs à la forme ISF, repos 1', () => {
  assert.deepEqual(ENTREES_PIECE.map((e) => e.nom), ['keyLight', 'ambient', 'env', 'fog']);
  for (const e of ENTREES_PIECE) { assert.equal(e.type, 'float'); assert.equal(e.defaut, 1); assert.ok(e.max > 1 && e.etiquette); }
});

test('multiplicateursPiece : un multiplicateur par lien valide, enveloppe avec état, entrée inconnue ignorée', () => {
  const liens = [
    { entree: 'env', oeuvre: 'p', signal: 'basse', min: 0.5, max: 2.5, bas: 0.6, haut: 0.85, attaque: 0, retombee: 0 },
    { entree: 'fog', oeuvre: 'p', signal: 'crete', inverse: true, attaque: 0, retombee: 0 },
    { entree: 'sol', oeuvre: 'p' }, { oeuvre: 'p' }, 'n/a'
  ];
  const etats = new Map();
  const m = multiplicateursPiece(liens, (l) => (l.signal === 'basse' ? 0.85 : 1), etats, 0.016);
  assert.deepEqual(Object.keys(m), ['env', 'fog']);
  assert.ok(Math.abs(m.env - 2.5) < 1e-9);
  // inverse, plein signal : de repos 1 au max… retourné → min = repos 1 ; sans plage : min = repos (1), max = 4 → 1
  assert.ok(Math.abs(m.fog - 1) < 1e-9);
  assert.deepEqual(multiplicateursPiece(null, () => 1, etats, 0.016), {});
  // l'état tient d'une image à l'autre (retombée longue)
  const lent = [{ entree: 'env', oeuvre: 'p', min: 0, max: 2, attaque: 0, retombee: 5000 }];
  const e2 = new Map();
  multiplicateursPiece(lent, () => 1, e2, 0.016);
  assert.ok(multiplicateursPiece(lent, () => 0, e2, 0.016).env > 1.9);
});

groupe('le portail porté par une œuvre');

test('portailPorte trouve l\'entrée `via` de la pièce, et rien sinon', () => {
  const salle = { portals: [{ to: 'a', position: [0, 0, 0] }, { to: 'dancefloor', via: 'shader-dancefloor', arrival: [0, 2.2, 9] }] };
  assert.equal(portailPorte(salle, 'shader-dancefloor').to, 'dancefloor');
  assert.equal(portailPorte(salle, 'autre'), null);
  assert.equal(portailPorte(null, 'x'), null);
  assert.equal(portailPorte({ portals: [{ via: 'x' }] }, 'x'), null);   // sans `to`, ce n'est pas un portail
});

groupe('les signaux');

test('les cases d\'une bande suivent la fréquence d\'échantillonnage et la taille de FFT', () => {
  assert.deepEqual(casesDe('basse', 48000, 512), [0, 3]);       // 93,75 Hz par case : 20→0, 250→3
  assert.deepEqual(casesDe('aigu', 48000, 512), [21, 86]);
  assert.deepEqual(casesDe('niveau', 22050, 512), [0, 255]);    // 16 kHz > Nyquist : borné à la dernière case
  assert.deepEqual(casesDe('inconnue', 48000, 512), casesDe('niveau', 48000, 512));
  assert.deepEqual(Object.keys(BANDES), ['niveau', 'basse', 'medium', 'aigu']);
});

test('la moyenne d\'une bande vaut 0..1, ignore les bornes hors spectre, 0 sur le vide', () => {
  const data = new Uint8Array(8).fill(255);
  assert.equal(niveauBande(data, 0, 7), 1);
  data.fill(0); data[2] = 255; data[3] = 255;
  assert.equal(niveauBande(data, 2, 3), 1);
  assert.equal(niveauBande(data, 0, 7), 0.25);
  assert.equal(niveauBande(data, 6, 100), 0);
  assert.equal(niveauBande(null, 0, 1), 0);
  assert.equal(niveauBande(data, 5, 2), 0);
});

test('le niveau global est la moyenne des trois bandes — une grosse caisse seule pèse un tiers', () => {
  assert.ok(Math.abs(niveauGlobal(0.9, 0, 0) - 0.3) < 1e-9);
  assert.equal(niveauGlobal(1, 1, 1), 1);
  assert.equal(niveauGlobal(undefined, NaN, null), 0);
});

test('la crête monte d\'un coup et retombe lentement', () => {
  assert.equal(crete(0.2, 0.9, 0.016), 0.9);
  const apres = crete(0.9, 0, 0.1);
  assert.ok(apres > 0.5 && apres < 0.9, `retombée ${apres}`);
});

test('observer : la plage suit les extrêmes tout de suite et se resserre lentement', () => {
  let o = observer(null, 0.7, 0);
  assert.deepEqual(o, { min: 0.7, max: 0.7, valeur: 0.7 });
  o = observer(o, 0.9, 0.016);
  assert.equal(o.max, 0.9);
  o = observer(o, 0.5, 0.016);
  assert.equal(o.min, 0.5); assert.ok(o.max > 0.89);
  // longtemps à 0,6 : les bornes se referment dessus
  for (let i = 0; i < 600; i++) o = observer(o, 0.6, 0.1);
  assert.ok(Math.abs(o.min - 0.6) < 0.01 && Math.abs(o.max - 0.6) < 0.01, `${o.min} ${o.max}`);
  assert.equal(observer(o, 3, 0.1).max, 1);   // borné
});

groupe('le dancefloor');

test('les entrées ont la forme ISF et portent les noms du shader de l\'auteur', () => {
  for (const e of ENTREES_DANCEFLOOR) assert.ok(e.nom && e.type && 'defaut' in e && e.etiquette);
  const noms = ENTREES_DANCEFLOOR.map((e) => e.nom);
  for (const n of ['pattern_mode', 'pattern_speed', 'tile_color', 'hue_spread', 'glow_strength', 'brightness', 'tiles_mask_lo', 'animate']) assert.ok(noms.includes(n), n);
});

test('creerDancefloor : grille, réglages appliqués aux uniforms, poser, bornes', () => {
  const sol = creerDancefloor({ size: 24, cols: 10, rows: 8, reglages: { brightness: 0.4, pattern_mode: 3, tile_color: [0, 1, 0] } });
  assert.equal(sol.uniforms.grid_cols.value, 10);
  assert.equal(sol.uniforms.grid_rows.value, 8);
  assert.equal(sol.uniforms.brightness.value, 0.4);
  assert.equal(sol.uniforms.pattern_mode.value, 3);
  assert.deepEqual([sol.uniforms.tile_color.value.x, sol.uniforms.tile_color.value.y, sol.uniforms.tile_color.value.z, sol.uniforms.tile_color.value.w], [0, 1, 0, 1]);
  sol.poser('brightness', 1.2);
  assert.equal(sol.uniforms.brightness.value, 1.2);
  sol.poser('inconnue', 3);   // ignoré
  sol.appliquer({ brightness: 9 });   // borné au max de l'entrée
  assert.equal(sol.uniforms.brightness.value, 1.5);
  sol.rendre(3601.5);
  assert.ok(Math.abs(sol.uniforms.TIME.value - 1.5) < 1e-9);
  assert.equal(sol.mesh.userData.ignoreRaycast, true);
  sol.dispose();
});

test('suivre : les liens poussent les entrées depuis un service de signaux de carton', () => {
  const sol = creerDancefloor({ reglages: { brightness: 0.5 },
    liens: [{ entree: 'brightness', oeuvre: 'pulsation', signal: 'basse', max: 1.5, attaque: 0, retombee: 0 }, { entree: 'nope', oeuvre: 'x' }, 'invalide'] });
  assert.equal(sol.liens.length, 2);   // l'invalide est écarté ; l'entrée inconnue reste un lien, sans effet
  const signaux = { valeur: (id, s) => (id === 'pulsation' && s === 'basse' ? 0.5 : 0) };
  sol.suivre(signaux);
  assert.equal(sol.uniforms.brightness.value, 1.0);   // 0,5 + 0,5·(1,5−0,5)
  sol.regler({ liens: [] });
  sol.suivre(signaux);
  assert.equal(sol.uniforms.brightness.value, 1.0);   // plus de lien : rien ne bouge
  sol.regler({ reglages: { brightness: 0.2 } });
  assert.equal(sol.uniforms.brightness.value, 0.2);
  sol.dispose();
});

console.log(`\n${ok} ✓ / ${ko} ✗`);
process.exit(ko ? 1 : 0);

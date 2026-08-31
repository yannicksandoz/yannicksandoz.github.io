/**
 * COMPOSER UNE EXPOSITION — gabarits, suppression en cascade, duplication.
 *
 *   1. les gabarits du moteur sont des JSON valides, au format promis ;
 *   2. instancier un gabarit donne des ids uniques, jamais d'œuvre, jamais
 *      de portail — et deux instanciations ne se marchent pas dessus ;
 *   3. « enregistrer comme modèle » n'emporte ni id, ni œuvres, ni portails,
 *      ni jetons — le mobilier seulement, et sur demande ;
 *   4. supprimer une pièce nomme ses conséquences, retire portails entrants
 *      et vistas, déplace ou supprime les œuvres — et le RÉSULTAT passe les
 *      trois règles de test-portails, sinon on refuse ;
 *   5. dupliquer donne des ids neufs, pas de portails, place la copie à côté.
 *
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gabaritDepuisPiece, instancierGabarit, validerGabarit, CHAMPS_EXCLUS }
  from '../engine/src/editor/state/Gabarits.js';
import { consequencesSuppression, simulerSuppression, validerPortails,
  simulerDuplication, pieceEntree } from '../engine/src/editor/state/pieces-regles.js';

let ok = 0, ko = 0;
const test = (nom, fn) => {
  try { fn(); ok++; console.log(`  ✓ ${nom}`); }
  catch (e) { ko++; console.log(`  ✗ ${nom}\n    ${e.message}`); }
};
const titre = (t) => console.log(`\n${t}`);

const ici = dirname(fileURLToPath(import.meta.url));
const DOSSIER_MOTEUR = join(ici, '..', 'engine', 'src', 'editor', 'gabarits');

/* ---------------------------------------------------------- une galerie --- */
const galerie = () => structuredClone({
  works: [
    { id: 'tableau', title: 'Tableau', image: 'a.jpg', position: [0, 1.5, -3] },
    { id: 'banc', title: 'Banc', role: 'decor', model: { shape: 'banc' }, position: [0, 0, 0] },
    { id: 'lampe', title: 'Lampe', role: 'decor', position: [2, 3, 0] },
    { id: 'echo', title: 'Écho', stems: [{ file: 'e.mp3' }], position: [1, 1, 1] }
  ],
  rooms: [
    { id: 'entree', title: 'Entrée', works: ['tableau', 'banc'], spawn: [0, 2.2, 7],
      portals: [{ to: 'salle-b', position: [3, 0, -5] }],
      jetons: [[1, 1, 1]] },
    { id: 'salle-b', title: 'Salle B', works: ['lampe', 'echo'],
      portals: [{ to: 'entree', position: [0, 0, 4] }, { to: 'cul-de-sac', position: [2, 0, 4] }],
      vistas: [{ room: 'entree', wall: 'nord' }] },
    { id: 'cul-de-sac', title: 'Cul-de-sac', works: [],
      portals: [{ to: 'salle-b', position: [0, 0, 2] }] }
  ],
  gabarits: []
});

titre('les gabarits du moteur : quatre JSON valides');
test('salle, couloir, extérieur, vide — tous lisibles et sains', () => {
  const fichiers = readdirSync(DOSSIER_MOTEUR).filter((f) => f.endsWith('.json'));
  assert.equal(fichiers.length, 4, `${fichiers.length} gabarits, 4 attendus`);
  for (const f of fichiers) {
    const g = JSON.parse(readFileSync(join(DOSSIER_MOTEUR, f), 'utf8'));
    const defauts = validerGabarit(g);
    assert.deepEqual(defauts, [], `${f} : ${defauts.join(' ; ')}`);
  }
});

titre('instancier un gabarit');
test('ids uniques, aucune œuvre, aucun portail', () => {
  const data = galerie();
  const g = JSON.parse(readFileSync(join(DOSSIER_MOTEUR, 'salle.json'), 'utf8'));
  const { piece, meubles } = instancierGabarit(g, data);
  assert.ok(piece.id && !data.rooms.some((r) => r.id === piece.id));
  assert.deepEqual(piece.portals, []);
  assert.deepEqual(piece.works, []);
  assert.equal(meubles.length, 0);
  for (const champ of ['jetons', 'vistas']) assert.ok(!(champ in piece), champ);
});
test('les meubles sont re-identifiés, en décor, sans collision', () => {
  const data = galerie();
  const g = {
    nom: 'Salon', description: '', vignette: null,
    piece: { spawn: [0, 2.2, 5] },
    meubles: [{ title: 'Banc', model: { shape: 'banc' }, position: [1, 0, 0] },
      { title: 'Banc', model: { shape: 'banc' }, position: [-1, 0, 0] }]
  };
  const a = instancierGabarit(g, data);
  assert.equal(a.meubles.length, 2);
  assert.notEqual(a.meubles[0].id, a.meubles[1].id);
  assert.ok(a.meubles.every((m) => m.role === 'decor'));
  assert.deepEqual(a.piece.works, a.meubles.map((m) => m.id));
  // deuxième instanciation APRÈS insertion : toujours unique
  data.rooms.push(a.piece);
  data.works.push(...a.meubles);
  const b = instancierGabarit(g, data);
  assert.notEqual(b.piece.id, a.piece.id);
  const tous = new Set([...a.meubles, ...b.meubles].map((m) => m.id));
  assert.equal(tous.size, 4, 'collision d\'ids entre deux instanciations');
});

titre('enregistrer une pièce comme modèle');
test('ni id, ni œuvres, ni portails, ni jetons, ni vistas, ni ambiance', () => {
  const data = galerie();
  const g = gabaritDepuisPiece(data.rooms[0], data.works, { nom: 'Hall' });
  for (const champ of CHAMPS_EXCLUS) assert.ok(!(champ in g.piece), champ);
  assert.deepEqual(validerGabarit(g), []);
});
test('le mobilier suit (coché), les œuvres jamais', () => {
  const data = galerie();
  const avec = gabaritDepuisPiece(data.rooms[0], data.works, { nom: 'Hall' });
  assert.equal(avec.meubles.length, 1); // le banc — pas le tableau
  assert.equal(avec.meubles[0].title, 'Banc');
  assert.ok(!avec.meubles[0].id, 'un meuble de gabarit ne porte pas d\'id');
  const sans = gabaritDepuisPiece(data.rooms[0], data.works,
    { nom: 'Hall', meubles: false });
  assert.equal(sans.meubles.length, 0);
});

titre('supprimer une pièce : les conséquences sont nommées');
test('œuvres, portails entrants, vistas, jetons, entrée', () => {
  const data = galerie();
  const csq = consequencesSuppression(data, 'entree');
  assert.deepEqual(csq.oeuvres, ['tableau', 'banc']);
  assert.equal(csq.entrants.length, 1);            // salle-b → entree
  assert.equal(csq.vistasVers.length, 1);          // la vista de salle-b
  assert.equal(csq.jetons, 1);
  assert.equal(csq.estEntree, true);
  assert.equal(pieceEntree(data.rooms), 'entree');
});

titre('la simulation, puis les trois règles des portails');
test('supprimer le cul-de-sac : cascade propre, galerie valide', () => {
  const data = galerie();
  const apres = simulerSuppression(data, 'cul-de-sac', {});
  assert.equal(apres.rooms.length, 2);
  // le portail salle-b → cul-de-sac est retiré
  assert.ok(!apres.rooms.some((r) => (r.portals ?? []).some((p) => p.to === 'cul-de-sac')));
  assert.deepEqual(validerPortails(apres.rooms), []);
});
test('déplacer les œuvres au lieu de les perdre', () => {
  const data = galerie();
  const apres = simulerSuppression(data, 'salle-b',
    { deplacerVers: 'entree' });
  const entree = apres.rooms.find((r) => r.id === 'entree');
  assert.ok(entree.works.includes('lampe') && entree.works.includes('echo'));
  assert.ok(apres.works.some((w) => w.id === 'echo'), 'l\'œuvre existe encore');
});
test('sans déplacement, les œuvres partent du catalogue', () => {
  const data = galerie();
  const apres = simulerSuppression(data, 'salle-b', {});
  assert.ok(!apres.works.some((w) => w.id === 'echo'));
  assert.ok(apres.works.some((w) => w.id === 'tableau'), 'les autres restent');
});
test('supprimer l\'entrée exige une nouvelle entrée — et la met en tête', () => {
  const data = galerie();
  const apres = simulerSuppression(data, 'entree',
    { nouvelleEntree: 'salle-b' });
  assert.equal(apres.rooms[0].id, 'salle-b');
  assert.deepEqual(validerPortails(apres.rooms), []);
});
test('une suppression qui isole une pièce est REFUSÉE par les règles', () => {
  // entree — salle-b — cul-de-sac : retirer salle-b coupe le cul-de-sac
  const data = galerie();
  const apres = simulerSuppression(data, 'salle-b', { nouvelleEntree: null });
  const erreurs = validerPortails(apres.rooms);
  assert.ok(erreurs.some((e) => e.includes('isolée')),
    `attendu une pièce isolée, obtenu : ${erreurs.join(' ; ') || '(rien)'}`);
});
test('les trois règles elles-mêmes : orphelin, sens unique, îlot', () => {
  assert.ok(validerPortails([
    { id: 'a', portals: [{ to: 'fantome' }] }
  ]).some((e) => e.includes('perdue')));
  assert.ok(validerPortails([
    { id: 'a', portals: [{ to: 'b' }] }, { id: 'b', portals: [] }
  ]).some((e) => e.includes('sens unique')));
  assert.ok(validerPortails([
    { id: 'a', portals: [] }, { id: 'b', portals: [] }
  ]).some((e) => e.includes('isolée')));
  // Escher : une pièce vers elle-même est son propre retour
  assert.deepEqual(validerPortails([
    { id: 'a', portals: [{ to: 'a', plane: 'nord' }] }
  ]), []);
});

titre('dupliquer une pièce');
test('ids neufs, pas de portails, placée à côté, œuvres au choix', () => {
  const data = galerie();
  const avec = simulerDuplication(data, 'entree', { avecOeuvres: true });
  assert.equal(avec.index, 1);
  assert.notEqual(avec.piece.id, 'entree');
  assert.deepEqual(avec.piece.portals, []);
  assert.equal(avec.oeuvres.length, 2);
  assert.ok(avec.oeuvres.every((o) => !data.works.some((w) => w.id === o.id)));
  assert.deepEqual(avec.piece.works, avec.oeuvres.map((o) => o.id));
  const sans = simulerDuplication(data, 'entree', { avecOeuvres: false });
  assert.equal(sans.oeuvres.length, 1); // le banc (décor) seulement
});

console.log(`\n${ok} ✓  ${ko} ✗`);
process.exit(ko ? 1 : 0);

/**
 * Test du cœur d'édition : chemins, commandes, historique.
 * Sans dépendance ni navigateur.  Lancer avec : npm test
 */
import { getPath, setPath, samePath } from '../engine/src/editor/state/paths.js';
import { patch, splice, batch } from '../engine/src/editor/state/commands.js';
import { History } from '../engine/src/editor/state/History.js';

let passed = 0, failed = 0;
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function check(name, actual, expected) {
  if (eq(actual, expected)) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}\n      attendu : ${JSON.stringify(expected)}\n      obtenu  : ${JSON.stringify(actual)}`); }
}

/** Document minimal, à l'image d'une scène réelle. */
function makeDoc() {
  const data = {
    works: [
      { id: 'a', title: 'A', position: [0, 2, 0], rotationY: 0, scale: 1,
        stems: [{ file: 'x.wav', radius: 10, gain: 1 }], modules: [] },
      { id: 'b', title: 'B', position: [5, 2, 0], rotationY: 90, scale: 1 }
    ],
    rooms: [{ id: 'hall', title: 'Hall', works: ['a', 'b'], portals: [] }]
  };
  return { data, workIndex: (id) => data.works.findIndex((w) => w.id === id) };
}

console.log('\npaths');
{
  const o = { a: { b: [1, 2, 3] } };
  check('getPath imbriqué', getPath(o, ['a', 'b', 1]), 2);
  check('getPath absent', getPath(o, ['a', 'zzz', 0]), undefined);
  const before = setPath(o, ['a', 'b', 1], 99);
  check('setPath renvoie l’ancienne valeur', before, 2);
  check('setPath écrit', o.a.b[1], 99);
  setPath(o, ['nouveau', 'clé'], 'v');
  check('setPath crée les conteneurs', o.nouveau.clé, 'v');
  setPath(o, ['nouveau', 'clé'], undefined);
  check('setPath supprime avec undefined', 'clé' in o.nouveau, false);
  check('samePath', samePath(['a', 1], ['a', 1]), true);
  check('samePath différent', samePath(['a', 1], ['a', 2]), false);
}

console.log('\npatch — annulation et rétablissement');
{
  const doc = makeDoc();
  const cmd = patch(doc, ['works', 0, 'title'], 'Nouveau titre');
  cmd.do();
  check('valeur appliquée', doc.data.works[0].title, 'Nouveau titre');
  cmd.undo();
  check('valeur restaurée', doc.data.works[0].title, 'A');
  cmd.do();
  check('rétablie', doc.data.works[0].title, 'Nouveau titre');
}

console.log('\npatch — portée déduite');
{
  const doc = makeDoc();
  check('transform → transformOnly',
    patch(doc, ['works', 0, 'position'], [1, 1, 1]).scope, { transformOnly: true, works: ['a'] });
  check('propriété → œuvre ciblée',
    patch(doc, ['works', 0, 'title'], 'x').scope, { works: ['a'] });
  check('pièce → structurel',
    patch(doc, ['rooms', 0, 'title'], 'x').scope, { structural: true });
  check('rotation v2 → transformOnly',
    patch(doc, ['works', 0, 'rotation'], [0, 45, 0]).scope,
    { transformOnly: true, works: ['a'] });
}

console.log('\npatch — portée voxel (rafraîchit le maillage, pas l’œuvre)');
{
  const doc = makeDoc();
  check('cellules → voxelOnly',
    patch(doc, ['works', 0, 'model', 'cells'], [8, 0]).scope,
    { voxelOnly: true, works: ['a'] });
  check('palette → voxelOnly',
    patch(doc, ['works', 0, 'model', 'palette', 0], '#fff').scope,
    { voxelOnly: true, works: ['a'] });
  check('autre champ de modèle → reconstruction de l’œuvre',
    patch(doc, ['works', 0, 'model', 'url'], 'x.glb').scope, { works: ['a'] });
  check('lot entièrement voxel → voxelOnly',
    batch([
      patch(doc, ['works', 0, 'model', 'dims'], [2, 2, 2], { scope: { voxelOnly: true, works: ['a'] } }),
      patch(doc, ['works', 0, 'model', 'cells'], [8, 0])
    ]).scope, { voxelOnly: true, works: ['a'] });
  check('lot mixte → reconstruction de l’œuvre',
    batch([
      patch(doc, ['works', 0, 'model', 'cells'], [8, 0]),
      patch(doc, ['works', 0, 'title'], 'Z')
    ]).scope, { works: ['a'] });
}

console.log('\nsplice — insertion et suppression');
{
  const doc = makeDoc();
  const add = splice(doc, ['works', 0, 'stems'], 1, 0, [{ file: 'y.wav', radius: 5, gain: 1 }]);
  add.do();
  check('stem inséré', doc.data.works[0].stems.length, 2);
  add.undo();
  check('insertion annulée', doc.data.works[0].stems.length, 1);

  const del = splice(doc, ['works', 0, 'stems'], 0, 1);
  del.do();
  check('stem supprimé', doc.data.works[0].stems.length, 0);
  del.undo();
  check('suppression annulée — contenu restauré',
    doc.data.works[0].stems, [{ file: 'x.wav', radius: 10, gain: 1 }]);
}

console.log('\nbatch — tout ou rien, dans l’ordre inverse à l’annulation');
{
  const doc = makeDoc();
  const b = batch([
    patch(doc, ['works', 0, 'position'], [9, 9, 9]),
    patch(doc, ['works', 0, 'rotationY'], 45)
  ]);
  b.do();
  check('les deux appliquées', [doc.data.works[0].position, doc.data.works[0].rotationY], [[9, 9, 9], 45]);
  b.undo();
  check('les deux annulées', [doc.data.works[0].position, doc.data.works[0].rotationY], [[0, 2, 0], 0]);
}

console.log('\nhistory — fusion des mutations rapprochées (glissement de gizmo)');
{
  const doc = makeDoc();
  const h = new History({ mergeWindowMs: 600 });
  const t0 = 1000;
  // 3 écritures successives au même chemin, comme pendant un drag
  for (let i = 1; i <= 3; i++) {
    const c = patch(doc, ['works', 0, 'position'], [i, 0, 0]);
    c.do();
    h.push(c, t0 + i * 50);
  }
  check('une seule entrée d’historique', h.undoStack.length, 1);
  check('état final conservé', doc.data.works[0].position, [3, 0, 0]);
  h.undo();
  check('une annulation ramène à l’origine', doc.data.works[0].position, [0, 2, 0]);
  h.redo();
  check('rétablissement complet', doc.data.works[0].position, [3, 0, 0]);
}

console.log('\nhistory — pas de fusion après un scellement ou une pause');
{
  const doc = makeDoc();
  const h = new History({ mergeWindowMs: 600 });
  const c1 = patch(doc, ['works', 0, 'position'], [1, 0, 0]); c1.do(); h.push(c1, 1000);
  h.seal();
  const c2 = patch(doc, ['works', 0, 'position'], [2, 0, 0]); c2.do(); h.push(c2, 1050);
  check('deux entrées après seal', h.undoStack.length, 2);

  const h2 = new History({ mergeWindowMs: 600 });
  const d = makeDoc();
  const a = patch(d, ['works', 0, 'position'], [1, 0, 0]); a.do(); h2.push(a, 1000);
  const b2 = patch(d, ['works', 0, 'position'], [2, 0, 0]); b2.do(); h2.push(b2, 5000); // pause
  check('deux entrées après une pause', h2.undoStack.length, 2);
}

console.log('\nhistory — chemins différents ne fusionnent pas');
{
  const doc = makeDoc();
  const h = new History();
  const c1 = patch(doc, ['works', 0, 'title'], 'X'); c1.do(); h.push(c1, 1000);
  const c2 = patch(doc, ['works', 1, 'title'], 'Y'); c2.do(); h.push(c2, 1010);
  check('deux entrées', h.undoStack.length, 2);
  h.undo();
  check('seule la dernière est annulée', [doc.data.works[0].title, doc.data.works[1].title], ['X', 'B']);
}

console.log('\nhistory — une nouvelle commande efface la pile de rétablissement');
{
  const doc = makeDoc();
  const h = new History();
  const c1 = patch(doc, ['works', 0, 'title'], 'X'); c1.do(); h.push(c1, 1000);
  h.undo();
  check('rétablissement disponible', h.canRedo, true);
  const c2 = patch(doc, ['works', 0, 'title'], 'Y'); c2.do(); h.push(c2, 9000);
  check('rétablissement effacé', h.canRedo, false);
}

console.log('\nhistory — plafond de la pile');
{
  const doc = makeDoc();
  const h = new History({ limit: 5, mergeWindowMs: 0 });
  for (let i = 0; i < 20; i++) {
    const c = patch(doc, ['works', 0, 'title'], `t${i}`); c.do(); h.push(c, 1000 + i * 1000);
  }
  check('pile plafonnée', h.undoStack.length, 5);
}

console.log('\nbatch — fusion des lots alignés (glissement de gizmo)');
{
  const doc = makeDoc();
  const h = new History({ mergeWindowMs: 600 });
  const mkMove = (x) => batch([
    patch(doc, ['works', 0, 'position'], [x, 2, 0]),
    patch(doc, ['works', 0, 'rotationY'], x * 10)
  ], 'transformation');
  for (let i = 1; i <= 5; i++) { const c = mkMove(i); c.do(); h.push(c, 1000 + i * 40); }
  check('un seul pas d’historique pour tout le glissement', h.undoStack.length, 1);
  check('état final', [doc.data.works[0].position, doc.data.works[0].rotationY], [[5, 2, 0], 50]);
  h.undo();
  check('une annulation restaure l’état d’avant le glissement',
    [doc.data.works[0].position, doc.data.works[0].rotationY], [[0, 2, 0], 0]);
}

console.log('\nbatch — lots non alignés : pas de fusion');
{
  const doc = makeDoc();
  const h = new History({ mergeWindowMs: 600 });
  const c1 = batch([patch(doc, ['works', 0, 'position'], [1, 2, 0])]); c1.do(); h.push(c1, 1000);
  const c2 = batch([patch(doc, ['works', 1, 'position'], [9, 2, 0])]); c2.do(); h.push(c2, 1010);
  check('deux entrées (cibles différentes)', h.undoStack.length, 2);
}

console.log('\nno-op — une écriture sans changement n’entre pas dans l’historique');
{
  const doc = makeDoc();
  check('patch identique détecté',
    patch(doc, ['works', 0, 'title'], 'A').isNoop(), true);
  check('patch différent non signalé',
    patch(doc, ['works', 0, 'title'], 'Z').isNoop(), false);
  check('lot entièrement neutre',
    batch([patch(doc, ['works', 0, 'title'], 'A')]).isNoop(), true);
  check('splice vide',
    splice(doc, ['works', 0, 'stems'], 0, 0, []).isNoop(), true);
  check('splice réel',
    splice(doc, ['works', 0, 'stems'], 0, 1).isNoop(), false);
}

console.log(`\n${passed} réussis, ${failed} échoués\n`);
process.exit(failed ? 1 : 0);

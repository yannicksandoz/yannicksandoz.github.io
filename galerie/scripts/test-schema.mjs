/**
 * Test de la migration de schéma v1 → v2.
 * Sans dépendance ni navigateur.  Lancer avec : npm test
 */
import { migrateWork, migrateRoom, migrateScene, detectVersion, stampVersion, SCHEMA_VERSION }
  from '../engine/src/core/schema.js';

let passed = 0, failed = 0;
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function check(name, actual, expected) {
  if (eq(actual, expected)) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}\n      attendu : ${JSON.stringify(expected)}\n      obtenu  : ${JSON.stringify(actual)}`); }
}

console.log('\nmigration d’une œuvre v1 → v2');
{
  // exactement la forme d'un fichier existant du dépôt
  const v1 = { id: 'monolithe', title: 'Monolithe 55 Hz', position: [12, 2.4, -9],
    rotationY: -20, model: { shape: 'monolith', height: 4.6 },
    stems: [{ file: 'audio/x.wav', radius: 30, gain: 1 }] };
  const v2 = migrateWork(v1);
  check('rotationY → rotation[x,y,z]', v2.rotation, [0, -20, 0]);
  check('rotationY retiré', 'rotationY' in v2, false);
  check('échelle absente → [1,1,1]', v2.scale, [1, 1, 1]);
  check('position conservée', v2.position, [12, 2.4, -9]);
  check('reste du document intact', [v2.id, v2.title, v2.model.height, v2.stems.length],
    ['monolithe', 'Monolithe 55 Hz', 4.6, 1]);
  check('entrée non modifiée (fonction pure)', v1.rotationY, -20);
}

console.log('\néchelle scalaire et valeurs manquantes');
{
  check('scale: 1.4 → [1.4,1.4,1.4]', migrateWork({ id: 'a', scale: 1.4 }).scale, [1.4, 1.4, 1.4]);
  check('sans rotation ni scale', 
    [migrateWork({ id: 'a' }).rotation, migrateWork({ id: 'a' }).scale], [[0, 0, 0], [1, 1, 1]]);
  check('position absente → défaut', migrateWork({ id: 'a' }).position, [0, 1.8, 0]);
}

console.log('\nidempotence : migrer du v2 ne l’abîme pas');
{
  const v2 = { id: 'a', position: [1, 2, 3], rotation: [10, 20, 30], scale: [2, 1, 0.5] };
  const again = migrateWork(v2);
  check('rotation inchangée', again.rotation, [10, 20, 30]);
  check('échelle inchangée', again.scale, [2, 1, 0.5]);
  check('double migration stable', migrateWork(migrateWork(v2)), again);
}

console.log('\nmigration des pièces (portails)');
{
  const room = { id: 'hall', portals: [{ to: 'annexe', position: [-5, 0, -22], rotationY: 12 }] };
  const r = migrateRoom(room);
  check('portail : rotationY → rotation', r.portals[0].rotation, [0, 12, 0]);
  check('portail : rotationY retiré', 'rotationY' in r.portals[0], false);
  check('destination conservée', r.portals[0].to, 'annexe');
  check('pièce sans portails', migrateRoom({ id: 'x' }).portals, []);
}

console.log('\nmigration d’une scène complète');
{
  const { works, rooms } = migrateScene(
    [{ id: 'a', rotationY: 90 }],
    [{ id: 'r', portals: [{ to: 'a', position: [0, 0, 0], rotationY: 45 }] }]
  );
  check('œuvres migrées', works[0].rotation, [0, 90, 0]);
  check('pièces migrées', rooms[0].portals[0].rotation, [0, 45, 0]);
  check('rooms null accepté', migrateScene([], null).rooms, null);
}

console.log('\ndétection de version');
{
  check('v1 détecté (scalaires)', detectVersion([{ id: 'a', rotationY: 10 }]), 1);
  check('v2 détecté (tableaux)', detectVersion([{ id: 'a', rotation: [0, 0, 0] }]), 2);
  check('marqueur explicite', detectVersion([{ schemaVersion: 2, id: 'a' }]), 2);
  check('document vide', detectVersion([]), SCHEMA_VERSION);
}

console.log('\nestampille d’export');
{
  const out = stampVersion([{ id: 'a' }, { id: 'b' }]);
  check('version sur le premier élément', out[0].schemaVersion, SCHEMA_VERSION);
  check('les suivants ne sont pas alourdis', 'schemaVersion' in out[1], false);
  check('relecture du propre export', detectVersion(out), SCHEMA_VERSION);
}

console.log(`\n${passed} réussis, ${failed} échoués\n`);
process.exit(failed ? 1 : 0);

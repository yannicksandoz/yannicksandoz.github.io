/**
 * SAUVEGARDER ET REVENIR (editor/state/Publication.js), sur une poignée de
 * dossier en mémoire — l'interface du navigateur, une arborescence derrière.
 *
 * Ce que « Revenir » doit faire : remettre les fichiers de la sauvegarde,
 * retirer ce qui est apparu depuis dans les sous-dossiers qu'elle PORTAIT —
 * et ne toucher à rien d'autre. Une sauvegarde d'avant les gabarits n'en a
 * pas : revenir dessus ne doit pas vider content/gabarits/.
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import { sauvegarder, restaurer, sauvegardes, SOUS_DOSSIERS } from '../engine/src/editor/state/Publication.js';

let ok = 0; let ko = 0;
const test = async (nom, fn) => { try { await fn(); ok++; console.log(`  ✓ ${nom}`); } catch (e) { ko++; console.log(`  ✗ ${nom}\n      ${e.message}`); } };

/* ---- une arborescence en mémoire, vue comme une poignée de dossier ---- */
function dossier(arbre = {}) {
  const h = {
    kind: 'directory', arbre,
    async getDirectoryHandle(nom, { create = false } = {}) {
      if (!(nom in arbre)) { if (!create) throw new Error(`NotFoundError: ${nom}`); arbre[nom] = {}; }
      if (typeof arbre[nom] !== 'object') throw new Error(`TypeMismatchError: ${nom}`);
      return dossier(arbre[nom]);
    },
    async getFileHandle(nom, { create = false } = {}) {
      if (!(nom in arbre)) { if (!create) throw new Error(`NotFoundError: ${nom}`); arbre[nom] = ''; }
      return {
        kind: 'file', name: nom,
        async getFile() { return { async text() { return arbre[nom]; } }; },
        async createWritable() { return { async write(c) { arbre[nom] = String(c); }, async close() {} }; }
      };
    },
    async removeEntry(nom) { if (!(nom in arbre)) throw new Error('NotFoundError'); delete arbre[nom]; },
    async *entries() {
      for (const nom of Object.keys(arbre)) {
        yield [nom, typeof arbre[nom] === 'object' ? dossier(arbre[nom]) : await h.getFileHandle(nom)];
      }
    }
  };
  return h;
}
const chemins = (arbre, prefixe = '') => Object.entries(arbre).flatMap(([n, v]) =>
  typeof v === 'object' ? chemins(v, `${prefixe}${n}/`) : [`${prefixe}${n}`]).sort();

console.log('\nsauvegarder et revenir');

await test('les gabarits font partie de la sauvegarde', async () => {
  const arbre = { works: { 'a.json': '{"id":"a"}', 'index.json': '["a.json"]' }, rooms: { 'r.json': '{"id":"r"}' },
    gabarits: { 'g.json': '{"nom":"g"}', 'index.json': '["g.json"]' }, 'reglages.json': '{}' };
  assert.deepEqual(SOUS_DOSSIERS, ['works', 'rooms', 'gabarits']);
  const bilan = await sauvegarder(dossier(arbre));
  const noms = await sauvegardes(dossier(arbre));
  assert.equal(noms.length, 1);
  const copie = arbre['.sauvegardes'][noms[0]];
  assert.deepEqual(chemins(copie), ['gabarits/g.json', 'gabarits/index.json', 'reglages.json', 'rooms/r.json', 'works/a.json', 'works/index.json']);
  assert.equal(bilan.fichiers, 6, 'six fichiers copiés : les gabarits comptent');
  assert.equal(bilan.nom, noms[0]);
});

await test('revenir sur une sauvegarde d\'AVANT les gabarits ne vide pas content/gabarits/', async () => {
  const arbre = {
    works: { 'a.json': '{"id":"a","v":2}', 'b.json': '{"id":"b"}', 'index.json': '["a.json","b.json"]' },
    rooms: { 'r.json': '{"id":"r"}' },
    gabarits: { 'g.json': '{"nom":"g"}', 'index.json': '["g.json"]' },
    'reglages.json': '{"cooldown":10}',
    '.sauvegardes': { '2026-01-01_00h00m00': { works: { 'a.json': '{"id":"a","v":1}', 'index.json': '["a.json"]' }, rooms: { 'r.json': '{"id":"r"}' }, 'reglages.json': '{"cooldown":5}' } }
  };
  const r = await restaurer(dossier(arbre), '2026-01-01_00h00m00');
  assert.equal(arbre.works['a.json'], '{"id":"a","v":1}', 'le fichier revient à son état');
  assert.ok(!('b.json' in arbre.works), 'ce qui est apparu depuis dans works/ s\'en va');
  assert.equal(arbre['reglages.json'], '{"cooldown":5}');
  assert.deepEqual(Object.keys(arbre.gabarits).sort(), ['g.json', 'index.json'], 'les gabarits sont intacts : la sauvegarde ne les portait pas');
  assert.equal(r.retires, 1);
  assert.ok(Object.keys(arbre['.sauvegardes']).length === 2, 'le filet du filet : une sauvegarde de plus');
});

await test('une sauvegarde qui PORTE les gabarits les remet, et retire ceux d\'après', async () => {
  const arbre = {
    works: { 'a.json': '{"id":"a"}', 'index.json': '["a.json"]' }, rooms: {},
    gabarits: { 'g.json': '{"nom":"g"}', 'h.json': '{"nom":"h"}', 'index.json': '["g.json","h.json"]' },
    '.sauvegardes': { vieille: { works: { 'a.json': '{"id":"a"}', 'index.json': '["a.json"]' }, gabarits: { 'g.json': '{"nom":"g"}', 'index.json': '["g.json"]' } } }
  };
  const r = await restaurer(dossier(arbre), 'vieille');
  assert.deepEqual(Object.keys(arbre.gabarits).sort(), ['g.json', 'index.json']);
  assert.equal(arbre.gabarits['index.json'], '["g.json"]');
  assert.equal(r.retires, 1);
  await assert.rejects(restaurer(dossier(arbre), 'inconnue'), /introuvable/);
});

console.log(`\n${ok} ✓  ${ko} ✗`);
if (ko) process.exit(1);

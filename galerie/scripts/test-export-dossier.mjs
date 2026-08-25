/**
 * EXPORT VERS UN DOSSIER — File System Access, éprouvé au nœud.
 *
 * La fonction reçoit sa POIGNÉE de dossier en argument : on lui en tend une
 * fausse, qui parle l'interface FileSystemDirectoryHandle et note tout dans
 * une Map. Aucun navigateur, aucune boîte de dialogue — et pourtant c'est
 * bien le VRAI code d'écriture qui tourne, chemin par chemin :
 *
 *   1. l'arbre écrit est celui de l'archive — mêmes chemins, mêmes octets
 *      (works/index/reglages/galerie.json/LISEZ-MOI, préfixe content/) ;
 *   2. une attribution incomplète REFUSE l'export, comme partout ;
 *   3. les sous-dossiers sont créés en chemin, pas supposés ;
 *   4. le panneau ne montre le bouton que si le navigateur sait faire, et
 *      choisit le dossier À CHAQUE export (un instantané, pas une
 *      destination mémorisée).
 *
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportDossier, AttributionIncompleteError }
  from '../engine/src/editor/exporters.js';

let ok = 0, ko = 0;
const test = async (nom, fn) => {
  try { await fn(); ok++; console.log(`  ✓ ${nom}`); }
  catch (e) { ko++; console.log(`  ✗ ${nom}\n    ${e.message}`); }
};
const titre = (t) => console.log(`\n${t}`);

/* ---- une fausse poignée : l'interface du navigateur, une Map derrière --- */

function fauxDossier(prefixe = '', ecrits = new Map()) {
  return {
    ecrits,
    async getDirectoryHandle(nom, { create } = {}) {
      assert.ok(create, `sous-dossier ${nom} demandé sans create`);
      return fauxDossier(`${prefixe}${nom}/`, ecrits);
    },
    async getFileHandle(nom, { create } = {}) {
      assert.ok(create, `fichier ${nom} demandé sans create`);
      return {
        async createWritable() {
          return {
            async write(contenu) { ecrits.set(`${prefixe}${nom}`, contenu); },
            async close() {}
          };
        }
      };
    }
  };
}

/* ---- une application minimale, comme la voit l'exporteur --------------- */

const oeuvre = { id: 'nebuleuse', title: 'Voix, vagues', room: 'entree' };
const piece = { id: 'entree', works: ['nebuleuse'] };
const app = {
  worksConfigs: [oeuvre], roomConfigs: [piece],
  reglages: { environnement: 'studio' }, assetOverrides: new Map()
};
const doc = { works: [oeuvre], rooms: [piece] };

titre('l’arbre écrit est celui de l’archive');
await test('chemins au plan du dépôt, racine comprise', async () => {
  const racine = fauxDossier();
  const bilan = await exportDossier(app, doc, racine);
  const chemins = [...racine.ecrits.keys()].sort();
  assert.deepEqual(chemins, [
    'LISEZ-MOI.txt', 'content/reglages.json', 'content/rooms/entree.json',
    'content/rooms/index.json', 'content/works/index.json',
    'content/works/nebuleuse.json', 'galerie.json'
  ]);
  assert.equal(bilan.fichiers, 7);
  assert.equal(bilan.objets, 1);
  assert.equal(bilan.pieces, 1);
  assert.deepEqual(bilan.manquants, []);
});
await test('les JSON écrits sont ceux de la publication (saut final)', async () => {
  const racine = fauxDossier();
  await exportDossier(app, doc, racine);
  const w = racine.ecrits.get('content/works/nebuleuse.json');
  assert.ok(w.endsWith('\n'), 'saut de ligne final absent — diffs illisibles');
  assert.equal(JSON.parse(w).id, 'nebuleuse');
  const index = JSON.parse(racine.ecrits.get('content/works/index.json'));
  assert.deepEqual(index, ['nebuleuse.json']);
});
await test('l’avancement est annoncé jusqu’au bout', async () => {
  const racine = fauxDossier();
  const vus = [];
  await exportDossier(app, doc, racine,
    { onProgress: (fait, total) => vus.push([fait, total]) });
  assert.equal(vus.length, 7);
  assert.deepEqual(vus.at(-1), [7, 7]);
});

titre('les refus sont les mêmes que partout');
await test('une attribution incomplète refuse l’export', async () => {
  const emprunte = { ...oeuvre, model: { url: 'x.glb', source: 'poly.pizza' } };
  const racine = fauxDossier();
  await assert.rejects(
    exportDossier({ ...app, worksConfigs: [emprunte] },
      { works: [emprunte], rooms: [piece] }, racine),
    AttributionIncompleteError);
  assert.equal(racine.ecrits.size, 0, 'rien ne doit avoir été écrit');
});

titre('le panneau fait les bons gestes');
const ici = dirname(fileURLToPath(import.meta.url));
const panneau = readFileSync(join(ici, '..', 'engine', 'src', 'editor',
  'ui', 'PanneauSauvegarde.js'), 'utf8');
const publication = readFileSync(join(ici, '..', 'engine', 'src', 'editor',
  'state', 'Publication.js'), 'utf8');
await test('le bouton n’apparaît que si le navigateur sait faire', () => {
  const bloc = panneau.slice(panneau.indexOf('exporter-dossier') - 200,
    panneau.indexOf('exporter-dossier'));
  assert.ok(bloc.includes('Publication.supportee()'),
    'le bouton doit être conditionné à supportee()');
});
await test('le dossier d’export se choisit à chaque fois, sans mémoire', () => {
  assert.ok(publication.includes('choisirDossierExport'));
  const corps = publication.slice(publication.indexOf('choisirDossierExport'));
  const fin = corps.slice(0, corps.indexOf('\n}'));
  assert.ok(!fin.includes('garder('),
    'la poignée d’export ne doit PAS être mémorisée');
});
await test('l’écriture passe par ecrireFichier — les mêmes octets partout', () => {
  const exporteurs = readFileSync(join(ici, '..', 'engine', 'src', 'editor',
    'exporters.js'), 'utf8');
  assert.ok(exporteurs.includes('ecrireFichier(racine, e.chemin, e.data)'));
  assert.ok(publication.includes('export async function ecrireFichier'));
});

console.log(`\n${ok} ✓ / ${ko} ✗`);
process.exit(ko ? 1 : 0);

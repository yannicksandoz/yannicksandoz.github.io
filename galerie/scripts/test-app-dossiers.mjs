/**
 * LES DOSSIERS AUTORISÉS DE L'APPLICATION AUTEUR (app/dossiers.cjs).
 *
 * Une liste blanche de racines ; des chemins relatifs qui ne sortent
 * jamais ; lister, lire, écrire (dossiers créés au passage), supprimer —
 * jamais la racine. Tout au nœud, sans Electron.
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Dossiers } = require('../app/dossiers.cjs');

let ok = 0; let ko = 0;
const test = async (nom, fn) => { try { await fn(); ok++; console.log(`  ✓ ${nom}`); } catch (e) { ko++; console.log(`  ✗ ${nom}\n      ${e.message}`); } };
const refuse = async (p) => { try { await p; return false; } catch { return true; } };

console.log('\nles dossiers autorisés de l\'application');

const tmp = mkdtempSync(join(tmpdir(), 'galerie-dossiers-'));
const d = new Dossiers();
const id = d.autoriser(tmp);

await test('une racine autorisée, les autres refusées', async () => {
  assert.equal(id, tmp);
  assert.ok(d.autorise(id));
  assert.ok(!d.autorise('/etc'));
  assert.ok(await refuse(d.lister('/etc')));
});

await test('un chemin relatif reste sous la racine : « .. », absolu et lecteur Windows refusés', async () => {
  assert.equal(d.resoudre(id, 'rooms/entree.json'), join(tmp, 'rooms', 'entree.json'));
  assert.equal(d.resoudre(id, ''), tmp);
  assert.ok(await refuse(Promise.resolve().then(() => d.resoudre(id, '../secret'))));
  assert.ok(await refuse(Promise.resolve().then(() => d.resoudre(id, 'a/../../secret'))));
  assert.ok(await refuse(Promise.resolve().then(() => d.resoudre(id, '/etc/passwd'))));
  assert.ok(await refuse(Promise.resolve().then(() => d.resoudre(id, 'C:\\x'))));
});

await test('écrire crée les dossiers, lire rend octets et date, lister dit le genre', async () => {
  const n = await d.ecrire(id, 'rooms/entree.json', '{"id":"entree"}');
  assert.equal(n, 15);
  await d.ecrire(id, 'assets/son.bin', new Uint8Array([1, 2, 3]));
  const lu = await d.lire(id, 'rooms/entree.json');
  assert.equal(Buffer.from(lu.donnees).toString('utf8'), '{"id":"entree"}');
  assert.ok(lu.modifie > 0);
  assert.deepEqual((await d.lister(id, 'rooms')), [{ nom: 'entree.json', kind: 'file' }]);
  const racine = (await d.lister(id)).map((e) => `${e.kind}:${e.nom}`).sort();
  assert.deepEqual(racine, ['directory:assets', 'directory:rooms']);
  assert.deepEqual(await d.lister(id, 'absent'), []);
  assert.equal(await d.existe(id, 'rooms'), 'directory');
  assert.equal(await d.existe(id, 'rooms/entree.json'), 'file');
  assert.equal(await d.existe(id, 'rien'), null);
  assert.equal(readFileSync(join(tmp, 'assets', 'son.bin')).length, 3);
});

await test('supprimer un fichier, un dossier entier ; jamais la racine', async () => {
  await d.creerDossier(id, '.sauvegardes/2026-01-01_00h00m00/rooms');
  await d.ecrire(id, '.sauvegardes/2026-01-01_00h00m00/rooms/x.json', '{}');
  await d.supprimer(id, 'rooms/entree.json');
  assert.ok(!existsSync(join(tmp, 'rooms', 'entree.json')));
  assert.ok(await refuse(d.supprimer(id, '.sauvegardes')));                      // non vide, sans recursive
  await d.supprimer(id, '.sauvegardes', { recursive: true });
  assert.ok(!existsSync(join(tmp, '.sauvegardes')));
  assert.ok(await refuse(d.supprimer(id, '')));
  assert.ok(await refuse(d.supprimer(id, '.')));
  assert.ok(existsSync(tmp));
});

rmSync(tmp, { recursive: true, force: true });
console.log(`\n${ok} ✓  ${ko} ✗`);
if (ko) process.exit(1);

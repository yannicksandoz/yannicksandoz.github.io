/**
 * LE SERVEUR INTERNE DE L'APPLICATION AUTEUR (app/serveur.cjs).
 *
 * Deux racines, la première gagne ; des types justes ; les plages pour les
 * médias ; jamais au-dessus de la racine ; les proxys reconnus par leur
 * préfixe. Tout au nœud, sans Electron.
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { demarrerServeur, cibleProxy, cheminSur, plageDe, typeDe } = require('../app/serveur.cjs');

let ok = 0; let ko = 0;
const test = async (nom, fn) => { try { await fn(); ok++; console.log(`  ✓ ${nom}`); } catch (e) { ko++; console.log(`  ✗ ${nom}\n      ${e.message}`); } };

console.log('\nle serveur de l\'application auteur');

await test('les proxys se reconnaissent à leur préfixe, et à lui seul', () => {
  assert.deepEqual(cibleProxy('/fs-api/apiv2/search/text/?query=pluie'),
    { origine: 'https://freesound.org', chemin: '/apiv2/search/text/?query=pluie' });
  assert.deepEqual(cibleProxy('/pp-api/v1/search?q=chair'), { origine: 'https://api.poly.pizza', chemin: '/v1/search?q=chair' });
  assert.equal(cibleProxy('/pp-static/x.glb').origine, 'https://static.poly.pizza');
  assert.equal(cibleProxy('/fs-apix/y'), null);
  assert.equal(cibleProxy('/index.html'), null);
});

await test('un chemin sûr : décodé, un dossier vaut son index, jamais au-dessus de la racine', () => {
  assert.equal(cheminSur('/'), '/index.html');
  assert.equal(cheminSur('/content/rooms/'), '/content/rooms/index.html');
  assert.equal(cheminSur('/assets/index.js?edit'), '/assets/index.js');
  assert.equal(cheminSur('/a%20b.png'), '/a b.png');
  // l'analyseur d'URL ramène « .. » à la racine avant nous : jamais au-dessus
  assert.equal(cheminSur('/../secret'), '/secret');
  assert.equal(cheminSur('/x/../../secret'), '/secret');
  // …et un « .. » qui n'arrive qu'après décodage est refusé net
  assert.equal(cheminSur('/..%2Fsecret'), null);
  assert.equal(cheminSur('/x/%2E%2E/secret'), '/secret');   // « %2E%2E » : l'analyseur le résout aussi
});

await test('les plages : début-fin, ouverte, suffixe, invalide', () => {
  assert.deepEqual(plageDe('bytes=0-9', 100), { debut: 0, fin: 9 });
  assert.deepEqual(plageDe('bytes=90-', 100), { debut: 90, fin: 99 });
  assert.deepEqual(plageDe('bytes=-10', 100), { debut: 90, fin: 99 });
  assert.deepEqual(plageDe('bytes=0-500', 100), { debut: 0, fin: 99 });
  assert.deepEqual(plageDe('bytes=200-300', 100), { invalide: true });
  assert.equal(plageDe(undefined, 100), null);
  assert.equal(plageDe('octets=1-2', 100), null);
});

await test('les types : modules, worklets, médias, modèles', () => {
  assert.equal(typeDe('x.js'), 'text/javascript; charset=utf-8');
  assert.equal(typeDe('x.wasm'), 'application/wasm');
  assert.equal(typeDe('x.glb'), 'model/gltf-binary');
  assert.equal(typeDe('x.MP3'), 'audio/mpeg');
  assert.equal(typeDe('x.inconnu'), 'application/octet-stream');
});

const tmp = mkdtempSync(join(tmpdir(), 'galerie-app-'));
const contenu = join(tmp, 'contenu'), dist = join(tmp, 'dist');
mkdirSync(join(contenu, 'rooms'), { recursive: true });
mkdirSync(join(dist, 'assets'), { recursive: true });
mkdirSync(join(dist, 'rooms'), { recursive: true });
mkdirSync(join(dist, 'works'), { recursive: true });
writeFileSync(join(dist, 'index.html'), '<!doctype html><title>galerie</title>');
writeFileSync(join(dist, 'assets', 'index.js'), 'export const a = 1;');
writeFileSync(join(dist, 'rooms', 'index.json'), '{"du":"build"}');
writeFileSync(join(dist, 'rooms', 'rooms.json'), '[{"du":"build combiné"}]');
writeFileSync(join(dist, 'works', 'works.json'), '[]') || true;
writeFileSync(join(contenu, 'rooms', 'index.json'), '{"du":"contenu"}');
writeFileSync(join(contenu, 'son.mp3'), Buffer.from('0123456789abcdef'));

const s = await demarrerServeur({ racines: [contenu, dist, join(tmp, 'absent')] });

await test('le serveur écoute sur un port libre de 127.0.0.1, sur les racines qui existent', () => {
  assert.ok(s.port > 0);
  assert.ok(s.url.startsWith('http://127.0.0.1:'));
  assert.deepEqual(s.racines, [contenu, dist]);
});

await test('la page et les modules viennent du build ; le contenu de l\'auteur passe devant', async () => {
  const page = await fetch(s.url);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('content-type'), 'text/html; charset=utf-8');
  const js = await fetch(`${s.url}assets/index.js?edit`);
  assert.equal(js.headers.get('content-type'), 'text/javascript; charset=utf-8');
  const rooms = await fetch(`${s.url}rooms/index.json`);
  assert.deepEqual(await rooms.json(), { du: 'contenu' });
  assert.equal(rooms.headers.get('cache-control'), 'no-cache');
});

await test('les combinés du build ne cachent pas le dossier de l\'auteur : première racine seule', async () => {
  assert.equal((await fetch(`${s.url}rooms/rooms.json`)).status, 404);   // le contenu n'en a pas : le build ne répond pas à sa place
  assert.equal((await fetch(`${s.url}works/works.json`)).status, 404);
  const seul = await demarrerServeur({ racines: [dist] });                // sans dossier d'auteur : le build sert les siens
  assert.equal((await fetch(`${seul.url}rooms/rooms.json`)).status, 200);
  await seul.fermer();
});

await test('un média se sert par plages ; 404 et 400 disent leur nom', async () => {
  const entier = await fetch(`${s.url}son.mp3`);
  assert.equal(entier.headers.get('accept-ranges'), 'bytes');
  assert.equal(entier.headers.get('content-length'), '16');
  const plage = await fetch(`${s.url}son.mp3`, { headers: { Range: 'bytes=4-7' } });
  assert.equal(plage.status, 206);
  assert.equal(plage.headers.get('content-range'), 'bytes 4-7/16');
  assert.equal(await plage.text(), '4567');
  const trop = await fetch(`${s.url}son.mp3`, { headers: { Range: 'bytes=99-' } });
  assert.equal(trop.status, 416);
  assert.equal((await fetch(`${s.url}rien.png`)).status, 404);
  assert.equal((await fetch(`${s.url}..%2F..%2Fetc%2Fpasswd`)).status, 400);
  const tete = await fetch(`${s.url}son.mp3`, { method: 'HEAD' });
  assert.equal(tete.status, 200);
  assert.equal((await fetch(s.url, { method: 'POST' })).status, 405);
});

await s.fermer();
rmSync(tmp, { recursive: true, force: true });

console.log(`\n${ok} ✓  ${ko} ✗`);
if (ko) process.exit(1);

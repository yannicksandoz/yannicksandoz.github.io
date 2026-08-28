/**
 * CONTENT-LENGTH RECALIBRÉ — le correctif des scans servis compressés.
 *
 * Le bogue qu'il ferme n'existait qu'EN LIGNE : un serveur de
 * développement ne compresse pas, `Content-Length` y coïncide avec la
 * taille décodée, et le calcul faux de la bibliothèque donnait le bon
 * résultat. C'est très exactement le genre de panne qu'une suite locale
 * laisse passer — d'où ces tests, qui fabriquent la condition au lieu de
 * l'attendre : une réponse qui ANNONCE moins d'octets qu'elle n'en rend.
 *
 * Node 22 fournit `fetch`, `Response` et `Headers` : tout se juge ici, sans
 * navigateur ni réseau.
 *
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import { ENTETE, reponseRecalibree, poserContournementLongueur }
  from '../engine/src/core/scan-longueur.js';

let ok = 0, ko = 0;
const test = async (nom, fn) => {
  try { await fn(); ok++; console.log(`  ✓ ${nom}`); }
  catch (e) { ko++; console.log(`  ✗ ${nom}\n    ${e.message}`); }
};
const titre = (t) => console.log(`\n${t}`);

/** Le corps réel : 704 000 octets, comme le scan de démonstration. */
const CORPS = new Uint8Array(704000);
CORPS[0] = 42; CORPS[703999] = 7;

/** Une réponse qui MENT sur sa longueur, comme une réponse gzip. */
const menteuse = (annonce = '499577') => new Response(CORPS, {
  status: 200,
  headers: { 'content-type': 'application/octet-stream', [ENTETE]: String(annonce) }
});

titre('la réponse recalibrée');
await test('le Content-Length compressé devient la longueur décodée', async () => {
  const r = await reponseRecalibree(menteuse());
  assert.ok(r, 'une réponse corrigée doit être rendue');
  assert.equal(r.headers.get(ENTETE), '704000',
    'c’est ce chiffre que la bibliothèque préalloue');
});
await test('les octets sont rendus INTACTS — on corrige un en-tête, pas un fichier', async () => {
  const r = await reponseRecalibree(menteuse());
  const v = new Uint8Array(await r.arrayBuffer());
  assert.equal(v.byteLength, 704000);
  assert.equal(v[0], 42);
  assert.equal(v[703999], 7, 'le dernier octet est le plus facile à perdre');
});
await test('le reste des en-têtes survit', async () => {
  const r = await reponseRecalibree(menteuse());
  assert.equal(r.headers.get('content-type'), 'application/octet-stream');
  assert.equal(r.status, 200);
});
await test('une réponse SANS Content-Length est laissée telle quelle', async () => {
  // sans l'en-tête, la bibliothèque bascule d'elle-même sur sa voie sûre :
  // il n'y a rien à corriger, et lire le corps pour rien serait un coût
  const r = await reponseRecalibree(new Response(CORPS, { status: 200 }));
  assert.equal(r, null);
});
await test('un Content-Length déjà juste reste juste', async () => {
  const r = await reponseRecalibree(menteuse(704000));
  assert.equal(r.headers.get(ENTETE), '704000');
});

titre('l’enveloppe posée sur fetch');
/** Un `fetch` de laboratoire : rend toujours la réponse menteuse. */
const atelier = () => {
  const f = {
    Response, Headers,
    fetch: async (entree) => {
      f.demandes.push(String(entree?.url ?? entree));
      return menteuse();
    },
    demandes: []
  };
  f.origine = f.fetch;
  return f;
};

await test('l’URL visée est corrigée, et applique() le dit', async () => {
  const f = atelier();
  const c = poserContournementLongueur(f, (a) => a.includes('.splat'));
  const r = await f.fetch('/assets/scans/onde.splat');
  assert.equal(r.headers.get(ENTETE), '704000');
  assert.ok(c.applique(), 'une correction a eu lieu : elle doit se déclarer');
});
await test('les AUTRES URL passent sans être touchées', async () => {
  const f = atelier();
  const c = poserContournementLongueur(f, (a) => a.includes('.splat'));
  const r = await f.fetch('/works/works.json');
  assert.equal(r.headers.get(ENTETE), '499577', 'aucune réécriture hors cible');
  assert.ok(!c.applique(), 'rien n’a été corrigé : applique() doit rester faux');
});
await test('retirer() rend le fetch d’origine', async () => {
  const f = atelier();
  const avant = f.fetch;
  const c = poserContournementLongueur(f, () => true);
  assert.notEqual(f.fetch, avant, 'l’enveloppe doit être posée');
  c.retirer();
  assert.equal(f.fetch, avant, 'et retirée exactement');
});
await test('retirer() ne DÉFAIT PAS l’enveloppe d’un autre', async () => {
  // deux scans qui se chevauchent : le premier à se retirer ne doit pas
  // arracher l'enveloppe du second, sinon le second charge sans correctif
  const f = atelier();
  const a = poserContournementLongueur(f, () => true);
  const b = poserContournementLongueur(f, () => true);
  a.retirer();
  const r = await f.fetch('/x.splat');
  assert.equal(r.headers.get(ENTETE), '704000', 'l’enveloppe de b doit tenir');
  b.retirer();
});
await test('une réponse en ERREUR n’est pas touchée', async () => {
  const f = atelier();
  f.fetch = async () => new Response('non', { status: 404, headers: { [ENTETE]: '3' } });
  const c = poserContournementLongueur(f, () => true);
  const r = await f.fetch('/absent.splat');
  assert.equal(r.status, 404);
  assert.ok(!c.applique());
});
await test('un fetch qui LÈVE laisse passer l’erreur', async () => {
  const f = atelier();
  f.fetch = async () => { throw new TypeError('Failed to fetch'); };
  poserContournementLongueur(f, () => true);
  await assert.rejects(() => f.fetch('/x.splat'), /Failed to fetch/);
});
await test('sans fetch dans l’hôte, la pose est un non-événement', () => {
  const c = poserContournementLongueur({}, () => true);
  assert.equal(c.applique(), false);
  c.retirer();   // ne doit pas lever
});

titre('la ligne fautive, chez l’amont');
await test('la bibliothèque préalloue TOUJOURS d’après Content-Length', async () => {
  // le jour où elle dimensionnera son tampon sur ce qu'elle a reçu, ce test
  // rougit : c'est le signal pour SUPPRIMER scan-longueur.js
  const { readFileSync } = await import('node:fs');
  const { dirname, join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const ici = dirname(fileURLToPath(import.meta.url));
  const lib = readFileSync(join(ici, '..', 'node_modules', '@mkkellogg',
    'gaussian-splats-3d', 'build', 'gaussian-splats-3d.module.js'), 'utf8');
  assert.ok(lib.includes('directLoadBufferIn = new ArrayBuffer(fileSize);'),
    'la préallocation a changé : revérifier le contournement');
  assert.ok(lib.includes("data.headers.get('Content-Length')"),
    'fileSize ne vient plus de l’en-tête : le correctif est peut-être inutile');
});

console.log(`\n${ok} ✓ / ${ko} ✗`);
if (ko) process.exitCode = 1;

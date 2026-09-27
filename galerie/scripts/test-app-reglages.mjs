/**
 * LES RÈGLES DES RÉGLAGES DE L'APPLICATION (app/reglages-regles.cjs).
 *
 * Galeries récentes sans doublon, versions comparées à la semver,
 * dossier de galerie reconnu à son index. Tout au nœud, sans Electron.
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { noterRecent, plusRecente, analyser, estUneGalerie, lienExterneSur, portPrefere, PORT_PREFERE, RECENTS_MAX } = require('../app/reglages-regles.cjs');

let ok = 0; let ko = 0;
const test = (nom, fn) => { try { fn(); ok++; console.log(`  ✓ ${nom}`); } catch (e) { ko++; console.log(`  ✗ ${nom}\n      ${e.message}`); } };

console.log('\nles réglages de l\'application');

test('les récents : en tête, sans doublon, huit au plus', () => {
  let l = noterRecent([], '/a');
  l = noterRecent(l, '/b');
  l = noterRecent(l, '/a');
  assert.deepEqual(l, ['/a', '/b']);
  for (let i = 0; i < 12; i++) l = noterRecent(l, `/d${i}`);
  assert.equal(l.length, RECENTS_MAX);
  assert.equal(l[0], '/d11');
  assert.deepEqual(noterRecent(null, ''), []);
  assert.deepEqual(noterRecent(['/x', null, ''], '/y'), ['/y', '/x']);
});

test('les versions : semver, pré-versions, textes qui ne sont pas des versions', () => {
  assert.ok(plusRecente('1.0.1', '1.0.0'));
  assert.ok(plusRecente('1.1.0', '1.0.9'));
  assert.ok(plusRecente('2.0.0', '1.9.9'));
  assert.ok(!plusRecente('1.0.0', '1.0.0'));
  assert.ok(plusRecente('1.0.0', '1.0.0-beta.1'));
  assert.ok(!plusRecente('1.0.0-beta.1', '1.0.0'));
  assert.ok(plusRecente('1.0.0-beta.2', '1.0.0-beta.1'));
  assert.ok(plusRecente('1.0.0-beta.10', '1.0.0-beta.9'));
  assert.ok(plusRecente('1.0.0-rc.1', '1.0.0-beta.3'));
  assert.ok(plusRecente('1.0.0-beta.1.1', '1.0.0-beta.1'));
  assert.ok(plusRecente('v1.0.1', '1.0.0'));
  assert.ok(!plusRecente('n’importe quoi', '1.0.0'));
  assert.ok(plusRecente('1.0.0', 'n’importe quoi'));
  assert.deepEqual(analyser('1.2.3-beta.4'), { nombres: [1, 2, 3], pre: ['beta', 4] });
  assert.equal(analyser(''), null);
});

test('un dossier de galerie se reconnaît à son index', () => {
  const existe = (p) => p === '/g/rooms/index.json';
  assert.ok(estUneGalerie('/g', existe));
  assert.ok(!estUneGalerie('/ailleurs', existe));
  assert.ok(!estUneGalerie('', existe));
});

test('dehors ne s\'ouvrent que le web et le courriel', () => {
  assert.ok(lienExterneSur('https://freesound.org/people/x'));
  assert.ok(lienExterneSur('http://localhost:5173/'));
  assert.ok(lienExterneSur('mailto:quelqun@example.org'));
  assert.ok(!lienExterneSur('file:///C:/Windows/System32/calc.exe'));
  assert.ok(!lienExterneSur('ms-msdt:/id x'));
  assert.ok(!lienExterneSur('javascript:alert(1)'));
  assert.ok(!lienExterneSur('pas une adresse'));
  assert.ok(!lienExterneSur(undefined));
});

test('le port préféré : celui du dernier lancement s\'il est plausible, sinon le port fixe', () => {
  assert.equal(portPrefere({ port: 51234 }), 51234);
  assert.equal(portPrefere({}), PORT_PREFERE);
  assert.equal(portPrefere({ port: 0 }), PORT_PREFERE);
  assert.equal(portPrefere({ port: 80 }), PORT_PREFERE);
  assert.equal(portPrefere({ port: 'x' }), PORT_PREFERE);
  assert.equal(portPrefere(null), PORT_PREFERE);
});

console.log(`\n${ok} ✓  ${ko} ✗`);
if (ko) process.exit(1);

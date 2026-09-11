/**
 * LE POIDS DU SON PUBLIÉ — les règles du garde-fou.
 *
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import { auditerPoids, rapportPoids, texteRapport, toutesLesPistes, normaliser, PLAFOND }
  from './poids-audio.mjs';

let ok = 0, ko = 0;
const test = (nom, fn) => {
  try { fn(); ok++; console.log(`  ✓ ${nom}`); }
  catch (e) { ko++; console.log(`  ✗ ${nom}\n    ${e.message}`); }
};
const Mo = (n) => Math.round(n * 1048576);

console.log('\nle poids du son publié');
test('un master léger passe, un master lourd est refusé', () => {
  const petit = auditerPoids({ fichiers: [{ chemin: 'audio/a.wav', octets: Mo(0.3) }] });
  assert.deepEqual(petit.erreurs, []);
  const gros = auditerPoids({ fichiers: [{ chemin: 'audio/b.wav', octets: Mo(12) }] });
  assert.equal(gros.erreurs.length, 1);
  assert.match(gros.erreurs[0], /master publié : audio\/b\.wav \(12\.0 Mo\)/);
});
test('le plafond : un mp3 de 9 Mo est refusé, un webm de 3 Mo passe', () => {
  const r = auditerPoids({ fichiers: [{ chemin: 'assets/x.mp3', octets: Mo(9) }, { chemin: 'assets/x.webm', octets: Mo(3) }] });
  assert.equal(r.erreurs.length, 1);
  assert.match(r.erreurs[0], /trop lourd : assets\/x\.mp3/);
  assert.equal(PLAFOND, Mo(8));
});
test('une piste fragmentée ne publie ni son original ni ses formats entiers', () => {
  const works = [{ id: 'banc', stems: [{ file: 'assets/x.mp3', fragments: 'assets/x.fragments.json',
    formats: { webm: 'assets/x.webm', m4a: 'assets/x.m4a' } }] }];
  const fichiers = [
    { chemin: 'assets/x.fragments.json', octets: 200 },
    { chemin: 'assets/x.frag/000.webm', octets: Mo(0.1) },
    { chemin: 'assets/x.mp3', octets: Mo(7.6) },
    { chemin: 'assets/x.webm', octets: Mo(3) }
  ];
  const r = auditerPoids({ fichiers, works });
  assert.equal(r.erreurs.length, 2, r.erreurs.join(' ; '));
  assert.match(r.erreurs[0], /original publié avec ses fragments : assets\/x\.mp3/);
  assert.match(r.erreurs[1], /fichier entier publié avec ses fragments : assets\/x\.webm/);
  const propre = auditerPoids({ fichiers: fichiers.slice(0, 2), works });
  assert.deepEqual(propre.erreurs, []);
});
test('le manifeste nommé doit exister dans le build', () => {
  const r = auditerPoids({ fichiers: [], rooms: [{ id: 'entree', ambience: [{ file: 'a.mp3', fragments: 'a.fragments.json' }] }] });
  assert.match(r.erreurs[0], /entree : manifeste de fragments absent/);
});
test('avec des formats entiers : l\'original lourd ne part pas, l\'original léger peut rester', () => {
  const works = [{ id: 'w', stems: [{ file: 'assets/x.mp3', formats: { webm: 'assets/x.webm', m4a: 'assets/x.m4a' } }] }];
  const lourd = auditerPoids({ fichiers: [
    { chemin: 'assets/x.mp3', octets: Mo(7.6) }, { chemin: 'assets/x.webm', octets: Mo(3) }, { chemin: 'assets/x.m4a', octets: Mo(4) }], works });
  assert.equal(lourd.erreurs.length, 1);
  assert.match(lourd.erreurs[0], /original lourd publié à côté de ses formats/);
  const leger = auditerPoids({ fichiers: [
    { chemin: 'assets/x.mp3', octets: Mo(0.6) }, { chemin: 'assets/x.webm', octets: Mo(0.3) }, { chemin: 'assets/x.m4a', octets: Mo(0.4) }], works });
  assert.deepEqual(leger.erreurs, []);
  // formats annoncés mais absents : ce n'est pas la règle 3 qui parle (le chargeur retombera sur file)
  const sansFormats = auditerPoids({ fichiers: [{ chemin: 'assets/x.mp3', octets: Mo(7.6) }], works });
  assert.equal(sansFormats.erreurs.length, 0);
});
test('les chemins se normalisent : « ./ », barre de tête, requête', () => {
  assert.equal(normaliser('./assets/x.webm?v=2'), 'assets/x.webm');
  assert.equal(normaliser('/assets/x.webm'), 'assets/x.webm');
  assert.equal(normaliser(''), null);
  assert.equal(normaliser(null), null);
});
test('le rapport : par format, et le texte', () => {
  const r = rapportPoids([{ chemin: 'a.webm', octets: Mo(1) }, { chemin: 'b.WEBM', octets: Mo(2) }, { chemin: 'c.m4a', octets: Mo(1) }]);
  assert.deepEqual(r.parFormat.webm, { n: 2, octets: Mo(3) });
  assert.equal(r.n, 3);
  const t = texteRapport(r);
  assert.match(t, /audio publié : 3 fichier\(s\), 4\.0 Mo/);
  assert.match(t, /webm\s+2 fichier\(s\)\s+3\.0 Mo/);
});
test('toutes les pistes : stems des œuvres et ambiances des pièces', () => {
  const p = toutesLesPistes([{ id: 'a', stems: [{ file: '1' }, { file: '2' }] }], [{ id: 'r', ambience: [{ file: '3' }] }, { id: 's' }]);
  assert.deepEqual(p.map((x) => `${x.ou}:${x.piste.file}`), ['a:1', 'a:2', 'r:3']);
});

console.log(`\n${ko ? '✗' : '✓'} test-poids : ${ok} ok, ${ko} ko`);
if (ko) process.exit(1);

/**
 * Test de l'archive : un zip écrit à la main, relu à la main.
 * Sans navigateur — Blob, CompressionStream et TextEncoder suffisent.
 * Lancer avec : npm test
 */
import { creerZip, lireZip, lireGalerie, crc32, texteDe }
  from '../engine/src/editor/state/Archive.js';

let passed = 0, failed = 0;
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function check(name, actual, expected) {
  if (eq(actual, expected)) { passed++; console.log(`  ✓ ${name}`); }
  else {
    failed++;
    console.error(`  ✗ ${name}\n      attendu : ${JSON.stringify(expected)}`
      + `\n      obtenu  : ${JSON.stringify(actual)}`);
  }
}

console.log('\nCRC-32');
{
  // les deux valeurs de référence du format, celles que tout le monde vérifie
  const octets = (s) => new TextEncoder().encode(s);
  check('« 123456789 »', crc32(octets('123456789')), 0xcbf43926);
  check('chaîne vide', crc32(new Uint8Array(0)), 0);
}

console.log('\naller-retour');
{
  const texte = '{\n  "id": "nébuleuse",\n  "titre": "Voix, vagues"\n}\n';
  // du binaire, avec des octets nuls et des valeurs hautes : c'est ce qui
  // casse un écrivain de zip qui traiterait tout comme du texte
  const binaire = new Uint8Array(5000);
  for (let i = 0; i < binaire.length; i++) binaire[i] = (i * 37) & 0xff;

  const zip = await creerZip([
    { chemin: 'content/works/nebuleuse.json', data: texte },
    { chemin: 'content/assets/son.mp3', data: binaire },
    { chemin: 'LISEZ-MOI.txt', data: 'Décompressez à la racine.' }
  ]);
  check('l’archive commence par la signature PK',
    [...new Uint8Array(await zip.slice(0, 2).arrayBuffer())], [0x50, 0x4b]);

  const relu = await lireZip(zip);
  check('les trois entrées sont là', [...relu.keys()].sort(),
    ['LISEZ-MOI.txt', 'content/assets/son.mp3', 'content/works/nebuleuse.json']);
  check('le texte revient intact, accents compris',
    texteDe(relu.get('content/works/nebuleuse.json')), texte);
  check('le binaire revient octet pour octet',
    [...relu.get('content/assets/son.mp3')].join(','), [...binaire].join(','));

  // un fichier de description est du texte répétitif : il doit rétrécir
  const gros = await creerZip([{ chemin: 'a.json', data: 'x'.repeat(20000) }]);
  check('un JSON répétitif est compressé', gros.size < 2000, true);
  check('…et se relit quand même',
    texteDe((await lireZip(gros)).get('a.json')).length, 20000);
}

console.log('\nune archive abîmée ne passe pas pour une galerie');
{
  let dit = '';
  try {
    await lireZip(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
  } catch (e) { dit = e.message; }
  check('un fichier qui n’est pas un zip le dit', /archive zip/.test(dit), true);
}

/* --------------------------------------------------------- la galerie --- */

const galerie = async (entrees) => lireGalerie(await creerZip(entrees));

console.log('\nrelire une galerie');
{
  const paquet = {
    format: 'galerie-v1',
    works: [{ id: 'a', title: 'A' }],
    rooms: [{ id: 'hall', works: ['a'] }],
    reglages: { delaiPortail: 2 }
  };
  const g = await galerie([
    { chemin: 'galerie.json', data: JSON.stringify(paquet) },
    { chemin: 'content/assets/son.mp3', data: new Uint8Array([1, 2, 3]) }
  ]);
  check('le chemin court passe par galerie.json', g.depuis, 'galerie.json');
  check('les œuvres reviennent', g.works.length, 1);
  check('les pièces aussi', g.rooms[0].id, 'hall');
  check('les réglages aussi', g.reglages.delaiPortail, 2);
  check('le média revient sous son chemin de contenu',
    [...g.medias.keys()], ['assets/son.mp3']);
  check('…avec son type, sans quoi un <audio> refuserait de le lire',
    g.medias.get('assets/son.mp3').type, 'audio/mpeg');
}

console.log('\nun content/ zippé à la main s’importe aussi');
{
  const g = await galerie([
    { chemin: 'content/works/index.json', data: '["a.json","b.json"]' },
    { chemin: 'content/works/a.json', data: '{"id":"a"}' },
    { chemin: 'content/works/b.json', data: '{"id":"b"}' },
    { chemin: 'content/rooms/index.json', data: '["hall.json"]' },
    { chemin: 'content/rooms/hall.json', data: '{"id":"hall","works":["a","b"]}' },
    { chemin: 'content/reglages.json', data: '{"delaiPortail":3}' }
  ]);
  check('reconstitué depuis content/', g.depuis, 'content');
  check('les deux objets, dans l’ordre de l’index',
    g.works.map((w) => w.id), ['a', 'b']);
  check('la pièce', g.rooms[0].id, 'hall');
  check('les réglages', g.reglages.delaiPortail, 3);
}

console.log('\ncas tordus');
{
  // quelqu'un qui zippe le dossier « content » lui-même : l'archive porte
  // alors un préfixe de plus, et refuser serait une chicane
  const g = await galerie([
    { chemin: 'ma-galerie/content/works/index.json', data: '["a.json"]' },
    { chemin: 'ma-galerie/content/works/a.json', data: '{"id":"a"}' }
  ]);
  check('un dossier parent en trop ne gêne pas', g.works?.[0]?.id, 'a');

  // le fichier COMBINÉ, celui que produisait l'ancien export
  const c = await galerie([
    { chemin: 'content/works/works.json', data: '[{"id":"x"},{"id":"y"}]' }
  ]);
  check('un works.json combiné est reconnu', c.works.map((w) => w.id), ['x', 'y']);
  check('…et l’absence de pièces ne casse rien', c.rooms, null);

  const vide = await galerie([{ chemin: 'LISEZ-MOI.txt', data: 'rien' }]);
  check('une archive sans galerie ne prétend pas en avoir une',
    [vide.works, vide.rooms], [null, null]);
}

console.log(`\n${passed} ✓ / ${failed} ✗`);
process.exit(failed ? 1 : 0);

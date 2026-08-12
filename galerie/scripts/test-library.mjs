/**
 * Test du catalogue de bibliothèque : normalisation, filtre, crédits.
 * Un catalogue peut être écrit par un tiers : la normalisation doit encaisser
 * n'importe quoi sans casser le panneau. Lancer avec : npm test
 */
import { readFile } from 'node:fs/promises';
import { normalizeItem, filterItems }
  from '../engine/src/core/library.js';
import { creditOf, collectCredits } from '../engine/src/core/credits.js';

let passed = 0, failed = 0;
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function check(name, actual, expected) {
  if (eq(actual, expected)) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}\n      attendu : ${JSON.stringify(expected)}\n      obtenu  : ${JSON.stringify(actual)}`); }
}

console.log('\nnormalisation — entrées valides');
{
  const it = normalizeItem({
    id: 'Socle Haut', name: 'Socle haut', url: 'library/models/x.glb',
    thumbnail: 'library/thumbs/x.svg', fit: 1.1, tags: ['socle'],
    author: 'Moi', license: 'CC-BY 4.0', sourceUrl: 'https://exemple.org/x'
  });
  check('identifiant assaini', it.id, 'socle-haut');
  check('url conservée', it.url, 'library/models/x.glb');
  check('taille conservée', it.fit, 1.1);
  check('étiquettes', it.tags, ['socle']);
  check('crédit complet', creditOf(it),
    { author: 'Moi', license: 'CC-BY 4.0', sourceUrl: 'https://exemple.org/x' });
}

console.log('\nnormalisation — entrées bancales');
{
  check('sans url : rejetée', normalizeItem({ name: 'x' }), null);
  check('url vide : rejetée', normalizeItem({ url: '' }), null);
  check('null : rejeté', normalizeItem(null), null);
  check('url non textuelle : rejetée', normalizeItem({ url: 42 }), null);

  const min = normalizeItem({ url: 'a.glb' }, 3);
  check('identifiant de repli', min.id, 'asset-3');
  check('nom de repli', min.name, 'asset-3');
  check('taille par défaut', min.fit, 2);
  check('taille négative ignorée', normalizeItem({ url: 'a.glb', fit: -5 }).fit, 2);
  check('étiquettes non tableau ignorées', normalizeItem({ url: 'a.glb', tags: 'x' }).tags, []);
  check('pas de crédit à citer', creditOf(min), null);
}

console.log('\nnormalisation — URL relatives à un catalogue distant');
{
  const distant = normalizeItem(
    { url: 'models/x.glb', thumbnail: 'thumbs/x.svg' }, 0,
    'https://exemple.org/catalogue/index.json');
  check('modèle résolu contre le catalogue', distant.url,
    'https://exemple.org/catalogue/models/x.glb');
  check('vignette résolue', distant.thumbnail,
    'https://exemple.org/catalogue/thumbs/x.svg');

  const absolue = normalizeItem(
    { url: 'https://ailleurs.net/y.glb' }, 0, 'https://exemple.org/c/index.json');
  check('url absolue laissée intacte', absolue.url, 'https://ailleurs.net/y.glb');

  const local = normalizeItem({ url: 'library/models/x.glb' }, 0, '/galerie/library/index.json');
  check('catalogue local : chemin de contenu inchangé', local.url, 'library/models/x.glb');
}

console.log('\nfiltre');
{
  const items = [
    normalizeItem({ id: 'a', name: 'Socle haut', url: 'a.glb', tags: ['socle'] }),
    normalizeItem({ id: 'b', name: 'Banc', url: 'b.glb', tags: ['mobilier'], description: 'assise' }),
    normalizeItem({ id: 'c', name: 'Colonne', url: 'c.glb', tags: ['architecture'] })
  ];
  check('requête vide rend tout', filterItems(items, '').length, 3);
  check('par nom', filterItems(items, 'socle').map((i) => i.id), ['a']);
  check('par étiquette', filterItems(items, 'mobilier').map((i) => i.id), ['b']);
  check('par description', filterItems(items, 'assise').map((i) => i.id), ['b']);
  check('insensible à la casse', filterItems(items, 'COLONNE').map((i) => i.id), ['c']);
  check('sans correspondance', filterItems(items, 'zzz'), []);
}

console.log('\ncrédits d’une scène');
{
  const works = [
    { id: 'a', title: 'Socle 1', credit: { author: 'Moi', license: 'CC0-1.0' } },
    { id: 'b', title: 'Socle 2', credit: { author: 'Moi', license: 'CC0-1.0' } },
    { id: 'c', title: 'Statue', credit: { author: 'Autre', license: 'CC-BY 4.0' } },
    { id: 'd', title: 'Mon œuvre' } // sans crédit : rien à citer
  ];
  const credits = collectCredits(works);
  check('un auteur = une ligne', credits.length, 2);
  check('objets regroupés', credits[0].titles, ['Socle 1', 'Socle 2']);
  check('second auteur', credits[1].author, 'Autre');
  check('œuvre sans crédit absente',
    credits.some((c) => c.titles.includes('Mon œuvre')), false);
  check('scène sans crédit', collectCredits(works.slice(3)), []);
  check('scène vide', collectCredits(), []);
}

console.log('\ncatalogue livré');
{
  const url = new URL('../content/library/index.json', import.meta.url);
  const data = JSON.parse(await readFile(url, 'utf8'));
  check('nom du catalogue', typeof data.name, 'string');
  check('toutes les entrées survivent à la normalisation',
    data.items.map((it, i) => normalizeItem(it, i)).filter(Boolean).length,
    data.items.length);
  check('identifiants uniques',
    new Set(data.items.map((i) => i.id)).size, data.items.length);
  check('toutes les licences renseignées',
    data.items.every((i) => i.license), true);
  check('tous les modèles pointent dans library/',
    data.items.every((i) => i.url.startsWith('library/models/')), true);
}

console.log(`\n${passed} réussis, ${failed} échoués\n`);
process.exit(failed ? 1 : 0);

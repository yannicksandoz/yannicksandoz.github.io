/**
 * Test du catalogue de bibliothèque : normalisation, filtre, crédits.
 * Un catalogue peut être écrit par un tiers : la normalisation doit encaisser
 * n'importe quoi sans casser le panneau. Lancer avec : npm test
 */
import { readFile } from 'node:fs/promises';
import { normalizeItem, filterItems }
  from '../engine/src/core/library.js';
import { a11yGaps, describeA11yGaps, speakableTitle } from '../engine/src/core/a11y.js';
import { creditOf, collectCredits, collectSources, validateWorkCredit,
         validateScene, describeSceneFaults, attributionFile, attributionPath }
  from '../engine/src/core/credits.js';

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

console.log('\nattribution — invariant, pas convention');
{
  const importe = (extra = {}) => ({
    id: 'statue', title: 'Statue',
    model: { type: 'gltf', url: 'assets/statue.glb', source: 'polypizza' },
    credit: { author: 'Musée X', license: 'CC-BY 4.0', sourceUrl: 'https://poly.pizza/m/x' },
    ...extra
  });

  check('modèle importé complet : conforme', validateWorkCredit(importe()), []);
  check('auteur manquant détecté',
    validateWorkCredit(importe({ credit: { license: 'CC-BY 4.0', sourceUrl: 'https://x' } })),
    ['author']);
  check('licence manquante détectée',
    validateWorkCredit(importe({ credit: { author: 'A', sourceUrl: 'https://x' } })),
    ['license']);
  check('URL source manquante détectée',
    validateWorkCredit(importe({ credit: { author: 'A', license: 'CC-BY' } })),
    ['sourceUrl']);
  check('crédit absent : les trois manquent',
    validateWorkCredit(importe({ credit: undefined })),
    ['author', 'license', 'sourceUrl']);
  check('nom vide détecté', validateWorkCredit(importe({ title: '   ' })), ['name']);
  check('champ vide compte comme manquant',
    validateWorkCredit(importe({ credit: { author: '  ', license: 'CC-BY', sourceUrl: 'https://x' } })),
    ['author']);

  // ce qui n'est PAS importé n'a personne à citer
  check('primitive non contrainte',
    validateWorkCredit({ id: 'a', model: { shape: 'box' } }), []);
  check('construction voxel non contrainte',
    validateWorkCredit({ id: 'v', model: { type: 'voxel', dims: [4, 4, 4] } }), []);
  check('image personnelle non contrainte',
    validateWorkCredit({ id: 'i', image: 'textures/moi.png' }), []);
  check('modèle local sans source non contraint',
    validateWorkCredit({ id: 'm', model: { type: 'gltf', url: 'models/a.glb' } }), []);

  // scène entière
  const scene = [importe(), importe({ id: 'b', title: 'B', credit: { author: 'A' } }),
    { id: 'c', title: 'C', model: { shape: 'box' } }];
  const fautes = validateScene(scene);
  check('une seule œuvre fautive', fautes.length, 1);
  check('faute correctement identifiée',
    { id: fautes[0].id, missing: fautes[0].missing },
    { id: 'b', missing: ['license', 'sourceUrl'] });
  check('message lisible pour l’auteur',
    describeSceneFaults(fautes), '• « B » : licence, URL source');
  check('scène entièrement conforme', validateScene([importe()]), []);
  check('scène vide', validateScene(), []);
}

console.log('\nfichier compagnon');
{
  const work = {
    id: 'statue', title: 'Statue',
    model: { type: 'gltf', url: 'assets/statue.glb', source: 'polypizza' },
    credit: { author: 'Musée X', license: 'CC-BY 4.0', sourceUrl: 'https://poly.pizza/m/x' }
  };
  check('chemin dérivé du modèle',
    attributionPath('assets/statue.glb'), 'assets/statue.glb.attribution.json');
  check('paramètres de requête ignorés',
    attributionPath('https://h/x.glb?v=2'), 'https://h/x.glb.attribution.json');

  const f = attributionFile(work);
  check('le compagnon porte tout ce qu’il faut citer',
    [f.name, f.author, f.license, f.sourceUrl, f.source],
    ['Statue', 'Musée X', 'CC-BY 4.0', 'https://poly.pizza/m/x', 'polypizza']);
  check('le compagnon désigne son modèle', f.model, 'assets/statue.glb');
  check('le compagnon s’explique tout seul', f.note.length > 40, true);
}

console.log('\nmention obligatoire de plateforme');
{
  const works = [
    { id: 'a', model: { source: 'polypizza' } },
    { id: 'b', model: { source: 'polypizza' } },
    { id: 'c', model: { source: 'library' } },
    { id: 'd', model: { shape: 'box' } }
  ];
  check('une mention par plateforme, dédupliquée', collectSources(works), ['polypizza']);
  check('le mobilier livré n’est pas une plateforme tierce',
    collectSources([{ id: 'c', model: { source: 'library' } }]), []);
  check('scène sans import : aucune mention', collectSources([{ id: 'd' }]), []);
}

console.log('\naccessibilité — titres et descriptions');
{
  check('œuvre complète : rien à signaler',
    a11yGaps([{ id: 'a', title: 'A', description: 'Une œuvre.' }]), []);
  check('titre manquant',
    a11yGaps([{ id: 'a', description: 'x' }]),
    [{ id: 'a', title: '', missing: ['titre'] }]);
  check('description manquante',
    a11yGaps([{ id: 'a', title: 'A' }]),
    [{ id: 'a', title: 'A', missing: ['description'] }]);
  check('les deux manquants',
    a11yGaps([{ id: 'a' }])[0].missing, ['titre', 'description']);
  check('titre fait d’espaces = manquant',
    a11yGaps([{ id: 'a', title: '   ', description: 'x' }])[0].missing, ['titre']);
  check('message lisible',
    describeA11yGaps(a11yGaps([{ id: 'a' }, { id: 'b', title: 'B' }])),
    '• « a » : titre et description manquants\n• « B » : description manquant');
  check('scène vide', a11yGaps(), []);
  check('libellé prononçable de repli', speakableTitle({ title: '  ' }), 'Sans titre');
  check('libellé prononçable normal', speakableTitle({ title: 'Marées' }), 'Marées');
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

/**
 * Module Poly Pizza (éditeur) — normalisation et mapping d'attribution.
 * Le module vit dans le sous-module privé : s'il n'est pas récupéré
 * (CI, build Visiteur), la section se saute proprement au lieu de casser
 * `npm test` — exactement comme le build Visiteur se passe de l'éditeur.
 */
const pp = await import('../engine/src/editor/polypizza/data.js').catch(() => null);
if (!pp) {
  console.log('\nPoly Pizza : sous-module éditeur absent — section sautée');
} else {
  console.log('\nPoly Pizza — normalisation (casse officielle PascalCase)');
  {
    // casse EXACTE de l'API officielle : Licence, « Tri Count », DPURL
    const officiel = pp.normalizeModel({
      ID: 'dLl4cyOOAcC', Title: 'Banc de parc', Description: 'Un banc.',
      Attribution: 'Banc de parc by Quaternius (https://poly.pizza/m/dLl4cyOOAcC)',
      Thumbnail: 'https://t.poly.pizza/dLl4cyOOAcC.webp',
      Download: 'https://static.poly.pizza/dLl4cyOOAcC.glb',
      'Tri Count': 1234,
      Creator: { Username: 'Quaternius', DPURL: 'https://poly.pizza/u/Quaternius' },
      Category: 'Furniture', Tags: ['banc', 'parc'],
      Licence: 'CC0', Animated: false
    });
    check('identifiant', officiel.id, 'dLl4cyOOAcC');
    check('titre', officiel.title, 'Banc de parc');
    check('téléchargement', officiel.download, 'https://static.poly.pizza/dLl4cyOOAcC.glb');
    check('« Tri Count » (clé avec espace) lu', officiel.triCount, 1234);
    check('créateur', officiel.creator,
      { username: 'Quaternius', profileUrl: 'https://poly.pizza/u/Quaternius' });
    check('« Licence » (orthographe britannique) lue', officiel.licence, 'CC0');
    check('étiquettes', officiel.tags, ['banc', 'parc']);
    check('page du modèle dérivée de l’identifiant', officiel.pageUrl,
      'https://poly.pizza/m/dLl4cyOOAcC');
  }

  console.log('\nPoly Pizza — normalisation (casse camelCase des clients tiers)');
  {
    const tiers = pp.normalizeModel({
      id: 'abc123', title: 'Chaise', download: 'https://cdn/x.glb',
      triCount: 500, creator: { username: 'Momo', dpurl: 'https://p/u/momo' },
      license: 'CC-BY', animated: true, tags: ['chaise']
    });
    check('identifiant (camelCase)', tiers.id, 'abc123');
    check('triCount (camelCase)', tiers.triCount, 500);
    check('créateur (camelCase)', tiers.creator,
      { username: 'Momo', profileUrl: 'https://p/u/momo' });
    check('license (américain) lu aussi', tiers.licence, 'CC-BY');
    check('animé', tiers.animated, true);
    check('Licence prime sur license si les deux',
      pp.normalizeModel({ ID: 'x', Download: 'https://d/x.glb',
        Licence: 'CC0', license: 'CC-BY' }).licence, 'CC0');
  }

  console.log('\nPoly Pizza — entrées bancales');
  {
    check('null : rejeté', pp.normalizeModel(null), null);
    check('sans identifiant : rejeté',
      pp.normalizeModel({ Download: 'https://d/x.glb' }), null);
    check('sans téléchargement : rejeté (rien à importer)',
      pp.normalizeModel({ ID: 'x' }), null);
    const nu = pp.normalizeModel({ ID: 'x', Download: 'https://d/x.glb' });
    check('titre de repli', nu.title, 'Sans titre');
    check('triangles inconnus : null', nu.triCount, null);
    check('créateur absent : champs vides', nu.creator, { username: '', profileUrl: '' });
  }

  console.log('\nPoly Pizza — mapping vers l’attribution de la galerie');
  {
    const modele = pp.normalizeModel({
      ID: 'dLl4cyOOAcC', Title: 'Banc de parc',
      Download: 'https://static.poly.pizza/dLl4cyOOAcC.glb',
      Creator: { Username: 'Quaternius', DPURL: 'https://poly.pizza/u/Quaternius' },
      Licence: 'CC0'
    });
    check('crédit : la SOURCE est la page du modèle, pas le CDN ni l’API',
      pp.creditFromModel(modele),
      { author: 'Quaternius', license: 'CC0', sourceUrl: 'https://poly.pizza/m/dLl4cyOOAcC' });
    check('licence absente laissée vide (l’export la réclamera)',
      pp.creditFromModel(pp.normalizeModel({ ID: 'x', Download: 'https://d/x.glb' })).license,
      '');

    const item = pp.libraryItemFromModel(modele);
    check('URL locale, jamais Poly Pizza', item.url,
      'assets/polypizza/banc-de-parc-dLl4cyOOAcC.glb');
    check('marqueur de plateforme', item.source, 'polypizza');
    const norme = normalizeItem(item);
    check('l’entrée survit au normaliseur de la bibliothèque', Boolean(norme), true);
    check('la bibliothèque conserve le marqueur', norme.source, 'polypizza');
    check('crédit complet après normalisation', creditOf(norme),
      { author: 'Quaternius', license: 'CC0', sourceUrl: 'https://poly.pizza/m/dLl4cyOOAcC' });
    check('le compagnon se placera à côté du fichier',
      attributionPath(item.url),
      'assets/polypizza/banc-de-parc-dLl4cyOOAcC.glb.attribution.json');
    check('nom de fichier : titre assaini + identifiant (pas de collision)',
      pp.modelFileName(pp.normalizeModel({ ID: 'zz9', Title: 'Banc de parc',
        Download: 'https://d/x.glb' })),
      'banc-de-parc-zz9.glb');
  }

  console.log('\nPoly Pizza — import par URL ou code de modèle');
  {
    check('URL complète → code',
      pp.modelIdFromInput('https://poly.pizza/m/XVRCQ0j2AF'), 'XVRCQ0j2AF');
    check('URL sans protocole → code',
      pp.modelIdFromInput('poly.pizza/m/XVRCQ0j2AF'), 'XVRCQ0j2AF');
    check('URL avec requête/ancre → code',
      pp.modelIdFromInput('https://poly.pizza/m/XVRCQ0j2AF?utm=x#top'), 'XVRCQ0j2AF');
    check('code seul (chiffre + 9-14 alphanum.) → code',
      pp.modelIdFromInput('  XVRCQ0j2AF '), 'XVRCQ0j2AF');
    check('mot-clé ordinaire → recherche', pp.modelIdFromInput('banc de parc'), null);
    check('mot long sans chiffre → recherche',
      pp.modelIdFromInput('constructions'), null);
    check('mot court → recherche', pp.modelIdFromInput('tree'), null);
    check('URL explicite reconnue', pp.isModelUrl('https://poly.pizza/m/x1'), true);
    check('code seul : pas une URL explicite', pp.isModelUrl('XVRCQ0j2AF'), false);
  }

  console.log('\nPoly Pizza — proxy local anti-CORS');
  {
    const api = await import('../engine/src/editor/polypizza/api.js').catch(() => null);
    if (!api) {
      console.log('  (module api absent — sous-section sautée)');
    } else {
      check('en local : proxy d’abord, direct en repli',
        api.apiUrls('/search/banc', { limit: '24' }, true),
        ['/pp-api/v1.1/search/banc?limit=24',
          'https://api.poly.pizza/v1.1/search/banc?limit=24']);
      check('publié : appel direct seulement',
        api.apiUrls('/search/banc', {}, false),
        ['https://api.poly.pizza/v1.1/search/banc']);
      check('téléchargement local : proxy du CDN d’abord',
        api.downloadUrls('https://static.poly.pizza/x.glb', true),
        ['/pp-static/x.glb', 'https://static.poly.pizza/x.glb']);
      check('hôte inconnu : pas de proxy inventé',
        api.downloadUrls('https://ailleurs.net/x.glb', true),
        ['https://ailleurs.net/x.glb']);
      check('publié : téléchargement direct',
        api.downloadUrls('https://static.poly.pizza/x.glb', false),
        ['https://static.poly.pizza/x.glb']);
    }
  }

  console.log('\nPoly Pizza — construction des requêtes');
  {
    check('mot-clé encodé dans le chemin',
      pp.searchRequest({ query: 'banc de parc' }).path, '/search/banc%20de%20parc');
    check('sans mot-clé : parcours', pp.searchRequest({}).path, '/search');
    const p = pp.searchRequest({ query: 'x', limit: 50, page: 2 }).params;
    check('limit borné au maximum de l’API (32)', p.limit, '32');
    check('page transmise', p.page, '2');
    check('limit plancher à 1', pp.searchRequest({ limit: 0 }).params.limit, '1');
    check('filtres transmis seulement s’ils sont définis',
      Object.keys(pp.searchRequest({ query: 'x' }).params), ['limit', 'page']);
    check('filtre licence transmis',
      pp.searchRequest({ license: 'CC0' }).params.license, 'CC0');
  }
}

console.log(`\n${passed} réussis, ${failed} échoués\n`);
process.exit(failed ? 1 : 0);

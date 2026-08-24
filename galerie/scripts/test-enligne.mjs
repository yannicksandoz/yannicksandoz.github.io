/**
 * Test de la mise en ligne : réglages, arbre de commit, suppressions.
 * Sans réseau — seules les fonctions pures sont éprouvées ici, ce sont
 * elles qui décident ce qui sera écrit et surtout ce qui sera EFFACÉ.
 * Lancer avec : npm test
 */
import { normaliserConfig, normaliserChemin, siteParDefaut, manques,
  entreesArbre, entreesRetirees, texteJson, jetonMasque, resumeEnvoi }
  from '../engine/src/editor/state/EnLigne.js';

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

console.log('\nréglages');
{
  // On colle presque toujours depuis la barre d'adresse : les quatre formes
  // doivent donner le même dépôt.
  const formes = [
    'yannicksandoz/yannicksandoz.github.io',
    'https://github.com/yannicksandoz/yannicksandoz.github.io',
    'https://github.com/yannicksandoz/yannicksandoz.github.io.git',
    'git@github.com:yannicksandoz/yannicksandoz.github.io.git'
  ];
  for (const f of formes) {
    check(`dépôt reconnu — ${f.slice(0, 28)}…`,
      normaliserConfig({ depot: f }).depot, 'yannicksandoz/yannicksandoz.github.io');
  }
  check('une adresse de sous-page ne garde que auteur/dépôt',
    normaliserConfig({ depot: 'github.com/a/b/tree/master/galerie' }).depot, 'a/b');
  check('un dépôt incomplet ne passe pas',
    normaliserConfig({ depot: 'yannicksandoz' }).depot, '');
  check('refs/heads/ est retiré de la branche',
    normaliserConfig({ branche: 'refs/heads/master' }).branche, 'master');

  check('le chemin se termine par une barre',
    normaliserChemin('/galerie/content/'), 'galerie/content/');
  check('un chemin vide reste vide', normaliserChemin('  '), '');
  check('le site perd sa barre finale',
    normaliserConfig({ site: 'https://exemple.org/galerie/' }).site,
    'https://exemple.org/galerie');
}

console.log('\nadresse du site proposée');
{
  check('dépôt de pages personnelles + sous-dossier',
    siteParDefaut('yannicksandoz/yannicksandoz.github.io', 'galerie/content'),
    'https://yannicksandoz.github.io/galerie');
  check('dépôt de pages personnelles, contenu à la racine',
    siteParDefaut('yannicksandoz/yannicksandoz.github.io', 'content'),
    'https://yannicksandoz.github.io');
  check('dépôt de projet',
    siteParDefaut('MonNom/ma-galerie', 'content'),
    'https://monnom.github.io/ma-galerie');
  check('sans dépôt, aucune proposition', siteParDefaut('', 'content'), '');
}

console.log('\nce qui manque');
{
  check('tout manque', manques({ depot: '', jeton: '' }),
    ['le dépôt (auteur/dépôt)', 'le jeton d’accès']);
  check('rien ne manque', manques({ depot: 'a/b', jeton: 'x' }), []);
}

console.log('\njeton');
{
  check('le jeton ne s’affiche jamais en entier',
    jetonMasque('github_pat_ABCDEFGHIJKLMNOP').endsWith('MNOP'), true);
  check('…et son début n’apparaît pas',
    jetonMasque('github_pat_ABCDEFGHIJKLMNOP').includes('github'), false);
  check('pas de jeton, pas de masque', jetonMasque(''), '');
}

/* ------------------------------------------------------------ l'arbre --- */

const plan = {
  fichiers: [
    { chemin: 'works/nebuleuse.json', data: { id: 'nebuleuse' } },
    { chemin: 'works/index.json', data: ['nebuleuse.json'] },
    { chemin: 'rooms/hall.json', data: { id: 'hall' } },
    { chemin: 'rooms/index.json', data: ['hall.json'] }
  ],
  medias: []
};

console.log('\narbre du commit');
{
  const entrees = entreesArbre(plan, 'galerie/content');
  check('chaque fichier est préfixé du dossier de contenu',
    entrees.map((e) => e.path),
    ['galerie/content/works/nebuleuse.json', 'galerie/content/works/index.json',
      'galerie/content/rooms/hall.json', 'galerie/content/rooms/index.json']);
  check('mode et type sont ceux d’un fichier ordinaire',
    [entrees[0].mode, entrees[0].type], ['100644', 'blob']);
  // Sans le saut de ligne final, chaque publication produirait cent
  // cinquante-huit modifications de fin de fichier — un diff illisible.
  check('le contenu finit par un saut de ligne',
    entrees[0].content.endsWith('}\n'), true);
  check('…et il est indenté comme les fichiers du dépôt',
    texteJson({ a: 1 }), '{\n  "a": 1\n}\n');
  check('un chemin vide écrit à la racine',
    entreesArbre(plan, '')[0].path, 'works/nebuleuse.json');
}

console.log('\nce qui disparaît');
{
  const distant = [
    'galerie/content/works/nebuleuse.json',   // toujours là
    'galerie/content/works/ancienne.json',    // retirée de la galerie
    'galerie/content/works/index.json',
    'galerie/content/works/works.json',       // fichier COMBINÉ : une ombre
    'galerie/content/rooms/hall.json',
    'galerie/content/rooms/index.json',
    'galerie/content/assets/son.mp3',         // un média : on n'y touche pas
    'galerie/content/reglages.json',          // hors works/ et rooms/
    'galerie/index.html',                     // le site lui-même
    'autre-dossier/works/perdue.json'         // hors du dossier de contenu
  ];
  const retires = entreesRetirees(distant, plan, 'galerie/content').map((e) => e.path);
  check('seuls les JSON orphelins de works/ et rooms/ partent',
    retires.sort(),
    ['galerie/content/works/ancienne.json', 'galerie/content/works/works.json']);
  check('une suppression est un blob à sha nul',
    entreesRetirees(distant, plan, 'galerie/content')[0].sha, null);
  check('rien de connu ne disparaît',
    entreesRetirees(['galerie/content/works/nebuleuse.json'], plan, 'galerie/content'),
    []);
  // Un arbre tronqué donne une liste vide : ne RIEN effacer est la seule
  // réponse défendable quand on ne sait pas ce qui existe.
  check('une liste distante vide n’efface rien',
    entreesRetirees([], plan, 'galerie/content'), []);
}

console.log('\nrésumé montré avant d’envoyer');
{
  const texte = resumeEnvoi({
    config: { depot: 'a/b', chemin: 'galerie/content/' },
    plan, branche: 'master',
    retires: [{ path: 'galerie/content/works/ancienne.json' }]
  });
  check('le résumé nomme le dépôt et la branche',
    texte.includes('a/b') && texte.includes('master'), true);
  check('…et nomme ce qui sera effacé',
    texte.includes('ancienne.json') && texte.includes('EFFACÉS'), true);
}

console.log(`\n${passed} ✓ / ${failed} ✗`);
process.exit(failed ? 1 : 0);

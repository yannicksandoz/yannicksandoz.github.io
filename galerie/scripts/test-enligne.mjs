/**
 * Test de la mise en ligne : réglages, arbre de commit, suppressions.
 * Sans réseau — seules les fonctions pures sont éprouvées ici, ce sont
 * elles qui décident ce qui sera écrit et surtout ce qui sera EFFACÉ.
 * Lancer avec : npm test
 */
import { normaliserConfig, normaliserChemin, siteParDefaut, manques,
  entreesArbre, entreesRetirees, texteJson, jetonMasque, resumeEnvoi,
  COMPTES_VIDES, normaliserComptes, ajouterCompte, mettreAJourCompte, choisirCompte,
  retirerCompte, compteCourant, nomDeCompte, idCompteLibre,
  fichiersSous, shaBlobGit, planRecuperation, resumeRecuperation }
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
    'galerie/content/gabarits/vieux.json',    // un modèle de pièce renommé depuis
    'galerie/content/assets/son.mp3',         // un média : on n'y touche pas
    'galerie/content/reglages.json',          // hors works/ et rooms/
    'galerie/index.html',                     // le site lui-même
    'autre-dossier/works/perdue.json'         // hors du dossier de contenu
  ];
  const retires = entreesRetirees(distant, plan, 'galerie/content').map((e) => e.path);
  check('seuls les JSON orphelins de works/, rooms/ et gabarits/ partent',
    retires.sort(),
    ['galerie/content/gabarits/vieux.json', 'galerie/content/works/ancienne.json', 'galerie/content/works/works.json']);
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

console.log('\nles comptes GitHub');
{
  let e = ajouterCompte(COMPTES_VIDES, { depot: 'https://github.com/yannicksandoz/yannicksandoz.github.io', chemin: 'galerie/content' });
  check('le premier compte est courant, ses réglages normalisés',
    [e.courant, e.comptes[0].depot, e.comptes[0].chemin], ['c1', 'yannicksandoz/yannicksandoz.github.io', 'galerie/content/']);
  check('sans nom, le compte porte le propriétaire du dépôt', nomDeCompte(e.comptes[0], 1), 'yannicksandoz');
  check('sans nom ni dépôt, « Compte n »', nomDeCompte(ajouterCompte(COMPTES_VIDES).comptes[0], 3), 'Compte 3');
  e = ajouterCompte(e, { nom: ' Client ', depot: 'client/site' });
  check('un second compte devient courant, nommé', [e.courant, e.comptes.length, e.comptes[1].nom], ['c2', 2, 'Client']);
  check('choisir revient au premier ; un id inconnu ne change rien',
    [choisirCompte(e, 'c1').courant, choisirCompte(e, 'zz').courant], ['c1', 'c2']);
  check('mettre à jour ne touche que le compte visé',
    mettreAJourCompte(e, 'c1', { branche: 'refs/heads/main', nom: 'Moi' }).comptes.map((c) => `${c.id}:${c.nom}:${c.branche}`),
    ['c1:Moi:main', 'c2:Client:']);
  check('retirer le courant passe au premier restant ; retirer tout laisse courant null',
    [retirerCompte(e, 'c2').courant, retirerCompte(retirerCompte(e, 'c2'), 'c1').courant], ['c1', null]);
  check('un id retiré se réattribue, jamais un id en place', [idCompteLibre(retirerCompte(e, 'c1')), idCompteLibre(e)], ['c1', 'c3']);
  check('normaliser : doublons et entrées sans id écartés, courant inconnu ramené au premier',
    normaliserComptes({ courant: 'x', comptes: [{ id: 'a', depot: 'u/v' }, { id: 'a' }, { nom: 'sans id' }] }),
    { courant: 'a', comptes: [{ id: 'a', nom: '', depot: 'u/v', branche: '', chemin: 'content/', site: '' }] });
  check('compteCourant rend le compte, ou null', [compteCourant(e)?.id, compteCourant(COMPTES_VIDES)], ['c2', null]);
}

console.log('\nrécupérer la version en ligne');
{
  const arbre = [
    { path: 'galerie/content/works/a.json', type: 'blob', sha: 'A', size: 10 },
    { path: 'galerie/content/rooms/e.json', type: 'blob', sha: 'E', size: 20 },
    { path: 'galerie/content/assets/son.wav', type: 'blob', sha: 'S', size: 1000 },
    { path: 'galerie/content/.sauvegardes/2026/works/x.json', type: 'blob', sha: 'X', size: 1 },
    { path: 'galerie/content/works', type: 'tree', sha: 'T' },
    { path: 'galerie/index.html', type: 'blob', sha: 'I', size: 5 },
    { path: 'autre/content/works/z.json', type: 'blob', sha: 'Z', size: 5 }
  ];
  const f = fichiersSous(arbre, 'galerie/content');
  check('seuls les blobs sous le dossier, en relatif, sans les sauvegardes',
    f.map((x) => `${x.chemin}:${x.sha}`), ['works/a.json:A', 'rooms/e.json:E', 'assets/son.wav:S']);
  check('sans dossier, tout le dépôt (sauvegardes exclues)', fichiersSous(arbre, '').length, 5);

  const locaux = new Map([['works/a.json', 'A'], ['rooms/e.json', 'E-modifie'], ['works/vieux.json', 'V'], ['rooms/sous/x.json', ''], ['assets/autre.wav', 'W']]);
  const plan = planRecuperation(f, locaux);
  check('identique gardé, différent et absent écrits, JSON orphelin retiré, média local jamais retiré',
    [plan.identiques, plan.aEcrire.map((x) => x.chemin), plan.aRetirer, plan.octets],
    [['works/a.json'], ['rooms/e.json', 'assets/son.wav'], ['works/vieux.json'], 1020]);
  const texte = resumeRecuperation({ config: { depot: 'a/b' }, branche: 'master', plan, tronque: true, modifie: true });
  check('le résumé nomme les écritures, les retraits, la troncature et le travail perdu',
    [/2 fichier\(s\) à écrire \(1 ko\), 1 déjà identique/.test(texte), /works\/vieux.json/.test(texte), /trop grand/.test(texte), /PERDUES/.test(texte)],
    [true, true, true, true]);
}

const empreinte = await shaBlobGit(new TextEncoder().encode('hello\n'));
check('l\'empreinte git d\'un blob est celle de git (« hello »)', empreinte, 'ce013625030ba8dba906f756967f9e9ca394464a');

console.log(`\n${passed} ✓ / ${failed} ✗`);
process.exit(failed ? 1 : 0);

#!/usr/bin/env node
/**
 * L'APPLICATION AUTEUR, CONSTRUITE ICI — sans GitHub Actions, sans minute payante.
 *
 *   npm run app:mac                 le .dmg pour CE Mac (arm64 ou x64, détecté)
 *   npm run app:mac -- --universel  arm64 + x64 dans un seul .dmg (deux fois plus long)
 *   npm run app:win                 l'installateur .exe, sur un poste Windows
 *   npm run app:linux               l'AppImage, sur un poste Linux
 *
 * Dans l'ordre, et chaque étape arrête tout si elle échoue :
 *   1. le dépôt est propre et le sous-module éditeur est au commit que le
 *      site référence — sinon on s'arrête en le disant (--forcer passe
 *      outre, pour un essai qu'on ne distribuera pas) ;
 *   2. npm test (--sans-tests pour les sauter, même réserve) ;
 *   3. le build auteur (dist-auteur/) ;
 *   4. app/build-info.json : le commit (SHA court), la branche, la date —
 *      ce qu'Aide › À propos montre, et ce que « Vérifier les mises à jour »
 *      compare aux commits du dépôt public ;
 *   5. electron-builder, pour ce poste seulement ;
 *   6. le chemin du paquet et la marche à suivre.
 *
 * La version (package.json) n'est pas touchée : elle se change à la main.
 * `--info-seulement` n'écrit que l'étape 4 (le workflow à la demande l'emploie).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ciblePour, etatDepot, infoBuild, marcheASuivre, COMMANDES } from './app-local-regles.mjs';

const ici = dirname(fileURLToPath(import.meta.url));
const racine = join(ici, '..');                       // galerie/
const site = join(racine, '..');                      // le dépôt public
const editeur = join(racine, 'engine', 'src', 'editor');
const args = process.argv.slice(2);
const a = (nom) => args.includes(nom);
const cible = a('--mac') ? 'mac' : a('--win') ? 'win' : a('--linux') ? 'linux' : null;

const titre = (t) => console.log(`\n━━ ${t}`);
const stop = (msg, code = 1) => { console.error(`\n✗ ${msg}`); process.exit(code); };
const git = (dossier, ...argv) => {
  const r = spawnSync('git', ['-C', dossier, ...argv], { encoding: 'utf8' });
  // la fin seulement : un « porcelain » commence par son code d'état, parfois un espace
  return r.status === 0 ? r.stdout.replace(/\s+$/, '') : '';
};
const etape = (cmd, argv, options = {}) => {
  const r = spawnSync(cmd, argv, { cwd: racine, stdio: 'inherit', ...options });
  if (r.status !== 0) stop(`${options.nom ?? cmd} a échoué (${r.status ?? r.signal}).`);
};

/* 4. l'information de build (seule étape du mode --info-seulement) */
function ecrireInfoBuild() {
  const version = JSON.parse(readFileSync(join(racine, 'package.json'), 'utf8')).version;
  const info = infoBuild({
    version,
    commit: git(site, 'rev-parse', 'HEAD'),
    commitEditeur: git(editeur, 'rev-parse', 'HEAD'),
    branche: process.env.GITHUB_REF_NAME || git(site, 'rev-parse', '--abbrev-ref', 'HEAD'),
    plateforme: process.platform, arch: process.arch, cible: cible ?? '', universel: a('--universel')
  });
  writeFileSync(join(racine, 'app', 'build-info.json'), `${JSON.stringify(info, null, 2)}\n`);
  console.log(`build ${info.commit} (éditeur ${info.commitEditeur}), branche ${info.branche}, ${info.date}`);
  return info;
}

if (a('--info-seulement')) { ecrireInfoBuild(); process.exit(0); }
if (!cible) stop('Quelle cible ? npm run app:mac, app:win ou app:linux.', 2);

/* 0. la cible sur ce poste */
const plan = ciblePour({ cible, plateforme: process.platform, arch: process.arch, universel: a('--universel') });
if (plan.erreur) stop(plan.erreur, 2);

/* 1. le dépôt */
titre('Le dépôt');
if (!existsSync(join(editeur, 'Editor.js'))) stop('L’éditeur (sous-module privé) est absent : git submodule update --init');
const etat = etatDepot({
  porcelain: git(site, 'status', '--porcelain', '--untracked-files=normal'),
  porcelainEditeur: git(editeur, 'status', '--porcelain', '--untracked-files=normal'),
  sousModule: git(site, 'submodule', 'status', '--', 'galerie/engine/src/editor')
});
if (!etat.ok) {
  for (const r of etat.raisons) console.error(`  • ${r}`);
  if (!a('--forcer')) stop('Le build embarque un commit : il doit correspondre à ce qu’il contient. Commitez (ou rangez), puis relancez ; --forcer pour un essai à ne pas distribuer.');
  console.warn('  --forcer : on construit quand même (ne pas distribuer ce paquet).');
} else console.log('  propre, sous-module au commit référencé.');

/* 2. les tests */
if (a('--sans-tests')) console.log('\n━━ Les tests : sautés (--sans-tests)');
else { titre('Les tests'); etape(process.execPath, [join(ici, 'tests.mjs')], { nom: 'npm test' }); }

/* 3. le build auteur */
titre('Le build auteur');
etape(process.execPath, [join(ici, 'build-auteur.mjs')], { nom: 'npm run build:auteur' });

/* 4. le commit embarqué */
titre('Le commit embarqué');
const info = ecrireInfoBuild();

/* 5. le paquet */
titre(`Le paquet ${cible} ${plan.archLibelle}`);
const cli = join(racine, 'node_modules', 'electron-builder', 'cli.js');
if (!existsSync(cli)) stop('electron-builder est absent : npm ci');
const avant = new Set(existsSync(join(racine, 'app-dist')) ? readdirSync(join(racine, 'app-dist')) : []);
const t0 = Date.now();
etape(process.execPath, [cli, ...plan.args], { nom: 'electron-builder', env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: process.env.CSC_LINK ? 'true' : 'false' } });

/* 6. où est le paquet, et quoi en faire */
const ext = { mac: '.dmg', win: '.exe', linux: '.AppImage' }[cible];
const paquets = readdirSync(join(racine, 'app-dist')).filter((f) => f.endsWith(ext));
const neufs = paquets.filter((f) => !avant.has(f));
const chemins = (neufs.length ? neufs : paquets).map((f) => join(racine, 'app-dist', f));
titre(`Terminé en ${Math.round((Date.now() - t0) / 1000)} s — version ${info.version}, build ${info.commit} (${info.branche})`);
for (const l of marcheASuivre({ cible, chemins })) console.log(l);
console.log(`\nÀ refaire après un changement de engine/, app/, de l’éditeur, des partagés (content/library, shaders, textures), d’Electron ou des dépendances : ${COMMANDES[cible]}.`);

/**
 * LES MISES À JOUR DE L'APPLICATION, sans Release ni jeton (app/main.cjs).
 *
 * L'application se construit en local (npm run app:mac) et embarque le
 * commit du site, la branche et la date de son build (app/build-info.json,
 * écrit par scripts/app-local.mjs). « Vérifier les mises à jour » ne
 * cherche plus une Release : elle lit, par l'API publique de GitHub et
 * sans jeton, les commits de master postérieurs au build qui touchent ce
 * dont l'application est faite — engine/ (l'éditeur, sous-module, y est),
 * app/, les dépendances, les partagés du build — et dit : « Le code a
 * avancé depuis ton build (N commits concernés) — relance npm run app:mac ».
 * Un commit qui ne touche que le contenu ne compte pas : l'application
 * sert le dossier de contenu en direct.
 *
 * Tout ici est pur (testé au nœud : test-app-mises-a-jour.mjs) ; main.cjs
 * fait les requêtes et les boîtes.
 */
const DEPOT_PUBLIC = 'yannicksandoz/yannicksandoz.github.io';
const BRANCHE = 'master';
const COMMANDE_BUILD = 'npm run app:mac';
/** Ce dont l'application est faite : un commit qui touche l'un de ces chemins vaut une reconstruction. */
const CHEMINS_SURVEILLES = Object.freeze([
  'galerie/engine',              // le moteur, l'éditeur (le pointeur du sous-module est dedans)
  'galerie/app',                 // Electron
  'galerie/package.json',        // les dépendances, Electron
  'galerie/package-lock.json',
  'galerie/content/library',     // les partagés que « Nouvelle galerie » copie du build
  'galerie/content/shaders',
  'galerie/content/textures'
]);

/** L'information de build, telle qu'embarquée — ou null si elle n'a pas la forme. */
function normaliserInfoBuild(brut) {
  if (!brut || typeof brut !== 'object') return null;
  const commit = String(brut.commit ?? '').trim();
  const date = new Date(brut.date ?? NaN);
  if (!/^[0-9a-f]{7,40}$/i.test(commit) || Number.isNaN(date.getTime())) return null;
  return {
    version: String(brut.version ?? ''),
    commit: commit.slice(0, 7),
    commitEditeur: String(brut.commitEditeur ?? '').slice(0, 7),
    branche: String(brut.branche ?? ''),
    date: date.toISOString(),
    plateforme: String(brut.plateforme ?? ''), arch: String(brut.arch ?? ''),
    universel: Boolean(brut.universel)
  };
}

/** Les requêtes à faire : une par chemin surveillé, les commits de master depuis le build. */
function urlsCommits({ base = 'https://api.github.com', depuis, branche = BRANCHE, depot = DEPOT_PUBLIC }) {
  return CHEMINS_SURVEILLES.map((chemin) =>
    `${base}/repos/${depot}/commits?sha=${encodeURIComponent(branche)}&path=${encodeURIComponent(chemin)}&since=${encodeURIComponent(depuis)}&per_page=100`);
}

/**
 * Les commits concernés, toutes listes confondues, sans doublon, le plus
 * récent d'abord ; le commit du build lui-même n'en est pas un.
 */
function commitsConcernes(listes, build) {
  const vus = new Map();
  for (const liste of listes) {
    for (const c of Array.isArray(liste) ? liste : []) {
      const sha = String(c?.sha ?? '');
      if (!sha || (build?.commit && sha.startsWith(build.commit))) continue;
      if (!vus.has(sha)) {
        vus.set(sha, {
          sha: sha.slice(0, 7),
          date: c.commit?.committer?.date ?? c.commit?.author?.date ?? '',
          message: String(c.commit?.message ?? '').split('\n')[0]
        });
      }
    }
  }
  return [...vus.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

const dateLisible = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
};

/** Le texte de la boîte « mises à jour ». */
function texteMiseAJour({ version, build, commits }) {
  const n = commits.length;
  const tete = `Application ${version}, build ${build.commit} du ${dateLisible(build.date)}${build.branche ? ` (${build.branche})` : ''}.`;
  if (!n) return `${tete}\nRien n’a changé depuis dans le code dont elle est faite : à jour.`;
  const liste = commits.slice(0, 5).map((c) => `  ${c.sha}  ${c.message}`).join('\n');
  return `${tete}\nLe code a avancé depuis ton build (${n} commit${n > 1 ? 's' : ''} concerné${n > 1 ? 's' : ''}) — relance ${COMMANDE_BUILD}.\n${liste}${n > 5 ? `\n  … et ${n - 5} autres` : ''}`;
}

/** Le texte d'Aide › À propos. */
function texteAPropos({ version, build, versions = {} }) {
  const moteur = `Electron ${versions.electron ?? '?'}, Chromium ${versions.chrome ?? '?'}, Node ${versions.node ?? '?'}.`;
  if (!build) return `Galerie auteur ${version} — build de développement (npm run app), commit inconnu.\n${moteur}`;
  const ou = `${build.plateforme || '?'} ${build.universel ? 'universel' : build.arch}`.trim();
  return `Galerie auteur ${version}\nBuild du ${dateLisible(build.date)} — commit ${build.commit}${build.commitEditeur ? ` (éditeur ${build.commitEditeur})` : ''}, branche ${build.branche || '?'}, ${ou}.\n${moteur}`;
}

module.exports = { DEPOT_PUBLIC, BRANCHE, COMMANDE_BUILD, CHEMINS_SURVEILLES, normaliserInfoBuild, urlsCommits, commitsConcernes, texteMiseAJour, texteAPropos };

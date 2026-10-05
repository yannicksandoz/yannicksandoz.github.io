/**
 * LES RÈGLES DU BUILD LOCAL de l'application (scripts/app-local.mjs), en
 * pur : la cible et l'architecture d'electron-builder pour ce poste, l'état
 * du dépôt qui autorise ou non la construction, l'information de build
 * embarquée, la marche à suivre. Testé au nœud (test-app-local.mjs).
 */

export const COMMANDES = { mac: 'npm run app:mac', win: 'npm run app:win', linux: 'npm run app:linux' };

/**
 * Les arguments d'electron-builder pour une cible sur ce poste — ou une
 * raison claire de ne pas construire. Un `.dmg` ne se fabrique que sur un
 * Mac, un `.exe` sur Windows, une AppImage sur Linux ; l'architecture est
 * celle du poste (arm64 ou x64), l'universel seulement si on le demande,
 * il double le temps.
 */
export function ciblePour({ cible, plateforme, arch, universel = false }) {
  const besoin = { mac: 'darwin', win: 'win32', linux: 'linux' }[cible];
  if (!besoin) return { erreur: `cible inconnue : ${cible} (mac, win ou linux)` };
  if (plateforme !== besoin) {
    const nom = { mac: 'un Mac', win: 'un poste Windows', linux: 'un poste Linux' }[cible];
    return { erreur: `${COMMANDES[cible]} se lance sur ${nom} (ici : ${plateforme}). Pour un autre système : le workflow « Application auteur » à la demande, qui se paie.` };
  }
  const args = [`--${cible}`];
  if (cible === 'mac') {
    if (universel) args.push('--universal');
    else if (arch === 'arm64') args.push('--arm64');
    else args.push('--x64');
  } else if (cible === 'win') args.push('--x64');
  args.push('--publish', 'never');
  return { args, archLibelle: cible === 'mac' ? (universel ? 'universel (arm64 + x64)' : arch) : 'x64' };
}

/**
 * Le dépôt est-il prêt ? `porcelain` : la sortie de `git status --porcelain`
 * du site ; `porcelainEditeur` : celle de l'éditeur ; `sousModule` : une
 * ligne de `git submodule status`. Rend { ok, raisons }.
 */
export function etatDepot({ porcelain = '', porcelainEditeur = '', sousModule = '' }) {
  const raisons = [];
  const modifies = (texte) => texte.split('\n').map((l) => l.trimEnd()).filter(Boolean);
  const site = modifies(porcelain).filter((l) => !/\bapp\/build-info\.json$/.test(l));
  if (site.length) raisons.push(`le site a des changements non commités (${site.length}) : ${site.slice(0, 4).map((l) => l.slice(3)).join(', ')}${site.length > 4 ? '…' : ''}`);
  const ed = modifies(porcelainEditeur);
  if (ed.length) raisons.push(`l'éditeur a des changements non commités (${ed.length}) : ${ed.slice(0, 4).map((l) => l.slice(3)).join(', ')}${ed.length > 4 ? '…' : ''}`);
  const marque = sousModule.charAt(0);
  if (marque === '+') raisons.push('le sous-module éditeur n’est pas au commit que le site référence (git submodule update, ou commiter le pointeur)');
  if (marque === '-') raisons.push('le sous-module éditeur n’est pas initialisé (git submodule update --init)');
  if (marque === 'U') raisons.push('le sous-module éditeur est en conflit');
  return { ok: !raisons.length, raisons };
}

/** Ce que l'application embarque : le commit (SHA court), la branche, la date du build. */
export function infoBuild({ version, commit, commitEditeur, branche, date = new Date(), plateforme, arch, cible, universel = false }) {
  return {
    version: String(version ?? ''),
    commit: String(commit ?? '').slice(0, 7),
    commitEditeur: String(commitEditeur ?? '').slice(0, 7),
    branche: String(branche ?? ''),
    date: (date instanceof Date ? date : new Date(date)).toISOString(),
    plateforme: String(plateforme ?? ''), arch: String(arch ?? ''), cible: String(cible ?? ''),
    universel: Boolean(universel)
  };
}

/** La marche à suivre après le build, selon la cible. */
export function marcheASuivre({ cible, chemins }) {
  const lignes = [];
  if (chemins.length) lignes.push(...chemins.map((c) => `  → ${c}`));
  if (cible === 'mac') {
    lignes.push('Installer : quitter l’ancienne application, ouvrir le .dmg, glisser « Galerie auteur » dans Applications (remplacer).');
    lignes.push('Un build local n’a pas de quarantaine : il s’ouvre directement. Transféré sur un autre Mac : Réglages › Confidentialité et sécurité › « Ouvrir quand même ».');
  } else if (cible === 'win') {
    lignes.push('Installer : fermer l’ancienne application, lancer l’installateur .exe (il remplace la version en place).');
  } else {
    lignes.push('Lancer : rendre l’AppImage exécutable (chmod +x) et l’ouvrir ; elle remplace l’ancienne au même endroit.');
  }
  return lignes;
}

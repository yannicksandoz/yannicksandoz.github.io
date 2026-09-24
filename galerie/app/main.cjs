/**
 * L'APPLICATION AUTEUR — le build auteur dans une fenêtre, sans terminal.
 *
 * Le quotidien de l'auteur était `npm run dev` puis Chrome : Node, Vite,
 * le dépôt cloné, un terminal ouvert. Ici, un double-clic. L'application
 * est petite parce qu'elle ne fait que trois choses :
 *
 *   1. elle SERT le build auteur et le dossier de contenu de l'auteur sur
 *      127.0.0.1 (app/serveur.cjs) — le contenu vivant passe devant celui
 *      figé au build, et les proxys Freesound / Poly Pizza sont là ;
 *   2. elle OUVRE une fenêtre Chromium dessus, en mode auteur (`?edit`) —
 *      le moteur tourne sur le navigateur où il est vérifié, et
 *      « Publier » (File System Access API) écrit dans le dossier comme
 *      dans Chrome ;
 *   3. elle DEMANDE une fois le dossier `content/` (menu Fichier pour en
 *      changer) et s'en souvient dans ses données d'utilisateur.
 *
 * Rien de plus : pas de mise à jour automatique (elle exigerait un jeton
 * pour lire une publication privée), pas de clé d'API (celles de l'auteur
 * restent dans le profil de la fenêtre, comme dans un navigateur). Les
 * liens vers le dehors s'ouvrent dans le navigateur du système.
 */
'use strict';
const { app, BrowserWindow, Menu, dialog, shell, session, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { demarrerServeur } = require('./serveur.cjs');
const { Dossiers } = require('./dossiers.cjs');
const { noterRecent, plusRecente, estUneGalerie } = require('./reglages-regles.cjs');

const DIST = path.join(__dirname, '..', 'dist-auteur');
const PAGE_RELEASES = 'https://github.com/yannicksandoz/yr0-editor/releases';
// la version de référence : celle du dépôt PUBLIC du site, lisible sans jeton
// (les binaires, eux, vivent dans une Release privée)
const URL_VERSION = process.env.GALERIE_URL_VERSION
  || 'https://raw.githubusercontent.com/yannicksandoz/yannicksandoz.github.io/master/galerie/package.json';

/* ------------------------------------------------------------ réglages --- */

const fichierReglages = () => path.join(app.getPath('userData'), 'reglages.json');

function lireReglages() {
  try { return JSON.parse(fs.readFileSync(fichierReglages(), 'utf8')); } catch { return {}; }
}

function ecrireReglages(r) {
  try { fs.writeFileSync(fichierReglages(), JSON.stringify(r, null, 2)); } catch { /* disque en lecture seule : on vivra sans */ }
}

/* -------------------------------------------------------------- état --- */

let serveur = null;
let fenetre = null;
let reglages = {};
// les dossiers que la page a le droit de toucher (voir dossiers.cjs)
const dossiers = new Dossiers();

/** Les racines servies : le dossier de contenu (s'il y en a un) devant le build. */
const racines = () => [reglages.contenu, DIST].filter(Boolean);

/** Démarre le serveur sur le dossier de contenu courant. */
async function demarrer() {
  if (serveur) await serveur.fermer();
  serveur = await demarrerServeur({ racines: racines(), port: Number(process.env.GALERIE_PORT) || 0 });
  return serveur;
}

/** Le dossier de contenu, tel que la page le voit : { id, nom } ou null. */
function contenuPourLaPage() {
  if (!reglages.contenu) return null;
  return { id: dossiers.autoriser(reglages.contenu), nom: path.basename(reglages.contenu) };
}

/** Retient `chemin` comme dossier de contenu : réglage, racines servies, rechargement. */
function adopterContenu(chemin) {
  reglages.contenu = chemin;
  // Fichier › Galeries récentes : celle-ci en tête
  reglages.recents = noterRecent(reglages.recents, chemin);
  ecrireReglages(reglages);
  serveur?.remplacerRacines(racines());
  construireMenu();
  // la page recharge sa galerie depuis le nouveau dossier — après que
  // l'appelant a reçu sa réponse, si c'est elle qui a demandé
  setTimeout(() => ouvrirPage(), 50);
  return contenuPourLaPage();
}

/**
 * Une boîte native « choisir un dossier ». `but` : 'contenu' (le dossier de
 * la galerie, adopté et mémorisé) ou 'export' (un dossier quelconque,
 * autorisé pour la session seulement). Rend { id, nom } ou null.
 */
async function choisirDossier(but = 'contenu') {
  const contenu = but === 'contenu';
  const r = await dialog.showOpenDialog(fenetre ?? undefined, {
    title: contenu ? 'Le dossier de contenu de la galerie' : 'Où écrire la galerie ?',
    message: contenu
      ? 'Choisissez le dossier « content » de votre galerie : ses pièces, ses œuvres, ses médias. « Publier » y écrira.'
      : 'Choisissez le dossier où écrire l’arbre complet de la galerie (comme galerie.zip, décompressé).',
    buttonLabel: 'Choisir ce dossier',
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: reglages.contenu || undefined
  });
  if (r.canceled || !r.filePaths?.[0]) return null;
  const chemin = r.filePaths[0];
  if (contenu) return adopterContenu(chemin);
  return { id: dossiers.autoriser(chemin), nom: path.basename(chemin) };
}

/** Fichier › Choisir le dossier de contenu… */
async function choisirContenu() { return Boolean(await choisirDossier('contenu')); }

/**
 * Fichier › Galeries récentes › une galerie : adoptée si elle existe
 * encore, retirée de la liste sinon — et on le dit.
 */
function ouvrirRecente(chemin) {
  if (fs.existsSync(chemin)) { adopterContenu(chemin); return; }
  reglages.recents = (reglages.recents ?? []).filter((c) => c !== chemin);
  ecrireReglages(reglages);
  construireMenu();
  dialog.showMessageBox(fenetre ?? undefined, {
    type: 'info', message: 'Cette galerie n’est plus là',
    detail: `${chemin}\n\nLe dossier a été déplacé ou supprimé : il quitte la liste des galeries récentes.`
  });
}

/**
 * Un dossier de galerie DÉPOSÉ sur l'application (macOS : « Ouvrir avec »,
 * un dossier glissé sur l'icône) ou passé en argument : adopté, s'il porte
 * un index d'œuvres ou de pièces — rien d'autre n'est pris pour une galerie.
 */
function ouvrirDossierDepose(chemin) {
  const abs = path.resolve(String(chemin ?? ''));
  if (!estUneGalerie(abs, fs.existsSync)) return false;
  if (app.isReady() && serveur) adopterContenu(abs);
  else reglages.contenuDepose = abs;   // avant le départ : adopté au démarrage
  return true;
}

/* ------------------------------------------------------ mises à jour --- */

/**
 * La version de référence est celle du package.json du dépôt public : pas
 * de jeton, pas de Release à interroger. `silencieux` : au démarrage, on
 * ne dit rien si tout est à jour, ni si le réseau manque.
 */
async function verifierMisesAJour({ silencieux = false } = {}) {
  const courante = app.getVersion();
  let derniere = null;
  try {
    const r = await fetch(URL_VERSION, { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    derniere = String((await r.json()).version ?? '');
  } catch (e) {
    if (!silencieux) {
      dialog.showMessageBox(fenetre ?? undefined, { type: 'warning', message: 'Impossible de vérifier',
        detail: `La version de référence n’a pas pu être lue (${e?.message ?? e}). Réessayez plus tard, ou ouvrez la page des Releases.` });
    }
    return null;
  }
  const nouvelle = plusRecente(derniere, courante);
  if (!nouvelle) {
    if (!silencieux) {
      dialog.showMessageBox(fenetre ?? undefined, { type: 'info', message: 'Vous êtes à jour',
        detail: `Version ${courante} — c’est la plus récente.` });
    }
    return { courante, derniere, nouvelle: false };
  }
  // au démarrage, une version déjà écartée ne revient pas à chaque ouverture
  if (silencieux && reglages.versionEcartee === derniere) return { courante, derniere, nouvelle: true };
  const r = await dialog.showMessageBox(fenetre ?? undefined, {
    type: 'info', buttons: ['Voir la Release', 'Plus tard'], defaultId: 0, cancelId: 1,
    message: `Une version ${derniere} est disponible`,
    detail: `Vous avez la ${courante}. Les paquets se téléchargent depuis la page des Releases (dépôt privé de l’éditeur, votre compte GitHub).`
  });
  if (r.response === 0) shell.openExternal(PAGE_RELEASES);
  else if (silencieux) { reglages.versionEcartee = derniere; ecrireReglages(reglages); }
  return { courante, derniere, nouvelle: true };
}

/* ---------------------------------------------------------------- pont --- */

/**
 * Ce que la page peut demander (preload.cjs → ipcRenderer.invoke). Chaque
 * opération de fichier passe par `dossiers`, qui refuse tout chemin hors
 * d'une racine autorisée.
 */
function brancherLePont() {
  ipcMain.handle('dossier:contenu', () => contenuPourLaPage());
  ipcMain.handle('dossier:choisir', (e, but) => choisirDossier(but === 'export' ? 'export' : 'contenu'));
  ipcMain.handle('fs:lister', (e, id, rel) => dossiers.lister(id, rel));
  ipcMain.handle('fs:existe', (e, id, rel) => dossiers.existe(id, rel));
  ipcMain.handle('fs:lire', (e, id, rel) => dossiers.lire(id, rel));
  ipcMain.handle('fs:ecrire', (e, id, rel, donnees) => dossiers.ecrire(id, rel, donnees));
  ipcMain.handle('fs:creerDossier', (e, id, rel) => dossiers.creerDossier(id, rel));
  ipcMain.handle('fs:supprimer', (e, id, rel, recursive) => dossiers.supprimer(id, rel, { recursive: Boolean(recursive) }));
}

function ouvrirPage() {
  if (!fenetre || !serveur) return;
  fenetre.loadURL(`${serveur.url}?edit`);
}

/* ------------------------------------------------------------- fenêtre --- */

function creerFenetre() {
  fenetre = new BrowserWindow({
    width: 1440, height: 900, minWidth: 960, minHeight: 600,
    title: 'Galerie — auteur',
    backgroundColor: '#05050a',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // la page sait dans quelle version de l'application elle tourne
      additionalArguments: [`--galerie-version=${app.getVersion()}`]
    }
  });
  fenetre.once('ready-to-show', () => fenetre.show());
  fenetre.on('closed', () => { fenetre = null; });
  // le dehors s'ouvre dehors : Freesound, GitHub, la documentation
  fenetre.webContents.setWindowOpenHandler(({ url }) => {
    if (serveur && url.startsWith(serveur.url)) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });
  fenetre.webContents.on('will-navigate', (e, url) => {
    if (serveur && url.startsWith(serveur.url)) return;
    e.preventDefault();
    shell.openExternal(url);
  });
  // le titre reste celui de l'application, pas celui de la page
  fenetre.on('page-title-updated', (e) => e.preventDefault());
}

/* ---------------------------------------------------------------- menu --- */

function construireMenu() {
  const mac = process.platform === 'darwin';
  const modele = [
    ...(mac ? [{ role: 'appMenu' }] : []),
    {
      label: 'Fichier',
      submenu: [
        { label: 'Choisir le dossier de contenu…', accelerator: 'CmdOrCtrl+O', click: () => choisirContenu() },
        { label: 'Ouvrir le dossier de contenu', enabled: Boolean(reglages.contenu),
          click: () => { if (reglages.contenu) shell.openPath(reglages.contenu); } },
        { label: 'Galeries récentes', submenu: [
          ...(reglages.recents ?? []).map((chemin) => ({
            label: `${path.basename(chemin)}  —  ${path.dirname(chemin)}`,
            type: 'checkbox', checked: chemin === reglages.contenu,
            click: () => ouvrirRecente(chemin)
          })),
          ...((reglages.recents ?? []).length ? [{ type: 'separator' }] : []),
          { label: 'Effacer la liste', enabled: (reglages.recents ?? []).length > 0,
            click: () => { reglages.recents = []; ecrireReglages(reglages); construireMenu(); } }
        ] },
        { type: 'separator' },
        { label: 'Recharger la galerie', accelerator: 'CmdOrCtrl+R', click: () => ouvrirPage() },
        { type: 'separator' },
        mac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    { label: 'Édition', role: 'editMenu' },
    {
      label: 'Affichage',
      submenu: [
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { role: 'toggleDevTools' }
      ]
    },
    { label: 'Fenêtre', role: 'windowMenu' },
    {
      label: 'Aide',
      role: 'help',
      submenu: [
        { label: 'Vérifier les mises à jour…', click: () => verifierMisesAJour() },
        { label: 'Page des Releases', click: () => shell.openExternal(PAGE_RELEASES) },
        { label: `Version ${app.getVersion()}`, enabled: false }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(modele));
}

/* --------------------------------------------------------------- départ --- */

// le son de la galerie doit jouer sans clic préalable, comme en dev
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// un autre dossier de données (réglages, profil) : pour les sondes et les essais
if (process.env.GALERIE_DONNEES) app.setPath('userData', process.env.GALERIE_DONNEES);

// macOS : un dossier de galerie déposé sur l'icône, ou « Ouvrir avec »
app.on('open-file', (e, chemin) => { if (ouvrirDossierDepose(chemin)) e.preventDefault(); });

app.whenReady().then(async () => {
  reglages = lireReglages();
  if (reglages.contenu && !fs.existsSync(reglages.contenu)) delete reglages.contenu;
  // Windows, Linux, ligne de commande : un dossier de galerie en argument
  for (const arg of process.argv.slice(1)) {
    if (!arg.startsWith('-') && ouvrirDossierDepose(arg)) break;
  }
  if (reglages.contenuDepose) {
    reglages.contenu = reglages.contenuDepose;
    reglages.recents = noterRecent(reglages.recents, reglages.contenu);
    delete reglages.contenuDepose;
    ecrireReglages(reglages);
  }

  // « Publier » : la File System Access API demande la permission d'écrire
  // dans le dossier choisi, et de s'en souvenir ; l'auteur l'a déjà donnée
  // en choisissant le dossier dans la boîte native
  const s = session.defaultSession;
  s.setPermissionRequestHandler((wc, permission, cb) => {
    cb(['fileSystem', 'clipboard-read', 'clipboard-sanitized-write', 'media', 'fullscreen'].includes(permission));
  });
  s.setPermissionCheckHandler((wc, permission) =>
    ['fileSystem', 'clipboard-read', 'clipboard-sanitized-write', 'media'].includes(permission));

  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    dialog.showErrorBox('Build auteur absent',
      `Le dossier « dist-auteur » manque : construisez-le avec « npm run build:auteur ».\n(${DIST})`);
    app.quit();
    return;
  }
  if (reglages.contenu) dossiers.autoriser(reglages.contenu);
  brancherLePont();
  await demarrer();
  construireMenu();
  creerFenetre();
  ouvrirPage();
  // premier lancement : sans dossier de contenu, la galerie du build sert de
  // départ, et l'on propose d'en choisir un — sans bloquer l'ouverture
  if (!reglages.contenu && !process.env.GALERIE_SANS_DIALOGUE) {
    setTimeout(async () => {
      const r = await dialog.showMessageBox(fenetre, {
        type: 'question', buttons: ['Choisir le dossier…', 'Plus tard'], defaultId: 0, cancelId: 1,
        message: 'Où est votre galerie ?',
        detail: 'Choisissez le dossier « content » de votre galerie pour composer dessus et y publier. Sans lui, vous éditez une copie de la galerie du build, sans pouvoir la publier dans un dossier.'
      });
      if (r.response === 0) await choisirContenu();
    }, 800);
  }
  // une version plus récente ? Demandé sans bruit, une fois la galerie ouverte
  if (!process.env.GALERIE_SANS_DIALOGUE) setTimeout(() => verifierMisesAJour({ silencieux: true }), 6000);
  app.on('activate', () => { if (!fenetre) { creerFenetre(); ouvrirPage(); } });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { serveur?.fermer(); });

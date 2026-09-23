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

const DIST = path.join(__dirname, '..', 'dist-auteur');
const PAGE_RELEASES = 'https://github.com/yannicksandoz/yr0-editor/releases';

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
        { label: 'Vérifier les mises à jour…', click: () => shell.openExternal(PAGE_RELEASES) },
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

app.whenReady().then(async () => {
  reglages = lireReglages();
  if (reglages.contenu && !fs.existsSync(reglages.contenu)) delete reglages.contenu;

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
  app.on('activate', () => { if (!fenetre) { creerFenetre(); ouvrirPage(); } });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { serveur?.fermer(); });

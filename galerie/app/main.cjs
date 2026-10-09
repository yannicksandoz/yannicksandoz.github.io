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
const { app, BrowserWindow, Menu, dialog, shell, session, ipcMain, screen, clipboard } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { demarrerServeur } = require('./serveur.cjs');
const { Dossiers } = require('./dossiers.cjs');
const { noterRecent, estUneGalerie, lienExterneSur, portPrefere } = require('./reglages-regles.cjs');
const { COMMANDE_BUILD, normaliserInfoBuild, urlsCommits, commitsConcernes, texteMiseAJour, texteAPropos } = require('./mises-a-jour-regles.cjs');
const { creerGalerie, dossierVide } = require('./galerie-neuve.cjs');
const { GitLocal } = require('./git-local.cjs');
const { fragmenterLot } = require('./fragments-auto.cjs');

// Empaqueté, le build auteur est sorti de l'archive asar (package.json,
// build.asarUnpack) : le serveur le lit par flux et « Nouvelle galerie… »
// en copie les partagés, deux choses que l'archive ne sait pas faire
const DIST = path.join(__dirname, '..', 'dist-auteur').replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
// L'application se construit en local (npm run app:mac) et embarque le
// commit, la branche et la date de son build (app/build-info.json, écrit par
// scripts/app-local.mjs). Lancée par `npm run app` sans build : null.
const INFO_BUILD = (() => {
  try { return normaliserInfoBuild(JSON.parse(fs.readFileSync(path.join(__dirname, 'build-info.json'), 'utf8'))); } catch { return null; }
})();
// l'API publique de GitHub, sans jeton : les commits du dépôt du site
const API_GITHUB = process.env.GALERIE_API_GITHUB || 'https://api.github.com';

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
// un dossier de galerie déposé sur l'application AVANT qu'elle soit prête
// (macOS : `open-file` précède `ready`) — adopté au démarrage
let depose = null;
// les dossiers que la page a le droit de toucher (voir dossiers.cjs)
const dossiers = new Dossiers();
// le git de la machine, pour le dépôt qui contient le dossier de contenu
const git = new GitLocal();

/** Les racines servies : le dossier de contenu (s'il y en a un) devant le build. */
const racines = () => [reglages.contenu, DIST].filter(Boolean);

/**
 * Démarre le serveur sur le dossier de contenu courant — sur le MÊME port
 * qu'au lancement précédent quand il est libre : l'origine de la page ne
 * change pas, et le profil de la fenêtre (jeton GitHub, clés, brouillon,
 * préférences de l'éditeur) survit d'une ouverture à l'autre.
 */
async function demarrer() {
  if (serveur) await serveur.fermer();
  const force = Number(process.env.GALERIE_PORT) || 0;
  serveur = await demarrerServeur({ racines: racines(), port: force, portPrefere: force ? null : portPrefere(reglages) });
  if (!force && reglages.port !== serveur.port) { reglages.port = serveur.port; ecrireReglages(reglages); }
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
 * Fichier › Nouvelle galerie… : un dossier VIDE (ou à créer), une première
 * salle à la charte, les partagés du build copiés (galerie-neuve.cjs) ;
 * puis la galerie neuve est adoptée. Le nom du dossier fait le titre.
 */
async function nouvelleGalerie() {
  const r = await dialog.showSaveDialog(fenetre ?? undefined, {
    title: 'Nouvelle galerie',
    message: 'Nommez le dossier de la nouvelle galerie : il sera créé, vide, avec une première salle. (Il deviendra votre dossier « content ».)',
    buttonLabel: 'Créer la galerie',
    defaultPath: path.join(app.getPath('documents'), 'ma-galerie'),
    properties: ['createDirectory', 'showOverwriteConfirmation'],
    nameFieldLabel: 'Dossier'
  });
  if (r.canceled || !r.filePath) return null;
  const dossier = r.filePath;
  if (!(await dossierVide(dossier))) {
    dialog.showMessageBox(fenetre ?? undefined, { type: 'warning', message: 'Ce dossier n’est pas vide',
      detail: `${dossier}\n\nUne galerie neuve se crée dans un dossier vide : choisissez-en un autre, ou ouvrez celui-ci par « Choisir le dossier de contenu… » s’il contient déjà une galerie.` });
    return null;
  }
  const titre = path.basename(dossier).replace(/[-_]+/g, ' ').trim();
  try {
    const bilan = await creerGalerie(dossier, { titre: titre ? titre[0].toUpperCase() + titre.slice(1) : 'Entrée', partagesDepuis: DIST });
    adopterContenu(dossier);
    if (bilan.manquants?.length) {
      dialog.showMessageBox(fenetre ?? undefined, { type: 'warning', message: 'Galerie créée, mais des partagés manquent',
        detail: `Le build de l’application n’avait pas : ${bilan.manquants.join(', ')}.\nLa galerie s’ouvre, mais ces dossiers sont à copier depuis un autre build (npm run build:auteur).` });
    }
    return bilan;
  } catch (e) {
    dialog.showErrorBox('La galerie n’a pas pu être créée', String(e?.message ?? e));
    return null;
  }
}

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
  else depose = abs;   // avant le départ : adopté au démarrage (hors des réglages, qui seront relus)
  return true;
}

/* ------------------------------------------------------ mises à jour --- */

/**
 * Plus de Release construite par CI : l'application compare le commit
 * qu'elle embarque aux commits de master du dépôt public (API publique,
 * sans jeton) qui touchent ce dont elle est faite — engine/, app/, le
 * pointeur du sous-module, les dépendances, les partagés du build
 * (app/mises-a-jour-regles.cjs). Le contenu, lui, est servi en direct.
 */
async function commitsDepuisLeBuild() {
  if (!INFO_BUILD) return null;
  const listes = await Promise.all(urlsCommits({ base: API_GITHUB, depuis: INFO_BUILD.date }).map(async (url) => {
    const r = await fetch(url, { headers: { Accept: 'application/vnd.github+json', 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }));
  return commitsConcernes(listes, INFO_BUILD);
}

/**
 * L'application face au dépôt, sans boîte : ce que la page montre dans
 * « Comparer » (Publier › Mettre en ligne). `commits` null : pas pu lire,
 * ou build de développement.
 */
async function etatVersion() {
  const courante = app.getVersion();
  let commits = null;
  try { commits = await commitsDepuisLeBuild(); } catch { commits = null; }
  return { courante, build: INFO_BUILD, commits: commits ? commits.length : null, nouvelle: Boolean(commits?.length), commande: COMMANDE_BUILD };
}

/** `silencieux` : au démarrage, on ne dit rien si tout est à jour, ni hors ligne. */
async function verifierMisesAJour({ silencieux = false } = {}) {
  const version = app.getVersion();
  if (!INFO_BUILD) {
    if (!silencieux) {
      dialog.showMessageBox(fenetre ?? undefined, { type: 'info', message: 'Build de développement',
        detail: `Lancée par npm run app : aucun commit embarqué à comparer. ${COMMANDE_BUILD} fabrique l’application avec le sien.` });
    }
    return null;
  }
  let commits;
  try {
    commits = await commitsDepuisLeBuild();
  } catch (e) {
    if (!silencieux) {
      dialog.showMessageBox(fenetre ?? undefined, { type: 'warning', message: 'Impossible de vérifier',
        detail: `Les derniers commits du dépôt public n’ont pas pu être lus (${e?.message ?? e}). Hors ligne ? Réessayez plus tard.` });
    }
    return null;
  }
  const detail = texteMiseAJour({ version, build: INFO_BUILD, commits });
  if (!commits.length) {
    if (!silencieux) dialog.showMessageBox(fenetre ?? undefined, { type: 'info', message: 'Vous êtes à jour', detail });
    return { courante: version, commits: 0, nouvelle: false };
  }
  // au démarrage, un retard déjà écarté ne revient pas à chaque ouverture
  const dernier = commits[0].sha;
  if (silencieux && reglages.commitEcarte === dernier) return { courante: version, commits: commits.length, nouvelle: true };
  const r = await dialog.showMessageBox(fenetre ?? undefined, {
    type: 'info', buttons: ['Copier la commande', 'Plus tard'], defaultId: 0, cancelId: 1,
    message: `Le code a avancé depuis ton build (${commits.length} commit${commits.length > 1 ? 's' : ''} concerné${commits.length > 1 ? 's' : ''})`,
    detail
  });
  if (r.response === 0) clipboard.writeText(COMMANDE_BUILD);
  else if (silencieux) { reglages.commitEcarte = dernier; ecrireReglages(reglages); }
  return { courante: version, commits: commits.length, nouvelle: true };
}

/** Aide › À propos : la version, le commit, la branche et la date du build. */
function aPropos() {
  dialog.showMessageBox(fenetre ?? undefined, { type: 'info', message: `Galerie auteur ${app.getVersion()}`,
    detail: texteAPropos({ version: app.getVersion(), build: INFO_BUILD, versions: process.versions }) });
}

/* ---------------------------------------------------------------- pont --- */

/**
 * Ce que la page peut demander (preload.cjs → ipcRenderer.invoke). Chaque
 * opération de fichier passe par `dossiers`, qui refuse tout chemin hors
 * d'une racine autorisée.
 */
function brancherLePont() {
  ipcMain.handle('dossier:contenu', () => contenuPourLaPage());
  ipcMain.handle('app:version', () => etatVersion());
  // LES SONS LONGS, fragmentés par l'application à la publication (voir
  // fragments-auto.cjs) : la page envoie ses pistes, reçoit les manifestes
  ipcMain.handle('sons:fragmenter', async (e, pistes) => {
    if (!reglages.contenu) return { faits: [], ignorees: 0, erreurs: [], ffmpeg: false };
    return fragmenterLot({ contenu: reglages.contenu, pistes: Array.isArray(pistes) ? pistes : [],
      surProgres: (p) => { try { e.sender.send('sons:progres', p); } catch { /* fenêtre fermée */ } } });
  });
  ipcMain.handle('dossier:choisir', (e, but) => choisirDossier(but === 'export' ? 'export' : 'contenu'));
  ipcMain.handle('fs:lister', (e, id, rel) => dossiers.lister(id, rel));
  ipcMain.handle('fs:existe', (e, id, rel) => dossiers.existe(id, rel));
  ipcMain.handle('fs:lire', (e, id, rel) => dossiers.lire(id, rel));
  ipcMain.handle('fs:ecrire', (e, id, rel, donnees) => dossiers.ecrire(id, rel, donnees));
  ipcMain.handle('fs:creerDossier', (e, id, rel) => dossiers.creerDossier(id, rel));
  ipcMain.handle('fs:supprimer', (e, id, rel, recursive) => dossiers.supprimer(id, rel, { recursive: Boolean(recursive) }));
  // git sans terminal : toujours sur le dossier de contenu, jamais ailleurs
  ipcMain.handle('git:etat', async () => {
    if (!reglages.contenu) return { git: await git.version(), depot: null };
    const version = await git.version();
    if (!version) return { git: null, depot: null };
    return { git: version, depot: await git.changements(reglages.contenu) };
  });
  ipcMain.handle('git:committer', (e, message) => {
    if (!reglages.contenu) throw new Error('Aucun dossier de contenu.');
    return git.committer(reglages.contenu, String(message ?? ''));
  });
  // le jeton du compte courant voyage avec l'appel, et n'est gardé nulle part ici
  ipcMain.handle('git:pousser', (e, options) => {
    if (!reglages.contenu) throw new Error('Aucun dossier de contenu.');
    const jeton = typeof options?.jeton === 'string' ? options.jeton : null;
    return git.pousser(reglages.contenu, { jeton });
  });
}

/* ------------------------------------------------------------- fenêtre --- */

/** La fenêtre reprend sa taille et sa place, si elles tiennent encore dans un écran. */
function cadreMemorise() {
  const f = reglages.fenetre;
  if (!f || !Number.isFinite(f.width) || !Number.isFinite(f.height)) return null;
  const ecran = screen.getDisplayMatching({ x: f.x ?? 0, y: f.y ?? 0, width: f.width, height: f.height });
  const z = ecran?.workArea;
  if (!z) return null;
  const width = Math.min(Math.max(960, f.width), z.width);
  const height = Math.min(Math.max(600, f.height), z.height);
  const x = Number.isFinite(f.x) ? Math.min(Math.max(z.x, f.x), z.x + z.width - width) : undefined;
  const y = Number.isFinite(f.y) ? Math.min(Math.max(z.y, f.y), z.y + z.height - height) : undefined;
  return { width, height, x, y };
}

let _cadreDelai = null;
function memoriserCadre() {
  if (!fenetre || fenetre.isDestroyed() || fenetre.isMinimized() || fenetre.isFullScreen()) return;
  clearTimeout(_cadreDelai);
  _cadreDelai = setTimeout(() => {
    if (!fenetre || fenetre.isDestroyed()) return;
    reglages.fenetre = { ...fenetre.getBounds(), maximisee: fenetre.isMaximized() };
    ecrireReglages(reglages);
  }, 400);
}

/** L'adresse de la page : le mode auteur, et l'image enrichie selon le réglage. */
function adressePage() {
  const params = new URLSearchParams();
  params.set('edit', '');
  // L'IMAGE ENRICHIE (ombres, occlusion, sources étendues) : l'application
  // tourne sur un ordinateur, elle part enrichie ; Affichage › Image
  // enrichie l'ôte, et le choix est mémorisé ici
  params.set('riche', reglages.imageRiche === false ? '0' : '1');
  return `${serveur.url}?${params.toString().replace('edit=', 'edit')}`;
}

function ouvrirPage() {
  if (!fenetre || !serveur) return;
  fenetre.loadURL(adressePage()).catch(() => { /* un chargement remplacé par le suivant (ERR_ABORTED) */ });
}

/* ------------------------------------------------------------- fenêtre --- */

function creerFenetre() {
  const cadre = cadreMemorise();
  fenetre = new BrowserWindow({
    width: 1440, height: 900, ...(cadre ?? {}), minWidth: 960, minHeight: 600,
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
  fenetre.once('ready-to-show', () => {
    if (reglages.fenetre?.maximisee) fenetre.maximize();
    fenetre.show();
  });
  fenetre.on('closed', () => { fenetre = null; });
  // la taille et la place se mémorisent : la fenêtre revient où on l'a laissée
  fenetre.on('resize', memoriserCadre);
  fenetre.on('move', memoriserCadre);
  fenetre.on('maximize', memoriserCadre);
  fenetre.on('unmaximize', memoriserCadre);
  // le dehors s'ouvre dehors : Freesound, GitHub, la documentation — le web
  // et le courriel seulement (les adresses viennent aussi du contenu)
  fenetre.webContents.setWindowOpenHandler(({ url }) => {
    if (serveur && url.startsWith(serveur.url)) return { action: 'allow' };
    if (lienExterneSur(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  fenetre.webContents.on('will-navigate', (e, url) => {
    if (serveur && url.startsWith(serveur.url)) return;
    e.preventDefault();
    if (lienExterneSur(url)) shell.openExternal(url);
  });
  // Du travail non publié (le brouillon de l'éditeur pose un `beforeunload`) :
  // sans cet écouteur, Electron n'affiche rien et ABANDONNE en silence la
  // fermeture, le rechargement ou le changement de dossier — la fenêtre
  // semble morte. Ici, on demande.
  fenetre.webContents.on('will-prevent-unload', (e) => {
    const r = dialog.showMessageBoxSync(fenetre, {
      type: 'question', buttons: ['Rester', 'Continuer sans publier'], defaultId: 0, cancelId: 0,
      message: 'Des modifications ne sont pas publiées',
      detail: 'Le brouillon est gardé dans l’application et vous sera proposé à la prochaine ouverture de cette galerie. Continuer quand même ?'
    });
    if (r === 1) e.preventDefault();   // « empêcher d'empêcher » : la page se décharge
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
        { label: 'Nouvelle galerie…', accelerator: 'CmdOrCtrl+N', click: () => nouvelleGalerie() },
        { label: 'Choisir le dossier de contenu…', accelerator: 'CmdOrCtrl+O', click: () => choisirContenu() },
        { label: 'Ouvrir le dossier de contenu', enabled: Boolean(reglages.contenu),
          click: () => { if (reglages.contenu) shell.openPath(reglages.contenu); } },
        { label: 'Galeries récentes', submenu: [
          ...(reglages.recents ?? []).filter((c) => typeof c === 'string' && c).map((chemin) => ({
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
        { label: 'Image enrichie', type: 'checkbox', checked: reglages.imageRiche !== false,
          click: (item) => { reglages.imageRiche = item.checked; ecrireReglages(reglages); ouvrirPage(); } },
        { type: 'separator' },
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
        { label: 'À propos…', click: () => aPropos() },
        { label: `Version ${app.getVersion()}${INFO_BUILD ? ` · build ${INFO_BUILD.commit}` : ' · développement'}`, enabled: false }
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

// Une seule instance (Windows, Linux ; macOS le fait de lui-même) : un second
// lancement, ou « Ouvrir avec » sur un dossier pendant que l'application
// tourne, rejoint la fenêtre existante au lieu d'ouvrir un second serveur
// et d'écrire les mêmes réglages à deux
const verrou = app.requestSingleInstanceLock();
if (!verrou) {
  app.quit();
} else {
  app.on('second-instance', (e, argv) => {
    for (const arg of argv.slice(1)) {
      if (!arg.startsWith('-') && ouvrirDossierDepose(arg)) break;
    }
    if (fenetre) { if (fenetre.isMinimized()) fenetre.restore(); fenetre.focus(); }
  });
}

app.whenReady().then(async () => {
  // sans le verrou, `quit()` est en route : ne rien démarrer (ni serveur qui
  // écrirait un autre port dans les réglages partagés, ni fenêtre fugace)
  if (!verrou) return;
  reglages = lireReglages();
  if (reglages.contenu && !fs.existsSync(reglages.contenu)) delete reglages.contenu;
  delete reglages.contenuDepose;   // ancien mécanisme, sans effet
  // Windows, Linux, ligne de commande : un dossier de galerie en argument
  for (const arg of process.argv.slice(1)) {
    if (!arg.startsWith('-') && ouvrirDossierDepose(arg)) break;
  }
  if (depose) {
    reglages.contenu = depose;
    reglages.recents = noterRecent(reglages.recents, reglages.contenu);
    depose = null;
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
  try {
    await demarrer();
  } catch (e) {
    // sans serveur, pas de page : le dire plutôt qu'une application sans fenêtre
    dialog.showErrorBox('Le serveur interne n’a pas pu démarrer', String(e?.message ?? e));
    app.quit();
    return;
  }
  construireMenu();
  creerFenetre();
  ouvrirPage();
  // (ce bloc est attrapé plus bas : un réglage corrompu ne laisse pas
  // l'application sans fenêtre ni message)
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
}).catch((e) => {
  // un réglage corrompu, un dossier illisible : le dire, et sortir proprement
  dialog.showErrorBox('Galerie auteur', `L’application n’a pas pu démarrer : ${e?.message ?? e}`);
  app.quit();
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { serveur?.fermer(); });

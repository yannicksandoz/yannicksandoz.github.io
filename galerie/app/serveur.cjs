/**
 * LE SERVEUR INTERNE DE L'APPLICATION AUTEUR.
 *
 * Le build auteur n'est pas un site à ouvrir depuis un fichier : ses
 * modules ES et ses worklets audio se chargent par URL, et Chromium les
 * refuse hors HTTP. L'application sert donc, sur 127.0.0.1 et un port
 * libre, TROIS choses à la même racine :
 *
 *   1. le DOSSIER DE CONTENU de l'auteur (`content/`), en premier — c'est
 *      la galerie vivante, celle où « Publier » écrit ; ce qu'il contient
 *      passe devant la copie figée au build ;
 *   2. `dist-auteur`, le build auteur (moteur, éditeur, contenu du jour) ;
 *   3. les PROXYS same-origin de Freesound et Poly Pizza (`/fs-api`,
 *      `/pp-api`, `/pp-static`), les mêmes que ceux du serveur Vite : leurs
 *      en-têtes d'autorisation imposent un préflight CORS que ces API
 *      refusent, et le proxy le leur épargne. Aucune clé ici : celle de
 *      l'auteur voyage dans l'en-tête de SA requête, comme en développement.
 *
 * Les médias se servent avec les plages (`Range`) : une vidéo se cherche,
 * un son se reprend au milieu. Module Node pur, sans Electron : il se
 * teste au nœud (scripts/test-app-serveur.mjs).
 */
'use strict';
const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');

/** Les types de contenu de ce que la galerie sert. */
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.ktx2': 'image/ktx2',
  '.hdr': 'application/octet-stream',
  '.exr': 'application/octet-stream',
  '.splat': 'application/octet-stream',
  '.ksplat': 'application/octet-stream',
  '.ply': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.fs': 'text/plain; charset=utf-8',
  '.frag': 'text/plain; charset=utf-8',
  '.glsl': 'text/plain; charset=utf-8'
};

/** Les proxys : le préfixe local et l'origine visée (voir vite.config.js). */
const PROXYS = {
  '/fs-api': 'https://freesound.org',
  '/pp-api': 'https://api.poly.pizza',
  '/pp-static': 'https://static.poly.pizza'
};

function typeDe(fichier) {
  return TYPES[path.extname(fichier).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Le chemin de fichier demandé, sûr : décodé, sans requête, jamais
 * au-dessus de la racine ; un dossier vaut son `index.html`. Rend null
 * pour un chemin qui tente de sortir.
 */
function cheminSur(url) {
  let p;
  try { p = decodeURIComponent(new URL(url, 'http://x').pathname); } catch { return null; }
  // un segment « .. », même annulé par la normalisation, est un chemin
  // qui a voulu sortir : on ne le sert pas
  if (p.includes('\0') || p.split('/').includes('..')) return null;
  const propre = path.posix.normalize(p);
  return propre.endsWith('/') ? `${propre}index.html` : propre;
}

/**
 * Où va une requête de proxy : { origine, chemin } pour un préfixe connu,
 * null sinon. Pur, testé.
 */
function cibleProxy(url) {
  for (const [prefixe, origine] of Object.entries(PROXYS)) {
    if (url === prefixe || url.startsWith(`${prefixe}/`) || url.startsWith(`${prefixe}?`)) {
      return { origine, chemin: url.slice(prefixe.length) || '/' };
    }
  }
  return null;
}

/** Une plage `bytes=a-b` sur `taille` octets, ou null si absente ou invalide. */
function plageDe(entete, taille) {
  if (!entete) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(entete).trim());
  if (!m) return null;
  let debut = m[1] === '' ? null : Number(m[1]);
  let fin = m[2] === '' ? null : Number(m[2]);
  if (debut === null && fin === null) return null;
  if (debut === null) { debut = Math.max(0, taille - fin); fin = taille - 1; }
  else if (fin === null || fin >= taille) fin = taille - 1;
  if (debut > fin || debut >= taille) return { invalide: true };
  return { debut, fin };
}

/** Sert `fichier` (stat connu) avec plages, types et cache court. */
function servirFichier(req, res, fichier, stat) {
  const type = typeDe(fichier);
  const entetes = {
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
    // l'auteur édite son contenu : rien ne doit se mettre en cache longtemps
    'Cache-Control': 'no-cache'
  };
  const plage = plageDe(req.headers.range, stat.size);
  if (plage?.invalide) {
    res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
    res.end();
    return;
  }
  if (plage) {
    entetes['Content-Range'] = `bytes ${plage.debut}-${plage.fin}/${stat.size}`;
    entetes['Content-Length'] = plage.fin - plage.debut + 1;
    res.writeHead(206, entetes);
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(fichier, { start: plage.debut, end: plage.fin }).pipe(res);
    return;
  }
  entetes['Content-Length'] = stat.size;
  res.writeHead(200, entetes);
  if (req.method === 'HEAD') { res.end(); return; }
  fs.createReadStream(fichier).pipe(res);
}

/** Relaie une requête vers l'API visée, en-têtes et corps compris. */
function relayer(req, res, cible) {
  const url = new URL(cible.chemin, cible.origine);
  const entetes = { ...req.headers, host: url.host };
  delete entetes.origin;
  delete entetes.referer;
  const aller = https.request(url, { method: req.method, headers: entetes }, (reponse) => {
    const retour = { ...reponse.headers };
    // la réponse revient same-origin : ces en-têtes n'ont plus de sens ici
    delete retour['access-control-allow-origin'];
    delete retour['content-security-policy'];
    res.writeHead(reponse.statusCode ?? 502, retour);
    reponse.pipe(res);
  });
  aller.on('error', (e) => {
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`proxy : ${e.message}`);
  });
  req.pipe(aller);
}

/**
 * Les fichiers COMBINÉS que le build fabrique (vite.config.js,
 * combinerContenu) : le chargeur les préfère aux fichiers séparés. Servis
 * depuis le build, ils cacheraient tout le dossier de l'auteur, qui n'en a
 * pas. Ils ne se servent donc que depuis la PREMIÈRE racine — le dossier
 * de contenu quand il y en a un.
 */
const PREMIERE_RACINE_SEULE = ['/rooms/rooms.json', '/works/works.json'];

/**
 * Démarre le serveur. `racines` : les dossiers servis, dans l'ordre de
 * priorité (le premier qui a le fichier gagne) ; `port` 0 = un port libre ;
 * `premiereSeule` : les chemins que seule la première racine peut servir.
 * Rend { port, url, fermer, racines }.
 */
function demarrerServeur({ racines, port = 0, hote = '127.0.0.1', proxys = true,
  premiereSeule = PREMIERE_RACINE_SEULE } = {}) {
  const filtrer = (liste) => (liste ?? []).filter((r) => r && fs.existsSync(r));
  let dossiers = filtrer(racines);
  const reserves = new Set(premiereSeule ?? []);
  const serveur = http.createServer((req, res) => {
    const url = req.url ?? '/';
    if (proxys) {
      const cible = cibleProxy(url);
      if (cible) { relayer(req, res, cible); return; }
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405); res.end(); return;
    }
    const chemin = cheminSur(url);
    if (!chemin) { res.writeHead(400); res.end(); return; }
    const candidats = reserves.has(chemin) ? dossiers.slice(0, 1) : dossiers;
    for (const racine of candidats) {
      const fichier = path.join(racine, chemin);
      let stat = null;
      try { stat = fs.statSync(fichier); } catch { continue; }
      if (stat.isDirectory()) {
        // un dossier sans barre finale : on redirige vers sa page
        res.writeHead(301, { Location: `${new URL(url, 'http://x').pathname}/` });
        res.end();
        return;
      }
      if (stat.isFile()) { servirFichier(req, res, fichier, stat); return; }
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('introuvable');
  });
  return new Promise((resoudre, rejeter) => {
    serveur.once('error', rejeter);
    serveur.listen(port, hote, () => {
      const p = serveur.address().port;
      resoudre({
        port: p,
        url: `http://${hote}:${p}/`,
        get racines() { return dossiers; },
        // un autre dossier de contenu, sans changer de port : l'origine de la
        // page reste la même, son profil (jeton, brouillon) avec elle
        remplacerRacines(liste) { dossiers = filtrer(liste); return dossiers; },
        fermer: () => new Promise((r) => serveur.close(() => r()))
      });
    });
  });
}

module.exports = { demarrerServeur, cibleProxy, cheminSur, plageDe, typeDe, PROXYS, TYPES, PREMIERE_RACINE_SEULE };

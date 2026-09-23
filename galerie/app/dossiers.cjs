/**
 * LES DOSSIERS QUE LA PAGE A LE DROIT DE TOUCHER.
 *
 * Dans un navigateur, « Publier » passe par la File System Access API :
 * l'auteur désigne `content/` dans une boîte, le navigateur garde une
 * poignée et redemande la permission à chaque redémarrage. Dans
 * l'application, le dossier de contenu est déjà connu — c'est celui que le
 * serveur interne sert — et la boîte native l'a déjà fait choisir. Ce
 * module est la seule porte par laquelle la page écrit sur le disque :
 *
 *   • une liste blanche de RACINES autorisées (le dossier de contenu, et
 *     tout dossier choisi par une boîte native pendant la session) ;
 *   • des opérations de fichier RELATIVES à une racine, dont le chemin
 *     résolu doit rester sous elle — jamais de « .. », jamais d'absolu.
 *
 * Module Node pur, sans Electron : il se teste au nœud
 * (scripts/test-app-dossiers.mjs). La page le voit à travers le pont
 * (preload.cjs → ipc → main.cjs), sous la forme d'une poignée compatible
 * avec ce que Publication.js attend (editor/state/DossierApp.js).
 */
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');

class Dossiers {
  constructor() {
    this._racines = new Set();
  }

  /** Autorise `chemin` (absolu) ; rend son identifiant : le chemin lui-même, normalisé. */
  autoriser(chemin) {
    const abs = path.resolve(String(chemin));
    this._racines.add(abs);
    return abs;
  }

  autorise(id) { return this._racines.has(id); }

  /** Le chemin absolu de `relatif` sous la racine `id`, ou une erreur. */
  resoudre(id, relatif = '') {
    if (!this.autorise(id)) throw new Error('dossier non autorisé');
    const rel = String(relatif ?? '');
    if (rel.includes('\0') || path.isAbsolute(rel) || /^[A-Za-z]:/.test(rel)) throw new Error('chemin refusé');
    if (rel.split(/[\\/]/).includes('..')) throw new Error('chemin refusé');
    const abs = path.resolve(id, rel);
    if (abs !== id && !abs.startsWith(id + path.sep)) throw new Error('chemin refusé');
    return abs;
  }

  /** Ce qu'un dossier contient : [{ nom, kind }] ; un dossier absent est vide. */
  async lister(id, relatif = '') {
    const abs = this.resoudre(id, relatif);
    let entrees;
    try { entrees = await fs.readdir(abs, { withFileTypes: true }); } catch (e) {
      if (e.code === 'ENOENT') return [];
      throw e;
    }
    return entrees
      .filter((e) => e.isFile() || e.isDirectory())
      .map((e) => ({ nom: e.name, kind: e.isDirectory() ? 'directory' : 'file' }));
  }

  /** 'file', 'directory' ou null. */
  async existe(id, relatif) {
    try {
      const s = await fs.stat(this.resoudre(id, relatif));
      return s.isDirectory() ? 'directory' : s.isFile() ? 'file' : null;
    } catch { return null; }
  }

  /** Le contenu d'un fichier et sa date de modification (ms). */
  async lire(id, relatif) {
    const abs = this.resoudre(id, relatif);
    const [donnees, s] = await Promise.all([fs.readFile(abs), fs.stat(abs)]);
    return { donnees, modifie: Math.round(s.mtimeMs) };
  }

  /** Écrit (crée les dossiers intermédiaires) ; `donnees` : chaîne ou octets. */
  async ecrire(id, relatif, donnees) {
    const abs = this.resoudre(id, relatif);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    const octets = typeof donnees === 'string' ? Buffer.from(donnees, 'utf8')
      : donnees instanceof ArrayBuffer ? Buffer.from(donnees) : Buffer.from(donnees ?? []);
    await fs.writeFile(abs, octets);
    return octets.length;
  }

  async creerDossier(id, relatif) {
    await fs.mkdir(this.resoudre(id, relatif), { recursive: true });
  }

  /** Retire un fichier ou un dossier (vide, ou entier avec `recursive`). */
  async supprimer(id, relatif, { recursive = false } = {}) {
    const abs = this.resoudre(id, relatif);
    if (abs === id) throw new Error('chemin refusé');   // jamais la racine elle-même
    await fs.rm(abs, { recursive, force: false });
  }
}

module.exports = { Dossiers };

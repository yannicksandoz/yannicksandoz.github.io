/**
 * GIT SANS TERMINAL — le dépôt local, depuis l'application.
 *
 * La mise en ligne passe par l'API GitHub ; mais quand le dépôt est sur la
 * machine, publier dans `content/` laisse un « reste à committer » qui
 * renvoie au terminal. Ici l'application, qui a Node, pilote le `git` de
 * la machine — celui de l'auteur, avec sa configuration, ses clés, son
 * trousseau : rien n'est stocké ici, aucun jeton ne transite.
 *
 * Trois gestes, et la règle de la maison pour chacun : rien n'est engagé
 * sans avoir été NOMMÉ d'abord.
 *   • ÉTAT — le dépôt qui contient le dossier de contenu, sa branche, et
 *     ce qui a changé DANS CE DOSSIER (ajoutés, modifiés, supprimés) ;
 *   • COMMITTER — `git add` limité au dossier de contenu (les autres
 *     changements du dépôt restent à leur auteur), puis un commit au
 *     message donné ;
 *   • POUSSER — `git push` sur la branche courante, tel quel.
 *
 * L'analyse du `status --porcelain` est pure et testée au nœud ; le reste
 * s'éprouve sur un vrai dépôt temporaire (scripts/test-app-git.mjs).
 */
'use strict';
const { execFile } = require('node:child_process');
const path = require('node:path');

/** `git status --porcelain=v1 -z`, en comptes et en listes courtes. */
function analyserPorcelain(texte) {
  const bilan = { ajoutes: [], modifies: [], supprimes: [], renommes: [], conflits: [] };
  const lignes = String(texte ?? '').split('\0').filter(Boolean);
  for (let i = 0; i < lignes.length; i++) {
    const l = lignes[i];
    if (l.length < 4) continue;
    const x = l[0], y = l[1];
    const chemin = l.slice(3);
    if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) { bilan.conflits.push(chemin); continue; }
    if (x === 'R' || x === 'C') { bilan.renommes.push(chemin); i++; continue; }   // l'ancien nom suit
    if (x === '?' || x === 'A') bilan.ajoutes.push(chemin);
    else if (x === 'D' || y === 'D') bilan.supprimes.push(chemin);
    else bilan.modifies.push(chemin);
  }
  bilan.total = bilan.ajoutes.length + bilan.modifies.length + bilan.supprimes.length + bilan.renommes.length + bilan.conflits.length;
  return bilan;
}

class GitLocal {
  constructor({ executer = null, git = 'git' } = {}) {
    this._git = git;
    this._executer = executer ?? ((args, cwd) => new Promise((resoudre, rejeter) => {
      execFile(this._git, args, { cwd, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
        if (err) { err.stderr = String(stderr ?? ''); rejeter(err); } else resoudre(String(stdout ?? ''));
      });
    }));
  }

  /** git est-il là ? Sa version, ou null. */
  async version() {
    try { return (await this._executer(['--version'], undefined)).trim(); } catch { return null; }
  }

  /**
   * Le dépôt qui contient `dossier` : { racine, branche, relatif } ou null
   * (pas de dépôt, ou git absent). `relatif` : le dossier vu depuis la
   * racine, celui que `committer` limite.
   */
  async depot(dossier) {
    try {
      const racine = (await this._executer(['rev-parse', '--show-toplevel'], dossier)).trim();
      if (!racine) return null;
      let branche = '';
      try { branche = (await this._executer(['rev-parse', '--abbrev-ref', 'HEAD'], dossier)).trim(); } catch { branche = ''; }
      const relatif = path.relative(racine, path.resolve(dossier)).split(path.sep).join('/');
      return { racine, branche: branche === 'HEAD' ? '(détachée)' : branche, relatif: relatif || '.' };
    } catch { return null; }
  }

  /** Ce qui a changé dans `dossier` (sous son dépôt). */
  async changements(dossier) {
    const d = await this.depot(dossier);
    if (!d) return null;
    const sortie = await this._executer(['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', d.relatif], d.racine);
    return { ...d, ...analyserPorcelain(sortie) };
  }

  /** `git add` limité au dossier, puis un commit. Rend { sha, resume }. */
  async committer(dossier, message) {
    const d = await this.depot(dossier);
    if (!d) throw new Error('Ce dossier n’est pas dans un dépôt git.');
    const m = String(message ?? '').trim();
    if (!m) throw new Error('Le message du commit est vide.');
    await this._executer(['add', '-A', '--', d.relatif], d.racine);
    const etat = analyserPorcelain(await this._executer(['status', '--porcelain=v1', '-z', '--', d.relatif], d.racine));
    if (!etat.total) throw new Error('Rien à committer : le dossier est déjà à jour.');
    await this._executer(['commit', '-m', m, '--', d.relatif], d.racine);
    const sha = (await this._executer(['rev-parse', '--short', 'HEAD'], d.racine)).trim();
    return { sha, branche: d.branche, total: etat.total };
  }

  /** `git push` sur la branche courante. Rend la sortie de git. */
  async pousser(dossier) {
    const d = await this.depot(dossier);
    if (!d) throw new Error('Ce dossier n’est pas dans un dépôt git.');
    try {
      return await this._executer(['push'], d.racine);
    } catch (e) {
      throw new Error(`git push a échoué : ${(e.stderr || e.message || '').trim().split('\n').slice(-3).join(' ')}`);
    }
  }
}

module.exports = { GitLocal, analyserPorcelain };

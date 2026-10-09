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
const fs = require('node:fs');

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
    // sans terminal, git ne peut demander ni mot de passe ni phrase secrète :
    // il doit échouer tout de suite (« could not read Username »), pas
    // attendre une saisie qui ne viendra jamais — d'où GIT_TERMINAL_PROMPT=0
    // et une limite de temps, pour un `push` sur un réseau qui ne répond pas
    const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', SSH_ASKPASS_REQUIRE: 'never' };
    // `options.env` : des variables de plus pour CET appel (le jeton d'un push)
    this._executer = executer ?? ((args, cwd, options = {}) => new Promise((resoudre, rejeter) => {
      execFile(this._git, args, { cwd, env: { ...env, ...(options.env ?? {}) }, maxBuffer: 16 * 1024 * 1024, windowsHide: true, timeout: 120000 }, (err, stdout, stderr) => {
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
      // git rend le chemin RÉEL de la racine (sur macOS, /var est un lien vers
      // /private/var ; le dossier choisi, lui, peut être donné par le lien) :
      // les deux côtés se résolvent avant d'en tirer le chemin relatif,
      // sans quoi git jugeait le dossier « outside repository »
      const reel = (p) => { try { return fs.realpathSync.native(p); } catch { return p; } };
      const relatif = path.relative(reel(racine), reel(path.resolve(dossier))).split(path.sep).join('/');
      if (relatif.startsWith('..')) return null;
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

  /**
   * L'adresse vers laquelle la branche courante pousse : celle de son
   * distant de suivi, sinon `origin`. '' si le dépôt n'en a pas.
   */
  async adresseDePush(racine) {
    let distant = 'origin';
    try {
      const suivi = (await this._executer(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], racine)).trim();
      if (suivi.includes('/')) distant = suivi.split('/')[0];
    } catch { /* pas de suivi : origin */ }
    try { return (await this._executer(['remote', 'get-url', '--push', distant], racine)).trim(); } catch { return ''; }
  }

  /**
   * `git push` sur la branche courante. Rend { methode, sortie }.
   *
   * AVEC UN JETON (`options.jeton`, celui du compte GitHub du bloc 3) et un
   * distant HTTPS sur github.com, le push se passe du trousseau de la
   * machine : les assistants d'identifiants sont écartés pour cet appel
   * (`-c credential.helper=` remet la liste à vide), et un assistant
   * éphémère répond avec le jeton — lu dans une VARIABLE D'ENVIRONNEMENT
   * de ce seul processus, jamais dans la ligne de commande ni sur le
   * disque. C'est ce qui évite la boîte « saisissez le mot de passe du
   * trousseau session » de macOS, et son refus quand on s'y trompe : un
   * mot de passe erroné là ne laissait plus rien passer, sans le dire.
   * Sans jeton, ou vers un autre distant (SSH, autre forge) : le git de la
   * machine, avec ses clés, tel quel.
   */
  async pousser(dossier, { jeton = null } = {}) {
    const d = await this.depot(dossier);
    if (!d) throw new Error('Ce dossier n’est pas dans un dépôt git.');
    const t = typeof jeton === 'string' ? jeton.trim() : '';
    const adresse = t ? await this.adresseDePush(d.racine) : '';
    const parJeton = Boolean(t) && /^https:\/\/(www\.)?github\.com\//i.test(adresse);
    try {
      if (parJeton) {
        const sortie = await this._executer([
          '-c', 'credential.helper=',
          // git soumet `host=…` sur l'entrée standard : le jeton ne part que
          // pour github.com, même si un suivi de redirection changeait d'hôte
          '-c', 'credential.helper=!f() { h=; while read -r l; do case "$l" in host=github.com|host=www.github.com) h=1;; esac; done; [ -n "$h" ] || exit 0; echo username=x-access-token; echo "password=$GALERIE_JETON"; }; f',
          'push'
        ], d.racine, { env: { GALERIE_JETON: t } });
        return { methode: 'jeton', sortie };
      }
      return { methode: 'machine', sortie: await this._executer(['push'], d.racine) };
    } catch (e) {
      // la cause est en TÊTE du stderr (« fatal: … ») ; la fin n'est que l'aide de git
      const lignes = (e.stderr || e.message || '').trim().split('\n').map((l) => l.trim()).filter(Boolean);
      const detail = lignes.find((l) => /^(fatal|error):/i.test(l)) ?? lignes[0] ?? '';
      let conseil = '';
      if (/Username|Password|Authentication|Permission denied|publickey|askpass|terminal prompts/i.test(detail)) {
        conseil = parJeton
          ? ' — le jeton du compte (Publier › Mettre en ligne) a été refusé par GitHub : vérifiez qu’il porte le droit « Contents : lecture et écriture » sur CE dépôt, ou collez-en un nouveau.'
          : ' — sans terminal, git ne peut rien demander, et le trousseau de la machine n’a rien fourni (mot de passe du trousseau refusé, ou rien d’enregistré). '
            + 'Le plus simple : un jeton GitHub dans Publier › Mettre en ligne — « Pousser » l’utilise alors pour un dépôt github.com, sans trousseau. Sinon : un assistant d’identifiants ou une clé SSH chargée dans l’agent.';
      } else if (/No configured push destination|no upstream|does not appear to be a git repository|Could not read from remote/i.test(detail)) {
        conseil = ' — ce dépôt n’a pas de distant : ajoutez-en un dans un terminal (git remote add origin …, puis git push -u origin <branche>) ; ensuite « Pousser » suffira.';
      } else if (e.killed) {
        conseil = ' — le distant n’a pas répondu dans les deux minutes.';
      }
      throw new Error(`git push a échoué : ${detail}${conseil}`);
    }
  }
}

module.exports = { GitLocal, analyserPorcelain };

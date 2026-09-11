/**
 * OÙ VIVENT LES MÉDIAS — le chemin de base des fichiers, réglable.
 *
 * Par défaut, tout est servi à côté de la page : `assets/x.webm` devient
 * `./assets/x.webm`. Le jour où l'audio dépasse ce que GitHub Pages porte
 * de bon cœur (le site sous 1 Go, la bande passante sous 100 Go par mois),
 * on le déplace vers un stockage d'objets sans frais de sortie, et l'on
 * écrit dans `content/reglages.json` :
 *
 *   "medias": { "sons": "https://sons.exemple.org/galerie/" }
 *
 * Rien d'autre ne change : les JSON gardent leurs chemins relatifs, seule
 * la résolution des SONS (pistes, ambiances, manifestes et fragments) part
 * vers cet hôte. `medias.base` fait de même pour tous les autres fichiers
 * (images, modèles, textures), si l'on veut tout déplacer.
 *
 * L'hôte distant doit autoriser le CORS (`Access-Control-Allow-Origin`)
 * pour que le navigateur puisse décoder ce qu'il télécharge — voir README.
 *
 * Module pur : testé au nœud par scripts/test-medias.mjs.
 */

/** Un chemin de son : fichier audio, manifeste de fragments, ou dossier de fragments. */
export function estSon(path) {
  const p = String(path ?? '').split(/[?#]/)[0];
  return /\.(wav|mp3|ogg|oga|opus|webm|m4a|aac|flac|aiff?)$/i.test(p)
    || /\.fragments\.json$/i.test(p)
    || /\.frag\//i.test(p);
}

/** Vrai pour une URL absolue (http(s):// ou //hôte). */
export function estAbsolu(path) {
  return typeof path === 'string' && /^(https?:)?\/\//.test(path);
}

/**
 * Le chemin à charger pour un média du contenu.
 * @param {string} path     tel qu'écrit dans le JSON
 * @param {object} [medias] `reglages.medias` : { base?, sons? }
 * @param {string} [base]   la base de la page (import.meta.env.BASE_URL)
 */
export function resoudreMedia(path, medias, base = './') {
  const p = String(path ?? '');
  if (!p || estAbsolu(p) || p.startsWith('/')) return p;
  const racine = (estSon(p) ? medias?.sons : null) ?? medias?.base ?? null;
  if (typeof racine === 'string' && racine.trim()) return joindre(racine.trim(), p);
  return base + p;
}

/** `racine` + `chemin` avec exactement une barre entre les deux. */
export function joindre(racine, chemin) {
  return racine.replace(/\/+$/, '') + '/' + String(chemin).replace(/^\.?\/+/, '');
}

/** Les réglages `medias` sains : chaînes non vides seulement. */
export function normaliserMedias(m) {
  const out = {};
  if (m && typeof m === 'object') {
    for (const cle of ['base', 'sons']) {
      const v = m[cle];
      if (typeof v === 'string' && v.trim()) out[cle] = v.trim();
    }
  }
  return out;
}

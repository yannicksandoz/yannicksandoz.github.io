import { assetUrl, isAbsoluteUrl } from './utils.js';

/**
 * Bibliothèque 3D — un catalogue de modèles prêts à poser dans l'éditeur.
 *
 * Un catalogue est un simple JSON, servi depuis `content/library/index.json`
 * ou depuis n'importe quelle URL qui autorise le CORS. Rien n'est stocké
 * dans le navigateur : le catalogue est relu à chaque ouverture du panneau,
 * et les objets insérés ne retiennent qu'une **URL**, exactement comme les
 * médias importés par lien.
 *
 *   {
 *     "name": "Mobilier de galerie",
 *     "items": [
 *       { "id": "socle-haut", "name": "Socle haut",
 *         "url": "library/models/socle-haut.glb",
 *         "thumbnail": "library/thumbs/socle-haut.svg",
 *         "fit": 1.1,                       // hauteur réelle, en mètres
 *         "tags": ["socle"],
 *         "author": "…", "license": "CC-BY 4.0",
 *         "sourceUrl": "https://…" }
 *     ]
 *   }
 *
 * `author` / `license` / `sourceUrl` sont recopiés dans l'œuvre créée et
 * ressortent dans l'écran de crédits (voir `credits.js`, qui reste côté
 * visiteur alors que ce module-ci ne sert qu'à l'auteur) : une licence
 * CC-BY impose de citer, et cette obligation ne doit pas dépendre de la
 * mémoire de qui compose la scène.
 */

export const DEFAULT_CATALOG = 'library/index.json';

/**
 * Charge et normalise un catalogue. Lève si le catalogue est illisible —
 * l'appelant (le panneau) affiche l'erreur, il n'y a rien à sauver.
 */
export async function loadCatalog(url = DEFAULT_CATALOG) {
  const resolved = assetUrl(url);
  const response = await fetch(resolved, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`${resolved} → HTTP ${response.status}`);

  // Un serveur statique qui ne trouve pas le fichier répond souvent la page
  // d'accueil avec un 200 : sans ce garde-fou, l'auteur lit « Unexpected
  // token < » au lieu de « ce n'est pas un catalogue ».
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(`${resolved} ne renvoie pas du JSON (chemin inexistant ?)`);
  }

  const rawItems = Array.isArray(data) ? data : data.items;
  if (!Array.isArray(rawItems)) throw new Error('catalogue sans liste « items »');

  return {
    name: (Array.isArray(data) ? null : data.name) ?? 'Bibliothèque',
    description: Array.isArray(data) ? '' : (data.description ?? ''),
    items: rawItems.map((item, i) => normalizeItem(item, i, resolved)).filter(Boolean)
  };
}

/**
 * Une entrée devient utilisable ou disparaît. Un catalogue distant est écrit
 * par quelqu'un d'autre : mieux vaut ignorer trois entrées bancales que
 * casser le panneau entier.
 */
export function normalizeItem(item, index = 0, catalogUrl = '') {
  if (!item || typeof item.url !== 'string' || !item.url) return null;
  const id = String(item.id ?? item.name ?? `asset-${index}`)
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || `asset-${index}`;
  return {
    id,
    name: String(item.name ?? id),
    description: String(item.description ?? ''),
    tags: Array.isArray(item.tags) ? item.tags.map(String) : [],
    url: resolveAgainst(item.url, catalogUrl),
    thumbnail: item.thumbnail ? resolveAgainst(item.thumbnail, catalogUrl) : '',
    fit: Number.isFinite(item.fit) && item.fit > 0 ? item.fit : 2,
    author: String(item.author ?? ''),
    license: String(item.license ?? ''),
    sourceUrl: String(item.sourceUrl ?? '')
  };
}

/**
 * Les URL d'un catalogue distant sont relatives à CE catalogue, pas au
 * dossier de contenu local. Sans cette résolution, un catalogue publié
 * ailleurs ne pourrait référencer que des URL absolues.
 */
function resolveAgainst(url, catalogUrl) {
  if (isAbsoluteUrl(url) || url.startsWith('/')) return url;
  if (!isAbsoluteUrl(catalogUrl)) return url; // catalogue local : chemin de contenu
  try {
    return new URL(url, catalogUrl).href;
  } catch {
    return url;
  }
}

/** Filtre par nom, description ou étiquette. Une requête vide rend tout. */
export function filterItems(items, query) {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((it) =>
    it.name.toLowerCase().includes(q)
    || it.description.toLowerCase().includes(q)
    || it.tags.some((t) => t.toLowerCase().includes(q)));
}

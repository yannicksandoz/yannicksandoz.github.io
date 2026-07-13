import { assetUrl } from './utils.js';

/**
 * Charge la liste des œuvres.
 *
 * Deux formats acceptés, par ordre de priorité :
 *  1. public/works/works.json — un tableau d'œuvres dans un seul fichier
 *     (c'est le format produit par l'export du mode édition) ;
 *  2. public/works/index.json — un tableau de noms de fichiers, chacun
 *     décrivant une œuvre (format recommandé pour l'édition à la main).
 */
export async function loadWorks() {
  const combined = await fetchJson(assetUrl('works/works.json'), true);
  if (Array.isArray(combined)) return combined;

  const index = await fetchJson(assetUrl('works/index.json'));
  const works = await Promise.all(
    index.map((file) => fetchJson(assetUrl(`works/${file}`)))
  );
  return works.filter(Boolean);
}

async function fetchJson(url, optional = false) {
  try {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) {
      if (optional) return null;
      throw new Error(`${url} → HTTP ${r.status}`);
    }
    return await r.json();
  } catch (err) {
    if (optional) return null;
    console.error('[galerie] Configuration illisible :', err);
    throw err;
  }
}

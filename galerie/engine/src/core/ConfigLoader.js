import { assetUrl } from './utils.js';
import { migrateWork, migrateRoom } from './schema.js';

/**
 * Charge la liste des œuvres.
 *
 * Deux formats acceptés, par ordre de priorité :
 *  1. works/works.json — un tableau d'œuvres dans un seul fichier
 *     (c'est le format produit par l'export du mode édition) ;
 *  2. works/index.json — un tableau de noms de fichiers, chacun
 *     décrivant une œuvre (format recommandé pour l'édition à la main).
 */
export async function loadWorks() {
  const combined = await fetchJson(assetUrl('works/works.json'), true);
  if (Array.isArray(combined)) return combined.map(migrateWork);

  const index = await fetchJson(assetUrl('works/index.json'));
  const works = await Promise.all(
    index.map((file) => fetchJson(assetUrl(`works/${file}`)))
  );
  return works.filter(Boolean).map(migrateWork);
}

/**
 * Charge la liste des pièces (rooms). Mêmes conventions que les œuvres :
 * rooms/rooms.json (fichier combiné, produit par l'export de l'éditeur),
 * sinon rooms/index.json + un fichier par pièce.
 *
 * Retourne null si aucune configuration de pièces n'existe — la galerie
 * fonctionne alors en mode « pièce unique » contenant toutes les œuvres
 * (compatibilité avec les scènes sans rooms).
 */
export async function loadRooms() {
  const combined = await fetchJson(assetUrl('rooms/rooms.json'), true);
  if (Array.isArray(combined)) return combined.map(migrateRoom);

  const index = await fetchJson(assetUrl('rooms/index.json'), true);
  if (!Array.isArray(index)) return null;

  const rooms = await Promise.all(
    index.map((file) => fetchJson(assetUrl(`rooms/${file}`)))
  );
  return rooms.filter(Boolean).map(migrateRoom);
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

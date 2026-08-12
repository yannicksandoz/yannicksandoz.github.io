import { assetUrl } from './utils.js';
import { migrateWork, migrateRoom } from './schema.js';
import { attributionPath, CHAMPS_REQUIS } from './credits.js';

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
  if (Array.isArray(combined)) return restoreCredits(combined.map(migrateWork));

  const index = await fetchJson(assetUrl('works/index.json'));
  const works = await Promise.all(
    index.map((file) => fetchJson(assetUrl(`works/${file}`)))
  );
  return restoreCredits(works.filter(Boolean).map(migrateWork));
}

/**
 * Recompose les crédits manquants depuis les fichiers compagnons.
 *
 * Un modèle importé est accompagné sur le disque d'un
 * `<modèle>.attribution.json` écrit à l'export. Si quelqu'un retire le
 * crédit du JSON de scène — par mégarde ou pour s'en débarrasser —, le
 * runtime le relit là. C'est ce qui fait de l'attribution un invariant
 * plutôt qu'une convention : la supprimer demande d'effacer DEUX fichiers,
 * dont un qui n'a aucune raison d'être ouvert.
 *
 * Une requête par modèle importé, en parallèle, et seulement pour eux :
 * une scène sans import ne coûte rien. Un compagnon absent n'est pas une
 * erreur — la scène peut être antérieure — il laisse simplement le crédit
 * en l'état.
 */
async function restoreCredits(works) {
  const importes = works.filter((w) => w.model?.source && w.model?.url);
  if (!importes.length) return works;

  await Promise.all(importes.map(async (work) => {
    const complet = CHAMPS_REQUIS.every((c) => String(work.credit?.[c] ?? '').trim());
    if (complet) return;
    const compagnon = await fetchJson(assetUrl(attributionPath(work.model.url)), true);
    if (!compagnon) return;
    work.credit = { ...work.credit };
    for (const champ of CHAMPS_REQUIS) {
      if (!String(work.credit[champ] ?? '').trim() && compagnon[champ]) {
        work.credit[champ] = compagnon[champ];
      }
    }
    if (!String(work.title ?? '').trim() && compagnon.name) work.title = compagnon.name;
  }));
  return works;
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

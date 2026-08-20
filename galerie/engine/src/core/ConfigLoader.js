import { assetUrl } from './utils.js';
import { migrateWork, migrateRoom } from './schema.js';
import { attributionPath, CHAMPS_REQUIS, sonsImportes } from './credits.js';

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
  // `optional` sur chaque œuvre : après trois tentatives, une œuvre qui
  // manque est signalée et laissée de côté — une galerie amputée d'un objet
  // vaut mieux qu'un écran d'erreur, et l'index, lui, reste impératif.
  const works = await parVagues(index,
    (file) => fetchJson(assetUrl(`works/${file}`), true));
  const perdus = index.filter((_, i) => !works[i]);
  if (perdus.length) {
    console.warn('[galerie] Œuvres illisibles, ignorées :', perdus);
  }
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
  // Une cible = un porteur de crédit à recompléter : le modèle d'une œuvre,
  // ou l'un de ses sons empruntés. Les deux obéissent à la même licence.
  const cibles = [];
  for (const work of works) {
    if (work.model?.source && work.model?.url) {
      cibles.push({ url: work.model.url, porteur: work, titre: work });
    }
    for (const { stem } of sonsImportes(work)) {
      if (stem.file) cibles.push({ url: stem.file, porteur: stem, titre: null });
    }
  }
  if (!cibles.length) return works;

  await parVagues(cibles, async ({ url, porteur, titre }) => {
    const complet = CHAMPS_REQUIS.every((c) => String(porteur.credit?.[c] ?? '').trim());
    if (complet) return;
    const compagnon = await fetchJson(assetUrl(attributionPath(url)), true);
    if (!compagnon) return;
    porteur.credit = { ...porteur.credit };
    for (const champ of CHAMPS_REQUIS) {
      if (!String(porteur.credit[champ] ?? '').trim() && compagnon[champ]) {
        porteur.credit[champ] = compagnon[champ];
      }
    }
    if (titre && !String(titre.title ?? '').trim() && compagnon.name) {
      titre.title = compagnon.name;
    }
  });
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
/**
 * Réglages GÉNÉRAUX de la galerie (`content/reglages.json`) — ce qui vaut
 * pour toutes les pièces à la fois. Optionnel : absent, les valeurs par
 * défaut du moteur s'appliquent.
 *   { "cooldown": 5 }   // délai de réarmement des passages, en secondes
 */
export async function loadReglages() {
  const r = await fetchJson(assetUrl('reglages.json'), true);
  return (r && typeof r === 'object') ? r : {};
}

export async function loadRooms() {
  const combined = await fetchJson(assetUrl('rooms/rooms.json'), true);
  if (Array.isArray(combined)) return combined.map(migrateRoom);

  const index = await fetchJson(assetUrl('rooms/index.json'), true);
  if (!Array.isArray(index)) return null;

  const rooms = await parVagues(index,
    (file) => fetchJson(assetUrl(`rooms/${file}`), true));
  const perdues = index.filter((_, i) => !rooms[i]);
  if (perdues.length) console.warn('[galerie] Pièces illisibles :', perdues);
  return rooms.filter(Boolean).map(migrateRoom);
}

/**
 * Un GET JSON qui ne renonce pas au premier accroc.
 *
 * La galerie ouvre cent trente fichiers de configuration ; sur une
 * connexion froide, derrière un CDN qui vient de recevoir un déploiement,
 * il suffisait qu'UN seul réponde mal pour que l'écran d'accueil affiche
 * « impossible de charger » — et un simple rechargement suffisait à tout
 * réparer, preuve que l'échec était passager. On réessaie donc, deux fois,
 * en laissant respirer entre chaque tentative.
 */
async function fetchJson(url, optional = false, essais = 3) {
  let dernier = null;
  for (let n = 0; n < essais; n++) {
    if (n > 0) await pause(180 * n * n);   // 0, 180, 720 ms
    try {
      const r = await fetch(url, { cache: 'no-cache' });
      if (r.ok) return await r.json();
      // 404 sur un fichier facultatif : inutile d'insister
      if (optional && r.status === 404) return null;
      dernier = new Error(`${url} → HTTP ${r.status}`);
      if (r.status === 404) break;         // il n'existe pas : il n'existera pas
    } catch (err) {
      dernier = err;                       // réseau : ça peut passer au suivant
    }
  }
  if (optional) return null;
  console.error('[galerie] Configuration illisible :', dernier);
  throw dernier;
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Applique `fn` à tous les éléments, quelques-uns à la fois.
 *
 * Cent trente requêtes lâchées d'un coup, c'est la rafale que les serveurs
 * et les proxys aiment le moins — et le premier refus emportait toute la
 * galerie. Par vagues de huit, le chargement est aussi rapide et bien plus
 * sûr.
 */
async function parVagues(items, fn, largeur = 8) {
  const out = new Array(items.length);
  let i = 0;
  const ouvriers = Array.from({ length: Math.min(largeur, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k], k);
    }
  });
  await Promise.all(ouvriers);
  return out;
}

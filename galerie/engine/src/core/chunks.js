/**
 * LES MORCEAUX DIFFÉRÉS — et la page qui a vieilli sous les pieds du visiteur.
 *
 * Le build découpe la galerie en morceaux (chunks) chargés au besoin : le
 * lecteur de modèles GLB, les scans, les écrans ISF, le menu de visite. Leur
 * nom porte une empreinte (`GLTFLoader-B4bV5sg.js`) qui change à chaque
 * déploiement où leur voisinage change. Un visiteur qui a OUVERT la page
 * avant un déploiement et entre ensuite dans une salle à modèles demande un
 * fichier qui n'existe plus : 404, et chaque banc, chaque pierre devient un
 * cube rouge. Sept déploiements dans une journée, c'est sept fois ce piège.
 *
 * Trois réponses, ici :
 *  1. `importerChunk` : un morceau qui ne vient pas est REDEMANDÉ une fois
 *     (le réseau d'un téléphone a des creux), puis, s'il manque toujours,
 *     on le dit : la version est périmée (`signalerVersionPerimee`) — la
 *     page affiche « nouvelle version en ligne, rechargez » plutôt qu'un
 *     cube muet ;
 *  2. `rechauffer` : les morceaux dont la visite aura besoin sont importés
 *     D'AVANCE, au calme, quelques secondes après la porte — une fois dans
 *     la mémoire des modules, un redéploiement ne peut plus les retirer ;
 *  3. `ecouterPreloadVite` : l'événement de Vite quand un préchargement
 *     échoue, même signal.
 *
 * Tout ce qui décide est pur et testé au nœud (test-chunks.mjs).
 */

/** Ce que disent les navigateurs quand un module différé ne vient pas. */
export const MOTIFS_CHUNK = [
  /dynamically imported module/i,          // Chrome : Failed to fetch dynamically imported module
  /Importing a module script failed/i,     // Safari
  /error loading dynamically imported module/i, // Firefox
  /Failed to fetch/i,
  /Load failed/i,
  /NetworkError/i
];

export function estErreurDeChunk(err) {
  if (!err) return false;
  if (err.code === 'version-perimee') return true;
  const m = String(err.message ?? err);
  return MOTIFS_CHUNK.some((r) => r.test(m));
}

let perimee = false;
const abonnes = new Set();

/** Vrai dès qu'un morceau a manqué pour de bon : la page n'est plus celle du serveur. */
export function versionPerimee() { return perimee; }

/** S'abonner au signal ; rappelé tout de suite si c'est déjà arrivé. Rend la désinscription. */
export function surVersionPerimee(fn) {
  abonnes.add(fn);
  if (perimee) fn();
  return () => abonnes.delete(fn);
}

export function signalerVersionPerimee(cause) {
  if (perimee) return false;
  perimee = true;
  for (const fn of abonnes) { try { fn(cause); } catch { /* un abonné ne casse pas les autres */ } }
  if (typeof window !== 'undefined' && typeof CustomEvent === 'function') {
    window.dispatchEvent(new CustomEvent('galerie:version-perimee', { detail: { cause } }));
  }
  return true;
}

/** Pour les tests : repartir de zéro. */
export function _reinitialiser() { perimee = false; abonnes.clear(); }

/**
 * Importe un morceau, en redemandant une fois s'il ne vient pas ; s'il
 * manque toujours, signale la version périmée et lève une erreur portant
 * `code = 'version-perimee'`. Une erreur qui n'est PAS un défaut de
 * chargement (une exception dans le module lui-même) remonte telle quelle,
 * sans nouvel essai : ce n'est pas le réseau.
 */
export async function importerChunk(charger, { essais = 2, attente = 600, dormir = null } = {}) {
  const pause = dormir ?? ((ms) => new Promise((suite) => setTimeout(suite, ms)));
  let derniere;
  for (let i = 0; i < essais; i++) {
    try {
      return await charger(i);
    } catch (err) {
      if (!estErreurDeChunk(err)) throw err;
      derniere = err;
      if (i < essais - 1) await pause(attente * (2 ** i));
    }
  }
  signalerVersionPerimee(derniere);
  const e = new Error(`version périmée — un morceau de la galerie n'existe plus sur le serveur (${derniere?.message ?? derniere})`);
  e.code = 'version-perimee';
  e.cause = derniere;
  throw e;
}

/** L'événement de Vite quand un préchargement de morceau échoue : même signal. */
export function ecouterPreloadVite(cible = typeof window !== 'undefined' ? window : null) {
  if (!cible?.addEventListener) return () => {};
  const fn = (ev) => signalerVersionPerimee(ev?.payload ?? ev);
  cible.addEventListener('vite:preloadError', fn);
  return () => cible.removeEventListener('vite:preloadError', fn);
}

/**
 * Importe d'avance, au calme, une liste de chargeurs — l'un après l'autre,
 * jamais en rafale (la première minute est au visiteur, pas à nous). Rend
 * le bilan (vrai / faux par chargeur) sans jamais lever : un échec ici est
 * déjà signalé par importerChunk s'il le mérite.
 */
export function rechauffer(chargeurs, { delai = 4000, planifier = null } = {}) {
  const auCalme = planifier ?? ((fn) => (typeof requestIdleCallback === 'function'
    ? requestIdleCallback(fn, { timeout: 8000 }) : setTimeout(fn, 1000)));
  return new Promise((res) => {
    setTimeout(() => auCalme(async () => {
      const bilan = [];
      for (const charger of chargeurs) {
        try { await charger(); bilan.push(true); } catch { bilan.push(false); }
      }
      res(bilan);
    }), delai);
  });
}

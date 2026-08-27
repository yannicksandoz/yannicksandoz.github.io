/**
 * LE TRI DES TACHES SANS MÉMOIRE PARTAGÉE — le correctif Firefox / Safari.
 *
 * Symptôme : sur Firefox et Safari, un scan gaussien se charge, son cartel
 * s'affiche, et l'œuvre reste INVISIBLE. Aucune erreur dans la page.
 *
 * Cause. GaussianSplats3D trie ses taches par profondeur dans un worker,
 * en WebAssembly. Le worker alloue toujours sa mémoire ainsi :
 *
 *     new WebAssembly.Memory({ initial: n, maximum: n, shared: true })
 *
 * `shared: true` — quoi qu'on demande. Or une mémoire WASM partagée est
 * adossée à un SharedArrayBuffer, et le SharedArrayBuffer exige un
 * contexte ISOLÉ (en-têtes COOP/COEP) que GitHub Pages n'envoie pas.
 * Chromium tolère l'allocation hors isolation ; Firefox et Safari la
 * REFUSENT. L'appel lève — mais il lève DANS le worker, dans un
 * `onmessage`, hors de toute promesse : la page ne voit rien, le tri ne
 * rend jamais d'indices, `splatRenderCount` reste à zéro, et le nuage ne
 * se dessine pas. Le cartel, lui, ne dépend de rien de tout cela.
 *
 * L'option `sharedMemoryForWorkers: false` ne suffit pas : elle ne change
 * que la façon de TRANSMETTRE les tableaux (messages au lieu de mémoire
 * commune), jamais l'allocation elle-même. Il faut deux gestes, et ils
 * vont ensemble :
 *
 *   1. le worker doit allouer une mémoire NON partagée ;
 *   2. le binaire WASM doit être celui qui IMPORTE une mémoire non
 *      partagée — les quatre variantes embarquées se répartissent en
 *      SIMD/sans-SIMD × partagée/non partagée, et un module qui déclare
 *      une mémoire partagée refuse une mémoire ordinaire, et l'inverse.
 *
 * Le premier geste se fait sur le SOURCE du worker : la bibliothèque le
 * fabrique en assemblant une fonction en texte dans un `Blob`, et l'on
 * réécrit ce texte au passage. Le second se fait par la seule porte que
 * la bibliothèque laisse ouverte — elle ne choisit la variante non
 * partagée que pour les iOS antérieurs à 16.4, d'après `navigator.
 * userAgent`. On se déclare donc iOS 16.3 le temps de cette lecture,
 * qui suit IMMÉDIATEMENT la création du blob, dans le même tour
 * synchrone : la feinte dure moins d'une microtâche.
 *
 * Rien de tout cela ne s'applique dans un contexte isolé
 * (`crossOriginIsolated`), où la voie partagée fonctionne partout : le
 * correctif se retire alors de lui-même.
 *
 * À RETIRER le jour où GaussianSplats3D allouera sa mémoire selon
 * `useSharedMemory` (0.4.7 ne le fait pas). `test-scan-memoire.mjs` lit
 * le paquet installé et échoue si les deux empreintes qu'on réécrit ont
 * disparu — une mise à jour qui répare le défaut le dira, plutôt que de
 * laisser dormir un contournement devenu faux.
 */

/** L'empreinte exacte réécrite dans le source du worker de tri. */
export const EMPREINTE_PARTAGEE = 'shared: true,';
export const EMPREINTE_NON_PARTAGEE = 'shared: false,';

/** Ce qui reconnaît le worker de tri parmi tous les blobs de la page. */
export const SIGNATURE_TRIEUR = 'sortSetupPhase1Complete';

/**
 * Un iPhone sous iOS 16.3 : la seule identité pour laquelle 0.4.7 choisit
 * un binaire de tri à mémoire non partagée.
 */
export const UA_FEINTE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X)'
  + ' AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.3 Mobile/15E148 Safari/604.1';

/**
 * Réécrit le source du worker de tri. Rendu séparément pour être testable
 * sans navigateur : c'est la substitution, pas le branchement, qui peut
 * silencieusement cesser de mordre.
 */
export function sourceSansPartage(source) {
  if (typeof source !== 'string' || !source.includes(SIGNATURE_TRIEUR)) return null;
  if (!source.includes(EMPREINTE_PARTAGEE)) return null;
  return source.split(EMPREINTE_PARTAGEE).join(EMPREINTE_NON_PARTAGEE);
}

/**
 * Pose le contournement et rend la fonction qui le retire. À encadrer
 * autour de la création de la visionneuse — jamais plus longtemps : on
 * remplace `Blob` le temps que le worker naisse, pas davantage.
 */
export function poserContournementScan(fenetre = globalThis) {
  const isole = fenetre.crossOriginIsolated;
  if (isole) return () => {};                 // la voie partagée marche : rien à faire

  const BlobOrigine = fenetre.Blob;
  const nav = fenetre.navigator;
  if (typeof BlobOrigine !== 'function' || !nav) return () => {};

  const uaOrigine = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(nav), 'userAgent');

  const feindreIOS = () => {
    if (!uaOrigine?.get) return;              // rien à rendre : on s'abstient
    Object.defineProperty(nav, 'userAgent', {
      configurable: true, get: () => UA_FEINTE
    });
    // La bibliothèque lit l'agent JUSTE APRÈS avoir fabriqué le blob, dans
    // le même tour synchrone. La microtâche suivante est donc le premier
    // instant où plus personne n'en a besoin.
    queueMicrotask(() => { delete nav.userAgent; });
  };

  function BlobContourne(parties, options) {
    if (Array.isArray(parties) && /javascript/.test(options?.type ?? '')) {
      const reecrit = sourceSansPartage(parties.join(''));
      if (reecrit) {
        feindreIOS();
        return new BlobOrigine([reecrit], options);
      }
    }
    return new BlobOrigine(parties, options);
  }
  BlobContourne.prototype = BlobOrigine.prototype;

  fenetre.Blob = BlobContourne;
  return () => { fenetre.Blob = BlobOrigine; };
}

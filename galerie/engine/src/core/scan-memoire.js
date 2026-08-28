/**
 * LE TRI DES TACHES SANS MÉMOIRE PARTAGÉE.
 *
 * CE QUE CE MODULE NE SOIGNE PAS — à lire d'abord, parce que ce fichier a
 * été écrit comme LA réponse à une panne qu'il ne répare pas. Sur l'iPhone
 * de l'auteur, `capacites.html` répond que la mémoire WebAssembly partagée
 * est ACCEPTÉE hors isolation, et le scan y reste pourtant invisible. Le
 * raisonnement ci-dessous tient donc pour les navigateurs qui refusent
 * l'allocation — et le contournement leur sert — mais il n'explique pas ce
 * que voit l'auteur. La panne qui reste se diagnostique sur `scan.html`,
 * qui charge le vrai scan sur l'appareil au lieu de raisonner à distance.
 *
 * Une cause qu'on ne peut pas confronter à la machine n'est pas une cause.
 *
 * ------------------------------------------------------------------------
 *
 * Symptôme visé : sur un navigateur qui refuse le SharedArrayBuffer hors
 * isolation, un scan gaussien se charge, son cartel s'affiche, et l'œuvre
 * reste INVISIBLE. Aucune erreur dans la page.
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
 * rend jamais d'indices, et le nuage ne se dessine pas. Le cartel, lui,
 * ne dépend de rien de tout cela.
 *
 * L'option `sharedMemoryForWorkers: false` ne suffit pas : elle ne change
 * que la façon de TRANSMETTRE les tableaux (messages au lieu de mémoire
 * commune), jamais l'allocation elle-même. Il faut deux gestes, et ils
 * vont ensemble :
 *
 *   1. le worker doit allouer une mémoire NON partagée ;
 *   2. le binaire WASM doit être celui qui IMPORTE une mémoire non
 *      partagée — les variantes embarquées se répartissent en
 *      SIMD/sans-SIMD × partagée/non partagée, et un module qui déclare
 *      une mémoire partagée refuse une mémoire ordinaire, et l'inverse.
 *
 * Le premier geste se fait sur le SOURCE du worker : la bibliothèque le
 * fabrique en assemblant `fonction.toString()` dans un `Blob`, et l'on
 * réécrit ce texte au passage. ATTENTION, leçon payée : en production ce
 * texte est celui du bundle MINIFIÉ — l'allocation s'y écrit
 * `shared:!0`, pas `shared: true`. Une empreinte littérale ne mord que
 * dans le développement et laisse la production silencieusement cassée ;
 * la réécriture est donc un MOTIF, qui couvre les deux orthographes.
 *
 * Le second geste passe par la seule porte que la bibliothèque laisse
 * ouverte — elle ne choisit la variante non partagée que pour les iOS
 * antérieurs à 16.4, d'après `navigator.userAgent`, lu au moment du
 * choix. On se déclare donc iOS 16.3 le temps de cette lecture, qui suit
 * IMMÉDIATEMENT la création du blob, dans le même tour synchrone : la
 * feinte dure moins d'une microtâche.
 *
 * Rien de tout cela ne s'applique dans un contexte isolé
 * (`crossOriginIsolated`), où la voie partagée fonctionne partout : le
 * correctif se retire alors de lui-même.
 *
 * À RETIRER le jour où GaussianSplats3D allouera sa mémoire selon
 * `useSharedMemory` (0.4.7 ne le fait pas). `test-scan-memoire.mjs` lit
 * le paquet installé et échoue si le défaut d'en face disparaît — une
 * mise à jour qui répare le dira, plutôt que de laisser dormir un
 * contournement devenu faux. Et si un futur minifieur invente une
 * TROISIÈME orthographe que le motif ne couvre pas, `applique()` rend
 * faux et `scans.js` le crie en console — jamais deux fois la même
 * régression muette.
 */

/**
 * Le motif de l'allocation partagée, dans le source du worker de tri.
 * Deux orthographes réelles : `shared: true` (source) et `shared:!0`
 * (esbuild/terser). Le préfixe capture la ponctuation d'objet pour ne
 * jamais toucher un `useSharedMemory` ou un mot qui finirait pareil.
 */
export const MOTIF_PARTAGE = /([{,(]\s*shared\s*:\s*)(?:!0|true)\b/g;

/** Ce qui reconnaît le worker de tri parmi tous les blobs de la page. */
export const SIGNATURE_TRIEUR = 'sortSetupPhase1Complete';

/**
 * Un iPhone sous iOS 16.3 : la seule identité pour laquelle 0.4.7 choisit
 * un binaire de tri à mémoire non partagée.
 */
export const UA_FEINTE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X)'
  + ' AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.3 Mobile/15E148 Safari/604.1';

/**
 * Réécrit le source du worker de tri, minifié ou non. Rendu séparément
 * pour être testable sans navigateur : c'est la substitution, pas le
 * branchement, qui peut silencieusement cesser de mordre.
 */
export function sourceSansPartage(source) {
  if (typeof source !== 'string' || !source.includes(SIGNATURE_TRIEUR)) return null;
  if (!source.includes('WebAssembly.Memory')) return null;
  const reecrit = source.replace(MOTIF_PARTAGE, '$1false');
  return reecrit === source ? null : reecrit;
}

/**
 * Pose le contournement. Rend `{ retirer, applique }` :
 *   • `retirer()` restitue le Blob d'origine — à encadrer autour de la
 *     création de la visionneuse, jamais plus longtemps ;
 *   • `applique()` dit si tout va bien : contexte isolé (rien à faire),
 *     ou réécriture réellement effectuée. Faux = le trieur est passé
 *     sans être réécrit, et les scans seront invisibles sur Firefox et
 *     Safari — à crier, pas à taire.
 */
export function poserContournementScan(fenetre = globalThis, surErreur = null) {
  const WorkerOrigine = fenetre.Worker;
  const ecouter = typeof WorkerOrigine === 'function' && typeof surErreur === 'function';

  // LE MOUCHARD. Un worker qui meurt ne dit rien à la page : c'est ce
  // silence, plus que la panne, qui a coûté deux allers-retours. On écoute
  // donc les workers nés pendant cette fenêtre — ils sont deux au plus, le
  // trieur et l'arbre des taches — et l'on relaie leur agonie.
  function WorkerEcoute(url, options) {
    const w = new WorkerOrigine(url, options);
    w.addEventListener('error', (e) => surErreur(e?.message || 'erreur inconnue'));
    return w;
  }
  if (ecouter) {
    WorkerEcoute.prototype = WorkerOrigine.prototype;
    fenetre.Worker = WorkerEcoute;
  }
  const rendreWorker = () => { if (ecouter) fenetre.Worker = WorkerOrigine; };

  if (fenetre.crossOriginIsolated) {
    return { retirer: rendreWorker, applique: () => true };
  }

  const BlobOrigine = fenetre.Blob;
  const nav = fenetre.navigator;
  if (typeof BlobOrigine !== 'function' || !nav) {
    return { retirer: rendreWorker, applique: () => false };
  }

  const uaOrigine = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(nav), 'userAgent');
  let aMordu = false;

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
        aMordu = true;
        feindreIOS();
        return new BlobOrigine([reecrit], options);
      }
    }
    return new BlobOrigine(parties, options);
  }
  BlobContourne.prototype = BlobOrigine.prototype;

  fenetre.Blob = BlobContourne;
  return {
    retirer: () => { fenetre.Blob = BlobOrigine; rendreWorker(); },
    applique: () => aMordu
  };
}

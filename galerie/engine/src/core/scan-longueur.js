/**
 * CONTENT-LENGTH N'EST PAS LA TAILLE DU FICHIER — le correctif des scans
 * servis compressés.
 *
 * Symptôme, tel qu'il s'est présenté : le scan gaussien est invisible en
 * ligne et parfait en local, sur la même version, avec le même fichier.
 * Sur l'appareil, `scan.html` finit par nommer la panne :
 *
 *     attempting to construct out-of-bounds Uint8Array on ArrayBuffer   (WebKit)
 *     Invalid typed array length: 499577                                (Chromium)
 *
 * Cause. GaussianSplats3D préalloue le tampon de réception d'après
 * l'en-tête HTTP `Content-Length`, puis y déverse les octets rendus par
 * `response.body.getReader()` :
 *
 *     directLoadBufferIn = new ArrayBuffer(fileSize);   // fileSize = Content-Length
 *     ...
 *     new Uint8Array(directLoadBufferIn, numBytesLoaded, chunk.byteLength).set(…)
 *
 * Or `Content-Length` annonce les octets qui passent SUR LE FIL, tandis que
 * le lecteur rend les octets DÉCODÉS. Dès que le serveur applique un
 * `Content-Encoding` — et GitHub Pages compresse —, le second est plus
 * gros que le premier : la vue déborde du tampon, la bibliothèque lève, et
 * comme elle jetait la cause (voir `scans.js`), l'œuvre disparaissait sans
 * un mot. Nos 704 000 octets voyagent en 499 577 : le tampon manquait de
 * 40 % de la place.
 *
 * C'EST POURQUOI LE LOCAL NE VOYAIT RIEN. Un `http-server` de
 * développement sert le `.splat` tel quel : `Content-Length` et taille
 * décodée coïncident, le calcul faux donne le bon résultat, et le bogue
 * n'existe qu'en ligne. Aucune quantité de tests locaux ne l'aurait
 * trouvé ; il a fallu une page qui interroge l'appareil.
 *
 * Le correctif ne masque pas le problème : il donne à la bibliothèque le
 * chiffre qu'elle croit lire. On enveloppe `fetch` le temps du chargement,
 * on lit le corps une fois, et l'on renvoie une réponse identique dont le
 * `Content-Length` porte la VRAIE longueur décodée. La bibliothèque
 * préalloue alors juste, et garde sa barre de progression — ce qu'elle
 * perdrait si l'on se contentait de supprimer l'en-tête.
 *
 * Une seule URL est concernée, l'enveloppe ne vit que le temps de la
 * naissance du chargement, et si quoi que ce soit tourne mal on rend la
 * réponse d'origine intacte.
 *
 * À RETIRER le jour où la bibliothèque dimensionnera son tampon sur ce
 * qu'elle a réellement reçu plutôt que sur un en-tête. `test-scans.mjs`
 * surveille la ligne fautive chez l'amont et rougira ce jour-là.
 */

/** L'en-tête que la bibliothèque prend pour une taille de fichier. */
export const ENTETE = 'content-length';

/**
 * La réponse à rendre à la place, ou `null` s'il n'y a rien à corriger.
 * Séparée pour être jugeable sans navigateur (voir `test-scan-longueur.mjs`).
 *
 * @param {Response} reponse la réponse d'origine, corps NON consommé
 * @returns {Promise<Response|null>}
 */
export async function reponseRecalibree(reponse) {
  const annonce = reponse.headers.get(ENTETE);
  // pas d'en-tête : la bibliothèque bascule d'elle-même sur sa voie sûre
  if (annonce === null) return null;
  const octets = await reponse.arrayBuffer();
  const vraie = String(octets.byteLength);
  const entetes = new Headers(reponse.headers);
  entetes.set(ENTETE, vraie);
  const neuve = new Response(octets, {
    status: reponse.status,
    statusText: reponse.statusText,
    headers: entetes
  });
  // Certains navigateurs refusent d'écrire cet en-tête sur une réponse
  // fabriquée. Le repli est SÛR : sans en-tête, la bibliothèque télécharge
  // d'abord et analyse ensuite — plus lent d'un souffle, jamais faux.
  if (neuve.headers.get(ENTETE) !== vraie) {
    const sans = new Headers(reponse.headers);
    sans.delete(ENTETE);
    return new Response(octets, {
      status: reponse.status, statusText: reponse.statusText, headers: sans
    });
  }
  return neuve;
}

/**
 * Pose l'enveloppe. Rend `{ retirer, applique }` — `applique()` dit si une
 * réponse a réellement été recalibrée, pour qu'une régression muette soit
 * impossible.
 *
 * @param {Window|globalThis} fenetre
 * @param {(url: string) => boolean} concerne quelles URL corriger
 */
export function poserContournementLongueur(fenetre = globalThis, concerne = () => false) {
  const origine = fenetre.fetch;
  if (typeof origine !== 'function' || typeof fenetre.Response !== 'function') {
    return { retirer() {}, applique: () => false };
  }
  let corrigee = false;

  const enveloppe = async (entree, init) => {
    const reponse = await origine.call(fenetre, entree, init);
    let url = '';
    try {
      url = typeof entree === 'string' ? entree
        : (entree instanceof URL ? entree.href : (entree?.url ?? ''));
    } catch { url = ''; }
    if (!reponse.ok || !concerne(url)) return reponse;
    try {
      const neuve = await reponseRecalibree(reponse);
      if (!neuve) return reponse;
      corrigee = true;
      return neuve;
    } catch {
      // corps déjà consommé, mémoire insuffisante, réponse opaque : on ne
      // dégrade jamais le chemin normal pour une correction facultative
      return reponse;
    }
  };

  fenetre.fetch = enveloppe;
  return {
    retirer() {
      // ne rendre la main que si l'on est encore le dernier posé : deux
      // scans qui se chevauchent ne doivent pas se marcher dessus
      if (fenetre.fetch === enveloppe) fenetre.fetch = origine;
    },
    applique: () => corrigee
  };
}

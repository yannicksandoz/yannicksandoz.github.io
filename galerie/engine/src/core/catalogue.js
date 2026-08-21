/**
 * Le catalogue — une seule description des œuvres, pour tous ses hôtes.
 *
 * La galerie se raconte à trois endroits : la page `liste.html` fabriquée
 * au build, le panneau de la visite audio, et la fiche d'œuvre en 3D. Ces
 * trois-là disaient la même chose dans trois langages différents, et
 * divergeaient déjà. Ce module porte la règle, une fois : ce qu'est une
 * œuvre au sens du catalogue, ce qu'on peut en dire selon qu'on l'a
 * rencontrée ou non, et à quoi ressemble sa carte.
 *
 * Fonctions PURES : ni DOM, ni Three.js, ni réseau. C'est ce qui permet à
 * Node de s'en servir au build et au navigateur de s'en servir à
 * l'exécution — la même règle des deux côtés, donc jamais deux vérités.
 *
 * Les libellés (« Voir en 3D »…) sont fournis par l'hôte : le générateur
 * les passe en dur, le runtime les prend du dictionnaire. Le module ne
 * traduit pas, il compose.
 */

/** Échappement HTML — strict : `>` inclus, on écrit dans du texte brut. */
export const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/**
 * Une ŒUVRE au sens du catalogue : ni décor, ni membre d'un ensemble. La
 * margelle n'est pas une œuvre, le bassin l'est — et le compteur, la liste
 * et la page doivent tous les trois compter pareil.
 */
export const estOeuvre = (w) => Boolean(w) && w.role !== 'decor' && !w.partOf;

/** Les œuvres d'une liste de configurations, dans l'ordre reçu. */
export const oeuvresDe = (works) => (works ?? []).filter(estOeuvre);

/** Premier fichier audio d'une œuvre (stem principal), ou null. */
export const audioPrincipal = (w) => w?.stems?.find((s) => s.file)?.file ?? null;

/** Le titre affichable — l'identifiant fait un repli acceptable à l'écrit. */
export const titreDe = (w) => w?.title ?? w?.id ?? '';

/** Cartel : année · technique, les deux champs étant facultatifs. */
export const cartelDe = (w) => [w?.year, w?.technique].filter(Boolean).join(' · ');

/**
 * La carte d'une œuvre, en HTML.
 *
 * `labels` : { voir3d, enSavoirPlus } — fournis par l'hôte.
 * L'indentation est celle de la page produite : ce module écrit du HTML
 * lisible, pas du HTML minifié.
 */
export function carteHtml(w, labels = {}) {
  const meta = cartelDe(w);
  const audio = audioPrincipal(w);
  const titre = titreDe(w);
  return `      <article class="oeuvre">
        ${w.image ? `<img src="${esc(w.image)}" alt="${esc(titre)}" loading="lazy">` : ''}
        <h3>${esc(titre)}</h3>
        ${meta ? `<p class="meta">${esc(meta)}</p>` : ''}
        ${w.description ? `<p>${esc(w.description)}</p>` : ''}
        ${audio ? `<audio controls preload="none" src="${esc(audio)}"></audio>` : ''}
        <p class="liens">
          <a href="./?work=${encodeURIComponent(w.id)}">${esc(labels.voir3d ?? '')}</a>
          ${w.link ? ` · <a href="${esc(w.link)}" target="_blank" rel="noopener noreferrer">${esc(labels.enSavoirPlus ?? '')}</a>` : ''}
        </p>
      </article>`;
}

/**
 * La section d'une pièce : son titre, son lien vers la 3D, ses cartes.
 * Une pièce sans œuvre ne produit rien — le décor ne fait pas une salle
 * d'exposition.
 */
export function sectionHtml(room, oeuvres, labels = {}) {
  if (!oeuvres.length) return '';
  return `    <section aria-labelledby="salle-${esc(room.id)}">
      <h2 id="salle-${esc(room.id)}">${esc(room.title ?? room.id)}
        <a class="salle-3d" href="./?room=${encodeURIComponent(room.id)}">${esc(labels.visiter3d ?? '')}</a></h2>
${oeuvres.map((w) => carteHtml(w, labels)).join('\n')}
    </section>`;
}

/**
 * Accessibilité du contenu — helpers partagés entre runtime et éditeur.
 *
 * En visite audio, le titre et la description d'une œuvre sont TOUT ce que
 * perçoit un visiteur aveugle avant de l'approcher. Une œuvre qui n'en a pas
 * est simplement absente de son exposition. D'où l'avertissement à l'export
 * (côté éditeur) et le libellé de repli (côté runtime).
 */

/** Libellé toujours prononçable d'une œuvre. */
export function speakableTitle(work) {
  const t = String(work?.title ?? '').trim();
  return t || 'Sans titre';
}

/**
 * Œuvres auxquelles il manque un titre ou une description.
 * Contrairement aux attributions, ce n'est PAS bloquant : c'est un manque
 * de qualité, pas une obligation de licence. L'export avertit, il n'échoue pas.
 */
export function a11yGaps(works) {
  const gaps = [];
  for (const work of works ?? []) {
    const missing = [];
    if (!String(work.title ?? '').trim()) missing.push('titre');
    if (!String(work.description ?? '').trim()) missing.push('description');
    if (missing.length) gaps.push({ id: work.id, title: work.title ?? '', missing });
  }
  return gaps;
}

/** Message d'avertissement listant les manques, lisible par l'auteur. */
export function describeA11yGaps(gaps) {
  return gaps.map((g) =>
    `• « ${g.title || g.id} » : ${g.missing.join(' et ')} manquant${g.missing.length > 1 ? 's' : ''}`
  ).join('\n');
}

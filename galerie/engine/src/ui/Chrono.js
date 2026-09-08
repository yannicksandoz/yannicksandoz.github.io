/**
 * LE PANNEAU DU CHRONO — le bilan du démarrage À L'ÉCRAN, pour `?chrono`.
 *
 * La console n'est pas sous la main sur un téléphone ; le bilan s'affiche
 * donc en bas à gauche, en monospace, avec « Copier » (presse-papiers) et
 * « × ». Il vit au-dessus de la 3D et survit à l'entrée : on le lit une
 * fois la salle d'arrivée complète, puis on le ferme. Rien de tout cela
 * n'existe sans `?chrono` dans l'adresse.
 */
export function afficherChrono(texte) {
  if (typeof document === 'undefined') return null;
  document.getElementById('chrono-bilan')?.remove();
  const boite = document.createElement('div');
  boite.id = 'chrono-bilan';
  boite.setAttribute('role', 'status');
  const pre = document.createElement('pre');
  pre.textContent = texte;
  const barre = document.createElement('div');
  barre.className = 'chrono-actions';
  const copier = document.createElement('button');
  copier.type = 'button';
  copier.textContent = 'Copier';
  copier.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(texte);
      copier.textContent = 'Copié';
    } catch {
      // sans presse-papiers (http, permission) : le texte reste sélectionnable
      copier.textContent = 'Sélectionnez le texte';
    }
  });
  const fermer = document.createElement('button');
  fermer.type = 'button';
  fermer.textContent = '×';
  fermer.setAttribute('aria-label', 'Fermer');
  fermer.addEventListener('click', () => boite.remove());
  barre.append(copier, fermer);
  boite.append(pre, barre);
  document.body.appendChild(boite);
  return boite;
}

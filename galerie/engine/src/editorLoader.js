/**
 * Chargement paresseux de l'éditeur (côté runtime).
 *
 * Ce module reste minuscule et fait partie du bundle visiteur : il se
 * contente d'écouter les trois déclencheurs (touche ², bouton ✎, `?edit`)
 * et d'importer dynamiquement le vrai éditeur au premier d'entre eux.
 *
 * Tant que rien ne le déclenche, `app.editor` reste `undefined` — le
 * runtime le sait et l'interroge partout en `app.editor?.…`.
 */
export function setupEditorLoader(app) {
  let pending = null;

  const load = () => {
    if (!pending) {
      pending = import('./editor/index.js')
        .then(({ mountEditor }) => mountEditor(app))
        .catch((err) => {
          pending = null; // un échec réseau ne doit pas condamner la session
          console.error('[galerie] Éditeur impossible à charger :', err);
          throw err;
        });
    }
    return pending;
  };

  const toggle = async () => {
    try {
      (await load()).toggle();
    } catch { /* déjà signalé en console */ }
  };

  // Touche physique à gauche du 1 (étiquetée ² sur PC FR, @ sur Mac FR,
  // ` en QWERTY). E est désormais « pivoter à droite » : un raccourci
  // d'édition sur une touche de navigation aurait ouvert l'éditeur en
  // pleine visite.
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Backquote') return;
    if (e.target instanceof Element && e.target.matches('input, textarea, select')) return;
    toggle();
  });

  document.getElementById('edit-toggle')?.addEventListener('click', toggle);

  // Mode auteur direct : …/galerie/?edit
  if (new URLSearchParams(location.search).has('edit')) toggle();
}

/**
 * Vrai chargeur : l'éditeur EST dans ce build, même s'il n'est pas encore
 * ouvert. Le moteur garde alors les représentations éditables (voxels
 * cellule-par-cellule) — c'est le build de la machine d'auteur, la
 * performance de visite s'y mesure moins qu'un cube qui se pique au rayon.
 */
export const EDITOR_AVAILABLE = true;

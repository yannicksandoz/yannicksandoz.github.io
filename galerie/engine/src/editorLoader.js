/**
 * Chargement paresseux de l'éditeur (côté runtime).
 *
 * Ce module reste minuscule et fait partie du bundle visiteur : il se
 * contente d'écouter les trois déclencheurs (touche E, bouton ✎, `?edit`)
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

  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyE') return;
    if (e.target instanceof Element && e.target.matches('input, textarea, select')) return;
    toggle();
  });

  document.getElementById('edit-toggle')?.addEventListener('click', toggle);

  // Mode auteur direct : …/galerie/?edit
  if (new URLSearchParams(location.search).has('edit')) toggle();
}

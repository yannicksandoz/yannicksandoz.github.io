/**
 * Remplaçant de `editorLoader.js` dans un build VISITEUR.
 *
 * `vite.config.js` substitue ce module au vrai chargeur quand
 * `GALERIE_EDITOR` n'est pas armé. Comme il ne contient aucun
 * `import('./editor/index.js')`, Rollup ne voit plus l'éditeur du tout :
 * il ne se contente pas de ne pas l'exécuter, il ne l'émet pas.
 *
 * C'est la différence entre « l'éditeur n'est pas chargé » et « l'éditeur
 * n'est pas publié ». La première laissait 90 ko d'outil d'auteur
 * téléchargeables par simple URL sur GitHub Pages.
 *
 * Conséquence attendue et voulue : dans une galerie publiée, la touche E,
 * le bouton ✎ et `?edit` ne font rien. Le mode Auteur se lance en local.
 */
export function setupEditorLoader() {
  // volontairement vide
}

/** Ici, jamais : ce build ne CONTIENT pas l'éditeur. Le moteur peut donc
 *  choisir ses représentations de visite (voxels fusionnés, etc.). */
export const EDITOR_AVAILABLE = false;

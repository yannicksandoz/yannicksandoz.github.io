import * as THREE from 'three';

/**
 * LE STYLE ARCHITECTURAL — un « mod » activable, pas un fork.
 *
 * `content/reglages.json` :  { "style": "fluide" }
 *
 * Deux styles :
 *
 *   « brut »   — la galerie telle qu'elle a grandi : chambranles en métal
 *                brossé, murs à arêtes franches, masses voxel colorées.
 *
 *   « fluide » — l'esthétique Zaha Hadid des références : coques blanches
 *                continues, ouvertures en anneau adouci, murs dont le
 *                couronnement ondule, masses striées de lignes sombres
 *                (le hall de la Dominion Tower). Le blanc n'est pas un
 *                blanc pur : un blanc de plâtre légèrement froid, qui
 *                prend la couleur des lampes — c'est LUI le matériau.
 *
 * Le style est un réglage GLOBAL lu à la construction des pièces : les
 * bâtisseurs (portails, coques, voxels) le consultent au moment de
 * construire. Le changer dans l'éditeur reconstruit les pièces ; côté
 * visiteur il est fixé au chargement. AUCUN JSON de contenu ne change :
 * le même monde se rend dans les deux styles — c'est ce qui fait du style
 * un mod, et non une migration.
 */

let _style = 'brut';

export function setStyle(nom) {
  _style = nom === 'fluide' ? 'fluide' : 'brut';
}

export function styleCourant() { return _style; }

/** Le monde est-il en mode fluide ? Les bâtisseurs posent LA question. */
export function estFluide() { return _style === 'fluide'; }

/* -------------------------------------------------- la matière du fluide --- */

/**
 * Le blanc structurel du mode fluide — partagé par tous les bâtisseurs
 * pour que portails, couronnements et rubans soient d'une seule coulée.
 * Rugosité basse mais pas nulle : les coques Hadid sont satinées, elles
 * étirent les reflets des lampes sans devenir des miroirs.
 */
export function materiauFluide({ teinte = '#e9e7f0', rugosite = 0.38 } = {}) {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(teinte),
    roughness: rugosite,
    metalness: 0.04
  });
}

/**
 * LES STRIES — la signature graphique des références : les lignes sombres
 * parallèles qui suivent la forme (sol de la Dominion Tower, nervures des
 * coques). Patch de shader : des bandes fines le long de l'axe MONDE
 * vertical, adoucies, qui multiplient la couleur — aucun UV requis, donc
 * elles marchent sur les InstancedMesh des voxels comme sur une coque.
 *
 * `pas` : distance entre deux stries (m). `epaisseur` : part sombre de la
 * période (0–1). `force` : combien la strie assombrit.
 */
export function patcherStries(material,
  { pas = 0.5, epaisseur = 0.14, force = 0.55, axe = null, espace = 'monde' } = {}) {
  // `axe` : direction des stries — la phase court LE LONG de cet axe, les
  // bandes lui sont perpendiculaires. Par défaut la verticale du monde.
  // `espace: 'local'` : l'axe se lit dans le repère de L'OBJET (pour un
  // escalier, la diagonale de sa montée) — insensible aux rotations de
  // salle, et l'instance d'un voxel compte dans la grille, pas dans le
  // monde : les stries suivent la forme, c'est toute l'idée.
  const local = espace === 'local';
  const ax = axe ?? [0, 1, 0];
  const precedent = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    precedent?.call(material, shader, renderer);
    shader.uniforms.uStriePas = { value: pas };
    shader.uniforms.uStrieEpaisseur = { value: epaisseur };
    shader.uniforms.uStrieForce = { value: force };
    shader.uniforms.uStrieAxe = { value: new THREE.Vector3(...ax).normalize() };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>',
        '#include <common>\nvarying vec3 vStriePos;')
      .replace('#include <project_vertex>', local ? `
        #ifdef USE_INSTANCING
          vStriePos = (instanceMatrix * vec4(transformed, 1.0)).xyz;
        #else
          vStriePos = transformed;
        #endif
        #include <project_vertex>` : `
        #ifdef USE_INSTANCING
          vStriePos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        #else
          vStriePos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        #endif
        #include <project_vertex>`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uStriePas;
        uniform float uStrieEpaisseur;
        uniform float uStrieForce;
        uniform vec3 uStrieAxe;
        varying vec3 vStriePos;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float phase = fract(dot(vStriePos, uStrieAxe) / uStriePas);
          // une strie douce : les bords fondent sur ~1/4 de son épaisseur
          float bord = uStrieEpaisseur * 0.25;
          float strie = smoothstep(0.0, bord, phase)
                      * (1.0 - smoothstep(uStrieEpaisseur - bord, uStrieEpaisseur, phase));
          diffuseColor.rgb *= 1.0 - strie * uStrieForce;
        }`);
  };
  material.customProgramCacheKey =
    () => `stries-${pas}-${epaisseur}-${force}-${ax.join(',')}-${espace}`;
  return material;
}

/* ------------------------------------------------------- le couronnement --- */

/**
 * Dessine le sommet FLUIDE d'un mur dans une Shape en cours : un voile qui
 * s'affaisse en douceur entre ses extrémités, celles-ci gardant la pleine
 * hauteur pour recevoir les angles. Appelé par `murPerce` quand le style
 * est fluide ET que la coque n'a pas de plafond. Fonction pure : la suite
 * de tests la conduit sans WebGL ni DOM.
 *
 * La forme arrive au point (length/2, hauteur-…) : on trace de droite à
 * gauche. Le creux est relatif — 12 % de la hauteur, plafonné à 1,20 m.
 */
export function dessinerCouronne(forme, length, height, segments = 48) {
  // L'ONDULATION, pas l'affaissement. La première version était UNE arche
  // en creux : de loin, elle se relisait comme une droite qui plonge un
  // peu. La ligne des références ne repose jamais — elle ondule. D'où une
  // PORTEUSE de ~2,2 périodes modulée par une enveloppe sin(πt) : les
  // extrémités restent exactement à pleine hauteur (les angles des murs
  // voisins se rejoignent), et TOUT l'intérieur vit — le facteur de la
  // porteuse reste dans [0,3 ; 1], donc la ligne ne retouche jamais le
  // sommet et ne descend jamais sous l'amplitude prévue.
  //
  // La phase est SEMÉE PAR LA LONGUEUR du mur : deux murs différents
  // ondulent différemment, le même mur ondule pareil à chaque build.
  const A = Math.min(height * 0.16, 1.5);
  const phase = (length * 7.13) % (Math.PI * 2);
  forme.lineTo(length / 2, height);
  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    const porteuse = 0.65 + 0.35 * Math.sin(Math.PI * 2 * 2.2 * t + phase);
    forme.lineTo(length / 2 - t * length,
      height - A * Math.sin(Math.PI * t) * porteuse);
  }
  return forme;
}

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
export function patcherStries(material, { pas = 0.5, epaisseur = 0.14, force = 0.55 } = {}) {
  const precedent = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    precedent?.call(material, shader, renderer);
    shader.uniforms.uStriePas = { value: pas };
    shader.uniforms.uStrieEpaisseur = { value: epaisseur };
    shader.uniforms.uStrieForce = { value: force };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>',
        '#include <common>\nvarying vec3 vStriePos;')
      .replace('#include <project_vertex>', `
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
        varying vec3 vStriePos;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float phase = fract(vStriePos.y / uStriePas);
          // une strie douce : les bords fondent sur ~1/4 de son épaisseur
          float bord = uStrieEpaisseur * 0.25;
          float strie = smoothstep(0.0, bord, phase)
                      * (1.0 - smoothstep(uStrieEpaisseur - bord, uStrieEpaisseur, phase));
          diffuseColor.rgb *= 1.0 - strie * uStrieForce;
        }`);
  };
  material.customProgramCacheKey = () => `stries-${pas}-${epaisseur}-${force}`;
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
export function dessinerCouronne(forme, length, height, segments = 24) {
  const creux = Math.min(height * 0.12, 1.2);
  forme.lineTo(length / 2, height);
  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    forme.lineTo(length / 2 - t * length, height - creux * Math.sin(Math.PI * t));
  }
  return forme;
}

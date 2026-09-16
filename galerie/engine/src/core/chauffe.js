/**
 * LA CHAUFFE — compiler les programmes d'un morceau de scène AVANT qu'il se
 * dessine, avec le compte de lumières que le dessin aura vraiment.
 *
 * `renderer.compile(sousArbre, caméra, scène)` de three compte les lumières
 * de la scène ET celles du sous-arbre : il est écrit pour un objet qu'on
 * n'a PAS ENCORE ajouté. Pour un sous-arbre déjà dans la scène, ses lampes
 * comptaient DOUBLE — et comme three met le compte de chaque sorte de
 * lumière dans la clé de chaque programme, la chauffe compilait des
 * variantes que rien ne dessine jamais (mesuré au labo : sol compilé pour
 * sept cônes, dessiné avec deux), puis chaque programme naissait quand
 * même au premier dessin, avec l'attente de sa liaison au milieu d'une
 * image. C'était le lag qui suivait chaque entrée dans une salle.
 *
 * Ici : les racines à compiler SORTENT de la scène le temps de l'appel,
 * réunies dans un paquet, et reviennent à leur place, dans leur ordre.
 * three voit alors les lumières de la scène (celles qui restent) et celles
 * du paquet, chacune une fois — le compte du dessin. Le brouillard et
 * l'environnement restent ceux de la scène, qui est toujours la cible.
 */
import * as THREE from 'three';

/**
 * Sort `racines` de la scène, appelle `fn(paquet)` avec le groupe qui les
 * réunit, et les remet où elles étaient. Les matrices monde ne bougent
 * pas : le paquet n'est jamais mis à jour, et three lit `matrixWorld`
 * tel quel. Sans événements `added`/`removed` — rien n'y est abonné, et un
 * détachement qui ne dure qu'un appel n'est pas un changement de scène.
 */
export function avecPaquet(scene, racines, fn) {
  const ensemble = new Set(racines.filter((o) => o && o.parent === scene));
  if (!ensemble.size) return fn(null);
  const paquet = new THREE.Group();
  paquet.name = 'chauffe';
  const enfants = scene.children;
  scene.children = enfants.filter((o) => !ensemble.has(o));
  for (const o of ensemble) { o.parent = paquet; paquet.children.push(o); }
  try {
    return fn(paquet);
  } finally {
    for (const o of ensemble) o.parent = scene;
    paquet.children.length = 0;
    scene.children = enfants;
  }
}

/**
 * Compile les programmes des `racines` (des enfants directs de `scene`)
 * pour `camera`, dans la cible de rendu courante. Les `invites` sont des
 * objets qui ne sont dans aucune scène — des maillages provisoires qui
 * portent un matériau à compiler pour une géométrie donnée (le pinceau à
 * alpha du survol sur chaque œuvre) : ils entrent dans le paquet le temps
 * de l'appel et en ressortent sans parent. Rend l'ensemble des matériaux
 * compilés (ce que `renderer.compile` rend), ou null.
 */
export function compilerRacines(renderer, scene, racines, camera, { invites = [] } = {}) {
  if (!renderer?.compile || !scene || !camera) return null;
  const libres = invites.filter((o) => o && !o.parent);
  return avecPaquet(scene, racines, (paquet) => {
    if (!paquet) return null;
    for (const o of libres) { o.parent = paquet; paquet.children.push(o); }
    try {
      return renderer.compile(paquet, camera, scene) ?? null;
    } finally {
      for (const o of libres) o.parent = null;
    }
  });
}

/**
 * Les invités du survol : pour chaque maillage sous `racines` que le
 * pinceau à alpha redessine (Survol._dessinerOeuvre : un Mesh avec une
 * géométrie, ni `horsSurvol`, ni squelette), un maillage provisoire qui
 * porte `masque` sur la même géométrie, avec la même matrice monde (le
 * sens des faces en dépend) et la même nature (instancié ou non).
 */
export function invitesMasque(racines, masque) {
  if (!masque) return [];
  const invites = [];
  for (const racine of racines) {
    if (!racine) continue;
    racine.traverse((o) => {
      if (!o.isMesh || !o.geometry || o.userData.horsSurvol || o.isSkinnedMesh) return;
      const inv = o.isInstancedMesh
        ? new THREE.InstancedMesh(o.geometry, masque, 1)
        : new THREE.Mesh(o.geometry, masque);
      inv.matrixAutoUpdate = false;
      inv.matrixWorld.copy(o.matrixWorld);
      inv.matrix.copy(o.matrixWorld);
      invites.push(inv);
    });
  }
  return invites;
}

/**
 * Attend que les programmes de `materiaux` soient LIÉS — sans bloquer.
 *
 * Avec `KHR_parallel_shader_compile`, le pilote lie en parallèle et
 * `compile` revient tout de suite : dessiner avant la fin de la liaison,
 * c'est l'attendre au milieu de l'image. On sonde donc l'état de chaque
 * programme (`isReady`, dix millisecondes entre deux sondes), au plus
 * `delai` millisecondes — la salle s'ouvre de toute façon. Sans
 * l'extension, la liaison a déjà bloqué dans `compile` : rien à attendre.
 *
 * C'est `renderer.compileAsync` de three, moins un piège : un matériau
 * DISPOSÉ pendant l'attente (une œuvre libérée en quittant sa salle) y
 * faisait lever la sonde — « reading 'isReady' of undefined » — et la
 * promesse ne revenait jamais. Ici, ce qui n'a plus de programme est
 * tenu pour prêt : il ne se dessinera pas.
 *
 * Rend true si tout est lié, false au délai (ou sans rien à attendre) —
 * dans les deux cas, ce qui restait à lier l'a été en bloquant, ici
 * (`lierProgrammes`), avant que la promesse ne revienne.
 */
export function attendreProgrammes(renderer, materiaux, { delai = 2000, pas = 10, horloge = null } = {}) {
  // …puis ce qui n'est pas lié se lie, en bloquant, ici plutôt qu'au dessin
  return attendreSansLier(renderer, materiaux, { delai, pas, horloge })
    .then((pret) => { lierProgrammes(renderer, materiaux); return pret; });
}

/**
 * LIE MAINTENANT, en bloquant, tout programme des `materiaux` qui ne
 * l'est pas encore : `getUniforms()` de three fait sa vérification de
 * premier usage (`LINK_STATUS`, journal du programme), celle qui attend
 * la fin de la liaison — au premier dessin d'ordinaire, au milieu d'une
 * image. Après l'attente non bloquante, c'est gratuit ; si l'attente a
 * expiré, ou sans l'extension de liaison parallèle, c'est le reste de la
 * liaison, payé DANS LE NOIR de l'entrée plutôt qu'à la première image.
 * Toutes les variantes de chaque matériau y passent (les comptes de
 * lumières d'un fondu), pas seulement la courante.
 */
export function lierProgrammes(renderer, materiaux) {
  if (!materiaux || !renderer?.properties?.get) return 0;
  let n = 0;
  for (const m of materiaux) {
    const props = renderer.properties.get(m);
    const programmes = props?.programs ? [...props.programs.values()] : (props?.currentProgram ? [props.currentProgram] : []);
    for (const p of programmes) {
      try { if (p?.getUniforms) { p.getUniforms(); n++; } } catch { /* un programme mort : le dessin le dira */ }
    }
  }
  return n;
}

function attendreSansLier(renderer, materiaux, { delai, pas, horloge }) {
  const lot = materiaux ? [...materiaux] : [];
  if (!lot.length || !renderer?.properties?.get) return Promise.resolve(false);
  if (!renderer.extensions?.has?.('KHR_parallel_shader_compile')) return Promise.resolve(false);
  const now = horloge ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const restants = new Set(lot);
  return new Promise((resolve) => {
    const t0 = now();
    const sonder = () => {
      for (const m of restants) {
        let pret = true;
        try { const p = renderer.properties.get(m)?.currentProgram; pret = !p || p.isReady() !== false; } catch { pret = true; }
        if (pret) restants.delete(m);
      }
      if (!restants.size) return resolve(true);
      if (now() - t0 >= delai) return resolve(false);
      setTimeout(sonder, pas);
    };
    sonder();
  });
}

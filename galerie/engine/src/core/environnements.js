/**
 * L'ENVIRONNEMENT — la lumière qui vient de partout.
 *
 * `scene.environment` est ce que les matériaux réfléchissent quand rien
 * d'autre ne les éclaire : c'est lui qui donne aux cadres leur reflet et
 * aux sols cirés leur profondeur. Depuis toujours la galerie utilise
 * `RoomEnvironment` — un studio neutre, procédural, calibré avec le reste
 * de l'éclairage. Il RESTE le défaut : rien ne change sans qu'on le
 * demande.
 *
 * S'y ajoutent deux PANORAMAS RÉELS, rapatriés dans le dépôt (CC0, via le
 * paquet `@pmndrs/assets` qui rediffuse des HDRI Poly Haven — voir
 * `scripts/rapatrie-matieres.mjs` et `engine/assets/provenance.json`) :
 *
 *   « aube »        — un lever de jour froid, doré au ras de l'horizon ;
 *   « appartement » — un intérieur chaud, fenêtres latérales.
 *
 * Dans `content/reglages.json` :  { "environnement": "aube" }
 *
 * Petits fichiers (98 et 178 ko) : un environnement se lit à travers le
 * PMREM, qui le floute par rugosité — la définition ne s'y voit pas, la
 * DIRECTION et la couleur de la lumière, si.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import aubeUrl from '../../assets/environnements/aube.exr';
import appartementUrl from '../../assets/environnements/appartement.exr';

export const ENVIRONNEMENTS = {
  studio: null,                        // le défaut historique : RoomEnvironment
  aube: aubeUrl,
  appartement: appartementUrl
};

/** Les noms offerts, dans l'ordre du menu — « studio » d'abord, le défaut. */
export const NOMS_ENVIRONNEMENTS = Object.keys(ENVIRONNEMENTS);

let _studio = null;
const _cache = new Map();
let _generation = 0;

/**
 * Applique un environnement à la scène. Idempotent par nom, asynchrone
 * sans à-coup : la scène GARDE son environnement courant jusqu'à ce que le
 * nouveau soit prêt — jamais d'écran aux reflets éteints pendant qu'un
 * fichier se charge. Si deux demandes se croisent, seule la dernière
 * gagne (le compteur de génération arbitre).
 */
export function appliquerEnvironnement(app, nom) {
  const cle = ENVIRONNEMENTS[nom] === undefined ? 'studio' : nom;
  const generation = ++_generation;

  const poser = (texture) => {
    if (generation !== _generation) return;   // une demande plus récente a gagné
    app.scene.environment = texture;
  };

  if (cle === 'studio') {
    if (!_studio) {
      const pmrem = new THREE.PMREMGenerator(app.renderer);
      _studio = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      pmrem.dispose();
    }
    poser(_studio);
    return;
  }

  if (_cache.has(cle)) { poser(_cache.get(cle)); return; }

  // le chargeur EXR ne pèse que dans son propre morceau, demandé au premier
  // panorama — une galerie au studio ne le télécharge jamais
  import('three/addons/loaders/EXRLoader.js').then(({ EXRLoader }) => {
    new EXRLoader().load(ENVIRONNEMENTS[cle], (exr) => {
      const pmrem = new THREE.PMREMGenerator(app.renderer);
      const texture = pmrem.fromEquirectangular(exr).texture;
      pmrem.dispose();
      exr.dispose();
      _cache.set(cle, texture);
      poser(texture);
    });
  }).catch(() => { /* hors ligne au premier chargement : le studio reste */ });
}

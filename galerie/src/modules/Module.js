/**
 * Classe de base d'un module de comportement.
 *
 * Cycle de vie :
 *  - constructor(artwork, params, app) : ne rien faire de lourd ici ;
 *  - init()          : appelé une fois, à la création de l'œuvre (scène prête) ;
 *  - onAudioReady()  : appelé quand le bus audio de l'œuvre existe (après le
 *                      déblocage de l'AudioContext et le décodage des stems),
 *                      juste avant le démarrage des sources ;
 *  - update(dt, ctx) : appelé à chaque frame.
 *                      ctx = { app, camera, cameraPos, time, distance } ;
 *  - onClick()       : optionnel — clic sur l'œuvre ; retourner true pour
 *                      consommer l'événement ;
 *  - dispose()       : libérer nœuds audio, objets 3D, listeners.
 */
export class Module {
  constructor(artwork, params, app) {
    this.artwork = artwork;
    this.params = params;
    this.app = app;
  }

  init() {}
  onAudioReady() {}
  update(_dt, _ctx) {}
  dispose() {}
}

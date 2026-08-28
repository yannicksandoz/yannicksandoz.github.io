import { Artwork } from './Artwork.js';

/**
 * Construit (ou reconstruit) la scène complète à partir des configurations :
 * un tableau d'œuvres (works) et un tableau de pièces (rooms, optionnel).
 * Sans rooms, une pièce unique implicite contient toutes les œuvres —
 * compatibilité avec les scènes d'avant le système de pièces.
 *
 * Utilisé au démarrage (main.js) et par l'éditeur lors d'un ré-import JSON.
 */
export function buildScene(app, works, roomConfigs) {
  app.worksConfigs = works;

  let rooms = roomConfigs;
  if (!Array.isArray(rooms) || !rooms.length) {
    rooms = [{
      id: 'galerie',
      title: 'Galerie',
      spawn: [0, 2.2, 14],
      works: works.map((w) => w.id),
      portals: []
    }];
  }
  app.roomConfigs = rooms;

  const byId = new Map(works.map((w) => [w.id, w]));
  const placed = new Set();

  // Les œuvres sont passées à la pièce dès sa construction : l'une d'elles
  // peut ÊTRE sa lumière (voir ombres.cleDepuisOeuvre), et la clé se pose
  // avant que les maillages n'arrivent.
  for (const cfg of rooms) {
    app.rooms.addRoom(cfg, (cfg.works ?? []).map((id) => byId.get(id)).filter(Boolean));
  }

  for (const cfg of rooms) {
    const room = app.rooms.get(cfg.id);
    for (const workId of cfg.works ?? []) {
      const workCfg = byId.get(workId);
      if (!workCfg) {
        console.warn(`[galerie] Pièce « ${cfg.id} » : œuvre inconnue « ${workId} ».`);
        continue;
      }
      if (placed.has(workId)) continue; // une œuvre vit dans une seule pièce
      placed.add(workId);
      app.addArtwork(new Artwork(workCfg, app), room);
    }
    app.rooms.buildPortals(room);
  }

  // œuvres orphelines (non référencées par une pièce) → première pièce
  const first = app.rooms.get(rooms[0].id);
  for (const w of works) {
    if (!placed.has(w.id)) {
      first.config.works = first.config.works ?? [];
      first.config.works.push(w.id);
      app.addArtwork(new Artwork(w, app), first);
      placed.add(w.id);
    }
  }

  app.rooms.setCurrent(rooms[0].id, { instant: true });
}

/** Détruit toute la scène (œuvres + pièces) avant reconstruction. */
export function clearScene(app) {
  for (const artwork of [...app.artworks]) app.removeArtwork(artwork);
  app.rooms.clear();
}

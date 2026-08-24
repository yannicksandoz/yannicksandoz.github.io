/**
 * Schéma de scène et migration.
 *
 * v1 (format d'origine) — rotation mono-axe et échelle uniforme :
 *     { rotationY: -20, scale: 1.4 }
 *
 * v2 — rotation trois axes et échelle non uniforme, nécessaires pour des
 * gizmos complets :
 *     { schemaVersion: 2, rotation: [0, -20, 0], scale: [1.4, 1.4, 1.4] }
 *
 * La migration est **appliquée au chargement**, dans le runtime comme dans
 * l'éditeur : le reste du code ne voit donc jamais que du v2, et vos JSON
 * existants continuent de se charger sans la moindre retouche. L'export
 * écrit du v2.
 */

export const SCHEMA_VERSION = 2;

/** Migre une œuvre vers v2. Fonction pure : ne modifie pas l'entrée. */
export function migrateWork(work) {
  const w = { ...work };

  // rotationY (degrés, scalaire) → rotation [x, y, z]
  if (!Array.isArray(w.rotation)) {
    w.rotation = [0, numberOr(w.rotationY, 0), 0];
  }
  delete w.rotationY;

  // scale scalaire → [x, y, z]
  if (!Array.isArray(w.scale)) {
    const s = numberOr(w.scale, 1);
    w.scale = [s, s, s];
  }

  if (!Array.isArray(w.position)) w.position = [0, 1.8, 0];

  // Pistes : le champ `spatial` accepte plusieurs écritures, on les ramène
  // à deux formes canoniques — false (nappe stéréo, canaux intacts) ou un
  // objet de réglages (source ponctuelle). ABSENT reste absent : le défaut
  // (ponctuelle) est celui du moteur, et l'écrire partout ferait dériver
  // tous les JSON existants au premier export.
  if (Array.isArray(w.stems)) {
    w.stems = w.stems.map((s) => {
      if (!s || s.spatial === undefined) return s;
      const t = { ...s };
      if (t.spatial === false || t.spatial === 'stereo') t.spatial = false;
      else if (t.spatial === true || t.spatial === 'spatial') t.spatial = {};
      else if (typeof t.spatial !== 'object' || t.spatial === null) delete t.spatial;
      return t;
    });
  }
  return w;
}

/** Migre une pièce vers v2 (les portails gagnent aussi une rotation XYZ). */
export function migrateRoom(room) {
  const r = { ...room };
  r.portals = (r.portals ?? []).map((p) => {
    const q = { ...p };
    if (!Array.isArray(q.rotation)) q.rotation = [0, numberOr(q.rotationY, 0), 0];
    delete q.rotationY;
    return q;
  });
  return r;
}

/** Migre un document complet. `works` et `rooms` peuvent être null. */
export function migrateScene(works, rooms) {
  return {
    works: (works ?? []).map(migrateWork),
    rooms: rooms ? rooms.map(migrateRoom) : null
  };
}

/** Version détectée d'un document (absence de marqueur ⇒ v1). */
export function detectVersion(items) {
  if (!Array.isArray(items) || !items.length) return SCHEMA_VERSION;
  const first = items[0];
  if (typeof first.schemaVersion === 'number') return first.schemaVersion;
  // heuristique : le v2 porte des tableaux là où le v1 avait des scalaires
  return Array.isArray(first.rotation) || Array.isArray(first.scale) ? 2 : 1;
}

/** Marque les œuvres exportées à la version courante. */
export function stampVersion(items) {
  return items.map((item, i) => (i === 0
    ? { schemaVersion: SCHEMA_VERSION, ...item }
    : item));
}

function numberOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

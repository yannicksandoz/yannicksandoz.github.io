/** Interpolation lissée entre deux bornes (edge0 peut être > edge1). */
export function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Lissage exponentiel indépendant du framerate. */
export function damp(current, target, lambda, dt) {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

/** Courbe d'accélération/décélération pour les mouvements de caméra. */
export function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Vrai pour une URL absolue (http(s):// ou //hôte) — média distant. */
export function isAbsoluteUrl(path) {
  return typeof path === 'string' && /^(https?:)?\/\//.test(path);
}

/**
 * Résout une source média. Deux formes acceptées partout dans les configs,
 * de façon transparente :
 *  - chemin relatif au dossier de contenu (« assets/photo.jpg ») ;
 *  - URL absolue vers un hôte distant (« https://exemple.org/photo.jpg »),
 *    qui doit autoriser le CORS (voir README).
 */
export function assetUrl(path) {
  if (isAbsoluteUrl(path) || path.startsWith('/')) return path;
  return import.meta.env.BASE_URL + path;
}

/** Transforme un nom de fichier en identifiant sûr (« Mon Œuvre.png » → « mon-oeuvre »). */
export function slugify(name) {
  return name
    .replace(/\.[^.]+$/, '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'objet';
}

/**
 * Comptabilise les chargements en cours pour la barre de progression de
 * l'écran d'accueil. Chaque promesse suivie incrémente le total, puis le
 * compteur « terminé » quand elle se résout (succès ou échec).
 */
export class LoadingTracker {
  constructor() {
    this.total = 0;
    this.done = 0;
    this._listeners = [];
  }

  onChange(fn) {
    this._listeners.push(fn);
  }

  track(promise) {
    this.total++;
    this._emit();
    promise.catch(() => {}).finally(() => {
      this.done++;
      this._emit();
    });
    return promise;
  }

  _emit() {
    for (const fn of this._listeners) fn(this.done, this.total);
  }
}

/**
 * Cet objet est-il de la MATIÈRE — quelque chose que l'on heurte et sur quoi
 * l'on marche ?
 *
 * Une construction voxel est de la matière par nature : un bloc que l'on voit
 * plein et que l'on traverse est la plus déroutante des surprises. Elle est
 * donc solide d'office, et l'on peut l'assouplir au cas par cas
 * (`"walkable": false`) pour une œuvre qu'on veut pouvoir pénétrer. Tout le
 * reste — panneaux, primitives, modèles importés — reste franchissable tant
 * qu'on ne l'a pas déclaré foulable, pour ne pas transformer chaque lanterne
 * en obstacle.
 */
export function isWalkable(config) {
  if (config?.walkable === false) return false;
  if (config?.walkable) return true;
  return config?.model?.type === 'voxel';
}

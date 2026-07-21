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

/** Préfixe les URLs relatives avec la base Vite (déploiement en sous-dossier). */
export function assetUrl(path) {
  if (/^(https?:)?\/\//.test(path) || path.startsWith('/')) return path;
  return import.meta.env.BASE_URL + path;
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

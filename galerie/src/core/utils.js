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

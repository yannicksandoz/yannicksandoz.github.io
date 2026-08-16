/**
 * Compteur d'images — outil de développement, coin bas-droit.
 *
 * S'active depuis menu → Réglages → Développement, et survit au
 * rechargement (localStorage) : quand on chasse une chute de framerate,
 * on recharge souvent, et re-cocher la case à chaque fois ferait perdre
 * la mesure qu'on venait chercher.
 *
 * La mesure est une moyenne courte (fenêtre de 500 ms), rafraîchie deux
 * fois par seconde : assez vive pour voir une pièce lourde faire plonger
 * la courbe, assez stable pour rester lisible. Le nombre de millisecondes
 * par frame accompagne les FPS — c'est lui qui se compare d'une
 * optimisation à l'autre (les FPS saturent au vsync).
 */
const KEY = 'galerie-fps-meter';

export function fpsMeterEnabled() {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}

export function setFpsMeter(app, on) {
  try {
    if (on) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch { /* stockage indisponible : le réglage ne survivra pas, tant pis */ }
  if (on) mountFpsMeter(app);
  else app._fpsMeter?.dispose();
}

export function mountFpsMeter(app) {
  if (app._fpsMeter) return app._fpsMeter;
  const el = document.createElement('div');
  el.id = 'fps-meter';
  el.setAttribute('aria-hidden', 'true'); // du bruit pour un lecteur d'écran
  el.textContent = '— fps';
  document.body.appendChild(el);

  let frames = 0;
  let acc = 0;
  const tick = (dt) => {
    frames++;
    acc += dt;
    if (acc < 0.5) return;
    const fps = frames / acc;
    el.textContent = `${fps.toFixed(0)} fps · ${(1000 * acc / frames).toFixed(1)} ms`;
    // sous 30, le chiffre passe à l'orange : le seuil où l'œil décroche
    el.classList.toggle('fps-low', fps < 30);
    frames = 0;
    acc = 0;
  };
  const off = app.onUpdate(tick);

  const meter = {
    el,
    dispose() {
      off?.();
      el.remove();
      app._fpsMeter = null;
    }
  };
  app._fpsMeter = meter;
  return meter;
}

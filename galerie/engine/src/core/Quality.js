/**
 * Détection des capacités de l'appareil et profil de qualité adaptatif.
 *
 * Trois niveaux de décision :
 *  1. avant création du renderer : mobile vs desktop (antialias, densité) ;
 *  2. après création : lecture du GPU (WEBGL_debug_renderer_info) pour
 *     rétrograder les GPU faibles ;
 *  3. en continu : gouverneur de framerate — si les FPS chutent durablement,
 *     la qualité descend d'un cran (pixelRatio → grain → bloom), jamais
 *     l'inverse (pas d'oscillation).
 */
export class QualityManager {
  constructor() {
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    this.isMobile = coarse || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

    this.profile = this.isMobile
      ? {
          tier: 'mobile',
          antialias: false,
          pixelRatio: Math.min(window.devicePixelRatio || 1, 1.5),
          bloomResScale: 0.25,  // bloom calculé au quart de la résolution
          bloomStrength: 0.8,
          grain: !this.reducedMotion,
          maxStems: 6,
          dustCount: 180,
          maxTextureSize: 1024
        }
      : {
          tier: 'desktop',
          antialias: true,
          pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
          bloomResScale: 0.5,
          bloomStrength: 0.9,
          grain: !this.reducedMotion,
          maxStems: 24,
          dustCount: 450,
          maxTextureSize: 2048
        };
    this.profile.reducedMotion = this.reducedMotion;
    this.profile.isMobile = this.isMobile;

    this._fps = 60;
    this._acc = 0;
  }

  /** Affinage une fois le renderer créé : GPU manifestement faible → cran mobile. */
  refineWithRenderer(renderer) {
    let gpu = '';
    try {
      const gl = renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      if (ext) gpu = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '');
    } catch { /* info GPU indisponible : on garde le profil courant */ }
    this.gpu = gpu;

    const weak = /SwiftShader|llvmpipe|Mali-[GT]?[0-7]\d\b|Adreno \(TM\) [1-5]|PowerVR/i.test(gpu);
    if (weak && this.profile.tier === 'desktop') {
      Object.assign(this.profile, {
        tier: 'desktop-low',
        pixelRatio: Math.min(window.devicePixelRatio || 1, 1.25),
        bloomResScale: 0.25,
        maxStems: 8,
        dustCount: 200
      });
      console.info('[galerie] GPU modeste détecté, profil réduit :', gpu);
    }
  }

  /**
   * Gouverneur : appelé chaque frame par l'App. Moyenne glissante des FPS ;
   * sous 27 fps pendant une fenêtre de 3 s, on rétrograde d'un cran.
   */
  tick(dt, app) {
    if (dt > 0) this._fps += ((1 / dt) - this._fps) * 0.05;
    this._acc += dt;
    if (this._acc < 3) return;
    this._acc = 0;
    if (this._fps >= 27) return;
    this._downgrade(app);
  }

  _downgrade(app) {
    const p = this.profile;
    if (p.pixelRatio > 1) {
      p.pixelRatio = Math.max(1, p.pixelRatio - 0.25);
      app.renderer.setPixelRatio(p.pixelRatio);
      app.composer.setPixelRatio(p.pixelRatio);
      console.info(`[galerie] FPS bas (${this._fps.toFixed(0)}) → pixelRatio ${p.pixelRatio}`);
    } else if (p.grain) {
      p.grain = false;
      app.grainPass.enabled = false;
      console.info('[galerie] FPS bas → grain désactivé');
    } else if (app.bloom.enabled) {
      app.bloom.enabled = false;
      console.info('[galerie] FPS bas → bloom désactivé');
    }
    this._fps = 45; // laisse le temps à la mesure de se re-stabiliser
  }
}

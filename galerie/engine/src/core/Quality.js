/**
 * Détection des capacités de l'appareil et profil de qualité adaptatif.
 *
 * Trois niveaux de décision :
 *  1. avant création du renderer : mobile vs desktop (échantillons, densité) ;
 *  2. après création : lecture du GPU (WEBGL_debug_renderer_info) pour
 *     rétrograder les GPU faibles ;
 *  3. en continu : gouverneur de framerate — si les FPS chutent durablement,
 *     la qualité descend d'un cran (MSAA → occlusion ambiante → pixelRatio →
 *     grain → apparitions → ombres → bloom), jamais l'inverse
 *     (pas d'oscillation).
 */
export class QualityManager {
  constructor() {
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    this.isMobile = coarse || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

    this.profile = this.isMobile
      ? {
          tier: 'mobile',
          // MSAA de la passe de scène (c'est ELLE qui lisse, voir App) :
          // deux échantillons sur mobile — la bande passante y est le mur.
          msaa: 2,
          gtao: false,          // l'occlusion ambiante coûte un G-buffer
          anisotropy: 4,
          pixelRatio: Math.min(window.devicePixelRatio || 1, 1.5),
          bloomResScale: 0.25,  // bloom calculé au quart de la résolution
          bloomStrength: 0.8,
          grain: !this.reducedMotion,
          maxStems: 6,
          // convolution HRTF : chère PAR SOURCE — au-delà, les voies
          // retombent sur equalpower (voir Spatialisation)
          maxHRTF: 4,
          dustCount: 180,
          maxTextureSize: 1024,
          shadows: false,
          shadowMapSize: 1024,
          // SOURCES ÉTENDUES (corniches) : aucune sur mobile. Mesuré au
          // belvédère, quatre bandeaux de 46 m coûtaient 26 % de l'image —
          // chaque pixel de chaque surface y intègre une LTC par lampe, et
          // le cube en présente beaucoup. Le TRAIT, lui, ne coûte presque
          // rien : on garde donc la ligne de lumière, on retire la source.
          // La salle garde sa lumière clé et ses ponctuelles : rien
          // n'éteint, c'est le dégradé sur le mur qui s'en va.
          sourcesEtendues: 0,
          // lampes de poche intégrées par pixel : voir budgetLampes (ombres.js)
          lampesProches: { points: 4, cones: 3 },
          // aucun accent ne projette sur téléphone : les ombres y sont
          // déjà coupées (shadows: false)
          projecteursOmbre: 0,
          envIntensity: 0.5
        }
      : {
          tier: 'desktop',
          msaa: 4,     // arêtes franches sur un écran de bureau
          gtao: true,  // occlusion ambiante (GTAO), à demi-résolution
          anisotropy: 16,  // sols nets aux angles rasants (parquet, sable)
          pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
          bloomResScale: 0.5,
          bloomStrength: 0.9,
          grain: !this.reducedMotion,
          maxStems: 24,
          maxHRTF: 16,
          dustCount: 450,
          maxTextureSize: 2048,
          shadows: true,
          // 4096 : la fenêtre d'ombre couvre désormais la coque entière
          // (jusqu'à 64 m à l'entrée) — à 2048, l'ombre d'un pied de banc
          // y retombait dans un texel de 3 cm. La carte ne se redessine
          // qu'à 30 Hz et les ombres n'existent pas sur mobile : le coût
          // reste borné au bureau, où la mémoire ne manque pas.
          shadowMapSize: 4096,
          sourcesEtendues: 8,
          lampesProches: { points: 6, cones: 6 },
          // DANS UNE PIÈCE CLOSE, ce sont les accents qui projettent : une
          // coque fermée n'a plus de soleil et une source étendue (la
          // corniche) ne projette jamais. Trois cartes de 1024 au plus,
          // redessinées à la cadence à la demande — voir ombres.budgetLampes.
          projecteursOmbre: 3,
          envIntensity: 0.5
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
        msaa: 0,     // GPU modeste : la netteté ne vaut pas la chute d'images
        gtao: false,
        anisotropy: 4,
        bloomResScale: 0.25,
        maxStems: 8,
        maxHRTF: 6,
        dustCount: 200,
        shadows: false,
        shadowMapSize: 1024
      });
      console.info('[galerie] GPU modeste détecté, profil réduit :', gpu);
    }
  }

  /**
   * Gouverneur : appelé chaque frame par l'App. Moyenne glissante des FPS,
   * décision toutes les 3 s, DEUX étages :
   *   — sous 50 fps, seule la FINITION est sacrifiée (anticrénelage, puis
   *     occlusion ambiante). Un écran fluide (ProMotion, 120 Hz) rend 35 fps
   *     pénibles bien avant le seuil de survie — attendre 27 fps, c'est
   *     laisser le visiteur dans la mélasse en trouvant que « ça va » ;
   *   — sous 27 fps, la survie : densité, grain, apparitions, ombres, bloom.
   * Jamais l'inverse (pas d'oscillation).
   */
  tick(dt, app) {
    if (dt > 0) this._fps += ((1 / dt) - this._fps) * 0.05;
    this._acc += dt;
    if (this._acc < 3) return;
    this._acc = 0;
    if (this._fps >= 50) {
      this._remonter(app);
      return;
    }
    if (this._finition(app)) {
      this._fps = 55; // laisse la mesure se re-stabiliser avant le cran suivant
      return;
    }
    if (this._fps >= 27) return;
    this._downgrade(app);
  }

  /**
   * LA REMONTÉE — le gouverneur cesse d'être une trappe.
   *
   * Il ne descendait que : une salle lourde (le belvédère d'avant sa cure)
   * coupait l'anticrénelage puis l'occlusion ambiante, et TOUT LE RESTE DE
   * LA VISITE restait dégradé — au jardin, à 120 fps, plus d'occlusion de
   * contact, et les objets semblaient flotter. Désormais, après 12 s
   * STABLES au-dessus de 72 fps, la FINITION remonte d'un cran (GTAO,
   * puis MSAA), jamais plus haut que le profil d'origine. L'hystérésis est
   * large — on remonte à 72, on descend à 50 — et un cran repris qui
   * refait chuter redescendra par le chemin normal : pas d'oscillation,
   * seulement une porte de sortie. Les crans de SURVIE (densité, grain,
   * ombres…) ne remontent pas : y avoir touché dit une machine qui n'a
   * pas les moyens de la finition.
   */
  _remonter(app) {
    if (this._fps < 72) { this._stable = 0; return; }
    this._stable = (this._stable ?? 0) + 3;
    if (this._stable < 12) return;
    this._stable = 0;
    const p = this.profile;
    const origine = this._origine ??= { msaa: p.msaa || (this.isMobile ? 2 : 4),
      gtao: !this.isMobile && p.tier === 'desktop' };
    if (origine.gtao && app.gtao && !app.gtao.enabled) {
      app.gtao.enabled = true;
      p.gtao = true;
      console.info('[galerie] FPS rétablis → occlusion ambiante réactivée');
      this._fps = 60; // laisse la mesure encaisser le cran repris
      return;
    }
    if (p.msaa < origine.msaa) {
      p.msaa = origine.msaa;
      app.setMsaa?.(p.msaa);
      console.info(`[galerie] FPS rétablis → anticrénelage ×${p.msaa}`);
      this._fps = 60;
    }
  }

  /** Étage 1 — la finition, cran par cran. Rend true si un cran a été pris. */
  _finition(app) {
    const p = this.profile;
    this._origine ??= { msaa: p.msaa, gtao: !!p.gtao };
    // L'anticrénelage d'abord : il coûte de la bande passante à chaque
    // pixel, et une image nette mais crénelée reste plus lisible qu'une
    // image lissée et molle (baisser la densité, elle, floute tout).
    if (p.msaa > 2) {
      p.msaa = 2;
      app.setMsaa?.(2);
      console.info(`[galerie] FPS bas (${this._fps.toFixed(0)}) → anticrénelage ×2`);
      return true;
    }
    if (p.msaa > 0) {
      p.msaa = 0;
      app.setMsaa?.(0);
      console.info(`[galerie] FPS bas (${this._fps.toFixed(0)}) → anticrénelage désactivé`);
      return true;
    }
    if (app.gtao?.enabled) {
      app.gtao.enabled = false;
      p.gtao = false;
      console.info(`[galerie] FPS bas (${this._fps.toFixed(0)}) → occlusion ambiante désactivée`);
      return true;
    }
    return false;
  }

  /** Étage 2 — la survie. */
  _downgrade(app) {
    const p = this.profile;
    if (p.pixelRatio > 1) {
      p.pixelRatio = Math.max(1, p.pixelRatio - 0.25);
      app.renderer.setPixelRatio(p.pixelRatio);
      app.composer.setPixelRatio(p.pixelRatio);
      console.info(`[galerie] FPS bas (${this._fps.toFixed(0)}) → pixelRatio ${p.pixelRatio}`);
    } else if (p.grain) {
      p.grain = false;
      app.sortie.grainActif = false;
      console.info('[galerie] FPS bas → grain désactivé');
    } else if (app.vistas?.live) {
      app.vistas.live = false;
      console.info('[galerie] FPS bas → apparitions figées');
    } else if (p.shadows) {
      p.shadows = false;
      app.setShadowsEnabled?.(false);
      console.info('[galerie] FPS bas → ombres désactivées');
    } else if (app.sortie.bloomActif) {
      // le bloom n'est plus une passe : c'est la sortie qui décide de lui
      // demander sa fleur ou non (voir PasseSortie.js)
      app.sortie.bloomActif = false;
      console.info('[galerie] FPS bas → bloom désactivé');
    }
    this._fps = 45; // laisse le temps à la mesure de se re-stabiliser
  }
}

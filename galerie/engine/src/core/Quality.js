/**
 * UNE SEULE IMAGE, et ce qui l'entoure.
 *
 * Longtemps, la galerie a choisi un profil selon l'appareil — bureau ou
 * téléphone — puis un gouverneur en retirait des morceaux quand les images
 * tombaient : deux visiteurs ne voyaient pas la même galerie. Désormais :
 *  1. l'image est UNIQUE (`unique`) : celle qui tient sur un téléphone,
 *     mesurée sur un iPhone. Seule la DENSITÉ suit l'écran ;
 *  2. l'image ENRICHIE (`riche`) — ombres, occlusion, quatre échantillons,
 *     sources étendues, reflets vivants — est un CHOIX du visiteur, mémorisé,
 *     proposé à l'arrivée quand la machine se montre à l'aise (ui/ImageRiche) ;
 *  3. le gouverneur n'est plus qu'un filet sur la densité (crans.js) ;
 *  4. le mode ÉCONOME reste, au choix du visiteur, pour une machine qui peine.
 * Le son est le même partout.
 */
/* -------------------------------------------------------- la cadence --- */

/** Les taux de rafraîchissement qu'on rencontre, pour y accrocher une mesure. */
const TAUX_CONNUS = [60, 72, 75, 90, 100, 120, 144, 165, 240];

/**
 * Le taux de rafraîchissement de l'écran, déduit de l'INTERVALLE MINIMAL
 * observé entre deux images (en secondes).
 *
 * Le navigateur cale chaque image sur le balayage : les intervalles sont
 * des multiples de la période de l'écran. Tant qu'UNE image sur la fenêtre
 * tient dans une période, le minimum la révèle — à 70 images par seconde
 * sur un écran à 120 Hz, les intervalles alternent 8,3 et 16,7 ms, et le
 * minimum dit 120. On accroche la mesure au taux connu le plus proche (à
 * 12 % près) ; hors de tout taux connu, ou sans mesure, on répond 60 — la
 * valeur qui ne change rien au comportement d'avant.
 *
 * La limite est franche et assumée : si aucune image ne tient jamais dans
 * une période (une machine très en dessous), le minimum vaut deux périodes
 * et l'on croit l'écran deux fois plus lent qu'il n'est. On n'y perd rien
 * — le gouverneur agit alors comme avant, sous 50 images.
 */
export function estimerHz(periodeMin) {
  if (!Number.isFinite(periodeMin) || periodeMin <= 0) return 60;
  const brut = 1 / periodeMin;
  let meilleur = null;
  for (const t of TAUX_CONNUS) {
    if (Math.abs(brut - t) / t <= 0.12 && (meilleur === null || Math.abs(brut - t) < Math.abs(brut - meilleur))) {
      meilleur = t;
    }
  }
  return meilleur ?? 60;
}

/**
 * La cadence VISÉE pour un écran donné : 85 % de son taux, jamais moins de
 * 50. À 60 Hz c'est 51 — le seuil de finition d'avant, à une image près ;
 * à 120 Hz c'est 102 : en dessous, un écran ProMotion montre chaque
 * saccade, et c'est là que la densité a quelque chose à donner.
 */
export function cibleImages(hz) {
  return Math.max(50, Math.round(0.85 * (Number(hz) || 60)));
}

import { FINITION, SURVIE, ECONOME_CRANS, prochainCran, etatDe, densiteSuivante, ECONOME, lireEconome, ecrireEconome, lireGouverneur, lireProfil, lireRiche } from './crans.js';

export class QualityManager {
  constructor() {
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const search = typeof location !== 'undefined' ? location.search : '';
    const stockage = typeof localStorage !== 'undefined' ? localStorage : null;
    // `?profil=unique|riche` force le profil pour cette page (mesures) ; le
    // profil est une IMAGE, pas un appareil : le HUD, les gestes et les
    // commandes suivent le vrai appareil
    this.force = lireProfil(search);
    this.isMobile = coarse || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const dpr = window.devicePixelRatio || 1;
    // la densité est la seule chose qui suive l'écran : 1,25 au doigt (une
    // dalle à 3× n'a pas le GPU de ses pixels), 2 à la souris, affûtée par
    // la sortie quand elle rend sous le natif
    const densite = Math.min(dpr, this.isMobile ? 1.25 : 2);

    // L'IMAGE UNIQUE — la même pour tous, celle qui tient sur un téléphone :
    // mesurée sur un iPhone à 56-60 images par seconde là où l'ancienne
    // image de bureau tombait à 28. Le gouverneur n'y touche pas (crans.js).
    const unique = {
          tier: 'unique',
          // MSAA de la passe de scène (c'est ELLE qui lisse, voir App) :
          // deux échantillons sur mobile — la bande passante y est le mur.
          // LA PERFORMANCE D'ABORD sur téléphone (mesuré sous profil mobile,
          // entrée : la densité 1,5 → 1,25 rend un quart de l'image). Le
          // multi-échantillonnage ×2 reste : mesuré en rasterisation
          // logicielle il coûtait un tiers, mais un GPU de téléphone (à
          // tuiles) le résout presque pour rien, et sans lui les arêtes
          // fines (un banc, une lisière) scintillent — le gouverneur le
          // coupe de lui-même sous 50 images par seconde.
          msaa: 2,
          gtao: false,          // l'occlusion ambiante coûte un G-buffer
          anisotropy: 16,       // sols nets aux angles rasants : ne coûte pas de pixels
          pixelRatio: densite,
          // L'AFFÛTAGE (PasseSortie.affuter) : à densité 1,25 sur une dalle
          // à 3×, l'image est molle. Quatre lectures dans la tuile déjà
          // chargée, dans la passe de sortie déjà payée — c'est le seul
          // endroit où la netteté ne coûte pas de pixels. À pleine densité,
          // rien à affûter.
          nettete: densite < dpr ? 0.5 : 0,
          // le masque du liseré de survol : LE MÊME qu'au bureau — à la
          // résolution de l'image, multi-échantillonné ×4, occulté par la
          // pièce. Mesuré sur un iPhone réel aux archives : sans MSAA ni
          // profondeur, le liseré partait en image fantôme décalée ; avec
          // les réglages de bureau, sur le même téléphone, il colle à la
          // stèle. L'hypothèse « WebKit résout mal une cible MSAA à
          // profondeur » était fausse ; c'est la version simple qui l'est.
          survolEchelle: 1,
          survolEchantillons: 4,
          survolOcclusion: true,
          bloomResScale: 0.25,  // bloom calculé au quart de la résolution
          bloomStrength: 0.5,
          // LE GRAIN, seulement à pleine densité : sur un téléphone qui rend
          // à 1,25 pour une dalle à 3×, le grain agrandi puis affûté par la
          // sortie faisait une image « moche » — du bruit, pas un grain
          grain: !this.reducedMotion && !(densite < dpr),
          // LE MÊME SON PARTOUT : six voix (une par œuvre, voir
          // Spatialisation), quatre en HRTF — la convolution est chère PAR
          // SOURCE, au-delà les voies retombent sur equalpower
          maxStems: 6,
          maxHRTF: 4,
          dustCount: 450,       // la poussière ne coûte rien
          maxTextureSize: 2048,
          isfResolution: 512,   // les écrans ISF pleins : à mesurer sur téléphone (sonde)
          shadows: false,
          shadowMapSize: 1024,
          // SOURCES ÉTENDUES (corniches) : aucune sur mobile. Mesuré au
          // belvédère, quatre bandeaux de 46 m coûtaient 26 % de l'image —
          // chaque pixel de chaque surface y intègre une LTC par lampe, et
          // le cube en présente beaucoup. Le TRAIT, lui, ne coûte presque
          // rien : on garde donc la ligne de lumière, on retire la source.
          // La salle garde sa lumière clé et ses ponctuelles : rien
          // n'éteint, c'est le dégradé sur le mur qui s'en va.
          // …DEUX tout de même, depuis la mesure (sonde:lumiere, iPhone émulé) :
          // le labo, éclairé par ses corniches, y rendait 7 % de luminance
          // moyenne contre 15 au bureau. Deux bandeaux, les plus proches ; le
          // gouverneur les retire au cran « etendues » si l'image ne suit pas.
          sourcesEtendues: 2,
          // Lampes intégrées par pixel : voir budgetLampes (ombres.js).
          // Les corniches ne prennent plus d'emplacement de cône — elles
          // sont devenues des lignes analytiques (voir lignes-lumiere.js).
          // Essayé de rendre ces emplacements aux accents des œuvres, en
          // montant à {5, 4} : mesuré, cela ne rapporte RIEN (le labo passe
          // de 28,3 à 28,4 de clarté moyenne, le belvédère de 48,2 à 48,4)
          // pour deux lampes de plus intégrées sur chaque pixel. Ce qui
          // manque encore dans ces deux salles n'est pas un accent de plus,
          // c'est qu'elles sont vastes et sans plafond.
          lampesProches: { points: 4, cones: 3 },
          // les lignes de lumière (corniches analytiques) intégrées par
          // pixel : DOUZE, les plus proches — la sonde d'ambiance porte les
          // autres (lignes-lumiere.reglerBudgetLignes). À huit, le labo
          // (quatre corniches, pliées en plusieurs segments par le voile
          // fluide) perdait des segments entiers : mesuré sur iPhone émulé,
          // 7,0 % de luminance moyenne contre 10,8 au bureau dans le même
          // cadre ; à douze, 11,2. Le gouverneur redescend à huit au cran
          // « etendues » si l'image ne suit pas.
          lignesProches: 12,
          // aucun accent ne projette sur téléphone : les ombres y sont
          // déjà coupées (shadows: false)
          projecteursOmbre: 0,
          envIntensity: 0.5,
          // LA SONDE DE REFLETS (reflets.js) : un cube de 64 px, une face
          // toutes les deux images — le reflet est flou de toute façon — et
          // PARESSEUSE : une photo à l'entrée, puis seulement tous les 2,5 m
          // de marche. Mesuré sous profil mobile au belvédère (287
          // maillages), la sonde continue coûtait les deux tiers de l'image :
          // chaque face est un rendu complet de la salle, et à 64 px c'est
          // le compte de maillages qui paie, pas les pixels.
          // Et SIMPLE au pixel : un niveau de flou au lieu de deux mélangés,
          // pas de rebond (la sonde d'ambiance le porte) — quatre lectures
          // au lieu de seize. Mesuré à l'entrée, les reflets pleins
          // coûtaient 13 % de l'image.
          reflets: { resolution: 64, cadence: 2, pas: 2.5, simple: true, rebond: 0 }
        };
    // L'IMAGE ENRICHIE (`riche`) : ce que l'image unique a laissé pour tenir
    // sur un téléphone — au choix du visiteur, mémorisé, proposé quand la
    // machine se montre à l'aise (ui/ImageRiche.js). Même son, même densité.
    const riche = {
          ...unique,
          tier: 'riche',
          msaa: 4,     // arêtes franches sur un écran de bureau
          gtao: true,  // occlusion ambiante (GTAO), à demi-résolution
          // LA DENSITÉ : native au départ, ADAPTATIVE ensuite. Sur un
          // portable Retina (densité 2, 120 Hz), l'image tenait à 60-80
          // images par seconde : le compte d'appels est dérisoire (85 par
          // image à l'entrée), tout part dans le PIXEL — six millions par
          // image, chacun intégrant huit sources étendues, douze lampes,
          // seize lignes, seize lectures de reflets, quatre échantillons. À
          // 1,5, c'est 44 % de pixels en moins (mesuré : −39 % d'image), la
          // seule économie de cette taille qui ne touche ni la lumière ni
          // l'anticrénelage. Mais une machine de bureau qui tient les 120
          // en natif n'a aucune raison d'y renoncer : c'est le GOUVERNEUR
          // qui descend à 1,5 — affûté par la sortie, comme sur téléphone —
          // quand l'écran est rapide et que l'image ne suit pas (voir
          // `_densite`). Un écran à densité 1 ne voit jamais rien changer.
          bloomResScale: 0.5,
          bloomStrength: 0.55,
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
          envIntensity: 0.5,
          reflets: { resolution: 128, cadence: 1 },
          // les corniches, huit ; et les lignes de lumière au budget de
          // bureau (voir lignes-lumiere.js) — le reste est celui de l'image unique
          sourcesEtendues: 8,
          lampesProches: { points: 6, cones: 6 },
          lignesProches: undefined
        };
    // l'image enrichie : demandée par l'adresse, sinon par la mémoire
    this.riche = this.force ? this.force === 'riche' : lireRiche(search, stockage);
    this.profile = this.riche ? riche : unique;
    // LE MODE ÉCONOME, au choix du visiteur (menu, ou ?eco), mémorisé :
    // tout en bas tout de suite, avant même le renderer — rien n'est créé
    // pour être jeté trois secondes plus tard
    this.econome = !this.force && lireEconome(search, stockage);
    // figé par `?gouverneur=0` (sondes de mesure d'image) — voir crans.js
    this.gouverneur = lireGouverneur(search);
    if (this.econome) {
      Object.assign(this.profile, ECONOME, { tier: `${this.profile.tier}-econome`,
        pixelRatio: Math.min(window.devicePixelRatio || 1, 1) });
    }
    this.profile.reducedMotion = this.reducedMotion;
    this.profile.isMobile = this.isMobile;

    this._fps = 60;
    this._acc = 0;
    this._aise = 0;   // secondes de suite au-dessus de la cadence visée (voir aLaMarge)
  }

  /**
   * Une fois le renderer créé : le nom du GPU, pour le cartouche et pour la
   * proposition de l'image enrichie (un GPU manifestement faible ne se la
   * voit pas proposer). L'image, elle, ne change pas : elle est unique.
   */
  refineWithRenderer(renderer) {
    let gpu = '';
    try {
      const gl = renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      if (ext) gpu = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '');
    } catch { /* info GPU indisponible */ }
    this.gpu = gpu;
    this.gpuFaible = /SwiftShader|llvmpipe|Mali-[GT]?[0-7]\d\b|Adreno \(TM\) [1-5]|PowerVR/i.test(gpu);
  }

  /**
   * La machine est-elle À L'AISE : au-dessus de la cadence visée de son
   * écran depuis `secondes` secondes de suite ? C'est ce qui vaut à un
   * visiteur la proposition de l'image enrichie — une mesure sur l'image
   * qu'il regarde, pas une supposition sur son matériel.
   */
  aLaMarge(secondes = 6) {
    return this._aise >= secondes;
  }

  /**
   * Gouverneur : appelé chaque frame par l'App. Moyenne glissante des FPS,
   * décision toutes les 3 s. UN FILET SUR LA DENSITÉ SEULE (voir crans.js) :
   * il ne touche jamais à ce qui se voit — lumière, ombres, écrans,
   * apparitions, grain, bloom — ni au son. Trois paliers de densité :
   *   — sous la CADENCE VISÉE de l'écran (85 % de son taux, voir
   *     `cibleImages` : 102 sur un 120 Hz, 51 sur un 60 Hz) pendant deux
   *     décisions (6 s), la densité descend de la native à 1,5, affûtée
   *     par la sortie — seulement s'il y a des pixels à rendre ;
   *   — sous 50 fps, la densité 1 ;
   *   — sous 27 fps, la densité sous le natif, jusqu'à 0,75.
   * Jamais l'inverse : une densité reprise qui refait chuter oscillerait,
   * et une image un peu douce vaut mieux qu'une image qui respire.
   *
   * Le taux de l'écran se lit dans l'intervalle MINIMAL entre deux images
   * (voir `estimerHz`) ; on garde le plus haut jamais vu, un écran ne
   * change pas de taux en cours de visite.
   */
  tick(dt, app) {
    if (this.gouverneur === false) return; // figé (?gouverneur=0) : rien ne bouge
    if (dt > 0) this._fps += ((1 / dt) - this._fps) * 0.05;
    if (dt > 1 / 250) this._periode = Math.min(this._periode ?? Infinity, dt);
    this._acc += dt;
    if (this._acc < 3) return;
    this._acc = 0;
    this._hz = Math.max(this._hz ?? 60, estimerHz(this._periode));
    this._periode = Infinity;
    const cible = cibleImages(this._hz);
    if (this._fps >= cible) { this._sousCible = 0; this._aise += 3; return; }
    this._aise = 0;
    // sous la cadence visée : six secondes de patience — une salle qui
    // charge fait chuter l'image un instant. Sous 50, plus de patience.
    this._sousCible = (this._sousCible ?? 0) + 1;
    if ((this._sousCible >= 2 || this._fps < 50) && this._densite(app)) {
      this._fps = cible; // laisse la mesure se re-stabiliser
      return;
    }
    if (this._fps >= 50) return;
    if (this._finition(app)) {
      this._fps = 55; // laisse la mesure se re-stabiliser avant le cran suivant
      return;
    }
    if (this._fps >= 27) return;
    this._downgrade(app);
  }

  /**
   * Étage 0 — LA DENSITÉ ADAPTATIVE. De la densité native à 1,5, affûtée
   * par la sortie (le même affûtage que sur téléphone), une seule fois, et
   * seulement s'il y a quelque chose à rendre : un écran à densité 1 ou
   * déjà sous 1,5 ne change pas. Ne remonte jamais — à 1,5 plafonné par le
   * balayage de l'écran, rien ne dit si le natif tiendrait, et l'essayer
   * ferait osciller l'image toutes les quinze secondes. Rend true si le
   * cran a été pris.
   */
  _densite(app) {
    const p = this.profile;
    if (!(p.pixelRatio > 1.5) || !app?.renderer) return false;
    p.pixelRatio = 1.5;
    p.nettete = 0.5;
    app.renderer.setPixelRatio(1.5);
    app.composer?.setPixelRatio(1.5);
    if (app.sortie) app.sortie.nettete = 0.5;
    console.info(`[galerie] ${this._fps.toFixed(0)} images sur un écran à ${this._hz} Hz → densité 1,5 affûtée`);
    return true;
  }

  /**
   * Étage 1 — la finition (voir crans.js : la densité ramenée à 1). Rend
   * true si un cran a été pris.
   */
  _finition(app) {
    const p = this.profile;
    const cran = prochainCran(etatDe(p, app), FINITION);
    if (!cran) return false;
    this._appliquer(cran.cle, app);
    console.info(`[galerie] FPS bas (${this._fps.toFixed(0)}) → ${cran.dit}`);
    return true;
  }

  /** Étage 2 — la survie (voir crans.js : la densité sous le natif, jusqu'à 0,75). */
  _downgrade(app) {
    const cran = prochainCran(etatDe(this.profile, app), SURVIE);
    if (cran) {
      this._appliquer(cran.cle, app);
      console.info(`[galerie] FPS bas (${this._fps.toFixed(0)}) → ${cran.dit}`);
    }
    this._fps = 45; // laisse le temps à la mesure de se re-stabiliser
  }

  /** Applique un cran au profil et à l'app — le seul endroit qui touche au renderer.
   *  Les crans d'image (msaa, gtao, ombres…) ne servent plus qu'au mode économe. */
  _appliquer(cle, app) {
    const p = this.profile;
    switch (cle) {
      case 'msaa2': p.msaa = 2; app.setMsaa?.(2); break;
      case 'msaa0': p.msaa = 0; app.setMsaa?.(0); break;
      case 'gtao': if (app.gtao) app.gtao.enabled = false; p.gtao = false; break;
      case 'ombres': p.shadows = false; app.setShadowsEnabled?.(false); break;
      case 'isf': p.isfResolution = 256; app.setIsfResolution?.(256); break;
      case 'etendues': p.sourcesEtendues = 0; app.setSourcesEtendues?.(0); app.setBudgetLignes?.(8); break;
      case 'apparitions': if (app.vistas) app.vistas.live = false; break;
      case 'densite1': this._poserDensite(app, 1); break;
      case 'densite': this._poserDensite(app, densiteSuivante(p.pixelRatio)); break;
      case 'grain': p.grain = false; if (app.sortie) app.sortie.grainActif = false; break;
      case 'bloom': if (app.sortie) app.sortie.bloomActif = false; break;
      default:
    }
  }

  /** La densité, affûtée par la sortie dès qu'elle passe sous le natif. */
  _poserDensite(app, valeur) {
    const p = this.profile;
    p.pixelRatio = valeur;
    app.renderer?.setPixelRatio(valeur);
    app.composer?.setPixelRatio(valeur);
    if (app.sortie && !(p.nettete > 0)) { p.nettete = 0.5; app.sortie.nettete = 0.5; }
  }

  /**
   * LE MODE ÉCONOME, à chaud : tous les crans d'un coup, mémorisé pour les
   * prochaines visites (le profil part alors d'en bas, voir le constructeur).
   */
  activerEconome(app) {
    this.econome = true;
    ecrireEconome(true, typeof localStorage !== 'undefined' ? localStorage : null);
    const p = this.profile;
    let cran;
    while ((cran = prochainCran(etatDe(p, app), ECONOME_CRANS))) this._appliquer(cran.cle, app);
    p.tier = p.tier.endsWith('-econome') ? p.tier : `${p.tier}-econome`;
    console.info('[galerie] mode économe : image à densité 1 affûtée, sans anticrénelage, occlusion, ombres ni bloom');
  }

  /** Quitter le mode économe : la mémoire s'efface, le profil d'origine revient au prochain chargement. */
  desactiverEconome() {
    this.econome = false;
    ecrireEconome(false, typeof localStorage !== 'undefined' ? localStorage : null);
  }
}

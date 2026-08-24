import * as THREE from 'three';

/**
 * Spatialisation binaurale — une VOIE par piste, au cœur du moteur.
 *
 * Longtemps, la spatialisation a été un module optionnel (`HRTFPanner`) :
 * une seule œuvre le déclarait, et pour toutes les autres « approcher »
 * voulait seulement dire « plus fort » — un GainNode n'a pas d'oreilles.
 * Elle devient ici la règle : chaque piste est une source ponctuelle
 * placée dans l'espace, sauf à demander explicitement le contraire.
 *
 * La voie d'une piste sépare DEUX contributions qui n'ont rien à se dire :
 *
 *   gainStem ─ entree ─┬─ panner (HRTF, direction PURE) ── wet ─┐
 *                      └─ dry ────────────────────────────────┴─ distGain ─ bus
 *
 *   • le PANNER ne porte que la DIRECTION : son `rolloffFactor` est à zéro,
 *     il n'atténue jamais. C'est lui qui fait traverser le champ stéréo à
 *     la source quand on pivote — l'écoutant, lui, est déjà orienté chaque
 *     frame par `AudioEngine.updateListener` ;
 *   • `distGain` ne porte que la DISTANCE : modèle « inverse » classique
 *     (refDistance / rolloff / maxDistance, par piste), élevé à la
 *     puissance `poidsDistance`. À 1, l'atténuation est physique ; plus
 *     bas, elle s'aplatit — une source proche mais de côté reste alors
 *     nettement latéralisée au lieu d'être simplement forte.
 *
 * Faire porter la distance au panner (son métier d'origine) aurait remis
 * les deux courbes dans le même nœud, et l'histoire du projet dit où cela
 * mène : `SpatialCrossfade` × `StemMixer` multipliaient déjà leurs
 * décroissances, et les œuvres devenaient muettes au carré de la portée
 * voulue. Une contribution, un nœud.
 *
 * Trois pondérations, chacune résolue piste → œuvre → galerie :
 *   • `poidsDistance`  (défaut 1) : force de l'atténuation par distance ;
 *   • `poidsDirection` (défaut 1) : part du signal qui passe par le panner
 *     (fondu à puissance constante wet/dry) — 0 rend la voie omnidirective ;
 *   • `largeur`        (défaut 1) : EXAGÉRATION D'AZIMUT. L'angle entre le
 *     regard et la source est multiplié avant d'être donné au panner : à
 *     1,5, une œuvre à 20° du nez s'entend à 30°. Au-delà du réalisme,
 *     mais l'image s'élargit et se lit — c'est un choix d'artiste, pas de
 *     physicien. L'élévation et la distance, elles, ne bougent pas.
 *
 * BUDGET HRTF (mobile) : la convolution HRTF coûte cher par source. Seules
 * les `maxHRTF` voies les plus proches l'obtiennent ; les autres retombent
 * sur `equalpower` (bon marché, gauche/droite correct, devant/derrière
 * perdu). La bascule de modèle se fait sous un court voile de gain — changer
 * `panningModel` en pleine onde claque, le voile l'étouffe.
 *
 * MONO / STÉRÉO : un PannerNode replie son entrée en mono avant de la
 * placer — c'est sa définition. Une nappe stéréo y perdrait toute sa
 * largeur d'origine. D'où le mode par piste : `"spatial": false` (ou
 * `"stereo"`) branche la piste directement sur le bus, gain par distance
 * seulement, canaux intacts. Voir le README pour préparer les fichiers.
 */

/* Défauts du modèle de distance — les mêmes que portait le module
 * HRTFPanner : une table, pas deux. */
export const SPATIAL_DEFAUTS = { refDistance: 2, rolloff: 1, maxDistance: 60 };

/* Le voile sous lequel un panner change de modèle : fondu de sortie, court
 * silence (qui absorbe l'imprécision du setTimeout face à l'horloge audio),
 * fondu de retour. */
const VOILE_SORTIE = 0.04;   // s
const VOILE_SILENCE = 0.08;  // s
const VOILE_RETOUR = 0.08;   // s

const _v = new THREE.Vector3();
const _f = new THREE.Vector3();
const _u = new THREE.Vector3();
const _r = new THREE.Vector3();
const _pos = new THREE.Vector3();

/** Le mode d'une piste : objet de réglages (ponctuelle) ou false (nappe). */
export function modeSpatial(stemCfg) {
  const s = stemCfg?.spatial;
  if (s === false || s === 'stereo') return false;
  if (s && typeof s === 'object') return s;
  return {}; // absent, true, "spatial" : ponctuelle, réglages par défaut
}

/** La piste porte-t-elle SES paramètres de distance ? */
function porteDistance(spa) {
  return spa && (Number.isFinite(spa.refDistance)
    || Number.isFinite(spa.rolloff) || Number.isFinite(spa.maxDistance));
}

/** Modèle « inverse » de la Web Audio API, calculé côté JS. */
function attenuationInverse(d, p) {
  const ref = Math.max(0.01, p.refDistance ?? SPATIAL_DEFAUTS.refDistance);
  const max = Math.max(ref, p.maxDistance ?? SPATIAL_DEFAUTS.maxDistance);
  const roll = Math.max(0, p.rolloff ?? SPATIAL_DEFAUTS.rolloff);
  const borne = Math.min(Math.max(d, ref), max);
  return ref / (ref + roll * (borne - ref));
}

export class Spatialisation {
  constructor(app) {
    this.app = app;
    this.voies = new Set();
    this._acc = 0;          // cadence du budget HRTF (0,5 s, comme les stems)
    this._hrtfActives = 0;  // compteur vivant, pour le modèle initial
  }

  /** Réglages GLOBAUX : `reglages.json` → bloc "audio", sinon les défauts. */
  get reglages() {
    const a = this.app.reglages?.audio ?? {};
    const n = (v, repli) => (Number.isFinite(v) ? v : repli);
    return {
      largeur: n(a.largeur, 1),
      poidsDistance: n(a.poidsDistance, 1),
      poidsDirection: n(a.poidsDirection, 1),
      maxHRTF: n(a.maxHRTF, this.app.quality?.profile?.maxHRTF ?? 8)
    };
  }

  /**
   * Construit la voie d'une piste et la branche entre `gainStem` et `bus`.
   * Rend null pour une nappe (mode stéréo) : l'appelant branche alors la
   * piste en direct, canaux intacts.
   */
  creerVoie(artwork, stemCfg, gainStem, bus) {
    const spa = modeSpatial(stemCfg);
    if (spa === false) return null;
    const ctx = this.app.audio.ctx;

    const entree = ctx.createGain();      // sert aussi de voile de bascule
    const panner = ctx.createPanner();
    // Direction PURE : le modèle de distance est neutralisé (rolloff 0
    // rend le modèle « inverse » constant à 1), la distance vit dans
    // `distGain` — voir l'en-tête du fichier.
    panner.panningModel = this._hrtfActives < this.reglages.maxHRTF
      ? 'HRTF' : 'equalpower';
    if (panner.panningModel === 'HRTF') this._hrtfActives++;
    panner.distanceModel = 'inverse';
    panner.refDistance = 1;
    panner.rolloffFactor = 0;
    const wet = ctx.createGain();
    const dry = ctx.createGain();
    dry.gain.value = 0;
    const distGain = ctx.createGain();

    gainStem.connect(entree);
    entree.connect(panner);
    panner.connect(wet);
    entree.connect(dry);
    wet.connect(distGain);
    dry.connect(distGain);
    distGain.connect(bus);

    const voie = {
      artwork, stemCfg, entree, panner, wet, dry, distGain,
      modele: panner.panningModel,
      _bascule: false,       // un voile est en cours : on ne rebascule pas
      // Infinity, pas NaN : toute comparaison avec NaN rend false, et la
      // première frame aurait « déjà écrit » des valeurs jamais posées.
      _last: { x: Infinity, y: Infinity, z: Infinity, wet: Infinity, dist: Infinity },
      azimut: 0, distance: 0 // exposés à la table d'écoute de l'éditeur
    };
    this.voies.add(voie);
    return voie;
  }

  libererVoie(voie) {
    if (!voie || !this.voies.has(voie)) return;
    this.voies.delete(voie);
    if (voie.modele === 'HRTF') this._hrtfActives--;
    for (const n of [voie.entree, voie.panner, voie.wet, voie.dry, voie.distGain]) {
      try { n.disconnect(); } catch { /* déjà libéré */ }
    }
  }

  /** Une voie compte-t-elle pour le budget (elle joue vraiment) ? */
  _active(voie) {
    const a = voie.artwork;
    return a.audioReady && a._stemsActive && (!a.room || a.room.state === 'current');
  }

  /**
   * Bascule le modèle de panning SOUS UN VOILE : fondu de sortie, silence
   * bref, changement, fondu de retour. `panningModel` n'est pas un
   * AudioParam — le changer en pleine onde recolle deux rendus différents
   * bord à bord, et cela s'entend.
   */
  _basculerModele(voie, modele) {
    if (voie.modele === modele || voie._bascule) return;
    const ctx = this.app.audio.ctx;
    voie._bascule = true;
    if (voie.modele === 'HRTF') this._hrtfActives--;
    if (modele === 'HRTF') this._hrtfActives++;
    voie.modele = modele; // réservé tout de suite : le budget compte juste
    const g = voie.entree.gain;
    const t = ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0, t + VOILE_SORTIE);
    g.setValueAtTime(0, t + VOILE_SORTIE + VOILE_SILENCE);
    g.linearRampToValueAtTime(1, t + VOILE_SORTIE + VOILE_SILENCE + VOILE_RETOUR);
    // le silence du voile absorbe la dérive du fil principal
    setTimeout(() => {
      try { voie.panner.panningModel = modele; } catch { /* nœud libéré */ }
      voie._bascule = false;
    }, (VOILE_SORTIE + VOILE_SILENCE / 2) * 1000);
  }

  /** Répartit HRTF sur les voies les plus proches, equalpower au-delà. */
  _repartirModeles() {
    const max = this.reglages.maxHRTF;
    const actives = [...this.voies].filter((v) => this._active(v))
      .sort((a, b) => (a.artwork._distance ?? 1e9) - (b.artwork._distance ?? 1e9));
    actives.forEach((v, i) => {
      this._basculerModele(v, i < max ? 'HRTF' : 'equalpower');
    });
  }

  /** Pondération de distance d'une œuvre (œuvre → galerie) — utilisée
   *  aussi par SpatialCrossfade et StemMixer, pour que TOUTES les courbes
   *  de distance obéissent au même réglage. */
  poidsDistanceDe(artwork) {
    const v = artwork?.config?.audio?.poidsDistance;
    return Number.isFinite(v) ? v : this.reglages.poidsDistance;
  }

  /**
   * Le pas de chaque frame : place les sources, pèse distance et direction.
   * Appelé par les deux boucles de l'App, juste avant `updateListener`.
   */
  update(dt) {
    if (!this.app.audio.ctx || !this.voies.size) return;
    this._acc += dt;
    if (this._acc > 0.5) { this._acc = 0; this._repartirModeles(); }

    const cam = this.app.camera;
    const e = cam.matrixWorld.elements;
    _f.set(-e[8], -e[9], -e[10]).normalize();   // regard
    _u.set(e[4], e[5], e[6]).normalize();       // up
    _r.crossVectors(_f, _u);                    // droite
    const glob = this.reglages;
    const t = this.app.audio.ctx.currentTime;

    for (const voie of this.voies) {
      const art = voie.artwork;
      // les voies muettes (budget de stems, pièce adjacente) ne coûtent
      // rien : leurs paramètres reprendront à la frame de réactivation,
      // juste avant le départ différé des sources (t0 + 50 ms)
      if (!art.audioReady || !art._stemsActive) continue;
      const spa = modeSpatial(voie.stemCfg) || {};
      const cfgAudio = art.config.audio ?? {};
      const num = (v, repli) => (Number.isFinite(v) ? v : repli);

      /* ---- position : l'azimut, éventuellement élargi ---------------- */
      const pos = art.worldPosition;
      _v.copy(pos).sub(cam.position);
      const lat = _v.dot(_r), av = _v.dot(_f), haut = _v.dot(_u);
      const az = Math.atan2(lat, av);
      voie.azimut = az;
      voie.azimutRendu = az; // ce que le panner entend (largeur comprise)
      voie.distance = art._distance ?? _v.length();
      const largeur = num(spa.largeur, num(cfgAudio.largeur, glob.largeur));
      if (largeur !== 1 && (lat || av)) {
        // l'angle s'élargit, l'élévation et la distance restent : la source
        // glisse sur son cercle autour de la tête, elle ne s'éloigne pas
        const az2 = Math.max(-Math.PI, Math.min(Math.PI, az * largeur));
        voie.azimutRendu = az2;
        const h = Math.hypot(lat, av);
        _pos.copy(cam.position)
          .addScaledVector(_f, h * Math.cos(az2))
          .addScaledVector(_r, h * Math.sin(az2))
          .addScaledVector(_u, haut);
      } else {
        _pos.copy(pos);
      }
      const p = voie.panner;
      const last = voie._last;
      if (Math.abs(_pos.x - last.x) > 1e-3 || Math.abs(_pos.y - last.y) > 1e-3
        || Math.abs(_pos.z - last.z) > 1e-3) {
        last.x = _pos.x; last.y = _pos.y; last.z = _pos.z;
        if (p.positionX) {
          p.positionX.setTargetAtTime(_pos.x, t, 0.05);
          p.positionY.setTargetAtTime(_pos.y, t, 0.05);
          p.positionZ.setTargetAtTime(_pos.z, t, 0.05);
        } else {
          p.setPosition(_pos.x, _pos.y, _pos.z);
        }
      }

      /* ---- direction de la source (pistes directives) ---------------- */
      if (spa.cone) this._orienterSource(voie, spa.cone, t);

      /* ---- part du panner : fondu wet/dry à puissance constante ------ */
      const poidsDir = Math.max(0, Math.min(1,
        num(spa.poidsDirection, num(cfgAudio.poidsDirection, glob.poidsDirection))));
      if (Math.abs(poidsDir - last.wet) > 1e-3) {
        last.wet = poidsDir;
        voie.wet.gain.setTargetAtTime(Math.sqrt(poidsDir), t, 0.05);
        voie.dry.gain.setTargetAtTime(Math.sqrt(1 - poidsDir), t, 0.05);
      }

      /* ---- atténuation par distance, si la voie la porte ------------- */
      // La piste qui déclare ses distances les applique ; sinon le module
      // HRTFPanner de l'œuvre (compatibilité) ; sinon la voie reste neutre
      // et la distance appartient à SpatialCrossfade ou StemMixer — une
      // seule courbe règne, jamais deux (voir _melangeurPresent, même leçon).
      const surcharge = art._spatialOverride?.params;
      const params = porteDistance(spa) ? spa : surcharge;
      let g = 1;
      if (params) {
        const poids = num(spa.poidsDistance,
          num(cfgAudio.poidsDistance, glob.poidsDistance));
        g = Math.pow(attenuationInverse(voie.distance, params), Math.max(0, poids));
      }
      voie.gainDistance = g;
      if (Math.abs(g - last.dist) > 1e-3) {
        last.dist = g;
        voie.distGain.gain.setTargetAtTime(g, t, 0.08);
      }
    }
  }

  /** Cône de directivité : la source rayonne dans l'axe +Z de l'œuvre. */
  _orienterSource(voie, cone, t) {
    const p = voie.panner;
    p.coneInnerAngle = cone.inner ?? 90;
    p.coneOuterAngle = cone.outer ?? 240;
    p.coneOuterGain = cone.gain ?? 0.25;
    _v.set(0, 0, 1).applyQuaternion(voie.artwork.group.getWorldQuaternion(_qCone));
    if (p.orientationX) {
      p.orientationX.setTargetAtTime(_v.x, t, 0.05);
      p.orientationY.setTargetAtTime(_v.y, t, 0.05);
      p.orientationZ.setTargetAtTime(_v.z, t, 0.05);
    } else {
      p.setOrientation(_v.x, _v.y, _v.z);
    }
  }

  /**
   * Photographie de l'instant, pour la table d'écoute de l'éditeur :
   * chaque voie vivante, son mode, son modèle, son angle et sa distance.
   */
  etat() {
    return [...this.voies].map((v) => ({
      oeuvre: v.artwork.config.id,
      fichier: v.stemCfg.file,
      active: this._active(v),
      modele: v.modele,
      distance: v.distance,
      azimut: (v.azimut * 180) / Math.PI,
      azimutRendu: ((v.azimutRendu ?? v.azimut) * 180) / Math.PI,
      gainDistance: v.gainDistance ?? 1
    }));
  }
}

const _qCone = new THREE.Quaternion();

/**
 * LA LECTURE PAR FRAGMENTS — une piste longue, servie dix secondes à la fois.
 *
 * Une nappe de cinq minutes chargée d'un bloc, c'est 3 Mo de réseau avant
 * la première note et 115 Mo de PCM décodé en mémoire pour toute la visite,
 * que le visiteur en entende dix secondes ou cinq minutes. Douze pistes à
 * l'entrée : 138 Mo (mesuré, scripts/sonde-poids-audio). Et c'est aussi UN
 * fichier, à une URL, qui est l'œuvre entière.
 *
 * Ici la piste est découpée à l'encodage (scripts/fragmente-sons.py) en
 * SEGMENTS de dix secondes, chacun prolongé d'un court CHEVAUCHEMENT
 * (100 ms) qui répète le début du suivant. Le lecteur ne charge que ce qui
 * va être entendu, quelques secondes d'avance, et rend chaque segment dès
 * qu'il a fini de jouer : deux ou trois segments décodés en mémoire, jamais
 * la pièce. Au raccord, le segment qui finit s'éteint pendant que le
 * suivant s'allume, sur le chevauchement — les deux portent LE MÊME son à
 * cet endroit, un fondu linéaire les additionne exactement à l'original.
 *
 * Le manifeste, à côté de la piste (`x.fragments.json`) :
 *
 *   { "version": 1, "duree": 342.5, "segment": 10, "chevauchement": 0.1,
 *     "n": 35, "formats": { "webm": "assets/x.frag/{i}.webm",
 *                            "m4a":  "assets/x.frag/{i}.m4a" } }
 *
 * et la piste le nomme : `"fragments": "assets/x.fragments.json"`. Le
 * `file` d'origine reste dans le JSON (l'éditeur le montre, les crédits le
 * citent) mais ne part plus en ligne : le build le retire (vite.config.js)
 * et le garde-fou refuse un original publié avec ses fragments.
 *
 * Les bornes « debut » / « fin » d'une piste (son-bornes.js) s'appliquent
 * comme à un buffer : la boucle court de l'une à l'autre, par-dessus les
 * segments.
 *
 * La partie PURE (plan, chemins, chaînage des morceaux) est testée au nœud
 * par scripts/test-fragments.mjs ; `LecteurFragments` porte la Web Audio.
 */
import { bornesLecture } from './son-bornes.js';
import { FORMATS } from './formats-audio.js';

export const VERSION_MANIFESTE = 1;
export const SEGMENT_DEFAUT = 10;
export const CHEVAUCHEMENT_DEFAUT = 0.1;

/** Combien de secondes d'avance le lecteur programme, et à quel rythme il y revient. */
export const HORIZON = 12;
export const CADENCE_MS = 1000;

/* -------------------------------------------------------------- le plan --- */

/**
 * Le découpage d'une durée : segment `i` commence à `i × segment` et dure
 * `segment + chevauchement`, sauf le dernier, qui s'arrête à la fin.
 */
export function planFragments(duree, segment = SEGMENT_DEFAUT, chevauchement = CHEVAUCHEMENT_DEFAUT) {
  const total = Number(duree) > 0 ? Number(duree) : 0;
  const seg = Number(segment) > 0 ? Number(segment) : SEGMENT_DEFAUT;
  const chev = Math.max(0, Number(chevauchement) || 0);
  const plan = [];
  for (let i = 0; i * seg < total; i++) {
    const debut = i * seg;
    plan.push({ i, debut, longueur: arrondi(Math.min(seg + chev, total - debut)) });
  }
  return plan;
}

/** Le chemin du segment `i` pour un format : `{i}` devient l'indice sur trois chiffres. */
export function cheminFragment(motif, i) {
  return String(motif ?? '').replace('{i}', String(i).padStart(3, '0'));
}

/**
 * Un manifeste sain, ou la liste de ce qui cloche. Les défauts sont des
 * phrases : c'est ce que l'auteur lit dans la console quand une piste
 * refuse de jouer.
 */
export function validerManifeste(m) {
  const erreurs = [];
  if (!m || typeof m !== 'object') return ['le manifeste n\'est pas un objet'];
  if (!(Number(m.duree) > 0)) erreurs.push('durée absente ou nulle');
  if (!(Number(m.segment) > 0)) erreurs.push('segment absent ou nul');
  if (!(Number(m.n) >= 1)) erreurs.push('nombre de segments absent');
  const formats = m.formats && typeof m.formats === 'object' ? m.formats : null;
  if (!formats || !FORMATS.some((f) => typeof formats[f.cle] === 'string' && formats[f.cle].includes('{i}'))) {
    erreurs.push('aucun format connu avec un motif « {i} »');
  }
  if (Number(m.duree) > 0 && Number(m.segment) > 0 && Number(m.n) >= 1
    && Math.ceil(Number(m.duree) / Number(m.segment)) !== Number(m.n)) {
    erreurs.push(`${m.n} segments annoncés, ${Math.ceil(Number(m.duree) / Number(m.segment))} attendus pour ${m.duree} s`);
  }
  return erreurs;
}

/** Le manifeste, normalisé — après `validerManifeste`. */
export function normaliserManifeste(m) {
  return {
    version: Number(m.version) || VERSION_MANIFESTE,
    duree: Number(m.duree),
    segment: Number(m.segment),
    chevauchement: Math.max(0, Number(m.chevauchement) || 0),
    n: Number(m.n),
    formats: { ...m.formats }
  };
}

/* ---------------------------------------------------------- le chaînage --- */

/**
 * Le MORCEAU suivant à jouer, et l'état d'après.
 *
 * Un morceau = une part d'un segment : « le segment `i`, depuis `offset`,
 * pendant `duree`, à l'instant `t` de la ligne de temps de la piste »
 * (t = 0 au premier départ). Il joue jusqu'à la fin nominale de son
 * segment, ou jusqu'à la borne `fin` de la boucle si elle vient avant,
 * PLUS le chevauchement, pendant lequel il s'éteint (`fonduSortie`) tandis
 * que le suivant s'allume (`fonduEntree`). Le tout premier morceau ne
 * s'allume pas en fondu : le gain de la piste s'en charge déjà.
 *
 * `etat` : { position, t } — la position dans la piste et l'instant de
 * ligne de temps où le prochain morceau doit commencer.
 */
export function morceauSuivant(manifeste, bornes, etat) {
  const seg = manifeste.segment;
  const chev = manifeste.chevauchement;
  const position = etat.position;
  const i = Math.min(manifeste.n - 1, Math.floor(position / seg + 1e-9));
  const offset = position - i * seg;
  const finSegment = Math.min((i + 1) * seg, manifeste.duree);
  const finNominale = Math.min(finSegment, bornes.fin);
  const nominal = Math.max(0.01, finNominale - position);
  // la queue de chevauchement n'existe que si le segment (ou la piste) la porte
  const queue = Math.min(chev, Math.max(0, manifeste.duree - finNominale));
  const boucle = finNominale >= bornes.fin - 1e-9;
  const morceau = {
    i, offset: arrondi(offset), duree: arrondi(nominal + queue), t: arrondi(etat.t),
    fonduEntree: etat.t === 0 ? 0 : chev,
    fonduSortie: queue,
    boucle
  };
  const suivant = { position: boucle ? bornes.debut : finNominale, t: arrondi(etat.t + nominal) };
  return { morceau, suivant };
}

/** Les morceaux qui couvrent `horizon` secondes de ligne de temps depuis `etat`. */
export function programme(manifeste, bornes, etat = { position: bornes.debut, t: 0 }, horizon = HORIZON) {
  const liste = [];
  let e = etat;
  let garde = 0;
  while (e.t < etat.t + horizon && garde++ < 10000) {
    const { morceau, suivant } = morceauSuivant(manifeste, bornes, e);
    liste.push(morceau);
    e = suivant;
  }
  return { morceaux: liste, etat: e };
}

/** Les bornes de boucle d'une piste par fragments : celles du JSON, sur la durée du manifeste. */
export function bornesFragments(cfg, manifeste) {
  return bornesLecture(cfg, manifeste.duree);
}

/* ------------------------------------------------------------ le lecteur --- */

/**
 * Le lecteur : programme les morceaux quelques secondes d'avance, charge
 * chaque segment par le cache compté du moteur (`engine.load`) et le rend
 * (`engine.release`) quand plus aucun morceau ne s'en sert.
 *
 *   const l = new LecteurFragments({ engine, manifeste, motif, cfg, destination });
 *   await l.precharger();       // le premier segment est décodé
 *   l.demarrer(ctx.currentTime + 0.05);
 *   l.arreter(ctx.currentTime + 1);   // les sources s'arrêtent, le gain de la piste a déjà fondu
 *   l.liberer();                // tout est rendu
 */
export class LecteurFragments {
  constructor({ engine, manifeste, motif, cfg = {}, destination }) {
    this.engine = engine;
    this.manifeste = normaliserManifeste(manifeste);
    this.motif = motif;
    this.cfg = cfg;
    this.destination = destination;
    this.bornes = bornesFragments(cfg, this.manifeste);
    this.actif = false;
    this._origine = 0;                 // ctx.currentTime du t = 0
    this._etat = { position: this.bornes.debut, t: 0 };
    this._sources = new Set();         // { src, gain, url }
    this._tenus = new Map();           // url → nombre de morceaux qui s'en servent
    this._timer = null;
    this._planification = null;
  }

  /** Le segment `i`, décodé — compté au cache du moteur. */
  _charger(i) {
    const url = cheminFragment(this.motif, i);
    this._tenus.set(url, (this._tenus.get(url) ?? 0) + 1);
    return this.engine.load(url).then((buffer) => ({ url, buffer }), (e) => {
      this._rendre(url);
      throw e;
    });
  }

  _rendre(url) {
    const reste = (this._tenus.get(url) ?? 1) - 1;
    if (reste > 0) { this._tenus.set(url, reste); return; }
    this._tenus.delete(url);
    this.engine.release(url);
  }

  /** Décode le premier segment (et demande le suivant) avant tout départ. */
  async precharger() {
    const { morceaux } = programme(this.manifeste, this.bornes, this._etat, 0.01);
    const premier = await this._charger(morceaux[0].i);
    this._rendre(premier.url); // le comptage réel se fait à la programmation
    return premier.buffer;
  }

  demarrer(quand) {
    if (this.actif) return;
    const ctx = this.engine.ctx;
    this.actif = true;
    this._origine = quand ?? ctx.currentTime;
    this._etat = { position: this.bornes.debut, t: 0 };
    this._planifier();
    this._timer = setInterval(() => this._planifier(), CADENCE_MS);
  }

  /** Programme les morceaux jusqu'à HORIZON secondes d'avance — un seul passage à la fois. */
  _planifier() {
    if (!this.actif || this._planification) return;
    this._planification = (async () => {
      const ctx = this.engine.ctx;
      while (this.actif && this._origine + this._etat.t < ctx.currentTime + HORIZON) {
        const { morceau, suivant } = morceauSuivant(this.manifeste, this.bornes, this._etat);
        this._etat = suivant;
        let charge;
        try { charge = await this._charger(morceau.i); } catch (e) {
          console.warn('[galerie] fragment illisible :', cheminFragment(this.motif, morceau.i), e?.message ?? e);
          continue; // on saute le morceau : mieux vaut un trou qu'une piste morte
        }
        if (!this.actif) { this._rendre(charge.url); return; }
        this._jouer(morceau, charge);
      }
    })().finally(() => { this._planification = null; });
  }

  _jouer(morceau, { url, buffer }) {
    const ctx = this.engine.ctx;
    let depart = this._origine + morceau.t;
    let offset = morceau.offset;
    let duree = morceau.duree;
    const maintenant = ctx.currentTime;
    // en retard (réseau lent) : on rattrape en sautant ce qui est passé
    if (depart < maintenant) {
      const retard = maintenant - depart;
      if (retard >= duree) { this._rendre(url); return; }
      offset += retard; duree -= retard; depart = maintenant;
    }
    const gain = ctx.createGain();
    gain.connect(this.destination);
    const g = gain.gain;
    if (morceau.fonduEntree > 0) {
      g.setValueAtTime(0, depart);
      g.linearRampToValueAtTime(1, depart + morceau.fonduEntree);
    } else {
      g.setValueAtTime(1, depart);
    }
    if (morceau.fonduSortie > 0) {
      const finPleine = depart + duree - morceau.fonduSortie;
      g.setValueAtTime(1, Math.max(depart, finPleine));
      g.linearRampToValueAtTime(0, depart + duree);
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(gain);
    const entree = { src, gain, url };
    this._sources.add(entree);
    src.onended = () => {
      this._sources.delete(entree);
      try { src.disconnect(); gain.disconnect(); } catch { /* déjà */ }
      this._rendre(url);
    };
    try {
      src.start(depart, Math.min(offset, Math.max(0, buffer.duration - 0.001)), duree);
    } catch (e) {
      src.onended = null;
      this._sources.delete(entree);
      this._rendre(url);
      console.warn('[galerie] fragment non lancé :', e?.message ?? e);
    }
  }

  /** Arrête tout à `quand` (le gain de la piste a fondu avant) ; le lecteur peut redémarrer. */
  arreter(quand) {
    if (!this.actif) return;
    this.actif = false;
    clearInterval(this._timer);
    this._timer = null;
    const t = quand ?? this.engine.ctx.currentTime;
    for (const s of this._sources) {
      try { s.src.stop(t); } catch { /* déjà arrêtée */ }
    }
  }

  /** Tout rendre, tout de suite : plus aucune source, plus aucun segment tenu. */
  liberer() {
    this.arreter();
    for (const s of this._sources) {
      s.src.onended = null;
      try { s.src.stop(); } catch { /* déjà */ }
      try { s.src.disconnect(); s.gain.disconnect(); } catch { /* déjà */ }
    }
    this._sources.clear();
    for (const url of [...this._tenus.keys()]) {
      this._tenus.delete(url);
      this.engine.release(url);
    }
  }

  /** Les segments décodés que ce lecteur tient en ce moment (pour la sonde). */
  residents() { return this._tenus.size; }

  /** La position courante dans la piste, en secondes, ou null à l'arrêt. */
  position() {
    if (!this.actif) return null;
    const t = this.engine.ctx.currentTime - this._origine;
    const longueur = this.bornes.fin - this.bornes.debut;
    if (longueur <= 0) return this.bornes.debut;
    return this.bornes.debut + (((t % longueur) + longueur) % longueur);
  }
}

/** Le manifeste d'une piste, lu et vérifié ; lève une erreur lisible sinon. */
export async function chargerManifeste(url, lire = (u) => fetch(u).then((r) => {
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
})) {
  const m = await lire(url);
  const defauts = validerManifeste(m);
  if (defauts.length) throw new Error(`manifeste ${url} : ${defauts.join(' ; ')}`);
  return normaliserManifeste(m);
}

const arrondi = (v) => Math.round(v * 1000) / 1000;

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
 *
 * DEUX COMPTES, PAS UN. Le chargement paresseux ne distingue pas ce qu'il
 * faut POUR ENTRER de ce qu'on prend D'AVANCE : à l'entrée, les œuvres des
 * salles voisines sont déjà à portée (50 m) et se chargent aussi. Un scan
 * gaussien voisin, c'est 1,3 Mo (bibliothèque + nuage de taches) et une
 * dizaine de secondes — pendant lesquelles la barre de l'accueil attendait
 * une salle où le visiteur n'est même pas.
 *
 * Le compte ESSENTIEL ne retient que la salle d'arrivée : c'est lui que la
 * barre affiche, et lui qui décide qu'on a fini. Les préchargements
 * continuent en silence derrière — ils comptent dans `total`, jamais dans
 * `essentiels`.
 */
/**
 * RÉESSAYER — parce qu'un accroc réseau ne doit pas coûter une œuvre.
 *
 * Retour d'auteur, sur iPhone : « les objets ne veulent pas charger ;
 * résolu en rechargeant tout le site ». Le chemin de chargement n'avait
 * AUCUN réessai : une seule requête ratée — un creux de réseau au premier
 * passage, une rafale de fichiers sur un cache froid — et l'œuvre virait au
 * rouge sourd pour le reste de la visite, sans possibilité de s'en
 * remettre. Recharger la page marchait parce que ça relançait tout ; c'est
 * la définition d'un défaut qu'on fait porter au visiteur.
 *
 * Trois tentatives, attente doublée entre chacune (400 ms puis 800 ms) :
 * assez pour traverser un creux de connexion, assez court pour qu'un
 * fichier vraiment absent (404, chemin faux) rende la main en une seconde
 * et demie au lieu de faire mine de travailler. On ne réessaie donc PAS
 * indéfiniment — un contenu manquant doit se voir, et le placeholder rouge
 * est là pour ça.
 */
export async function reessayer(faire, { essais = 3, attente = 400, surEchec = null } = {}) {
  let derniere;
  for (let i = 0; i < essais; i++) {
    try {
      return await faire(i);
    } catch (erreur) {
      derniere = erreur;
      if (i === essais - 1) break;
      surEchec?.(erreur, i + 1);
      await new Promise((suite) => setTimeout(suite, attente * (2 ** i)));
    }
  }
  throw derniere;
}

export class LoadingTracker {
  constructor() {
    this.total = 0;
    this.done = 0;
    this.essentiels = 0;
    this.faits = 0;
    this._listeners = [];
  }

  onChange(fn) {
    this._listeners.push(fn);
  }

  /**
   * @param {Promise} promise
   * @param {boolean} essentiel — false pour un préchargement (salle voisine) :
   *   il se fait, mais ne retient pas l'écran d'accueil.
   */
  track(promise, essentiel = true) {
    this.total++;
    if (essentiel) this.essentiels++;
    this._emit();
    promise.catch(() => {}).finally(() => {
      this.done++;
      if (essentiel) this.faits++;
      this._emit();
    });
    return promise;
  }

  _emit() {
    for (const fn of this._listeners) {
      fn(this.done, this.total, this.faits, this.essentiels);
    }
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

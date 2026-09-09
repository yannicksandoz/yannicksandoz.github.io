/**
 * LE SONOMÈTRE — la sonie intégrée d'un son, en LUFS (ITU-R BS.1770-4 / EBU R128).
 *
 * Deux pistes « au même gain » ne s'entendent pas au même niveau : un
 * drone plein et une cascade lointaine à 0,95 diffèrent de trente LU, et
 * rien dans le JSON ne le disait. La sonie, elle, approche l'oreille :
 *
 *   1. un filtre K (deux biquads : une bosse d'aigus qui imite la tête,
 *      puis un coupe-bas qui ignore le grave sourd), calculé pour la
 *      fréquence d'échantillonnage réelle — les fichiers de la galerie sont
 *      à 22 050, 44 100 ou 48 000 Hz ;
 *   2. des blocs de 400 ms qui se recouvrent aux trois quarts, chacun
 *      réduit à sa puissance moyenne ;
 *   3. deux portes : on ignore les blocs sous −70 LUFS (le silence), puis
 *      ceux à plus de 10 LU sous la moyenne des restants (les creux) ;
 *   4. la sonie intégrée = −0,691 + 10·log10 (puissance moyenne des blocs
 *      retenus), les voies pesées (avant : 1 ; arrière : 1,41).
 *
 * Tout est pur (des Float32Array, un nombre) : testé au nœud contre les
 * valeurs de ffmpeg (ebur128) sur les fichiers réels de la galerie, à
 * 0,3 LU près. Voir scripts/niveaux-sons.py pour la mesure hors ligne, et
 * l'éditeur (Table d'écoute) pour la mesure en direct sur la piste décodée.
 */

/** Les deux biquads du filtre K pour une fréquence d'échantillonnage. */
export function filtreK(fs) {
  // 1. le pré-filtre : plateau d'aigus (+4 dB au-dessus de ~1,7 kHz)
  let f0 = 1681.974450955533;
  const G = 3.999843853973347;
  let Q = 0.7071752369554196;
  let K = Math.tan(Math.PI * f0 / fs);
  const Vh = Math.pow(10, G / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const plateau = {
    b: [(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0],
    a: [1, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0]
  };
  // 2. le coupe-bas RLB (≈ 38 Hz)
  f0 = 38.13547087602444;
  Q = 0.5003270373238773;
  K = Math.tan(Math.PI * f0 / fs);
  a0 = 1 + K / Q + K * K;
  const coupeBas = {
    b: [1, -2, 1],
    a: [1, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0]
  };
  return [plateau, coupeBas];
}

/** Applique un biquad (forme directe I) à une voie ; rend une nouvelle voie. */
export function biquad(x, { b, a }) {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let n = 0; n < x.length; n++) {
    const x0 = x[n];
    const y0 = b[0] * x0 + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2;
    x2 = x1; x1 = x0; y2 = y1; y1 = y0;
    y[n] = y0;
  }
  return y;
}

const ABSOLU = -70;    // LUFS : sous ce niveau, un bloc est du silence
const RELATIF = -10;   // LU sous la moyenne : un bloc est un creux
const BLOC = 0.4;      // s
const PAS = 0.1;       // s (recouvrement 75 %)

/**
 * La sonie intégrée d'un son.
 * @param {Float32Array[]} voies  les voies (1 : mono, 2 : gauche/droite, 5 : G D C Gs Ds)
 * @param {number} fs  fréquence d'échantillonnage
 * @returns {{ lufs: number|null, crete: number|null, blocs: number }}
 *   `lufs` null si tout est sous la porte absolue (un silence) ; `crete`
 *   en dBFS (crête d'échantillon, avant filtre).
 */
export function sonie(voies, fs) {
  if (!voies?.length || !voies[0]?.length || !(fs > 0)) return { lufs: null, crete: null, blocs: 0 };
  const poids = voies.length >= 5 ? [1, 1, 1, 1.41, 1.41] : voies.map(() => 1);
  const [plateau, coupeBas] = filtreK(fs);
  let crete = 0;
  const filtrees = voies.map((v) => {
    for (let i = 0; i < v.length; i++) { const m = Math.abs(v[i]); if (m > crete) crete = m; }
    return biquad(biquad(v, plateau), coupeBas);
  });
  const n = filtrees[0].length;
  const tailleBloc = Math.round(BLOC * fs);
  const pas = Math.round(PAS * fs);
  if (n < tailleBloc) {
    // plus court qu'un bloc : un seul bloc, le son entier
    return finir([puissance(filtrees, poids, 0, n)], crete);
  }
  const puissances = [];
  for (let debut = 0; debut + tailleBloc <= n; debut += pas) {
    puissances.push(puissance(filtrees, poids, debut, debut + tailleBloc));
  }
  return finir(puissances, crete);
}

function puissance(voies, poids, debut, fin) {
  let somme = 0;
  for (let c = 0; c < voies.length; c++) {
    const v = voies[c];
    let s = 0;
    for (let i = debut; i < fin; i++) s += v[i] * v[i];
    somme += poids[c] * (s / (fin - debut));
  }
  return somme;
}

const enLufs = (z) => -0.691 + 10 * Math.log10(z);

function finir(puissances, crete) {
  const creteDb = crete > 0 ? 20 * Math.log10(crete) : null;
  // porte absolue
  const audibles = puissances.filter((z) => z > 0 && enLufs(z) > ABSOLU);
  if (!audibles.length) return { lufs: null, crete: creteDb, blocs: 0 };
  // porte relative : 10 LU sous la moyenne des blocs audibles
  const moyenne = audibles.reduce((a, b) => a + b, 0) / audibles.length;
  const seuil = enLufs(moyenne) + RELATIF;
  const retenus = audibles.filter((z) => enLufs(z) > seuil);
  const zFinal = retenus.reduce((a, b) => a + b, 0) / retenus.length;
  return { lufs: enLufs(zFinal), crete: creteDb, blocs: retenus.length };
}

/**
 * Le niveau EFFECTIF d'une piste dans la galerie : sa sonie, plus les gains
 * du JSON (gain de piste × gain d'œuvre), en LUFS. Pure.
 */
export function niveauEffectif(lufs, gainPiste = 1, gainOeuvre = 1) {
  if (lufs == null) return null;
  const g = (gainPiste ?? 1) * (gainOeuvre ?? 1);
  if (!(g > 0)) return null;
  return lufs + 20 * Math.log10(g);
}

/**
 * Le gain de piste qui amènerait la piste à la cible, l'œuvre gardant son
 * gain — arrondi au pas (le centième, ou celui d'un curseur), borné à
 * [0, max]. Pure.
 */
export function gainPourCible(lufs, cible, gainOeuvre = 1, max = 2, pas = 0.01) {
  if (lufs == null) return null;
  const g = Math.pow(10, (cible - lufs) / 20) / ((gainOeuvre ?? 1) || 1);
  const arrondi = Math.round(g / pas) * pas;
  return Math.max(0, Math.min(max, Math.round(arrondi * 1000) / 1000));
}

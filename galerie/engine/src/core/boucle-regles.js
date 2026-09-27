/**
 * LE RACCORD D'UNE BOUCLE — des règles pures, pour juger un encodage.
 *
 * Une boucle courte (six secondes de nappe, une pulsation) tourne des
 * centaines de fois par visite : ce qui compte, c'est le RACCORD, l'instant
 * où la fin rejoint le début. Deux choses le cassent quand on encode :
 *
 *   • un DÉCALAGE — Opus met 312 échantillons d'amorce (pre-skip), AAC un
 *     amorçage d'environ 2 112 ; si le décodeur ne les retire pas, la
 *     boucle commence trop tard et le raccord tombe au milieu d'une onde ;
 *   • un SAUT — la queue de l'encodage (dernière trame complétée de
 *     silence, fondu du codec) ne recolle plus sur le début.
 *
 * Ici, deux mesures sans Web Audio ni codec : le décalage entre deux
 * signaux (par corrélation), et le saut au raccord rapporté au pas moyen
 * du signal. Le script de contrôle (scripts/controle-boucles.mjs) décode
 * les formats par ffmpeg et compare à l'original ; les règles, elles, se
 * testent au nœud (test-bornes.mjs).
 */

/**
 * Le saut au raccord d'une boucle bornée à [debut, fin) échantillons :
 * |x[debut] − x[fin−1]|, rapporté au pas moyen |x[i+1] − x[i]| de la
 * boucle. Un rapport proche de 1 est un raccord aussi doux que le reste du
 * signal ; à 10 ou plus, ça claque. Rend { saut, pas, rapport }.
 */
export function sautRaccord(x, debut = 0, fin = x.length) {
  const d = Math.max(0, Math.floor(debut));
  const f = Math.min(x.length, Math.floor(fin));
  if (f - d < 2) return { saut: 0, pas: 0, rapport: 0 };
  let somme = 0;
  for (let i = d; i < f - 1; i++) somme += Math.abs(x[i + 1] - x[i]);
  const pas = somme / (f - d - 1);
  const saut = Math.abs(x[d] - x[f - 1]);
  return { saut, pas, rapport: pas > 0 ? saut / pas : (saut > 0 ? Infinity : 0) };
}

/**
 * De combien d'échantillons `autre` est en retard sur `ref` : le décalage
 * (entre −maxLag et +maxLag) qui maximise la corrélation normalisée sur
 * une fenêtre de `fenetre` échantillons prise au MILIEU de la référence
 * (le début d'une piste peut être silencieux). Un signal presque
 * périodique donne des corrélations égales à chaque période : à corrélation
 * égale (à `tolerance` près), le décalage le plus PETIT l'emporte. Rend
 * { lag, correlation } ; un lag positif dit que `autre` commence plus tard.
 */
export function decalage(ref, autre, { maxLag = 4096, fenetre = 8192, depuis = null, tolerance = 0.002 } = {}) {
  const n = Math.min(fenetre, ref.length - 2 * maxLag, autre.length - 2 * maxLag);
  if (n < 16) return { lag: 0, correlation: 0 };
  const d0 = depuis ?? Math.floor((Math.min(ref.length, autre.length) - n) / 2);
  const debut = Math.max(maxLag, Math.min(d0, Math.min(ref.length, autre.length) - n - maxLag));
  let energieRef = 0;
  for (let i = 0; i < n; i++) energieRef += ref[debut + i] * ref[debut + i];
  let meilleur = { lag: 0, correlation: -Infinity };
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    let prod = 0, energie = 0;
    const base = debut + lag;
    for (let i = 0; i < n; i++) {
      const y = autre[base + i];
      prod += ref[debut + i] * y;
      energie += y * y;
    }
    const c = energieRef > 0 && energie > 0 ? prod / Math.sqrt(energieRef * energie) : 0;
    if (c > meilleur.correlation + tolerance || (c > meilleur.correlation - tolerance && Math.abs(lag) < Math.abs(meilleur.lag))) {
      meilleur = { lag, correlation: c };
    }
  }
  return meilleur;
}

/**
 * Le verdict d'un format encodé face à son original : le décalage doit
 * être nul (à `toleranceLag` près), et le raccord ne doit pas être plus dur
 * que `facteur` fois celui de l'original (plus une marge absolue pour les
 * signaux presque silencieux). Rend { ok, raisons: [] }.
 */
export function jugerFormat({ lag, rapportOriginal, rapportFormat }, { toleranceLag = 2, facteur = 3, marge = 3 } = {}) {
  const raisons = [];
  if (Math.abs(lag) > toleranceLag) raisons.push(`décalé de ${lag} échantillon(s)`);
  if (rapportFormat > rapportOriginal * facteur + marge) {
    raisons.push(`raccord ${rapportFormat.toFixed(1)}× le pas, contre ${rapportOriginal.toFixed(1)}× dans l'original`);
  }
  return { ok: raisons.length === 0, raisons };
}

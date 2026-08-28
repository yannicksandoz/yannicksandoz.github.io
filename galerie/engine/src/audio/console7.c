/*
 * CONSOLE7, LA TRANCHE — pilote WebAssembly du chemin audio.
 *
 * D'après Console7Channel de Chris Johnson (© 2018 airwindows, licence MIT).
 * Le portage JavaScript vit dans `core/console7-worklet.js` ; celui-ci en
 * est la transcription en C, destinée à `clang --target=wasm32`.
 *
 * POURQUOI ICI ET PAS AILLEURS. Le rendu 3D ne passe pas une milliseconde
 * en JavaScript — tout son temps est dans le shader. L'audio, lui, est le
 * seul endroit de la galerie où le langage est un vrai passif : douze
 * worklets, environ trois mille deux cents lignes de traitement PAR
 * ÉCHANTILLON, sur le thread audio, avec cent vingt-huit échantillons à
 * rendre en 2,7 ms à 48 kHz. Pas de SIMD, et une pause du ramasse-miettes
 * s'entend. Console7 est le meilleur pilote : c'est le plus court des
 * douze, et c'est celui qui tourne sur QUINZE tranches à la fois.
 *
 * PAS DE BIBLIOTHÈQUE MATHÉMATIQUE, ET C'EST GRATUIT. On compile sans
 * libc ni libm. Le seul appel transcendant du chemin chaud est `sin`, et
 * ses arguments sont BORNÉS par construction : Chris écrête à ±1,097 avant
 * la saturation, donc |x| ≤ 1,097 et |x·|x|| ≤ 1,204. Sur un intervalle
 * aussi étroit, la série de Taylor jusqu'au degré 21 est exacte à mieux que
 * l'epsilon du double : confrontée à `Math.sin` sur [-1,3 ; 1,3], l'erreur
 * absolue maximale vaut 2,22·10⁻¹⁶ — un ulp. Inutile de réduire l'argument,
 * inutile de lier quoi que ce soit. Les coefficients ne sont pas écrits à
 * la main mais engendrés et vérifiés (voir `test-console7-wasm.mjs`).
 *
 * `tan`, lui, ne sert qu'au calcul des coefficients du passe-bas : il se
 * fait une fois, côté JavaScript, et les cinq coefficients arrivent par la
 * porte.
 *
 * ON NE COMPILE PAS EN `-ffast-math`. Il autoriserait le compilateur à
 * réassocier les additions, et le résultat cesserait d'être comparable au
 * JavaScript au bit près — or c'est précisément ce que la suite exige : un
 * portage audio qui « sonne pareil » sans le prouver ne prouve rien.
 *
 * L'ÉTAT vit dans la mémoire du module, à des adresses fixes rendues à
 * l'appelant. Un module par tranche : chacun a sa mémoire, comme chaque
 * worklet a la sienne.
 */

/* ------------------------------------------------------------------ sin --
 * sin(x) pour |x| ≤ 1,3, par la série alternée. Le terme suivant celui de
 * degré 21 vaut x²³/23! ≈ 2·10⁻²³ à x = 1,3 : bien sous l'epsilon du
 * double (2,2·10⁻¹⁶). On garde l'ordre de Horner, du plus petit terme au
 * plus grand, pour ne pas perdre les bits de poids faible.
 */
static double sinus_borne(double x) {
  const double x2 = x * x;
  double r = 0.0;
  r = r * x2 + 1.9572941063391262595e-20;   /* +1/21! */
  r = r * x2 - 8.2206352466243294955e-18;   /* -1/19! */
  r = r * x2 + 2.8114572543455205981e-15;   /* +1/17! */
  r = r * x2 - 7.6471637318198164055e-13;   /* -1/15! */
  r = r * x2 + 1.6059043836821613341e-10;   /* +1/13! */
  r = r * x2 - 2.5052108385441720224e-8;    /* -1/11! */
  r = r * x2 + 2.7557319223985892511e-6;    /*  +1/9! */
  r = r * x2 - 1.9841269841269841253e-4;    /*  -1/7! */
  r = r * x2 + 8.3333333333333332177e-3;    /*  +1/5! */
  r = r * x2 - 1.6666666666666665741e-1;    /*  -1/3! */
  return x + x * x2 * r;
}

/* ------------------------------------------------------------- la tranche --
 * État : cinq coefficients, huit mémoires de filtre (deux canaux × x1 x2
 * y1 y2), et le fader poursuivi (vitesse, valeur, cible).
 */
static double coef[5];
static double etat[8];
static double poursuite[3];   /* vitesse, valeur, cible */

__attribute__((export_name("coefficients")))
double* coefficients(void) { return coef; }

__attribute__((export_name("reinitialiser")))
void reinitialiser(void) {
  for (int i = 0; i < 8; i++) etat[i] = 0.0;
  poursuite[0] = 64.0;        /* vitesse */
  poursuite[1] = -1.0;        /* valeur : « pas encore posée » */
  poursuite[2] = 0.0;         /* cible */
}

/* Deux tampons d'un bloc, à demeure : le worklet y recopie ses canaux. */
#define BLOC 128
static double gauche[BLOC];
static double droite[BLOC];

__attribute__((export_name("tampon_gauche")))
double* tampon_gauche(void) { return gauche; }
__attribute__((export_name("tampon_droite")))
double* tampon_droite(void) { return droite; }

/* Forme directe I, un échantillon, sur le canal c. */
static inline double passer(int c, double x) {
  const int b = c * 4;
  const double y = coef[0] * x + coef[1] * etat[b] + coef[2] * etat[b + 1]
    - coef[3] * etat[b + 2] - coef[4] * etat[b + 3];
  etat[b + 1] = etat[b]; etat[b] = x;
  etat[b + 3] = etat[b + 2]; etat[b + 2] = y;
  return y;
}

/*
 * `niveau` : le fader de Chris, déjà borné à [0, 1] par l'appelant.
 * `stereo` : 0 pour traiter le seul canal gauche.
 * `n` : la taille du bloc (128 en pratique, mais on ne le suppose pas).
 */
__attribute__((export_name("traiter")))
void traiter(double niveau, int stereo, int n) {
  const double RACINE_PHI = 1.272019649514069;
  const double cible = niveau * RACINE_PHI;

  /* le fader POURSUIVI : il accélère quand la cible bouge, se pose sinon */
  if (poursuite[1] != cible) poursuite[0] *= 2.0;
  if (poursuite[0] > (double) n) poursuite[0] = (double) n;
  if (poursuite[1] < 0.0) poursuite[1] = cible;
  poursuite[2] = cible;

  const int canaux = stereo ? 2 : 1;
  for (int i = 0; i < n; i++) {
    poursuite[0] *= 0.9999;
    poursuite[0] -= 0.01;
    if (poursuite[0] < 64.0) poursuite[0] = 64.0;
    poursuite[1] = (poursuite[1] * poursuite[0] + poursuite[2])
      / (poursuite[0] + 1.0);
    const double g = poursuite[1];
    const double cube = g * g * g;

    for (int c = 0; c < canaux; c++) {
      double* buf = c == 0 ? gauche : droite;
      double x = passer(c, buf[i]);
      if (g != 1.0) x *= cube;
      /* le plafond de Chris : 1,097, pas un */
      if (x > 1.097) x = 1.097;
      else if (x < -1.097) x = -1.097;
      const double abs = x < 0.0 ? -x : x;
      const double spirale = abs == 0.0 ? 0.0 : sinus_borne(x * abs) / abs;
      x = spirale * 0.8 + sinus_borne(x) * 0.2;
      if (g != 1.0 && g != 0.0) x /= g;
      buf[i] = x;
    }
  }
}

/* Le sinus seul, pour que la suite de tests puisse le juger contre Math.sin. */
__attribute__((export_name("sinus")))
double sinus(double x) { return sinus_borne(x); }

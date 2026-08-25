/**
 * LES COULEURS DU BUS — BussColors4, d'Airwindows.
 *
 * D'après **BussColors4** de Chris Johnson
 * (© 2016 airwindows, licence MIT — https://github.com/airwindows/airwindows).
 * Les huit jeux de trente-trois coefficients, leurs gains d'entrée et de
 * sortie, l'affaissement dynamique et les deux étages de saturation sont les
 * siens.
 *
 * CE QUE C'EST, ET EN QUOI CE N'EST PAS LE PUPITRE. Channel9 modèle la
 * VITESSE d'une table : ce qu'elle n'arrive pas à suivre. Ceci modèle sa
 * MATIÈRE : la réponse impulsionnelle mesurée d'un vrai bus de console, huit
 * fois, sur du vrai matériel. Trente-trois prises de retard par modèle, dont
 * les poids ne sont pas constants — ils bougent avec l'affaissement de
 * l'alimentation sous le signal, ce qui est exactement ce qu'une console
 * fait quand on la pousse.
 *
 * Les deux se cumulent, et c'est voulu : une table a une vitesse ET une
 * matière. Mais ils s'entendent séparément, et chacun s'éteint tout seul.
 *
 * LES HUIT, avec le matériel que Chris a mesuré :
 *   Dark (Focusrite MCI) · Rock (SSL) · Lush (Neve) · Vibe (Elation)
 *   Holo (Precision 8) · Punch (API) · Steel (Calibre) · Tube (Manley)
 *
 * ÉCART D'IMPLÉMENTATION, pas de résultat : Chris décale tout son tampon de
 * convolution d'un cran à chaque échantillon (« it saves us an add inside
 * the convolution calculation », dit-il, et en C il a raison). On utilise un
 * tampon CIRCULAIRE : trente-quatre recopies par échantillon et par canal,
 * c'est trois millions de recopies par seconde qu'un moteur JavaScript n'a
 * aucune raison de faire. L'arithmétique est identique — `b[j]` reste
 * l'échantillon d'il y a `j` — et le test compare les deux implémentations
 * échantillon par échantillon.
 *
 * Non porté : le dither, comme partout ailleurs ici, et le bruit
 * anti-dénormal de l'entrée.
 */

/* Les huit tables de coefficients, EXTRAITES DU SOURCE de Chris par
   programme et non recopiées à la main : cinq cent vingt-huit nombres, c'est
   exactement là qu'une faute de frappe se cache pour toujours. L'extraction
   a été validée en comparant les blocs gauche et droit de Chris, qu'il a
   écrits deux fois — ils concordent sur les deux cent soixante-quatre paires.

   Forme : chaque prise vaut `[statique, dynamique]`, et sa contribution est
   `b[c[k]] * (statique + dynamique * affaissement)`. Les signes de Chris
   (`+=` / `-=` au-dehors, `+` / `-` au-dedans) sont absorbés dans les deux
   nombres — d'où des valeurs négatives là où il écrivait une soustraction. */
const TAPS = [
  /* Dark — Focusrite */
  [
    [0.6128328894220132, 0.00024011410669522], [-0.24036380659761222, 0.00020789518206241], [0.09104669761717916, 0.00012829642741548],
    [-0.02378290768554025, 0.0001767364647044], [-0.02832818490275965, 0.00013536187747384], [0.03268797679215937, 0.00015035126653359],
    [-0.04024464202655586, 0.00015034923056735], [0.01864890074318696, 0.00014513281680642], [-0.01632731954100322, 0.00015509089075614],
    [-0.00318907090555589, 0.0001478481207655], [-0.00208573465221869, 0.00015350520779465], [-0.00907033901519614, 0.0001544296415725],
    [-0.00199458794148013, 0.00015595640046297], [-0.00705979153201755, 0.00015730069418051], [-0.00429488975412722, 0.00015743697943505],
    [-0.00497724878704936, 0.00016014760011861], [-0.00506059305562353, 0.00016194824072466], [-0.00483432223285621, 0.00016329050124225],
    [-0.00495100420886005, 0.00016297509798749], [-0.00489319520555115, 0.00016472839684661], [-0.00489177657970308, 0.0001679187586663],
    [-0.00487900894707044, 0.00016755993898534], [-0.00486234009335561, 0.00016968157345446], [-0.00485737490288736, 0.00017180713324431],
    [-0.00484106070563455, 0.00017251073661092], [-0.0048321942940841, 0.00017321683790891], [-0.0048201359743755, 0.00017392186866488],
    [-0.00480949628051497, 0.00017569098775602], [-0.00479992055604049, 0.00017746046369449], [-0.00478750757986987, 0.00017745630047554],
    [-0.0047782865118574, 0.00017958043287604], [-0.00476906544384494, 0.00018170456527653], [-0.00475700712413634, 0.00018099144598088]
  ],
  /* Rock — SSL */
  [
    [0.6788791618527406, 0.00068787552301086], [-0.25671050678827934, -0.0001769174945449], [0.1513583989661528, 7.481480365043e-05],
    [-0.11813512969090802, -5.191138121359e-05], [0.08329104347166429, 1.871054659794e-05], [-0.07663817456103936, -2.751359071705e-05],
    [0.05477586152148759, 7.44843212679e-06], [-0.05547314737187786, -1.025289931145e-05], [0.03822948356540711, -2.49791561457e-06],
    [-0.04199383340841713, 6.7328840674e-07], [0.02695796542339694, -7.96704606548e-06], [-0.03228715059431878, 5.79711816722e-06],
    [0.01846929689819187, -9.8401780495e-06], [-0.02528050435045951, 7.01189792484e-06], [0.01207844846859765, -1.522630289356e-05],
    [-0.01894464378378515, 1.20545637208e-05], [0.00667804407593324, -1.343604283817e-05], [-0.0140841804547313, 1.246443581504e-05],
    [0.00228696509481569, -1.506764046927e-05], [-0.01006277891348454, 9.70723079112e-06], [-0.00132368373546377, -1.188847238761e-05],
    [-0.00676615715578373, 1.209129844861e-05], [-0.00426288438418556, -1.286836943559e-05], [-0.00408897698639688, 1.102542567911e-05],
    [-0.00662040619382751, -1.206328529063e-05], [-0.00196101294183599, 9.50703614981e-06], [-0.00845620581010342, -1.279970295678e-05],
    [-0.00032595215043616, 9.20518241371e-06], [-0.00982957737435458, -1.177745362317e-05], [0.00086920573760513, 9.13758382404e-06],
    [-0.01079020871452061, -9.00750153697e-06], [0.0016761360633446, 7.32769151038e-06], [-0.01138050011044332, -9.46908207442e-06]
  ],
  /* Lush — Neve */
  [
    [0.2064160269316795, -0.00078952185394898], [-0.07601816702459827, -0.00022786334179951], [0.03929765560019285, -0.00054517993246352],
    [0.00298333157711103, -0.00033083756545638], [-0.0072400628230461, -0.00045483683460812], [0.03073108963506036, -0.00038190060537423],
    [-0.02332434692533051, -0.00040347288688932], [0.03792606869061214, -0.00039673687335892], [-0.02437059376675688, -0.00037221210539535],
    [0.03416764311979521, -0.00040314850796953], [-0.01761669868102127, -0.00035989484330131], [0.02538237753523052, -0.00040149119125394],
    [-0.00770737340728377, -0.00035462118723555], [0.01580706228482803, -0.00037563141307594], [0.00055119240005586, -0.00035409299268971],
    [0.00818552143438768, -0.0003650766104218], [0.00661842703548304, -0.00034550528559056], [0.00362447476272098, -0.0003555301276124],
    [0.00957098027225745, -0.00034091691045338], [0.0019362177401666, -0.00034554529131668], [0.01005433027357935, -0.00033878223153845],
    [0.00221712428802004, -0.00033481410137711], [0.00911255639207995, -0.00033263425232666], [0.00339667169034909, -0.0003263442803843],
    [0.00774096948249924, -0.00032599868802996], [0.00463907626773794, -0.00032131993173361], [0.00658222997260378, -0.00032014977430211],
    [0.00550347079924993, -0.00031557153256653], [0.00588754981375325, -0.00032041307242303], [0.00590293898419892, -0.00030457857428714],
    [0.005589520104418, -0.00030448053548086], [0.00598183557634295, -0.00030715064323181], [0.00555223929714115, -0.00030319367948553]
  ],
  /* Vibe — Elation */
  [
    [-0.258679353586565, 0.00045755657070112], [0.11509367290253694, -0.00017494270657228], [-0.06709853575891785, 0.00058913102597723],
    [0.01871006356851681, -3.387358004645e-05], [-0.00794797957360465, 0.00044224784691203], [-0.0195692181739422, 6.718936750076e-05],
    [0.01682120257195205, 0.0003285744629223], [-0.03401069039824205, 0.00013634182872897], [0.02369950268232634, 0.00023112685751657],
    [-0.03477071178117132, 0.000180297922316], [0.02024369717958201, 0.00017337813374202], [-0.02819087729102172, 0.0002143853866542],
    [0.01147946743141303, 0.00014424066034649], [-0.01894777011468867, 0.00021549146262408], [0.00301370330346873, 0.00013527460148394],
    [-0.01067147835815486, 0.00020960689910868], [-0.00402715397506384, 0.0001442158271247], [-0.00502221703392005, 0.00019805767015024],
    [-0.00808788533308497, 0.00016095444141931], [-0.00232696588842683, 0.00018384470981829], [-0.00943950821324531, 0.00017098987347593],
    [-0.00193709517200834, 0.00018151995939591], [-0.00899713952612659, 0.00017385835059948], [-0.00280584331659089, 0.0001774216416247],
    [-0.0078038100195497, 0.00018002500755708], [-0.00400370310490333, 0.00017471691087957], [-0.00661527728186928, 0.00018137323370347],
    [-0.00496545526864518, 0.00017681872601767], [-0.00580728820997532, 0.0001818622038979], [-0.00549309984725666, 0.00017722985399075],
    [-0.00542194777529239, 0.00018486900185338], [-0.00565992080998939, 0.00018005824393118], [-0.00532121562846656, 0.00018643189636216]
  ],
  /* Holo — Precision 8 */
  [
    [0.5918844027455189, -8.361469668405e-05], [-0.24439750948076133, -2.651678396848e-05], [0.1410987610320562, -8.40487181372e-06],
    [-0.10053507128157971, -1.768100964598e-05], [0.05859287880626238, -3.61398065989e-06], [-0.0433740688982366, -7.35941182117e-06],
    [0.01589900680531097, 2.07347387987e-06], [-0.01087234854973281, -7.32123412029e-06], [-0.00845782429679176, 1.33058605071e-06],
    [0.00662278586618295, -4.24594730611e-06], [-0.02000592193760155, -6.32896879068e-06], [0.01321157777167565, -1.42117159257e-05],
    [-0.02249955362988238, -1.63937127317e-06], [0.01196492077581504, -5.35385220676e-06], [-0.01905917427000097, -1.2167288203e-06],
    [0.00761909482108073, -3.26242895115e-06], [-0.01362744780256239, -3.59274216003e-06], [0.00200183122683721, -8.9207452791e-07],
    [-0.00833042637239315, -9.46767677294e-06], [-0.00258481175207224, 8.7429351464e-07], [-0.00459744479712244, 4.9519758701e-07],
    [-0.0053427703099382, -3.97547847155e-06], [-0.00272332919605675, -4.0077229097e-07], [-0.00637243782359372, 1.39419072176e-06],
    [-0.00233001590327504, -4.20129915747e-06], [-0.00623296727793041, -1.9010664856e-07], [-0.00276177096376805, -5.80301901385e-06],
    [-0.00559184754866264, -8.0597287792e-07], [-0.00343180144395919, 2.43701142085e-06], [-0.00493325428861701, -3.009857409e-06],
    [-0.00396140827680823, 5.1459681789e-07], [-0.00448497879902493, -7.44412841743e-06], [-0.00425146888772076, 8.2346016542e-07]
  ],
  /* Punch — API */
  [
    [0.09299870608542582, -9.582362368873e-05], [-0.1194784771074101, 4.50089160277e-05], [0.09071606264761795, 5.639498984741e-05],
    [-0.0856198277083698, 4.964855606916e-05], [0.06440549220820363, 2.428052139507e-05], [-0.05987991812840746, -1.0186708229e-06],
    [0.03980233135839382, 3.312430049041e-05], [-0.03648402630896925, 2.116186381142e-05], [0.01826860869525248, 3.115110025396e-05],
    [-0.01723968622495364, 2.450634121718e-05], [0.00187588812316724, 2.838206198968e-05], [-0.00381796423957237, 3.155815499462e-05],
    [-0.00852092214496733, 1.702651162392e-05], [0.00315560292270588, 2.547861676047e-05], [-0.01258630914496868, 4.555319243213e-05],
    [0.00536435648963575, 1.812393657101e-05], [-0.01272975658159178, 4.103775306121e-05], [0.00403818975172755, 3.764615492871e-05],
    [-0.01042617366897483, 3.605210426041e-05], [0.00126599583390057, 4.305458668852e-05], [-0.00747876207688339, 3.731207018977e-05],
    [-0.00149873689175324, 5.086601800791e-05], [-0.00503221309488033, 3.636086782783e-05], [-0.00342998224655821, 4.103091180506e-05],
    [-0.00355585977903117, 3.6989821454e-05], [-0.00437201792934817, 2.720235666939e-05], [-0.00299217874451556, 4.446954727956e-05],
    [-0.00457924652487249, 3.85906577886e-05], [-0.00298182934892027, 2.064710931733e-05], [-0.00438838441540584, 5.223008424866e-05],
    [-0.00323984218794705, 3.397987535887e-05], [-0.00407693981307314, 3.935772436894e-05], [-0.00350435348467321, 5.525463935338e-05]
  ],
  /* Steel — Calibre */
  [
    [-0.23505923670562212, 0.00028312859289245], [0.08188436704577637, -8.817721351341e-05], [-0.05075798481700617, 0.00018817166632483],
    [-0.00455811821873093, -1.922902995296e-05], [-0.0002761052143366, 0.00013252525469291], [-0.03529246280346626, 2.772989223299e-05],
    [0.01784111585586136, 0.00010230276997291], [-0.04394950700298298, 5.910607126944e-05], [0.01990770780547606, 7.640328340556e-05],
    [-0.04073629569741782, 7.71232711709e-05], [0.01349648572795252, 5.959130575917e-05], [-0.03191590248003717, 8.418000575151e-05],
    [0.00348795527924766, 5.489156318238e-05], [-0.02198496281481767, 8.471601187581e-05], [-0.00504771152505089, 5.525060587917e-05],
    [-0.01391075698598491, 7.929630732607e-05], [-0.01142762504081717, 5.967036737742e-05], [-0.00893541815021255, 7.535697758141e-05],
    [-0.01459704973464936, 5.969199602841e-05], [-0.00694755135226282, 6.930127097865e-05], [-0.01516695630808575, 6.365800069826e-05],
    [-0.00705917318113651, 6.497209096539e-05], [-0.01420501209177591, 6.555654576113e-05], [-0.00815905656808701, 6.105622534761e-05],
    [-0.01274326525552961, 6.542652857017e-05], [-0.00937146927845488, 6.051267868722e-05], [-0.01146573981165209, 6.381511607749e-05],
    [-0.01021294359409007, 5.930397856398e-05], [-0.01065217095323532, 6.371505438319e-05], [-0.01058751196699751, 6.042857480233e-05],
    [-0.01026557827762401, 6.007776163871e-05], [-0.01060929183604604, 6.114703012726e-05], [-0.01014533525058528, 5.963567932887e-05]
  ],
  /* Tube — Manley */
  [
    [-0.2064160269316795, 0.00078952185394898], [0.07601816702459827, 0.00022786334179951], [-0.03929765560019285, 0.00054517993246352],
    [-0.00298333157711103, 0.00033083756545638], [0.0072400628230461, 0.00045483683460812], [-0.03073108963506036, 0.00038190060537423],
    [0.02332434692533051, 0.00040347288688932], [-0.03792606869061214, 0.00039673687335892], [0.02437059376675688, 0.00037221210539535],
    [-0.03416764311979521, 0.00040314850796953], [0.01761669868102127, 0.00035989484330131], [-0.02538237753523052, 0.00040149119125394],
    [0.00770737340728377, 0.00035462118723555], [-0.01580706228482803, 0.00037563141307594], [-0.00055119240005586, 0.00035409299268971],
    [-0.00818552143438768, 0.0003650766104218], [-0.00661842703548304, 0.00034550528559056], [-0.00362447476272098, 0.0003555301276124],
    [-0.00957098027225745, 0.00034091691045338], [-0.0019362177401666, 0.00034554529131668], [-0.01005433027357935, 0.00033878223153845],
    [-0.00221712428802004, 0.00033481410137711], [-0.00911255639207995, 0.00033263425232666], [-0.00339667169034909, 0.0003263442803843],
    [-0.00774096948249924, 0.00032599868802996], [-0.00463907626773794, 0.00032131993173361], [-0.00658222997260378, 0.00032014977430211],
    [-0.00550347079924993, 0.00031557153256653], [-0.00588754981375325, 0.00032041307242303], [-0.00590293898419892, 0.00030457857428714],
    [-0.005589520104418, 0.00030448053548086], [-0.00598183557634295, 0.00030715064323181], [-0.00555223929714115, 0.00030319367948553]
  ]
];

/** Le décalage du détecteur d'affaissement, par couleur (« offsetA »). */
const DECALAGES = [4, 3, 5, 8, 5, 7, 7, 6];

/** Les gains d'entrée et de sortie de Chris, en décibels sur son échelle. */
const ENTREES_DB = [-5.2, -6.2, -2.9, -1.1, -5.1, -3.6, -2.3, -2.9];
const SORTIES_DB = [-0.3, 0.5, -0.7, -0.6, -0.2, 0.3, 0.1, 0.9];

/** L'échelle de Chris : ses décibels se divisent par quatorze. */
const ECHELLE_DB = 14.0;
/** Au-delà, le redresseur de Chris rend un, et non le sinus. */
const QUART_DE_TOUR = 1.57079633;

export class BussColors4 {
  constructor(taux) {
    this.taux = taux > 0 ? taux : 48000;
    let e = this.taux / 44100.0;
    if (e < 1.0) e = 1.0;
    if (e > 4.5) e = 4.5;
    this.echelle = e;
    this.tampon = Math.floor(34.0 * e);          // la plus longue prise utile
    // les prises, mises à l'échelle du taux : c[k] = k * echelle
    this.prises = new Int32Array(34);
    for (let k = 0; k < 34; k++) this.prises[k] = Math.floor(k * e);
    // TAMPON CIRCULAIRE (voir l'en-tête) : un par canal, plus une position
    this.taille = this.tampon + 1;
    this.ligneG = new Float64Array(this.taille);
    this.ligneD = new Float64Array(this.taille);
    this.pos = 0;
    // l'affaissement : une moyenne glissante de la valeur absolue
    this.sagG = new Float64Array(99);
    this.sagD = new Float64Array(99);
    this.compteur = 44;
    this.controleG = 0;
    this.controleD = 0;
    this.lentG = 0;
    this.lentD = 0;
    this._allume = false;
  }

  vider() {
    this.ligneG.fill(0); this.ligneD.fill(0);
    this.sagG.fill(0); this.sagD.fill(0);
    this.pos = 0;
    this.compteur = 44;
    this.controleG = 0; this.controleD = 0;
    this.lentG = 0; this.lentD = 0;
  }

  /** Une couleur qu'on rallume repart de rien — sinon elle recrache l'avant. */
  _armer(allume) {
    if (allume !== this._allume) { this.vider(); this._allume = allume; }
  }

  /**
   * `couleur` : l'indice dans TAPS. `entree` et `sortie` : les deux gains de
   * Chris (0 à 1, centrés sur la moitié). `melange` : la part traitée.
   */
  traiter(gauche, droite, couleur, entree, sortie, melange) {
    this._armer(true);
    const i = Math.min(TAPS.length - 1, Math.max(0, Math.round(couleur) || 0));
    const taps = TAPS[i];
    let decalage = Math.floor(DECALAGES[i] * this.echelle);
    if (decalage < 3) decalage = 3;
    const gainE = (10 ** (ENTREES_DB[i] / ECHELLE_DB))
      * (10 ** (((Math.min(1, Math.max(0, entree)) * 36.0) - 18.0) / ECHELLE_DB));
    const gainS = (10 ** (SORTIES_DB[i] / ECHELLE_DB))
      * (10 ** ((((Math.min(1, Math.max(0, sortie)) * 36.0) - 18.0) + 3.3) / ECHELLE_DB));
    const part = Math.min(1, Math.max(0, melange));
    const mono = droite === gauche;

    for (let n = 0; n < gauche.length; n++) {
      const secG = gauche[n];
      const secD = mono ? secG : droite[n];
      let g = secG * gainE;
      let d = mono ? g : secD * gainE;

      /* — LE PREMIER ÉTAGE : un redresseur en sinus, et l'affaissement — */
      // `lent` monte avec ce qui passe et redescend d'un millième par
      // échantillon : c'est l'alimentation d'une console qui fatigue.
      let brut = Math.abs(g);
      this.lentG = Math.min(1.5, (this.lentG * 0.999) + brut);
      const dynG = 2.5 + this.lentG;
      let redresse = brut > QUART_DE_TOUR ? 1.0 : Math.sin(brut);
      g = g > 0 ? redresse : -redresse;

      let dynD = dynG;
      if (!mono) {
        brut = Math.abs(d);
        this.lentD = Math.min(1.5, (this.lentD * 0.999) + brut);
        dynD = 2.5 + this.lentD;
        redresse = brut > QUART_DE_TOUR ? 1.0 : Math.sin(brut);
        d = d > 0 ? redresse : -redresse;
      }

      /* — l'affaissement proprement dit : une moyenne sur `decalage` — */
      if (this.compteur < 0 || this.compteur > 44) this.compteur = 44;
      const c = this.compteur;
      this.sagG[c + 44] = this.sagG[c] = Math.abs(g);
      this.controleG += this.sagG[c] / decalage;
      this.controleG -= this.sagG[c + decalage] / decalage;
      this.controleG -= 0.000001;
      this.controleG = Math.min(100, Math.max(0, this.controleG));
      const appliqueG = (this.controleG / decalage) * dynG;

      let appliqueD = appliqueG;
      if (!mono) {
        this.sagD[c + 44] = this.sagD[c] = Math.abs(d);
        this.controleD += this.sagD[c] / decalage;
        this.controleD -= this.sagD[c + decalage] / decalage;
        this.controleD -= 0.000001;
        this.controleD = Math.min(100, Math.max(0, this.controleD));
        appliqueD = (this.controleD / decalage) * dynD;
      }
      this.compteur--;

      /* — LA CONVOLUTION : trente-trois prises aux poids mouvants — */
      this.pos = this.pos === 0 ? this.taille - 1 : this.pos - 1;
      this.ligneG[this.pos] = g;
      if (!mono) this.ligneD[this.pos] = d;
      for (let k = 1; k <= 33; k++) {
        const t = taps[k - 1];
        const j = this.pos + this.prises[k];
        const idx = j >= this.taille ? j - this.taille : j;
        g += this.ligneG[idx] * (t[0] + (t[1] * appliqueG));
        if (!mono) d += this.ligneD[idx] * (t[0] + (t[1] * appliqueD));
      }

      /* — LE SECOND ÉTAGE : un cosinus, qui creuse au lieu d'arrondir — */
      let creux = 1.0 - Math.cos(Math.abs(g));
      g = g > 0 ? g - creux : g + creux;
      if (!mono) {
        creux = 1.0 - Math.cos(Math.abs(d));
        d = d > 0 ? d - creux : d + creux;
      }

      g *= gainS;
      if (!mono) d *= gainS;
      if (part !== 1.0) {
        g = (g * part) + (secG * (1.0 - part));
        if (!mono) d = (d * part) + (secD * (1.0 - part));
      }
      gauche[n] = g;
      if (!mono) droite[n] = d;
    }
  }

  /** Éteinte : on passe tout droit, mais on note qu'on dort. */
  dormir() { this._armer(false); }
}

class CouleursProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'actif', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'couleur', defaultValue: 2, minValue: 0, maxValue: 7, automationRate: 'k-rate' },
      { name: 'entree', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'sortie', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'melange', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' }
    ];
  }

  constructor() {
    super();
    this.moteur = new BussColors4(sampleRate);
    this.vivant = true;
    this.port.onmessage = (e) => {
      if (e.data?.arret) this.vivant = false;
      if (e.data?.vider) this.moteur.vider();
    };
  }

  process(entrees, sorties, parametres) {
    const entree = entrees[0];
    const sortie = sorties[0];
    if (!sortie || !sortie.length) return this.vivant;
    // Pas de queue à entretenir : sans entrée on rend du silence, et les
    // trente-trois prises gardent ce qu'elles avaient.
    if (!entree || !entree.length) {
      for (const canal of sortie) canal.fill(0);
      return this.vivant;
    }
    sortie[0].set(entree[0]);
    if (sortie.length > 1) sortie[1].set(entree.length > 1 ? entree[1] : entree[0]);
    const g = sortie[0];
    const d = sortie.length > 1 ? sortie[1] : sortie[0];
    if (parametres.actif[0] > 0.5) {
      this.moteur.traiter(g, d, parametres.couleur[0], parametres.entree[0],
        parametres.sortie[0], parametres.melange[0]);
    } else {
      this.moteur.dormir();
    }
    for (let c = 2; c < sortie.length; c++) sortie[c].set(g);
    return this.vivant;
  }
}

registerProcessor('galerie-couleurs', CouleursProcessor);

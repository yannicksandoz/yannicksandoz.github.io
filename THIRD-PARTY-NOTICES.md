# Avis relatifs aux composants tiers

Ce dépôt intègre ou charge les composants tiers listés ci-dessous. Leurs
licences respectives s'appliquent à eux, indépendamment des licences de ce
dépôt (voir `LICENSE.txt`).

Aucun de ces composants n'est vendoré — **à une exception près, signalée
comme telle** (le limiteur Airwindows, plus bas) : les autres sont soit
installés par `npm` ou `bundler`, soit chargés depuis un CDN. Les inventaires
ci-dessous sont donc à relire après toute mise à jour de dépendance.

Dernière vérification : 12 août 2026.

---

## Galerie 3D — `galerie/`

### Livré au visiteur (présent dans le build)

| Composant | Version | Licence | Copyright |
|---|---|---|---|
| [three.js](https://threejs.org) | 0.166.1 | MIT | © 2010-2024 three.js authors |
| [Airwindows](https://github.com/airwindows/airwindows) — `Pressure4`, `ClipOnly2`, `Console6`, `Monitoring`, `Verbity`, `Galactic2`, `Distance2`, `ClearCoat`, `Ultrasonic`, `Infrasonic`, `Channel9`, `BussColors4`, `ToTape6`, `Console7`, `Pressure5` | portage 2026 | MIT | © 2016, 2018 airwindows (Chris Johnson) |
| [Slug](https://github.com/EricLengyel/Slug) — algorithme de lettrage, portage 2026 | shaders de référence | MIT OU Apache-2.0 | © 2017 Eric Lengyel |
| [Inter](https://github.com/rsms/inter) *(courbes extraites ; `@fontsource/inter` en dépendance de développement)* | 5.3.0 | **SIL OFL 1.1** | © 2016 The Inter Project Authors |
| [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) | 0.9.14 | MIT | © 2018 Garrett Johnson |
| Matières « hardwood2 » et « brick » *(rapatriées du dépôt three.js, tag r166, désaturées et réduites)* | r166 | MIT | © 2010-2024 three.js authors |
| Panoramas « aube » et « appartement » *(via `@pmndrs/assets`, HDRI Poly Haven)* | 1.7.0 | **CC0-1.0** | domaine public |
| [GaussianSplats3D](https://github.com/mkkellogg/GaussianSplats3D) — rendu des œuvres « scan » | 0.4.7 | MIT | © 2023 Mark Kellogg |

**Le lettrage est un PORTAGE de Slug, et le crédit est une CONDITION.** Les
shaders de référence d'Eric Lengyel (SlugPixelShader.hlsl,
SlugVertexShader.hlsl) sont transcrits en GLSL dans
`engine/src/core/lettrage.js`, et l'auteur écrit : « If you do use this code
in software that gets distributed in any way, then you are required to give
credit. » Le crédit vit dans les chaînes GLSL (il survit à la minification,
le garde-fou le vérifie), dans les en-têtes de fichiers et dans
`galerie/content/LICENCES/slug-MIT.txt`, livré avec chaque build. Le brevet
de l'algorithme a été versé au domaine public par son auteur en 2026.

**La police n'est plus livrée en fichier : ses COURBES sont dans le code.**
`scripts/genere-lettrage.mjs` extrait de l'Inter du dépôt les contours
quadratiques des 126 caractères du jeu courant, le crénage et les métriques,
et les écrit dans `engine/src/core/lettrage-inter.js`. L'**OFL 1.1** suit la
fonte sous cette forme dérivée : la licence est distribuée
(`galerie/content/LICENCES/inter-OFL.txt`), les données de police ne sont pas
vendues seules, et le nom « Inter » n'est pas utilisé pour une version
modifiée. `troika-three-text` (SDF), qui dessinait les cartels avant Slug, a
été retiré avec ses dépendances.

**Les matières et les panoramas sont RAPATRIÉS, avec leur provenance.**
`scripts/rapatrie-matieres.mjs` télécharge une fois, transforme (albédos
désaturés : la couleur reste celle des pièces — le contrat des textures de
la galerie), et écrit des fichiers commités dans `engine/assets/`, avec
`provenance.json` : source exacte, taille et empreinte SHA-256 de chaque
fichier, que `test-matieres.mjs` revérifie à chaque chaîne. Le CC0 n'exige
rien ; on cite quand même. La MIT de three.js couvre déjà le moteur.

**`three-mesh-bvh` est chargé À LA DEMANDE, et ne l'est jamais aujourd'hui.**
Mesuré au navigateur, la plus grosse cible de collision de la galerie fait
douze triangles : un arbre de volumes englobants n'y sert à rien. La
bibliothèque vit donc dans un morceau séparé que le navigateur ne demande que
si un modèle dépasse deux mille triangles. Voir `engine/src/core/rayons.js`,
qui porte les mesures.

**Airwindows est VENDORÉ, et porté.** Plusieurs plugins de Chris Johnson sont
réécrits en JavaScript :

- `engine/src/core/limiteur-worklet.js` — le compresseur vari-µ *Pressure4* et
  l'écrêteur *ClipOnly2*, dans un AudioWorklet ;
- `engine/src/core/Console.js` — la table de mixage *Console6* (encodage de
  tranche, décodage de bus), en `WaveShaperNode` natifs. Son encodage/décodage
  vient lui-même de **torridgristle**, également sous licence MIT, comme le
  note le code d'origine ;
- `engine/src/core/monitoring-worklet.js` — *Monitoring*, l'écoute de contrôle
  de l'auteur : mono, côté, graves (SubsOnly), crêtes (PeaksOnly) et la
  diaphonie de casque (Cans C), longueurs d'allpass comprises ;
- `engine/src/core/reverb-worklet.js` — *Verbity*, la réverbération des
  pièces : trois blocs de quatre lignes de retard et leurs matrices de
  Householder, avec les longueurs de Chris ;
- `engine/src/core/galactique-worklet.js` — *Galactic2*, le grand espace :
  les seize longueurs de son unique jeu (290 ms, « un stade de dix mille
  places »), les quatre étages de Householder, le CONDITIONNEMENT NON
  LINÉAIRE de la contre-réaction — quatre gains qui grandissent avec ce qui
  les traverse — les dix seuils d'assombrissement et l'arc sinus rapide de
  sortie ;
- `engine/src/core/premieres-worklet.js` — *ClearCoat*, les premières
  réflexions des pièces : dix-sept jeux de seize longueurs de ligne (de la
  salle de 96 places au hall de 1541), leurs quatre étages de Householder et
  l'étage SubTight, avec les valeurs de Chris — qui ne les a pas réglées mais
  CHERCHÉES, une sur des centaines de milliers de tirages ;
- `engine/src/core/pression5-worklet.js` — *Pressure5* : le compresseur
  vari-µ et ses deux jeux de coefficients alternés, les deux Butterworth
  fixes à 24 kHz, la modulation de la courbe par la pente (« PawClaw ») et
  l'écrêteur *ClipOnly2* qu'il embarque ;
- `engine/src/core/console7-worklet.js` — *Console7Channel* et
  *Console7Buss*, la table version sept : les deux mélanges d'harmoniques
  (Spiral et Density d'un côté, leurs réciproques en arc sinus de l'autre),
  les passe-bas à 20 kHz et leurs Q au nombre d'or, et le fader poursuivi ;
- `engine/src/core/bande-worklet.js` — *ToTape6*, la bande : le pleurage
  interpolé sur un tampon de cinq cents cases, la bosse de tête non linéaire
  et son passe-bande, l'adoucissement des aigus, l'étage « mojo », l'UnBox et
  l'écrêteur ADClip ;
- `engine/src/core/couleurs-worklet.js` — *BussColors4*, les huit couleurs de
  bus (Dark, Rock, Lush, Vibe, Holo, Punch, Steel, Tube) : les huit jeux de
  trente-trois coefficients relevés par Chris sur du vrai matériel, leurs
  gains d'entrée et de sortie, l'affaissement dynamique et les deux étages de
  saturation. Les coefficients ont été extraits de son source par programme,
  et l'extraction validée en comparant ses blocs gauche et droit ;
- `engine/src/core/pupitre-worklet.js` — *Channel9*, les cinq tables de
  mixage (Neve, API, SSL, Teac, Mackie) : les trois constantes de chacune, le
  passe-haut « diélectrique » dont la vitesse suit le niveau, la saturation
  *Spiral* et l'écrêtage de pente au nombre d'or ;
- `engine/src/core/hygiene-worklet.js` — *Ultrasonic* et *Infrasonic*, les
  deux bornes de l'audible : un Butterworth d'ordre dix en cinq biquads de
  chaque côté, avec les fréquences (20 kHz, 20 Hz) et les cinq facteurs de
  qualité de Chris ;
- `engine/src/core/lointain-worklet.js` — *Distance2* (lui-même l'hybride de
  ses plugins *Distance* et *Atmosphere*) : la cascade de treize limiteurs de
  pente aux seuils du nombre d'or, l'étage d'*offset air compression* et
  l'IIR qui « écrase ce qui est très lointain ».

L'algorithme, les coefficients et les constantes sont les siens ; les en-têtes
portent le copyright, et la console de mixage l'affiche à l'auteur.

**La licence MIT demande DEUX choses, pas une** — et c'est un piège où l'on
tombe volontiers, parce qu'on retient « MIT = il suffit de citer l'auteur ».
Le texte dit exactement : *« The above copyright notice **and this permission
notice** shall be included in all copies or substantial portions of the
Software »*. Il faut donc que le TEXTE de la licence voyage avec le code, et
pas seulement le nom. Neuf plugins portés, c'est une part substantielle, et
un portage est une œuvre dérivée.

Le texte complet est donc livré, à la racine du dépôt
([`LICENSE-airwindows-MIT.txt`](LICENSE-airwindows-MIT.txt)) **et dans le
build**, en `LICENCES/airwindows-MIT.txt`, avec la liste des fichiers qu'il
couvre. `scripts/check-visitor-build.mjs` refuse de publier un build où il
manquerait, serait tronqué, ou dont le JS aurait perdu les en-têtes de
copyright à la minification — l'invariant est vérifié sur le RÉSULTAT, comme
les autres. Ce dépôt refuse de publier une œuvre dont l'attribution est
incomplète : la règle vaut d'abord pour lui.

**Six écarts assumés au réglage d'origine**, documentés dans le code : le
limiteur *rend* le gain de rattrapage de Pressure4 (sans quoi le brancher
monte toute la galerie de +3 dB) et dose sa saturation sinus par un réglage
`caractere`, à zéro par défaut ; le lointain coupe le CONTINU que pose
l'*offset air compression* de Distance2 (0,12 mesuré à fond de course, même
sur du silence — quinze œuvres l'additionneraient dans le limiteur du
maître), sous 10 Hz et sur la seule part traitée. Enfin, l'hygiène BORNE ses
coupures à 0,46 fois le taux d'échantillonnage : Chris pose 20 kHz sans
condition, ce qui est juste dans une station, et le navigateur ouvre parfois
un contexte à 22 050 Hz — 20 kHz passerait alors au-dessus de Nyquist et le
biquad partirait en oscillation. À 44,1 et 48 kHz la borne ne mord pas. Enfin, les couleurs
de bus utilisent un tampon CIRCULAIRE là où Chris décale le sien d'un cran à
chaque échantillon : trente-quatre recopies par échantillon et par canal, ce
qu'un moteur JavaScript n'a aucune raison de faire. L'arithmétique est
identique, et le test compare les deux implémentations échantillon par
échantillon sur les huit couleurs. Enfin, la bande
tire le hasard de son pleurage d'un générateur À ELLE et non de l'état du
dither, que l'on ne porte pas : le pleurage est donc reproductible d'une
visite à l'autre, ce qui n'est pas un défaut ici et rend le portage
éprouvable. Les
algorithmes ne sont pas modifiés ; ce sont des robinets posés autour d'eux,
et ils se remettent à la valeur de Chris.

Le moteur importe également des **modules d'exemple** de three.js
(`three/addons/…`, dossier `examples/jsm` du dépôt three.js). Ils sont publiés
sous la même licence MIT que la bibliothèque, et sont ici comptés à part parce
qu'ils suivent le rythme de développement des exemples, pas celui du cœur :

*Chemin visiteur*
- `controls/OrbitControls.js`
- `postprocessing/EffectComposer.js`
- `postprocessing/RenderPass.js`
- `postprocessing/UnrealBloomPass.js`
- `postprocessing/ShaderPass.js`
- `postprocessing/OutputPass.js`
- `loaders/GLTFLoader.js` — chargé à la demande, uniquement si une œuvre
  utilise un modèle glTF/GLB

*Mode Auteur uniquement*
- `controls/TransformControls.js`
- `loaders/OBJLoader.js`
- `loaders/MTLLoader.js`
- `exporters/GLTFExporter.js` — utilisé hors ligne par `npm run library`,
  jamais livré

Le mode Auteur embarque en outre
[three-gpu-pathtracer](https://github.com/gkjohnson/three-gpu-pathtracer)
(0.0.23, MIT, © 2022 Garrett Johnson) : le bouton « 📸 Photo » de la barre
d'outils, un rendu de la vue courante par transport de lumière, pour tirer
une image de presse de la vraie scène. La bibliothèque est chargée
dynamiquement au premier clic et n'existe que dans le build Auteur — le
garde-fou de publication refuse un build Visiteur qui en porterait la
moindre trace.

### Outillage (jamais livré)

| Composant | Version | Licence |
|---|---|---|
| [Vite](https://vitejs.dev) | 5.4.x | MIT |

Vite et ses dépendances transitives servent à construire le site ; aucun de
leurs fichiers ne se retrouve dans `dist/`.

### Rien d'autre

Le bundle du **runtime Visiteur ne contient aucune référence réseau externe** :
une galerie publiée ne contacte aucun service tiers et fonctionne indéfiniment
hors ligne. Le seul motif d'URL présent dans le bundle est l'espace de noms XML
`http://www.w3.org/1999/xhtml`, qui n'est pas une requête.

Deux exceptions à connaître, qui ne contredisent pas ce qui précède :

- le module `TipJar` ouvre une page de paiement externe (Ko-fi) **au clic**,
  jamais au chargement ;
- le blog à la racine du site, lui, charge une feuille de style depuis un CDN
  (voir plus bas) — mais il est distinct de `/galerie/`.

---

## Blog / thème Jekyll — racine du dépôt

| Composant | Licence | Copyright |
|---|---|---|
| Thème [github/personal-website](https://github.com/github/personal-website) | MIT | © 2019 GitHub |
| [Primer CSS](https://primer.style) — chargé depuis `unpkg.com` | MIT | © GitHub |
| [github-pages](https://github.com/github/pages-gem) (gem) | MIT | © GitHub |
| [jekyll-github-metadata](https://github.com/jekyll/github-metadata) | MIT | © Parker Moore et contributeurs |
| [jekyll-octicons](https://github.com/primer/octicons) | MIT | © GitHub |
| [jemoji](https://github.com/jekyll/jemoji) | MIT | © Parker Moore et contributeurs |

Le texte intégral de la licence MIT du thème figure dans
[`LICENSE-theme-MIT.txt`](LICENSE-theme-MIT.txt).

**Primer est chargé depuis `https://unpkg.com/primer/build/build.css`** par
`assets/styles.scss`. C'est la seule dépendance CDN du site, et elle ne
concerne que le blog : si `unpkg.com` tombe, le blog perd sa mise en forme,
la galerie n'est pas affectée.

---

## Mobilier de galerie — `galerie/content/library/`

Ces modèles ne sont pas des composants tiers : ils sont produits par
`npm run library` à partir de `scripts/generate-library.mjs`, et placés dans
le domaine public sous CC0-1.0. Voir `galerie/content/RIGHTS.md`.

---

## Modèles importés par l'auteur

Un modèle 3D ajouté à une scène depuis une source externe conserve **sa
propre licence**, indépendante de tout ce qui précède. L'éditeur enregistre
son auteur, sa licence et son URL source dans la configuration de l'œuvre, et
le mode Visiteur les publie dans son écran de crédits. Une licence
Creative Commons BY impose de citer : c'est à cela que sert cet écran, et
c'est pourquoi il n'est pas désactivable lorsque la scène contient de tels
modèles.

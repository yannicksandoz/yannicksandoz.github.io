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
| [Airwindows](https://github.com/airwindows/airwindows) — `Pressure4`, `ClipOnly2`, `Console6`, `Monitoring`, `Verbity` | portage 2026 | MIT | © 2016, 2018 airwindows (Chris Johnson) |

**Airwindows est VENDORÉ, et porté.** Trois plugins de Chris Johnson sont
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
  Householder, avec les longueurs de Chris.

L'algorithme, les coefficients et les constantes sont les siens ; les en-têtes
portent le copyright et la licence, et la console de mixage l'affiche à
l'auteur. La licence MIT n'exige rien de plus que cette mention — la
respecter est le minimum, et ce dépôt refuse de publier une œuvre dont
l'attribution est incomplète : la règle vaut d'abord pour lui.

**Deux écarts assumés au réglage d'origine**, documentés dans le code : le
limiteur *rend* le gain de rattrapage de Pressure4 (sans quoi le brancher
monte toute la galerie de +3 dB) et dose sa saturation sinus par un réglage
`caractere`, à zéro par défaut. L'algorithme n'est pas modifié ; ce sont deux
robinets posés autour de lui, et ils se remettent à la valeur de Chris.

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

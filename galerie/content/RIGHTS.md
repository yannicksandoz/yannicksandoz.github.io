# Droits sur le contenu — Tous droits réservés

Le contenu de ce dossier (`content/`) — œuvres, configurations d'œuvres
(`works/*.json`), images, textures, pistes audio et tout autre média — est la
propriété exclusive de son auteur.

**Tous droits réservés.** © Yannick Sandoz.

Ce contenu est **explicitement HORS du périmètre de la licence du moteur**
(dossier `engine/`). Obtenir une licence sur le moteur ne vous accorde
aucun droit de reproduction, de distribution, de modification ni de
représentation sur les œuvres de ce dossier.

Concrètement :

- le **moteur** est propriétaire, tous droits réservés : son usage suppose une
  licence commerciale (voir `engine/LICENSE`) ;
- vous ne pouvez **pas** réutiliser les œuvres de ce dossier dans vos propres
  déploiements sans autorisation écrite préalable ;
- pour faire tourner le moteur, remplacez ce dossier par **votre propre
  contenu** (voir le README, section « Utiliser le moteur avec votre
  contenu »).

Les fichiers de démonstration générés par `npm run assets` (textures et sons
synthétiques) peuvent être régénérés librement par le script — c'est le
résultat de VOS exécutions du script ; les fichiers présents dans ce dossier
restent couverts par la présente mention.

## Exception — `content/library/` : domaine public (CC0-1.0)

Le sous-dossier **`content/library/`** (mobilier de galerie : socles,
cimaise, colonne, arche, banc, cadre, estrade… — modèles GLB, vignettes SVG
et catalogue `index.json`) est **explicitement exclu** de la mention
« tous droits réservés » ci-dessus.

Il est placé sous [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/deed.fr),
c'est-à-dire dans le domaine public : réutilisez-le librement, y compris
commercialement, sans attribution.

La raison est simple : ce mobilier n'est pas une œuvre, c'est un outil. Il
fait partie de ce que le moteur apporte, et il doit rester utilisable par qui
obtient une licence du moteur. Il vit dans
`content/` seulement parce que c'est le dossier servi au navigateur.

Ces fichiers sont reproductibles à l'identique par `npm run library`, dont le
source (`scripts/generate-library.mjs`) reste couvert par la licence du moteur.

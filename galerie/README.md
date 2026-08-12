# Galerie — espace sonore 3D

Galerie d'art 3D immersive, **100 % statique et autohébergeable**, séparée en
deux moitiés qui ne se mélangent pas :

- **`engine/`** — le **moteur** réutilisable (cœur, modules de comportement,
  système de configuration), **propriétaire, tous droits réservés** ;
- **`content/`** — le **contenu** (œuvres `works/*.json` + médias), propriété
  de l'artiste, **tous droits réservés** (voir `content/RIGHTS.md`).

Chaque œuvre est décrite par un JSON qui active des *modules* (spatialisation
audio, réactivité visuelle, caméra de focus, chapeau…). Les œuvres vivent dans
des **pièces connectées par des portails** (rooms/*.json), et un **éditeur de
scène in-browser** permet de composer ces espaces à partir de médias importés
(images, vidéos, sons) puis d'exporter le résultat en JSON. Aucune base de
données, aucun backend — un simple serveur de fichiers suffit.

**Stack** : [Vite](https://vitejs.dev) · [Three.js](https://threejs.org)
(EffectComposer : bloom + grain) · Web Audio API · modules ES.

## Démarrage

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # → dist/ (site statique prêt à déployer)
npm run preview    # prévisualise le build
npm run assets     # régénère les textures/stems de démo (aucune dépendance)
```

**Navigation** — desktop : ZQSD / WASD / flèches (Maj = courir), souris pour
orbiter, clic sur une œuvre pour l'approcher (Échap pour reculer).
Mobile : **1 doigt** pour regarder autour, **2 doigts** pour se déplacer et
pincer pour zoomer, joystick virtuel pour marcher. Le bouton **Entrer**
débloque l'`AudioContext` (obligatoire sur tous les navigateurs, iOS en tête).

## Déploiement

### Automatique — GitHub Pages (configuré)

Le workflow [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml)
construit le blog Jekyll **et** la galerie, puis publie le tout sur GitHub
Pages : la galerie est servie sous **`/galerie/`** de l'URL Pages du dépôt.

**Pour redéployer :** il suffit de pousser sur `master` (ou de lancer le
workflow à la main : onglet *Actions* → *Deploy Pages (blog + galerie)* →
*Run workflow*).

```bash
git push origin master        # → build + déploiement automatiques
```

**Prérequis : *Settings → Pages → Source* doit être sur « GitHub Actions ».**
Le workflow force ce réglage lui-même à chaque exécution (appel à l'API
Pages), mais il vaut la peine de savoir pourquoi c'est indispensable.

Tant que la source reste sur « Deploy from a branch », GitHub lance à chaque
push son **propre** build Jekyll (workflow « pages build and deployment »)
*en plus* du nôtre. Or ce build ignore `galerie/` — le dossier est exclu dans
`_config.yml` puisque c'est un projet Vite, pas du Jekyll — et il écrase
notre déploiement une fois sur deux. Symptôme caractéristique : **le blog
s'affiche mais `/galerie/` renvoie 404**, alors que le workflow est vert et
que l'artefact contient bien la galerie.

Si vous revoyez ce symptôme, vérifiez dans l'onglet *Actions* qu'un run
« pages build and deployment » ne se déclenche plus en parallèle du nôtre ;
s'il est encore là, repassez la source sur « GitHub Actions » à la main.

### Manuel — Nginx

```nginx
server {
    listen 443 ssl;
    server_name galerie.exemple.org;
    # ssl_certificate ... ; ssl_certificate_key ... ;

    root /var/www/galerie;          # contenu de dist/
    index index.html;

    gzip on;
    gzip_types application/javascript application/json text/css;

    location ~* \.(wav|mp3|ogg|png|jpg|glb|gltf)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
```

```bash
npm run build && rsync -av dist/ serveur:/var/www/galerie/
```

### Manuel — Caddy

```caddyfile
galerie.exemple.org {
    root * /var/www/galerie
    file_server
    encode gzip
    @assets path *.wav *.mp3 *.ogg *.png *.jpg *.glb *.gltf
    header @assets Cache-Control "public, max-age=2592000, immutable"
}
```

`base: './'` est configuré dans Vite : le build fonctionne à la racine d'un
domaine comme dans n'importe quel sous-dossier, sans réglage.

## Utiliser le moteur avec VOTRE contenu

Le moteur ne connaît pas les œuvres : il lit un dossier de contenu servi
statiquement (par défaut `content/`). Pour brancher le vôtre **sans toucher
au code du moteur** :

1. Créez un dossier avec cette structure :

   ```
   mon-contenu/
   ├── works/
   │   ├── index.json        # ["oeuvre-1.json", "oeuvre-2.json"]
   │   └── oeuvre-1.json
   ├── rooms/                # optionnel : pièces connectées (sinon pièce unique)
   │   ├── index.json        # ["hall.json", …]
   │   └── hall.json
   ├── audio/ …              # vos stems
   ├── assets/ …             # médias importés via l'éditeur
   └── textures/ …           # vos images (et models/ pour les .glb)
   ```

   Les médias peuvent aussi vivre hors du dépôt : toute source (`image`,
   `video`, `stems[].file`, `ambience[].file`, `model.url`) accepte
   indifféremment un chemin relatif ou une URL absolue.

2. Pointez le moteur dessus au build (ou en dev) :

   ```bash
   GALERIE_CONTENT=../mon-contenu npm run build
   GALERIE_CONTENT=../mon-contenu npm run dev
   ```

   (ou remplacez simplement le dossier `content/` par le vôtre).

3. C'est tout : les chemins `image`, `stems[].file`, `model.url` des JSON
   sont relatifs à la racine du dossier de contenu.

### Décrire une œuvre

```jsonc
{
  "id": "mon-oeuvre",              // identifiant unique (nom d'export)
  "title": "Titre affiché",
  "description": "Texte de la fiche (module FocusCamera).",
  "schemaVersion": 2,              // porté par le premier objet du fichier
  "position": [x, y, z],
  "rotation": [0, 0, 0],           // degrés, trois axes
  "loadDistance": 50,              // distance de chargement paresseux (optionnel)
  "lightColor": "#7a6cff",         // lumière d'appoint de l'œuvre (optionnel)

  // — visuel : au choix —
  // (toute source média accepte un chemin relatif OU une URL absolue)
  "image": "textures/mon-image.png",   // ou "https://exemple.org/image.jpg"
  "size": [6, 4],                  // largeur, hauteur du panneau (image/vidéo)
  // ou une vidéo (playsinline + muted : l'autoplay passe sur iOS) :
  "video": "assets/clip.mp4",
  "videoSound": true,              // son de la vidéo routé dans le bus spatialisé
  // ou un modèle :
  "model": { "type": "gltf", "url": "models/piece.glb", "scale": 1 },
  // ou la primitive shader intégrée :
  "model": { "shape": "monolith", "height": 4.5, "color": "#66f0d8" },
  // ou une construction voxel (mode Voxel de l'éditeur) :
  "model": {
    "type": "voxel",
    "dims": [16, 16, 16],          // nombre de cellules par axe (64 max)
    "cell": 0.25,                  // arête d'une cellule, en mètres
    "palette": ["#8a7cff", "#66f0d8"],
    "cells": [40, 0, 3, 1, 4053, 0] // RLE : longueur, valeur, longueur, valeur…
  },                               // valeur 0 = vide, n ≥ 1 = couleur n−1
  "scale": [1, 1, 1],              // échelle par axe (gizmo « échelle »)

  // — audio : autant de pistes que voulu, lues en boucle —
  "stems": [
    { "file": "audio/nappe.wav", "radius": 20, "gain": 0.9 }
  ],

  // — comportements —
  "modules": [
    { "type": "SpatialCrossfade", "params": { "radius": 20, "inner": 5 } },
    { "type": "FocusCamera", "params": { "distance": 7 } }
  ]
}
```

Ajout pas à pas : déposer les médias → créer le JSON → l'ajouter à
`works/index.json` → recharger. Ou plus simple : composer directement dans
**l'éditeur de scène** (ci-dessous) et exporter.

**Compatibilité du format.** Les scènes écrites avant le schéma v2
(`rotationY` scalaire, `scale` uniforme) se chargent telles quelles : la
migration est appliquée en mémoire au chargement, dans le runtime comme dans
l'éditeur. Vos anciens JSON n'ont rien à changer ; l'export, lui, écrit
toujours du v2.

### Décrire une pièce (rooms/*.json)

```jsonc
{
  "id": "hall",
  "title": "Hall",
  "spawn": [0, 2.2, 14],           // point d'arrivée (position caméra)
  "fogColor": "#05050a",           // ambiance visuelle de la pièce (optionnel)
  "ambience": [                    // nappes propres à la pièce, fondues quand
    { "file": "audio/vent.wav", "gain": 0.3 }   // on entre/sort (optionnel)
  ],
  "works": ["nebuleuse", "marees"],// œuvres présentes (ids de works/*.json)
  "portals": [
    {
      "to": "annexe",              // pièce de destination
      "position": [-5, 0, -22],    // pied du portail
      "rotation": [0, 12, 0],
      "label": "Annexe",           // étiquette flottante
      "arrival": [0, 2.2, 8]       // où l'on apparaît dans la destination
    }
  ]
}
```

Référencées par `rooms/index.json` (ou un `rooms/rooms.json` combiné, produit
par l'export de l'éditeur, qui prend le pas). **Sans dossier rooms/, la
galerie fonctionne en pièce unique** contenant toutes les œuvres.

Franchir un portail (s'en approcher, ou le toucher/cliquer) déclenche un fondu
puis téléporte au point d'arrivée. Performance : seule la pièce courante est
rendue (culling par pièce) ; ses voisines directes sont préchargées mais
muettes et invisibles ; tout le reste est déchargé (textures, sources audio,
buffers, vidéos en pause).

## Éditeur de scène (mode auteur)

**Lancer** : touche **E**, bouton **✎** (en haut à droite), ou ouvrir l'URL
avec **`?edit`** (ex. `http://localhost:5173/?edit`). Les mêmes commandes
referment l'éditeur. Utilisable au doigt sur iOS : panneaux repliables,
champs numériques pour le placement précis, barre d'outils défilante.

**Barre d'outils** : 📁 Médias (import de fichiers), 🔗 URL (média distant),
⤒ JSON (réimport d'un export), ＋ Objet, gizmos ↔ / ⟳ / ⤢ (raccourcis
1 / 2 / 3), ⧉ dupliquer, 🗑 supprimer (Suppr), 💾 Exporter, ✕ quitter.

### Importer des médias

Deux voies équivalentes : **fichiers locaux** (glisser-déposer sur la fenêtre,
ou 📁 Médias) et **URLs externes** (bouton 🔗 URL, ou section « Importer » du
panneau). Dans les deux cas, le média produit le même type d'objet :

- **image** (jpg/png/webp) → plan texturé ;
- **vidéo** (mp4/webm) → plan avec VideoTexture (autoplay iOS : playsinline
  + muted ; cochez « son de la vidéo » pour router l'audio dans le bus
  spatialisé de l'objet, débloqué au tap) ;
- **son(s)** (mp3/ogg/wav) → objet sonore spatialisé ; plusieurs sons
  importés ensemble forment un seul objet multi-stems.

Avec un objet **sélectionné**, l'image/vidéo importée **remplace** son visuel
et les sons **s'ajoutent** en stems. Le bouton « ＋ Ambiance » importe un son
comme ambiance de la pièce courante.

#### Fichier local ou URL externe ?

|  | Fichier local | URL externe |
|---|---|---|
| Stocké dans le JSON | `assets/<nom>` (chemin relatif) | l'URL absolue, telle quelle |
| Après rechargement de la page | **perdu** tant que le fichier n'est pas déposé dans `content/assets/` | **conservé** — rechargé depuis l'hôte distant |
| Hébergement | votre dépôt (le média est versionné) | l'hôte distant, qui doit autoriser le **CORS** |

Un média référencé par URL **persiste d'une session à l'autre** : c'est la
voie la plus rapide pour composer une scène sans rien copier dans le dépôt.
Un fichier importé, lui, vit en URL blob le temps de la session — il faut le
déposer dans `content/assets/` pour la version déployée (voir « Publier »).

**Contrainte CORS.** Un média distant est chargé en `crossOrigin="anonymous"`
(obligatoire : WebGL doit pouvoir lire ses pixels, et l'audio son buffer).
L'hôte doit donc renvoyer un en-tête `Access-Control-Allow-Origin` permissif.
Beaucoup d'hébergeurs d'images grand public ne le font pas ; en cas de doute,
préférez un stockage objet configuré pour le CORS (S3/R2/Bucket avec règle
CORS), votre propre serveur, ou déposez simplement le fichier dans
`content/assets/`.

L'éditeur **valide chaque URL avant de créer l'objet** : une URL injoignable
(CORS refusé, 404, réseau, format non pris en charge) est signalée sous le
champ d'import et ignorée — rien n'est ajouté à la scène. Si un média cesse
d'être joignable **plus tard** (hôte hors ligne, fichier supprimé), la scène
ne plante pas : l'objet reste en place avec un **placeholder rouge**, l'erreur
est écrite en console et affichée dans son panneau de propriétés.

### Éditer les objets

Clic sur un objet → sélection : gizmo (déplacer/tourner/échelle) **et**
champs numériques x/y/z, rotation, échelle dans le panneau — indispensables
sur tactile. Le panneau expose : titre, description, taille du plan, stems
(rayon/gain par piste, sphères de rayon visibles), son de vidéo, et les
modules activés (crossfade spatial + rayon, HRTF, réactivité audio, focus
caméra). Dupliquer/Supprimer via la barre d'outils.

### Mode Voxel — construire cellule par cellule

La barre d'outils propose deux modes : **◻ Objets** (médias, primitives,
gizmos) et **▦ Voxel** (touche **V**). Une construction voxel n'est pas un
type d'objet à part : c'est une œuvre ordinaire dont le modèle est une
grille. Elle accepte donc **stems, modules et transformation** comme les
autres, sans réglage particulier — on peut spatialiser un son dans une
maison qu'on vient de bâtir.

Créer : « ＋ Primitive… → Construction voxel », ou le bouton
« ＋ Nouvelle construction » du panneau. L'objet apparaît devant la caméra,
posé au sol, avec son volume de construction et son quadrillage.

Gestes, identiques à la souris et au doigt :

| Geste | Effet |
| --- | --- |
| clic bref sur une face | pose une cellule contre cette face |
| clic bref sur le quadrillage | pose une cellule au sol |
| clic maintenu et glissé | orbite — rien n'est posé |
| clic droit, ou Alt + clic | retire la cellule visée |
| outil **⌫ Gomme** | le clic simple retire (utile au doigt) |
| outil **⊙ Pipette** | reprend la couleur d'une cellule, puis repasse en pose |
| outil **▤ Boîte** | deux clics : remplit le pavé entre les deux coins |

La **palette** : la pastille choisit la couleur du pinceau, le petit carré
sous elle la modifie — et toute la construction suit, puisque les cellules
stockent un index et non une couleur. Les champs x/y/z redimensionnent la
grille en conservant ce qui y tient encore ; « taille d'une cellule » change
l'échelle du bâti sans toucher au dessin.

Chaque geste est une entrée d'annulation (**Ctrl/Cmd + Z**) et rien n'est
« cuit » : le JSON contient la grille, pas un maillage.

**Ce que ça coûte.** La grille est encodée en RLE (`longueur, valeur, …`),
donc une petite maison de 378 cellules pèse ≈ 1 ko de JSON. Le rendu est un
**seul appel de dessin** quel que soit le nombre de cubes (`InstancedMesh`),
et les cellules entièrement entourées ne sont pas instanciées. Coût mesuré
d'une pose, reconstruction du maillage comprise : **0,017 ms** en 16³,
**0,13 ms** en 32³, **1,1 ms** en 64³ (le maximum autorisé par axe).

### Pièces et portails

Section « Pièce » du panneau : changer de pièce active, la renommer, choisir
sa couleur de brouillard, définir le point d'arrivée (« Point d'arrivée
ici »), gérer son ambiance sonore. « ＋ Nouvelle pièce » crée une pièce vide
et y bascule ; « ＋ Portail » relie la pièce courante à la pièce choisie (un
portail de retour est créé automatiquement, déplaçable ensuite comme
n'importe quel objet — clic dessus pour le sélectionner, cible/étiquette
modifiables).

### Publier (site 100 % statique, sans backend)

1. **💾 Exporter** télécharge `works.json` et `rooms.json` ;
2. déposez-les dans `content/works/` et `content/rooms/` (les fichiers
   combinés prennent le pas sur les `index.json`) ;
3. copiez les médias **importés en fichier** dans **`content/assets/`** en
   gardant les noms listés dans le panneau « Publier » après l'export (les
   JSON les référencent par `assets/<nom>`) ; les médias référencés par URL
   n'ont rien à copier — leur URL absolue est déjà dans le JSON ;
4. `git add … && git commit && git push` → le déploiement automatique met le
   site à jour.

**Réimport** : ⤒ JSON (ou glisser un `.json` sur la fenêtre) recharge un
export — works.json, rooms.json ou les deux — pour reprendre l'édition plus
tard. Les médias déjà déployés dans `content/` et **ceux référencés par URL**
se rechargent normalement ; seuls les blobs d'une session précédente ne
survivent pas au rechargement (re-glissez les fichiers ou déployez-les).

## Modules fournis

| Module | Rôle | Paramètres principaux |
|---|---|---|
| `SpatialCrossfade` | Volume global de l'œuvre selon la distance (smoothstep) | `radius`, `inner`, `maxGain` |
| `StemMixer` | Mixe chaque stem selon **son propre** rayon — les couches se révèlent en approchant | `innerRatio` |
| `HRTFPanner` | Spatialisation binaurale (PannerNode HRTF), son localisé au casque | `refDistance`, `maxDistance`, `rolloff`, `distanceModel` |
| `AudioReactive` | AnalyserNode → pulsation, émission, uniform `uAudio`, lumière | `band`, `pulseScale`, `emissiveBoost`, `lightBoost`, `smoothing`, `gate` |
| `FocusCamera` | Travelling doux vers l'œuvre au clic + fiche titre/description | `distance`, `height`, `duration` |
| `TipJar` | Chapeau de fin d'expérience (voir ci-dessous) | `enabled`, `message`, `buttonLabel`, `url`, `visitRadius`, `delay` |

Les trois œuvres de démo illustrent trois recettes : *Nébuleuse*
(`SpatialCrossfade` + `AudioReactive`), *Triptyque des marées* (`StemMixer`,
rayons 26/14/7), *Monolithe 55 Hz* (`HRTFPanner` + shader réactif + `TipJar`).

### Le chapeau (TipJar)

Quand le visiteur a approché toutes les œuvres, un écran discret propose de
soutenir l'artiste ; un petit ♥ en coin d'écran le garde accessible. Le
bouton **redirige vers une page de paiement hébergée** (Ko-fi, Stripe Payment
Link, PayPal.me, Liberapay…) dans un nouvel onglet : **aucune donnée bancaire
ne transite par le site**, qui reste entièrement statique.

Activez-le sur **une seule** œuvre (n'importe laquelle) :

```json
{
  "type": "TipJar",
  "params": {
    "enabled": true,
    "message": "Si cet espace vous a touché, vous pouvez soutenir son artiste.",
    "buttonLabel": "Soutenir l'artiste",
    "url": "https://ko-fi.com/votre-compte"
  }
}
```

`enabled: false` (ou `url` vide) désactive tout, proprement. Remplacez
l'URL d'exemple `https://ko-fi.com/REMPLACEZ-MOI` de la démo par votre lien.

## Créer un nouveau module

Un module est une classe qui étend `Module` (`engine/src/modules/Module.js`) :

```js
// engine/src/modules/OrbitMotion.js — exemple : l'œuvre tourne sur elle-même
import { Module } from './Module.js';

export class OrbitMotion extends Module {
  init() {                       // la scène est prête
    this.speed = this.params.speed ?? 0.2;
  }
  onAudioReady() {}              // le bus audio de l'œuvre vient d'être créé
  onAudioReleased() {}           // il va être libéré (déchargement mémoire)
  update(dt, ctx) {              // chaque frame ; ctx = { app, camera, cameraPos, time, distance }
    this.artwork.group.rotation.y += this.speed * dt;
  }
  onClick() {}                   // clic sur l'œuvre ; return true = consommé
  dispose() {}                   // libérer nœuds audio, listeners, objets 3D
}
```

Enregistrement dans `engine/src/main.js` :

```js
import { OrbitMotion } from './modules/OrbitMotion.js';
registry.register('OrbitMotion', OrbitMotion);
```

Points d'appui : `this.artwork.bus` (GainNode de l'œuvre),
`this.artwork.setAudioLevel(...)` (canal standard vers le visuel),
`this.app.audio.ctx` (AudioContext partagé), `this.app.quality.profile`
(profil de l'appareil), `this.app.controls` / `this.app.camera`.

## Qualité adaptative & mobile

Le `QualityManager` (`engine/src/core/Quality.js`) choisit un profil au
lancement puis l'ajuste en continu :

- **détection** : mobile vs desktop (pointer coarse + UA), lecture du GPU
  (`WEBGL_debug_renderer_info`) pour rétrograder les GPU faibles ;
- **plafonds** : `pixelRatio` ≤ 2 (desktop) / 1,5 (mobile), bloom au quart de
  résolution et textures ≤ 1024 px sur mobile, **6 stems audio simultanés
  max sur mobile** (24 sur desktop) avec *voice stealing* par distance : les
  œuvres les plus proches gardent leurs pistes, les plus lointaines sont
  suspendues ;
- **gouverneur FPS** : sous 27 fps pendant 3 s, la qualité descend d'un cran
  (pixelRatio → grain → bloom), sans jamais remonter (pas d'oscillation) ;
- **mémoire** : textures et buffers audio chargés à l'approche
  (`loadDistance`, 50 par défaut) et **libérés** au-delà de 1,6 × cette
  distance (dispose des textures, arrêt des sources, buffers oubliés) ;
- **pièces** : seule la pièce courante est rendue et audible ; les pièces
  adjacentes (via portails) sont préchargées, les autres entièrement
  libérées ; les vidéos hors pièce courante sont mises en pause et
  déchargées ;
- **iOS Safari** : resume() + buffer silencieux à chaque tap si le contexte
  audio n'est plus « running » ;
- **divers** : boucle et audio en pause quand l'onglet est masqué
  (`visibilitychange`), `prefers-reduced-motion` respecté (pas de grain
  animé, pas de pulsation géométrique, travellings quasi instantanés),
  échec de chargement d'un asset = placeholder conservé + log, jamais de
  plantage (un média distant devenu injoignable vire au placeholder rouge) ;
  fallback explicite si WebGL2 est absent.

## Licences

| Dossier | Licence |
|---|---|
| `engine/` (+ `index.html`, `vite.config.js`, `scripts/`) | **Propriétaire — tous droits réservés** — voir [`engine/LICENSE`](engine/LICENSE) |
| `content/` | **Tous droits réservés** — voir [`content/RIGHTS.md`](content/RIGHTS.md) |

Le moteur n'est pas libre. Aucun droit d'usage, de reproduction, de
modification ou de redistribution n'est concédé par défaut. Le fait que le
code arrive dans le navigateur d'un visiteur ne lui confère aucun droit :
c'est nécessaire à l'exécution, rien de plus.

**Licence commerciale disponible sur demande** — contact :
**yro.lab.licence@gmail.com**.

Les œuvres du dossier `content/` ne sont **pas** couvertes par cette licence : ce
sont des créations personnelles, tous droits réservés. Déployez le moteur
avec votre propre contenu.

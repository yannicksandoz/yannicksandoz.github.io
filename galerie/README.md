# Galerie — espace sonore 3D

Galerie d'art 3D immersive, **100 % statique et autohébergeable**, pensée comme
un système modulaire : chaque œuvre est décrite par un fichier JSON qui active
des *modules de comportement* (spatialisation audio, réactivité visuelle,
caméra de focus…). Aucune base de données, aucun backend — un simple serveur
de fichiers suffit.

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

**Navigation** : ZQSD / WASD / flèches pour se déplacer (Maj = courir), souris
ou tactile pour orbiter, joystick virtuel sur mobile. Clic sur une œuvre pour
l'approcher (Échap pour reculer). Le bouton **Entrer** débloque
l'`AudioContext` (obligatoire sur tous les navigateurs). Un bouton VR apparaît
si le navigateur supporte WebXR (nécessite HTTPS).

## Architecture

```
src/
├── main.js                  # amorçage + enregistrement des modules
├── core/
│   ├── App.js               # scène, boucle, post-processing, picking, XR
│   ├── Artwork.js           # une œuvre : visuel + bus audio + modules
│   ├── AudioEngine.js       # AudioContext partagé, cache, listener 3D
│   ├── ConfigLoader.js      # lecture de public/works/*.json
│   ├── ModuleRegistry.js    # registre type → classe de module
│   └── utils.js             # smoothstep, easing, résolution d'URL
├── modules/                 # les comportements activables par la config
├── controls/Controls.js     # orbite + clavier + joystick tactile
├── editor/Editor.js         # mode édition (touche E)
└── ui/UI.js                 # écran d'accueil, fiche d'œuvre
public/
├── works/                   # configuration des œuvres (JSON)
├── audio/                   # stems (chargés paresseusement)
└── textures/                # images (chargées paresseusement)
```

Le **cœur est minimal** : `App` fait tourner la scène et la boucle, `Artwork`
matérialise une config. Tout le reste est un module avec un cycle de vie
`init → onAudioReady → update → dispose`, instancié uniquement si la config
d'une œuvre le demande. Les assets (textures, audio) ne sont chargés que
lorsque la caméra s'approche à moins de `loadDistance` (50 par défaut).

## Décrire une œuvre

Une œuvre = un fichier dans `public/works/`, référencé par
`public/works/index.json` :

```jsonc
{
  "id": "mon-oeuvre",              // identifiant unique (nom d'export)
  "title": "Titre affiché",
  "description": "Texte de la fiche (module FocusCamera).",
  "position": [x, y, z],
  "rotationY": 0,                  // degrés
  "loadDistance": 50,              // distance de chargement paresseux (optionnel)
  "lightColor": "#7a6cff",         // lumière d'appoint de l'œuvre (optionnel)

  // — visuel : au choix —
  "image": "textures/mon-image.png",
  "size": [6, 4],                  // largeur, hauteur du panneau (avec "image")
  // ou un modèle :
  "model": { "type": "gltf", "url": "models/piece.glb", "scale": 1 },
  // ou la primitive shader intégrée :
  "model": { "shape": "monolith", "height": 4.5, "color": "#66f0d8" },

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

### Ajouter une œuvre, pas à pas

1. Déposer l'image (ou le `.glb`) dans `public/textures/` (ou `public/models/`)
   et les pistes audio dans `public/audio/` (WAV, OGG, MP3 — tout ce que
   `decodeAudioData` accepte ; préférez des boucles sans couture).
2. Créer `public/works/mon-oeuvre.json` sur le modèle ci-dessus.
3. Ajouter `"mon-oeuvre.json"` dans `public/works/index.json`.
4. Recharger la page — aucun build nécessaire en dev, les JSON sont lus au
   démarrage.
5. Affiner le placement en jeu : touche **E**, glisser le gizmo, régler les
   rayons, puis **exporter** (voir plus bas).

## Modules fournis

| Module | Rôle | Paramètres principaux |
|---|---|---|
| `SpatialCrossfade` | Volume global de l'œuvre selon la distance (courbe smoothstep) | `radius` (silence), `inner` (plein volume), `maxGain` |
| `StemMixer` | Mixe chaque stem selon **son propre** rayon (`radius`/`gain` des stems) — les couches se révèlent en approchant | `innerRatio` |
| `HRTFPanner` | Spatialisation binaurale (PannerNode HRTF) : son localisé dans l'espace, au casque | `refDistance`, `maxDistance`, `rolloff`, `distanceModel` |
| `AudioReactive` | AnalyserNode sur le bus de l'œuvre → pulsation d'échelle, émission du matériau, uniform `uAudio` des shaders, lumière | `band` (`low`/`mid`/`high`/`all`), `pulseScale`, `emissiveBoost`, `lightBoost`, `smoothing`, `gate` |
| `FocusCamera` | Travelling doux vers l'œuvre au clic + fiche titre/description | `distance`, `height`, `duration` |

Les modules se combinent librement — les trois œuvres de démo illustrent trois
recettes différentes :

- **Nébuleuse** : `SpatialCrossfade` + `AudioReactive` (l'image respire sur les basses) ;
- **Triptyque des marées** : `StemMixer` avec trois rayons concentriques (26 / 14 / 7) ;
- **Monolithe 55 Hz** : `HRTFPanner` (binaural) + `AudioReactive` pilotant les uniforms d'un shader custom.

## Créer un nouveau module

Un module est une classe qui étend `Module` (`src/modules/Module.js`) :

```js
// src/modules/OrbitMotion.js — exemple : l'œuvre tourne sur elle-même
import { Module } from './Module.js';

export class OrbitMotion extends Module {
  init() {
    // appelé une fois, la scène est prête ; this.artwork, this.params, this.app
    this.speed = this.params.speed ?? 0.2;
  }

  onAudioReady() {
    // optionnel : le bus audio de l'œuvre existe (this.artwork.bus, .stems),
    // appelé juste AVANT le démarrage des sources
  }

  update(dt, ctx) {
    // chaque frame ; ctx = { app, camera, cameraPos, time, distance }
    this.artwork.group.rotation.y += this.speed * dt;
  }

  onClick() { /* optionnel : return true pour consommer le clic */ }

  dispose() { /* libérer nœuds audio, listeners, objets 3D */ }
}
```

Puis l'enregistrer dans `src/main.js` :

```js
import { OrbitMotion } from './modules/OrbitMotion.js';
registry.register('OrbitMotion', OrbitMotion);
```

Il devient activable depuis n'importe quelle œuvre :

```json
{ "type": "OrbitMotion", "params": { "speed": 0.35 } }
```

Points d'appui utiles : `this.artwork.bus` (GainNode de l'œuvre, à tapper ou
re-router), `this.artwork.setAudioLevel(...)` (canal standard vers le visuel),
`this.app.audio.ctx` (AudioContext partagé), `this.app.controls` /
`this.app.camera`.

## Mode édition (touche E)

- **Clic sur une œuvre** → gizmo de translation ([TransformControls](https://threejs.org/docs/#examples/en/controls/TransformControls)).
- Les **sphères filaires** matérialisent les rayons audio : une couleur par
  stem, violet pour le rayon du `SpatialCrossfade`. Les sliders du panneau les
  redimensionnent en direct — le mix audio réagit immédiatement.
- **Exporter `<id>.json`** télécharge la config de l'œuvre sélectionnée (à
  remettre dans `public/works/`). **Tout exporter** télécharge un
  `works.json` combiné : déposé dans `public/works/`, il **prend le pas** sur
  `index.json` + fichiers individuels au chargement suivant.

## Déploiement

`npm run build` produit `dist/` : des fichiers statiques, sans en-têtes
spéciaux requis. `base: './'` est configuré : le site fonctionne à la racine
d'un domaine comme dans un sous-dossier. Seule contrainte : **HTTPS** pour
WebXR (et recommandé pour l'audio).

### Nginx

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
rsync -av dist/ serveur:/var/www/galerie/
```

### Caddy

```caddyfile
galerie.exemple.org {
    root * /var/www/galerie
    file_server
    encode gzip
    @assets path *.wav *.mp3 *.ogg *.png *.jpg *.glb *.gltf
    header @assets Cache-Control "public, max-age=2592000, immutable"
}
```

Caddy gère les certificats HTTPS automatiquement. Pour GitHub Pages ou tout
autre hébergeur statique : servez simplement le contenu de `dist/`.

## Performances & mobile

- `pixelRatio` plafonné à 2, bloom en demi-résolution, brouillard exponentiel
  qui limite la profondeur utile de rendu ;
- textures et stems chargés **paresseusement** à l'approche (`loadDistance`) ;
- le `GLTFLoader` n'est téléchargé que si une œuvre utilise un modèle
  (import dynamique, chunk séparé) ;
- contrôles tactiles natifs (orbite/pincement) + joystick virtuel ;
- audio : préférez des boucles courtes ; un WAV mono 22 kHz suffit largement
  pour des nappes (les fichiers de démo font ~260 Ko chacun).

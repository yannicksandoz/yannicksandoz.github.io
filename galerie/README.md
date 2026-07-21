# Galerie — espace sonore 3D

Galerie d'art 3D immersive, **100 % statique et autohébergeable**, séparée en
deux moitiés qui ne se mélangent pas :

- **`engine/`** — le **moteur** réutilisable (cœur, modules de comportement,
  système de configuration), **propriétaire, tous droits réservés** ;
- **`content/`** — le **contenu** (œuvres `works/*.json` + médias), propriété
  de l'artiste, **tous droits réservés** (voir `content/RIGHTS.md`).

Chaque œuvre est décrite par un JSON qui active des *modules* (spatialisation
audio, réactivité visuelle, caméra de focus, chapeau…). Aucune base de
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

Prérequis à vérifier une seule fois : *Settings → Pages → Source* doit être
sur **GitHub Actions** (le workflow tente de l'activer tout seul ; si le
premier run échoue sur l'étape de déploiement, faites ce réglage puis
relancez).

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
   ├── audio/ …              # vos stems
   └── textures/ …           # vos images (et models/ pour les .glb)
   ```

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

Ajout pas à pas : déposer les médias → créer le JSON → l'ajouter à
`works/index.json` → recharger. Affinez ensuite en jeu : touche **E**,
glisser le gizmo, régler les rayons (sphères visibles), puis **exporter** le
JSON mis à jour (l'export `works.json` combiné, déposé dans `works/`, prend
le pas sur `index.json`).

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
- **iOS Safari** : resume() + buffer silencieux à chaque tap si le contexte
  audio n'est plus « running » ;
- **divers** : boucle et audio en pause quand l'onglet est masqué
  (`visibilitychange`), `prefers-reduced-motion` respecté (pas de grain
  animé, pas de pulsation géométrique, travellings quasi instantanés),
  échec de chargement d'un asset = placeholder conservé + log, jamais de
  plantage ; fallback explicite si WebGL2 est absent.

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

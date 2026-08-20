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

## Deux modes

Le moteur se construit de deux façons, à partir de la même base de code.

| | Mode **Visiteur** | Mode **Auteur** |
|---|---|---|
| Ce que c'est | la galerie publiée | l'éditeur complet |
| Où | en ligne (GitHub Pages) | sur votre machine, jamais publié |
| Éditeur | **absent du résultat** — pas désactivé, pas émis | présent |
| Commande | `npm run build` | `npm run dev` / `npm run build:auteur` |

La distinction n'est pas cosmétique. Auparavant l'éditeur était simplement
chargé à la demande : le chunk partait quand même sur Pages et restait
**téléchargeable par simple URL**, quelle que soit la visibilité du dépôt.
Un site statique ne peut pas cacher ce qu'il publie — la seule protection
est de ne pas le publier.

En mode Visiteur, trois choses disparaissent ensemble : le **JS**
(`editorLoader.js` est remplacé par un module vide, ce qui coupe la seule
racine menant à l'éditeur, donc Rollup ne l'émet pas), le **CSS**
(`editor/editor.css` est importé par l'éditeur, il suit) et le **DOM**
(le bloc `<!-- editor:start … end -->` est retiré de `index.html`).
Conséquence assumée : dans une galerie publiée, la touche **²**, le bouton
**✎** et `?edit` ne font rien.

## L'expérience visiteur

Tout ce qui suit est dans le build Visiteur, sans backend ni service tiers.

**Ne jamais perdre le visiteur.** À l'arrivée dans une pièce, la caméra cadre
déjà une œuvre. Les œuvres non encore découvertes portent une petite lueur
flottante, et un **pointeur** montre toujours la prochaine : hors du champ,
une flèche glisse au bord de l'écran ; dès qu'elle est en vue, le pointeur
se pose **au-dessus d'elle** — il ne disparaît pas au moment de confirmer.
Ce qu'il désigne suit l'ORDRE du catalogue : la **prochaine** œuvre à
découvrir (la n° 1 tant qu'elle manque, puis la n° 2…), et non la plus
proche — sans quoi l'on tombait sur la n° 6 sans rien connaître des cinq
premières, et les numéros du catalogue ne voulaient plus rien dire. Quand
elle est dans une autre pièce, le pointeur vise la porte qui y mène (chemin
le plus court dans le graphe des pièces). Le jeton ◈ suit la même règle :
il débloque la prochaine du catalogue. Le **son sert de boussole** : les rayons d'audibilité sont larges —
une œuvre lointaine reste faiblement perceptible et attire.

**Le catalogue se gagne.** Une œuvre n'est nommée qu'une fois rencontrée :
le compteur « ◆ 2 / 7 » (haut-droite) se déplie d'un clic et montre la
liste — les trouvées portent leur titre et leur salle, et **s'y rejoignent
d'un clic** ; les autres tiennent leur rang sous un « ??? », avec le rappel
de suivre le pointeur. Une œuvre est découverte après quelques secondes à
portée, ou dès qu'on l'approche. Le catalogue **se garde d'une visite à
l'autre** (voir « Mémoire de visite ») : une galerie de cette taille ne se
traverse pas d'un trait, et repartir de zéro punissait qui revient.

**« Laisse-toi porter »** (barre `◂ ▸` en bas de l'écran, ou le menu) : la
visite guidée **rejoue les œuvres découvertes**, dans l'ordre du catalogue,
du n° 1 au dernier — la caméra vole de l'une à l'autre et se pose devant
chacune. Certaines se contemplent en vol (le tore flotte au centre du cube
du belvédère) : reprendre la main là-haut **repose d'abord le visiteur au sol**,
en une descente douce, plutôt que de le laisser marcher dans le vide. Pendant la
pause, `◂` / `▸` (boutons, ou flèches gauche/droite du clavier) vont à la
précédente ou à la suivante ; **tout autre geste rend la main**. Avec
`prefers-reduced-motion`, les travellings deviennent des déplacements
quasi instantanés.

**Les jetons ◈.** De petits octaèdres dorés sont **cachés dans les
pièces** ; on les ramasse en marchant dessus (compteur sur le badge).
Au bout du parcours connu, `▸` devient `▸ ◈` : **un jeton débloque une
œuvre non découverte** — la dérive y vole, l'œuvre prend son nom au
catalogue. Pas de boîte de dialogue : le prix s'affiche sur le bouton.
Un jeton se dépense aussi **depuis le catalogue** : quand on en porte un,
les lignes « ??? » deviennent cliquables (marquées ◈) et un clic **dévoile
le nom et la pièce** de l'œuvre — sans la compter découverte : le jeton est
un indice, la rencontre reste à faire sur place. Sans jeton ni découverte,
la visite guidée reste inerte et dit pourquoi ; un seul jeton suffit à
l'armer. Les positions (et donc le NOMBRE, à régler selon celui des
œuvres) sont déclarées par pièce : `"jetons": [[x, y, z], …]` dans
`rooms/*.json`. Ramassés et solde se gardent d'une visite à l'autre, comme
le catalogue et la carte : refouiller une pièce déjà fouillée n'est pas un jeu.

**Le chapeau (TipJar)** s'appuie sur cette progression : voir « Le chapeau »
plus bas — ses trois portes sont toutes atteignables, et celle du « tout
découvert » ne compte que les découvertes **de la visite en cours** (sans
quoi un visiteur qui revient recevrait l'écran de fin au premier pas).

**La carte se dessine en marchant.** Une carte complète serait une table
des matières : on saurait d'avance combien de salles restent et comment
elles s'enchaînent, et la galerie cesserait d'être un endroit où l'on se
perd. Celle-ci ne montre que ce qu'on a vécu :

- une **pièce** n'apparaît qu'une fois qu'on y a posé le pied ;
- un **trait** n'apparaît qu'une fois le passage franchi — sauter d'une
  salle à l'autre par le menu montre les deux salles, jamais le lien ;
- une porte vue mais non prise laisse un **« ? »** : on sait qu'il y a
  quelque chose par là, on ne sait pas quoi.

Elle vit à deux endroits : la **minimap** du coin bas-droit (la salle où
l'on est, ses portes, une aiguille qui suit le regard — un clic ouvre la
grande) et la **carte** du menu, section « Pièces », où l'on saute d'un
clic dans une salle déjà connue. La liste sous la carte suit exactement la
même mémoire : elle nomme les pièces visitées et compte les autres sans les
nommer (« 11 pièces encore inconnues »). Une carte qui ménage la surprise à
côté d'une liste qui la vend n'aurait rien ménagé du tout.

**D'où viennent les coordonnées.** De nulle part : aucune pièce n'en porte,
et en tenir un jeu à jour à la main aurait été une seconde vérité, la
première à mentir. `engine/src/core/planGalerie.js` les **déduit du graphe
des portails** — chaque salle a une empreinte (`shell.width × depth`),
chaque porte une position et une orientation, et franchir une porte c'est
sortir par sa face extérieure. Un parcours en largeur pose les voisines de
l'autre côté de chaque porte, puis une relaxation rapproche ce que relie un
passage et écarte ce qui se recouvre. Le résultat n'est pas un plan
d'architecte — la galerie est un espace d'Escher, six chambres y tiennent
dans un cube — mais un **plan de métro** : les distances mentent, les liens
disent vrai. Module pur, sans Three.js ni DOM : il se teste au nœud
(`npm test`).

**Mémoire de visite.** Une seule clé de `localStorage`
(`galerie-visite`, `engine/src/core/Memoire.js`) retient les pièces
visitées, les passages franchis, les œuvres rencontrées, celles dévoilées
par un jeton, les jetons ramassés et le solde. Elle **ne retient pas** où
l'on se tenait : on revient toujours par l'entrée — retrouver ses pas est
le plaisir, être reposé là où l'on s'était arrêté ne l'est pas.

Rien n'est irréversible : **menu → Réglages → « Recommencer la visite »**
(deux clics, le premier demande) efface tout et rend la galerie au premier
jour — les jetons se recachent, le catalogue redevient une liste de « ??? »,
la carte redevient blanche, sans recharger la page. Le stockage peut être
refusé (navigation privée) : tout y est en `try`, et la visite se déroule
alors normalement, simplement sans mémoire. La minimap s'éteint depuis les
mêmes réglages.

**Fiches d'œuvre.** La fiche affiche le cartel (`year` · `technique`), la
description, un lien externe optionnel (`link`) et, pour les œuvres qui ont
une image, une **vue détail** plein écran.

**Menu de la visite** (Échap ou ☰) : la **carte** et la liste des pièces
visitées, pour sauter directement dans l'une d'elles, visite audio, **partage** (Web Share sur
mobile, copie du lien sinon) avec **lien profond** `?room=pièce` /
`?work=œuvre` — celui qui l'ouvre arrive au même endroit, **sans écran
d'accueil** (l'audio se débloque au premier geste, règle des navigateurs) —,
**plein écran**, vue liste, raccourcis, langue, « Terminer la visite ».

**Sphères de transfert de gravité.** Un seul objet par passage : une
sphère de verre où **flotte le sablier de la gravité** (deux cônes pointe
à pointe et un grain). Elle sert **les deux sens** — le sens du saut est
donné par le plan sur lequel on se tient, non par une face de l'objet
(une sphère n'en a pas). Deux anneaux, l'un pour partir l'autre pour
revenir, disaient la même chose en double ; la sphère flotte au sommet de
la volée, et ce **même point de la pièce** se retrouve à hauteur d'homme
une fois le monde pivoté. Elle se traverse en volume, avec les trois
gardes des portails : marcher, la voir, aller vers elle. Format :
`"bascules": [{ "position": […], "radius": 2.2, "transferts": [
{ "depuis": "sol", "vers": "est", "arrival": […] }, … ] }]`.

**Délai de réarmement des passages.** Un portail ou une sphère franchi se
**ferme quelques secondes** : il devient rouge, affiche le signe du sens
interdit et **décompte** ce qui reste — jamais une porte muette qui refuse
sans dire pourquoi. Une porte et **sa jumelle** (la même ouverture vue de
l'autre côté) se ferment **ensemble** : un passage ne peut pas être ouvert
d'un bord et fermé de l'autre. Et l'on ne voit jamais le décompte du
passage dans lequel on **se tient** : en débouchant d'une porte, on l'aurait
en plein cadre à l'instant même où l'on découvre la pièce. Il compte en
silence et ne se signale qu'une fois la porte quittée — quand on pourrait
vouloir y revenir. Le délai se règle dans `content/reglages.json`
(`{"cooldown": 5}`, en secondes ; 0 = aucun délai) et se surcharge passage
par passage (champ `cooldown` sur un portail ou une bascule). Il se mesure
en **temps réel**, pas en images : cinq secondes valent cinq secondes que
la machine rende à 120 images par seconde ou à trois. Le panneau « Réglages
généraux » de l'éditeur le règle à chaud et l'exporte.

**Les six chambres Face** (belvédère) : une porte par face intérieure du
cube ouvre sur une chambre cubique de 25 m **à la couleur de sa face** —
Face 1 (sol) à Face 6 (plafond), murs, sol, brume et lanterne teintés de la
même famille. Le portail de retour rend le visiteur **sur le plan d'où il
est parti** (champ `plane`) : on ressort du mur est debout sur le mur est.

**La tour jumelle** (belvédère) : deux tours identiques — trois galeries à
colonnades (6 m, 11,5 m, 17 m) reliées par des **volées-lames à double
face**, dont le dessous est lui aussi un escalier — se dressent l'une sur
le sol, l'autre sur le plafond, aux mêmes coordonnées de leur plan : dans
la pièce, la seconde pend au-dessus de la première, marches renversées
vers le bas, comme dans la gravure. Au sommet de chacune, un **anneau
bascule sur le sommet de l'autre** : on échange les gravités inverses en
marchant (l'anneau jumeau, désarmé à l'arrivée, se réarme en s'éloignant
de quelques mètres — pas de va-et-vient involontaire).

**On ne tombe pas d'un escalier — on en descend.** Le vide aussi est un
mur : à chaque pas, une sonde descend au point où il nous mènerait ; sans
sol à moins de **1,6 m** sous les pieds, le pas est refusé et l'on glisse
le long du bord, exactement comme contre une paroi. On peut se tenir sur
l'arête d'une volée, plus la passer — de face comme à reculons. Les marches
et petites descentes restent libres, et les bascules restent prenables :
leur anneau pend à 1,2 m de la crête et se déclenche à 1,7 m, avant le bord.

**On ne franchit un portail qu'en y allant.** Trois conditions, toutes
nécessaires : marcher (tourner la caméra la fait orbiter autour de sa
cible, ce qui suffisait à la pousser dans une porte voisine), **voir** le
portail (test de champ de vision sur son volume — un point aurait déclaré
« invisible » l'instant du franchissement, où la porte remplit l'écran mais
où son centre passe sous le bas du cadre), et **avancer** vers lui : reculer
dedans ou le longer ne le déclenche pas.

**Œuvres composées.** Plusieurs objets peuvent former UNE œuvre indexée :
les membres déclarent `partOf` (voir « Décrire une œuvre ») — un clic sur
n'importe quel membre ouvre la fiche commune, la proximité de n'importe
lequel compte pour la découverte, et la liste 2D n'affiche qu'une entrée.

**Vue liste 2D** (`liste.html`, générée au build depuis les mêmes JSON) :
toutes les œuvres avec texte, image et lecteur audio natif — la voie
accessible sans 3D, le repli quand WebGL2 manque, et la face indexable du
site. L'aide aux contrôles s'adapte à l'appareil (gestes tactiles sur écran
tactile, clavier/souris sinon), le zoom de la page n'est plus bloqué, et le
partage d'un lien affiche une carte d'aperçu (Open Graph / Twitter Card,
image `content/apercu.jpg`).

## Démarrage

```bash
npm install
npm run dev          # mode AUTEUR — http://localhost:5173, éditeur inclus
npm run dev:visiteur # mode Visiteur, pour vérifier ce que verra le public
npm run build        # → dist/        site publiable, SANS éditeur
npm run check        # vérifie que dist/ ne contient rien d'éditeur
npm run build:auteur # → dist-auteur/ build local avec éditeur (jamais publié)
npm run preview      # prévisualise un build
npm run test         # tests unitaires (356 assertions, 5 fichiers)
npm run assets       # régénère les textures/stems de démo
npm run library      # régénère le mobilier de galerie (GLB + vignettes)
```

**Votre quotidien reste `npm run dev`** : l'éditeur y est complet, rien ne
change. `dist-auteur/` est ignoré par git.

### L'éditeur vit dans un dépôt privé

`engine/src/editor/` est un **sous-module** pointant sur
`yannicksandoz/yr0-editor`, dépôt privé. Le build sélectif empêche de
*publier* l'éditeur ; le sous-module empêche de le *lire* dans le dépôt
public. Il faut les deux : le premier protège le déploiement, le second le
code source.

```bash
git clone --recurse-submodules https://github.com/yannicksandoz/yannicksandoz.github.io
# ou, sur un clone existant :
git submodule update --init --recursive
```

Sans accès au dépôt privé, le clone réussit quand même : le dossier reste
vide, `npm run build` fonctionne, et seul `npm run dev` s'arrête — avec un
message qui dit quoi taper. C'est exactement ce dont la CI a besoin :
`actions/checkout` ne récupère pas les sous-modules par défaut, donc le
déploiement se fait **sans jamais avoir accès à l'éditeur**.

Après une modification de l'éditeur, deux commits : un dans le sous-module,
un dans le dépôt public pour enregistrer la nouvelle révision.

```bash
cd engine/src/editor && git commit -am "…" && git push
cd ../../.. && git add engine/src/editor && git commit -m "Editor: bump"
```

**Livrer l'éditeur à un client** : ajoutez-le en collaborateur sur
`yr0-editor` seul. Il obtient l'éditeur et ses mises à jour, rien d'autre,
et l'accès se révoque en un clic.

`npm run check` inspecte le **résultat** du build, pas la configuration —
une erreur de configuration est précisément ce qu'on cherche à attraper. Il
échoue si une empreinte d'éditeur, un hôte tiers ou quelque chose qui
ressemble à une clé d'API apparaît dans ce qui serait publié. Le workflow
de déploiement le lance avant de publier ; rouge vaut mieux que vert avec
l'outil d'auteur en ligne.

**Navigation** — desktop : ZQSD / WASD / flèches (Maj = courir), **A/E**
(Q/E en QWERTY) pour pivoter sur place, souris pour orbiter, clic sur une
œuvre pour l'approcher (Échap pour reculer). Tous les raccourcis sont liés
aux **touches physiques** (`e.code`) : les mêmes positions marchent sur tous
les claviers, et l'aide affiche les étiquettes réelles quand le navigateur
sait les donner (`getLayoutMap`).
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
  "year": "2026",                  // cartel de la fiche (optionnel)
  "technique": "Synthèse granulaire, 4 voix",  // idem (optionnel)
  "link": "https://exemple.org/a-propos",      // « En savoir plus » (optionnel)
  "schemaVersion": 2,              // porté par le premier objet du fichier
  "position": [x, y, z],
  "rotation": [0, 0, 0],           // degrés, trois axes
  "loadDistance": 50,              // distance de chargement paresseux (optionnel)
  "lightColor": "#7a6cff",         // lumière d'appoint de l'œuvre (optionnel)
  "lightIntensity": 4,             // idem — 1.5 environ pour du mobilier
  "selfLit": true,                 // l'objet ÉCLAIRE sans être éclairé : sa
                                   // propre lampe le lavait à bout portant
                                   // (une lanterne virait au blanc pur et
                                   // fleurissait dans le bloom). Il ne lui
                                   // reste que son émission ; la lampe, elle,
                                   // continue d'éclairer la pièce.
  "solid": true,                   // s'oppose à la marche (défaut : les
                                   // panneaux image/vidéo le sont déjà ;
                                   // false pour laisser passer)
  "credit": {                      // cité dans l'écran de crédits (optionnel)
    "author": "…", "license": "CC-BY 4.0", "sourceUrl": "https://…"
  },
  "year": "2026",                  // cartel de la fiche (optionnels)
  "technique": "Synthèse granulaire, 4 haut-parleurs virtuels",
  "link": "https://…",             // « En savoir plus » de la fiche
  // Ensemble : plusieurs objets, UNE œuvre indexée. Les membres portent
  // `partOf` (et restent `role: "decor"`) : cliquer l'un d'eux ouvre la
  // fiche de l'œuvre maîtresse, s'approcher de n'importe lequel compte
  // pour sa découverte, et un seul repère/une seule entrée de liste existe.
  "partOf": "id-de-l-oeuvre-maitresse",

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
  // les primitives acceptent une émission DISSOCIÉE de la couleur du corps
  // (une lanterne : paroi sombre, lueur claire) :
  "model": { "shape": "cylinder", "color": "#4a4266",
             "emissiveColor": "#cbb4ff", "emissive": 0.6 },
  // deux primitives d'AMBIANCE (décor, additives, jamais des cibles) :
  // un puits de lumière volumétrique suggéré (fresnel + fondu du pied)…
  "model": { "shape": "faisceau", "size": 9, "color": "#cbb4ff",
             "emissive": 0.5 },
  // …et un essaim de lucioles dérivant dans le shader (zéro CPU ;
  // `size` = côté du volume de vol, graine déterministe)
  "model": { "shape": "lucioles", "size": 26, "count": 48, "seed": 11,
             "color": "#ffd97a", "emissive": 1.1, "dotSize": 0.24 },
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
  "baseGain": 1,                   // volume de référence de l'objet
  "stems": [
    { "file": "audio/nappe.wav", "radius": 20, "gain": 0.9 },
    // un son EMPRUNTÉ porte sa source et son crédit, comme un modèle :
    // sans eux, la publication est refusée (voir « Attribution »)
    { "file": "assets/freesound/vent-42.mp3", "gain": 0.6,
      "source": "freesound",
      "credit": { "author": "A. Vento", "license": "Attribution",
                  "sourceUrl": "https://freesound.org/s/42" } }
  ],

  // — comportements —
  "modules": [
    { "type": "SpatialCrossfade", "params": { "radius": 20, "inner": 5 } },
    { "type": "FocusCamera", "params": { "distance": 7 } }
  ]
}
```

**UN SEUL module de distance par objet.** `SpatialCrossfade` atténue le bus
entier, `StemMixer` atténue chaque piste : posés ensemble, leurs courbes se
**multiplient** et le son décroît au carré de la portée annoncée. Une seule
piste → `SpatialCrossfade` ; plusieurs → `StemMixer`, dont c'est justement
l'objet. Le moteur se protège des scènes qui portent les deux (le mélangeur
l'emporte sur la distance, le fondu se réduit alors à `baseGain`), et
l'éditeur n'en pose plus qu'un.

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
  "floor": { "size": 80, "color": "#13131f", "grid": true },  // sol (false = aucun)
  "shell": {                       // coque : murs de salle (absent = à ciel
    "width": 26, "depth": 20,      // ouvert, comme le parvis d'entrée)
    "height": 5, "color": "#1e1e2e", "ceiling": false,
    "walls": ["nord", "est"],      // de 0 à 4 murs (absent = les 4)
    "windows": [                   // baies percées, donnant sur l'espace
      { "wall": "nord", "offset": 0, "width": 4, "height": 1.8, "sill": 1.1 }
    ]
  },
  "fogDensity": 0.014,             // densité du brouillard (0,026 par défaut :
                                   // une grande salle a besoin de bien moins,
                                   // sinon son fond disparaît)
  "bascules": [                    // hauts d'escaliers : atteindre l'anneau
    {                              // fait PIVOTER la pièce (rotation continue,
      "position": [38, 20, 8],     // sans warp) — le plan choisi devient le
      "radius": 1.8,               // sol. Un escalier `walkable: true` se
      "plane": "est",              // gravit à la marche (la caméra suit, et
      "arrival": [20, 3.7, 8],     // sa masse arrête : on ne la traverse pas) ;
      "cooldown": 8                // un escalier qui ABOUTIT au mur cible
    }                              // donne une continuité parfaite.
  ],                               // `cooldown` : délai propre à ce passage.
  "vistas": [                      // apparitions : une pièce d'ailleurs,
    {                              // vivante, sur un mur de celle-ci —
      "room": "jardin",            // la caméra suit le visiteur (parallaxe)
      "wall": "nord", "offset": 0, "width": 5, "height": 2.4, "sill": 0.9,
      "anchor": { "position": [0, 1.8, 10], "rotationY": 0 }
    }
  ],
  "keyLight": {                    // lumière clé de la pièce — la seule à
    "color": "#b8c2ff",            // projeter des ombres (false = aucune)
    "intensity": 2,
    "azimuth": 35,                 // ° autour de la pièce (0 = +Z)
    "elevation": 55                // ° au-dessus de l'horizon
  },
  "envIntensity": 1,               // × l'éclairage d'image global (IBL)
  "ambience": [                    // nappes propres à la pièce, fondues quand
    { "file": "audio/vent.wav", "gain": 0.3 }   // on entre/sort (optionnel)
  ],
  "works": ["nebuleuse", "marees"],// œuvres présentes (ids de works/*.json)
  "portals": [
    {
      "to": "annexe",              // pièce de destination (soi-même autorisé)
      "position": [-5, 0, -22],    // pied du portail
      "rotation": [0, 12, 0],
      "label": "Annexe",           // étiquette flottante
      "arrival": [0, 2.2, 8],      // où l'on apparaît dans la destination
      "plane": "est"               // Escher : plan d'arrivée (sol par défaut,
    }                              // nord/sud/est/ouest/plafond) — la pièce
                                   // entière pivote pour que ce plan devienne
                                   // le sol ; un portail peut être posé couché
                                   // sur un mur (rotation [0,0,90]) : il ne se
                                   // franchit qu'une fois debout sur ce plan
  ]
}
```

Référencées par `rooms/index.json` (ou un `rooms/rooms.json` combiné, produit
par l'export de l'éditeur, qui prend le pas). **Sans dossier rooms/, la
galerie fonctionne en pièce unique** contenant toutes les œuvres. La
**première pièce de l'index est le point d'entrée** de la visite.

L'éditeur crée les pièces à partir de **modèles** (« ＋ Pièce ») : *salle*
(exposition murée), *couloir* (passage étroit), *extérieur* (parvis ouvert
sous le ciel — le modèle du hall d'entrée) ou *vide*. Un modèle n'est qu'un
préréglage : sol, murs, brouillard et lumière restent modifiables champ par
champ dans la section Pièce.

Une œuvre peut être marquée **décor** (`"role": "decor"`) : elle meuble la
scène (banc, rocher…) sans être une œuvre — ni listée dans la visite audio,
ni cliquable, ni approchable. L'attribution d'un modèle importé reste due
et affichée aux crédits, décor ou pas.

Franchir un portail (s'en approcher, ou le toucher/cliquer) déclenche un fondu
puis téléporte au point d'arrivée. Performance : seule la pièce courante est
rendue (culling par pièce) ; ses voisines directes sont préchargées mais
muettes et invisibles ; tout le reste est déchargé (textures, sources audio,
buffers, vidéos en pause).

## Éditeur de scène (mode auteur)

**Lancer** : touche **²** (à gauche du 1 — `@` sur Mac FR), bouton **✎**
(en haut à droite), ou ouvrir l'URL
avec **`?edit`** (ex. `http://localhost:5173/?edit`). Les mêmes commandes
referment l'éditeur. Utilisable au doigt sur iOS : panneaux repliables,
champs numériques pour le placement précis, barre d'outils défilante.

**Barre d'outils** : ◻ Objets / ▦ Voxel (**V**) / ✂ Découpe (**C**),
📁 Médias (import de fichiers), 🔗 URL (média distant),
⤒ JSON (réimport d'un export), ＋ Objet, gizmos ↔ / ⟳ / ⤢ (raccourcis
1 / 2 / 3), ⧉ dupliquer, 🗑 supprimer (Suppr), ⇪ Publier (écriture directe
dans `content/`), ⟲ Revenir (version précédente), 💾 Exporter (repli par
téléchargement), ✕ quitter.

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

La hiérarchie (à gauche) permet de **masquer** (👁) et **verrouiller** (🔒) un
objet pour travailler dans une scène chargée. Ces deux états décrivent votre
session de travail, pas l'œuvre : ils **ne partent pas à l'export** et sont
donc perdus au rechargement. C'est voulu — un objet replié pendant l'édition
ne doit pas arriver masqué chez un visiteur.

### Bibliothèque 3D

Le bouton **🧱 Bibliothèque** ouvre un catalogue de modèles prêts à poser :
un clic sur une vignette dépose l'objet devant la caméra, à sa taille réelle
et au sol. L'objet créé est une **œuvre ordinaire** — déplaçable, sonorisable,
exportable comme les autres.

Le moteur en livre dix : socles, vitrine, cimaise, colonne, arche, banc, cube
d'assise, cadre, estrade (domaine public, CC0). Ce sont des supports neutres
pour VOS œuvres, pas des œuvres. Ils sont fabriqués par
`npm run library`, qui écrit les GLB, les vignettes et le catalogue dans
`content/library/` à partir d'une seule description — à relancer seulement si
vous modifiez ce catalogue.

**Pointer votre propre catalogue.** Le champ « catalogue » en bas du panneau
accepte n'importe quelle URL. Le format :

```jsonc
{
  "name": "Ma bibliothèque",
  "items": [
    {
      "id": "chaise",
      "name": "Chaise",
      "description": "…",
      "tags": ["mobilier"],
      "url": "models/chaise.glb",    // relatif AU CATALOGUE, ou absolu
      "thumbnail": "thumbs/chaise.svg",
      "fit": 0.9,                    // plus grande dimension, en mètres
      "author": "Nom de l'auteur",
      "license": "CC-BY 4.0",
      "sourceUrl": "https://…"
    }
  ]
}
```

Les URL relatives d'un catalogue distant sont résolues **contre ce
catalogue**, pas contre votre dossier de contenu : une bibliothèque publiée
ailleurs peut donc référencer ses modèles normalement. L'hôte doit autoriser
le CORS. Une entrée sans `url` exploitable est ignorée plutôt que de casser
le panneau — un catalogue tiers n'est pas forcément écrit avec soin.

**Rien n'est copié.** Un objet posé ne retient qu'une **URL**, exactement
comme un média importé par lien : pensez à publier vos modèles à côté de la
scène, ou à pointer un hôte stable.

**Crédits.** `author`, `license` et `sourceUrl` sont recopiés dans l'œuvre et
ressortent dans l'**écran de crédits** de la galerie (bouton ⓘ, en bas à
droite). Le bouton n'apparaît que si la scène contient effectivement quelque
chose à citer, et les objets d'un même auteur sont regroupés en une ligne.
Une licence CC-BY oblige à créditer : cette obligation ne doit pas dépendre
de votre mémoire.

> **Poly Pizza** n'est pas intégré : son API demande une clé et je n'ai pas
> ses conditions d'usage sous la main. Le format ci-dessus est le point
> d'accroche — un petit script qui transforme sa réponse en `items` suffira,
> et les champs d'attribution sont déjà là pour ses modèles CC-BY.

### Attribution des modèles importés

Un modèle venu d'ailleurs porte `model.source`, et ce marqueur déclenche une
obligation : **nom, auteur, licence et URL source deviennent des champs
requis**. Une section *Attribution* apparaît dans l'inspecteur, les champs
manquants y sont signalés en rouge, et **l'export est refusé** tant qu'ils le
sont — avec le nom de l'œuvre et la liste de ce qui manque.

C'est un refus, pas un avertissement. Une licence CC-BY oblige à citer ; un
avertissement contournable n'est qu'une façon polie de ne pas le faire.

**Le crédit est aussi écrit à côté de l'asset.** L'export produit un
`<modèle>.glb.attribution.json` en plus des JSON de scène. Au chargement, le
runtime relit ce fichier pour tout modèle importé dont le crédit serait
incomplet, et le restaure. Supprimer une attribution demande donc d'effacer
**deux** fichiers, dont un qui n'a aucune raison d'être ouvert — y compris
quand un client reprend votre galerie et « nettoie » le JSON.

Le coût est nul pour une scène sans import : aucune requête. Pour les
autres, un petit JSON par modèle importé, en parallèle, et seulement si le
crédit manque.

Enfin, l'**écran de crédits** du mode Visiteur affiche la mention de la
plateforme d'origine avec son lien — « Modèles fournis par Poly Pizza »,
lien vers `https://poly.pizza` — dès qu'un modèle en vient. Elle n'est pas
désactivable.

### Mode Voxel — construire cellule par cellule

La barre d'outils propose trois modes : **◻ Objets** (médias, primitives,
gizmos), **▦ Voxel** (touche **V**) et **✂ Découpe** (touche **C**, voir plus
bas). Une construction voxel n'est pas un
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

### Mode Découpe — percer un mur à la main

Une baie est un champ de la pièce (`shell.windows`), mais la remplir au
clavier revient à deviner des coordonnées : on ne sait pas *où* est
« position 3,2 » avant de l'avoir vu. Le mode **✂ Découpe** (touche **C**)
rend le geste à la main — on vise le mur, on trace la baie, elle apparaît —
et laisse les chiffres pour caler ensuite.

| Geste | Effet |
| --- | --- |
| presser sur un mur puis **glisser** | trace la baie ; relâcher la perce |
| clic bref sur une baie existante | la reprend (ses chiffres s'affichent) |
| clic bref sur un mur nu | désélectionne |
| **▭ Baie / ⌂ Arche / ○ Oculus** | forme du prochain tracé — et de la baie choisie |
| champs position / largeur / hauteur / appui | règlent la baie au centimètre |
| **Suppr** ou « Reboucher cette baie » | la rebouche |

Le tracé s'affiche en violet pendant le glissement, la baie choisie en
turquoise. Un tracé de moins de 40 cm de côté est ignoré : c'est une
éraflure, pas une ouverture.

**Viser un trou.** Une fois la baie percée, il n'y a plus de matière en son
milieu : un rayon lancé là traverse le mur et sort de la pièce. Le viseur
double donc le tir de matière d'un tir sur le **plan** des murs et garde le
plus proche des deux — sans quoi une baie déjà faite serait impossible à
reprendre au clic. Les deux tirs travaillent dans le repère de la pièce
(`worldToLocal`, ou l'inverse de la matrice du groupe) : dans une pièce
basculée du belvédère, viser en coordonnées monde percerait le mur d'à côté.

Toute création, tout réglage et toute suppression passent par une commande
du document : **Ctrl/Cmd + Z** rebouche, la publication et l'export suivent
sans une ligne de plus.

### Pièces et portails

Section « Pièce » du panneau : changer de pièce active, la renommer, choisir
sa couleur de brouillard, définir le point d'arrivée (« Point d'arrivée
ici »), gérer son ambiance sonore. « ＋ Nouvelle pièce » crée une pièce vide
et y bascule ; « ＋ Portail » relie la pièce courante à la pièce choisie (un
portail de retour est créé automatiquement, déplaçable ensuite comme
n'importe quel objet — clic dessus pour le sélectionner, cible/étiquette
modifiables).

### Publier (site 100 % statique, sans backend)

**⇪ Publier** écrit la galerie **directement dans `content/`**. Au premier
clic, le navigateur demande de désigner le dossier ; ensuite le bouton porte
son nom (`⇪ Publier → content/`) et un clic suffit. **Maj+clic** pour changer
de dossier.

Ce qui est écrit — le format déjà en place dans le dépôt, celui qui donne des
diffs lisibles dans git :

- `works/<id>.json`, un fichier par objet, plus `works/index.json` ;
- `rooms/<id>.json`, un par pièce, plus `rooms/index.json` ;
- `reglages.json` (réglages généraux) ;
- un `<modèle>.attribution.json` par modèle importé ;
- les médias importés en fichier, déposés dans `content/assets/` — plus rien
  à copier à la main.

Avant d'écrire, un récapitulatif **nomme tout** : combien d'objets et de
pièces, combien de fichiers, et surtout **ce qui va être effacé** — les
fichiers d'objets supprimés depuis la dernière publication, et le fichier
combiné `works.json`/`rooms.json` s'il traîne encore (le chargeur lui donne
la priorité : laissé en place, il masquerait toute la publication). Rien ne
part en ligne : `git add … && git commit && git push` reste votre geste.

Une **attribution incomplète refuse la publication**, exactement comme
l'export : c'est une condition de licence, pas une préférence.

**⟲ Revenir** — avant d'écrire, la publication archive l'état précédent dans
`content/.sauvegardes/<date>/` (works, rooms, réglages ; pas les médias, ce
sont les mêmes octets). Les **cinq dernières** sont gardées. Le bouton liste
les versions et remet celle qu'on choisit : ses fichiers reprennent leur
place, ce qui est né depuis s'en va, et la page se recharge dessus. L'état
d'avant le retour est sauvegardé lui aussi — revenir se regrette aussi.

Ce dossier ne part **ni dans git** (`.gitignore`) **ni en ligne** : un plugin
Vite le retire de `dist/`, et `scripts/check-visitor-build.mjs` échoue s'il en
reste la moindre trace — ce sont des copies entières de la galerie, elles se
laisseraient parcourir par qui connaît le chemin. Git reste l'historique
long ; ces sauvegardes servent quand git n'est pas à portée de main.

**Repli** — Firefox et Safari n'ont pas l'API d'écriture dans un dossier.
**💾 Exporter** y télécharge alors `works.json` + `rooms.json` + les fichiers
d'attribution, à déposer dans `content/works/`, `content/rooms/` et
`content/assets/` (les noms des médias à copier sont listés après l'export).

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
| `FocusCamera` | Travelling doux vers l'œuvre au clic + fiche (titre, cartel année/technique, description, lien, vue détail de l'image) | `distance`, `height`, `duration` |
| `TipJar` | Chapeau de fin d'expérience (voir ci-dessous) | `enabled`, `message`, `buttonLabel`, `url`, `minutes`, `delay` |

Les trois œuvres de démo illustrent trois recettes : *Nébuleuse*
(`SpatialCrossfade` + `AudioReactive`), *Triptyque des marées* (`StemMixer`,
rayons 26/14/7), *Monolithe 55 Hz* (`HRTFPanner` + shader réactif + `TipJar`).

### Le chapeau (TipJar)

Un écran discret propose de soutenir l'artiste ; un petit ♥ en coin d'écran
le garde accessible. Il apparaît par la **première** de trois portes, toutes
atteignables : toutes les **œuvres** découvertes (le décor ne compte pas),
`minutes` de visite écoulées (défaut 12), ou le bouton **« Terminer la
visite »** du menu — disponible à tout moment. Le bouton **redirige vers une
page de paiement hébergée** (Ko-fi, Stripe Payment Link, PayPal.me,
Liberapay…) dans un nouvel onglet : **aucune donnée bancaire ne transite par
le site**, qui reste entièrement statique.

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

`enabled: false` (ou `url` vide) désactive tout, proprement.

La scène de démo pointe sur `https://ko-fi.com/yannicksandoz` (dans
`content/works/monolithe.json`). Si vous déployez le moteur avec votre propre
contenu, c'est l'une des trois choses à remplacer, avec le dossier `content/`
et le contact de licence commerciale — sans quoi vous enverriez vos visiteurs
soutenir quelqu'un d'autre.

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
- **anticrénelage** : le rendu passe par un `EffectComposer` (AO, bloom,
  grain), donc **hors écran** — et l'`antialias` du renderer, qui ne vaut que
  pour le canevas, n'agit sur rien. Le MSAA vit dans une **passe de scène
  dédiée** (`PasseSceneMSAA`) : la scène se rend multi-échantillonnée (×4
  desktop, ×2 mobile, 0 GPU modeste), est résolue **une** fois, et toute la
  chaîne de post reste simple échantillon. Donner la cible MSAA au composer
  lui-même serait ruineux : il la clone pour ses deux tampons ping-pong et
  chaque passe plein écran paierait le rendu ×4 plus une résolution complète
  — c'est ce qui faisait tomber un M1 Max à 35 fps ;
- **occlusion ambiante** (GTAO, desktop) : calculée à **demi-résolution**
  (l'occlusion est un signal basse fréquence), mélangée plein cadre — elle
  ancre bancs, pierres et marches au sol par une ombre de contact douce.
  Les lutins (balises) sont écartés de la pré-passe normales/profondeur ;
- **courbe de rendu** : Neutral (Khronos PBR) plutôt qu'ACES — comparées
  A/B pièce par pièce, ACES tirait les néons violets vers le gris ; Neutral
  compresse les hautes lumières sans désaturer ;
- **anisotropie** ×16 sur desktop (4 mobile/GPU modeste) : parquet et sable
  ratissé restent nets aux angles rasants ;
- **aberration chromatique** : une pointe (nulle au centre, en carré de
  l'excentricité) dans la passe grain/vignette — un bord d'objectif, pas un
  filtre ;
- **gouverneur FPS** : deux étages. Sous **50 fps** pendant 3 s, la finition
  se replie cran par cran (MSAA ×4→×2→0, puis GTAO) — sur un écran ProMotion,
  35 fps se sentent lourds bien avant le seuil de survie. Sous **27 fps**,
  le reste y passe (pixelRatio → grain → apparitions → ombres → bloom), sans
  jamais remonter (pas d'oscillation) ;
- **cache d'ombres** : la carte d'ombre ne se re-rend qu'à **30 Hz**
  (`shadowMap.autoUpdate = false`, `needsUpdate` cadencé dans la boucle) —
  la galerie est presque statique, une pénombre qui suit à 33 ms reste
  imperceptible, et à 120 Hz ce sont trois rendus de scène sur quatre
  d'économisés ;
- **budget de lumières** : chaque PointLight se paie sur chaque pixel de
  la pièce. Une œuvre-décor peut porter `lightIntensity: 0` pour garder sa
  lueur (selfLit, émission, bloom) sans coûter un poste au shader — au
  belvédère, quatre lanternes sur onze éclairent ainsi « pour rien »
  (plafond à 40 m de tout, secondes lanternes d'une même face) : 12 → 8
  lumières réelles ;
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
| `engine/` (+ `index.html`, `vite.config.js`, `scripts/`) | **Propriétaire — tous droits réservés** © Yannick Sandoz, voir [`engine/LICENSE`](engine/LICENSE) |
| `content/` | **Tous droits réservés** — voir [`content/RIGHTS.md`](content/RIGHTS.md) |
| `content/library/` | **CC0-1.0** (domaine public) — le mobilier livré est un outil, pas une œuvre |

Le moteur n'est pas libre. Aucun droit d'usage, de reproduction, de
modification ou de redistribution n'est concédé par défaut. Le fait que le
code arrive dans le navigateur d'un visiteur ne lui confère aucun droit :
c'est nécessaire à l'exécution, rien de plus.

Les composants tiers — Three.js et ses modules d'exemple, Vite, le thème
Jekyll du site, Primer — gardent leurs propres licences, listées dans
[`../THIRD-PARTY-NOTICES.md`](../THIRD-PARTY-NOTICES.md).

Le dossier `content/` contient des créations personnelles, également tous
droits réservés : déployez le moteur avec votre propre contenu. Seule
exception, **`content/library/`**, le mobilier de galerie, est dans le
domaine public — c'est un outil, pas une œuvre, et il doit rester utilisable
par qui obtient une licence du moteur.

## Licence commerciale

Ce projet est distribué sous licence propriétaire — tous droits réservés.
Aucun usage n'est concédé par défaut. Pour tout usage, une licence
commerciale est disponible auprès de Yannick Sandoz, titulaire des droits.

Contact : **yro.lab.licence@gmail.com**

Merci d'indiquer dans votre message : l'usage envisagé, le produit ou le
contexte de déploiement, l'organisation concernée et sa taille, et le
périmètre souhaité. Réponse sous une dizaine de jours. FR / EN.

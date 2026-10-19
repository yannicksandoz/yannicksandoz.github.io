# Démarrer en dix minutes

Le guide court : ce qu'il faut savoir pour faire tourner la galerie, y poser
une œuvre et une pièce à soi, et publier. Tout le reste — pourquoi chaque
chose est comme elle est, les mesures, l'éditeur, la charte — est dans
[`README.md`](README.md) (long, et fait pour être cherché).

## 1. Faire tourner (deux minutes)

Il faut Node 22 ou plus récent.

```bash
cd galerie
npm ci                 # les dépendances exactes du dépôt
npm run dev:visiteur   # http://localhost:5347 — ce que verra le public
```

Casque recommandé : la galerie est un espace sonore, le mix se compose en
marchant. À l'accueil, trois portes : la **visite guidée** (tout est ouvert,
on se laisse porter), la **visite libre** (on explore, on trouve des jetons ◈
qui dévoilent des œuvres), et la **visite audio** (au clavier et à l'oreille,
sans l'image — voir plus bas).

```bash
npm test               # la suite de tests, sans navigateur (une minute)
npm run build          # → dist/ : le site publiable
npm run check          # rien de l'éditeur dans dist/, et le poids sous ses seuils
```

`npm run dev` (sans `:visiteur`) ouvre le mode auteur, avec l'éditeur de
scène. L'éditeur vit dans un dépôt privé (sous-module
`engine/engine/src/editor`) : sans lui, `npm run dev` est identique à
`npm run dev:visiteur`, et tout le reste de ce guide marche.

## 2. Comment le contenu est rangé

Tout ce qui se voit et s'entend est dans `content/`, en JSON lisible :

| Dossier ou fichier | Ce que c'est |
|---|---|
| `content/works/*.json` | une œuvre par fichier ; `works/index.json` dit lesquels charger, dans l'ordre |
| `content/rooms/*.json` | une pièce par fichier ; `rooms/index.json` pareil — la première est la salle d'arrivée |
| `content/audio/` | les sons (`.wav` d'origine, `.webm` et `.m4a` pour le navigateur) |
| `content/assets/` | images, modèles 3D importés, sons fragmentés |
| `content/reglages.json` | les réglages généraux (audio, passages, style) |
| `content/exemples/` | **un gabarit d'œuvre et un gabarit de pièce, commentés, à copier** |

Le moteur (`engine/`) ne connaît rien de ce contenu : on peut vider
`content/works` et `content/rooms` et mettre les siens.

## 3. Poser une œuvre (trois minutes)

1. Copier `content/exemples/oeuvre-exemple.json` dans `content/works/`, sous
   un nom à soi (`ma-piece-sonore.json`). L'`id` doit être unique et sans
   espace : c'est aussi le nom dans l'adresse (`?work=ma-piece-sonore`).
2. Changer `title`, `description` (c'est ce qu'un lecteur d'écran lira : les
   deux sont tout ce qu'un visiteur aveugle perçoit de l'œuvre), `position`
   (en mètres, `y` vers le haut), et le `model` (une forme simple, ou un
   fichier `.glb` dans `content/assets/`).
3. Le son : un fichier dans `content/audio/`. Un `.wav` suffit pour essayer ;
   pour publier, ajouter `.webm` et `.m4a` à côté (le navigateur prend le
   plus léger qu'il sait lire). `radius` est la portée en mètres, `gain` le
   volume de la voie.
4. Ajouter le nom du fichier dans `content/works/index.json`, et l'`id` de
   l'œuvre dans le tableau `works` de la pièce où elle vit.

Recharger la page : l'œuvre est là. Si elle ne l'est pas, la console du
navigateur dit pourquoi (un JSON mal fermé, un `id` en double).

## 4. Poser une pièce (trois minutes)

1. Copier `content/exemples/piece-exemple.json` dans `content/rooms/`.
2. L'`id`, le `title`, la taille de la coque (`shell.width` × `shell.depth`,
   `shell.height`), le `spawn` (où l'on arrive), ses `works`.
3. Un passage vers une autre pièce : une entrée de `portals` — `to` (l'id
   de la pièce cible), `position` sur le bord de la coque, `arrival` (où l'on
   débarque dans la cible). Le passage retour se déclare dans la cible.
4. Ajouter le fichier dans `content/rooms/index.json`.

Le plan de la galerie (`npm run budget` donne aussi ce que chaque salle
coûte à un téléphone) se dessine tout seul depuis ces passages.

## 5. Publier (deux minutes)

Le site est statique : `dist/` se sert tel quel. Sur GitHub Pages, un
`git push` suffit — le déploiement construit `dist/`, lance les tests et les
garde-fous, et publie. Pour un autre hébergeur : `npm run build`, puis copier
`dist/` (voir « Déploiement » dans le README pour Nginx ou Caddy).

Un lien vers une pièce ou une œuvre : `?room=<id>`, `?work=<id>` ; avec
`&mode=audio`, l'accueil propose directement la visite audio ; avec
`&mode=guidee`, la visite guidée.

## 6. La visite audio, en deux mots

Pour qui ne voit pas l'image : une liste au clavier qui pilote le même
moteur. Haut/bas parcourt les œuvres de la pièce (le son glisse de l'une à
l'autre), Entrée approche, droite et gauche changent de pièce, Maj + flèche
pivote sur place (le binaural fait entendre le changement), **I** dit où
l'on est et ce qui est le plus proche. Chaque entrée dit sa direction et sa
distance (« — à gauche, 12 m »). Les pages `liste.html` et `catalogue.html`
(générées au build) offrent la même galerie sans 3D du tout.

## Et ensuite

- « Décrire une œuvre » et « Décrire une pièce » dans le README : tous les
  champs, avec leur raison.
- « Composer une exposition » : le plan, les jetons, les passages.
- « Éditeur de scène » : si vous avez accès au sous-module, tout cela se fait
  à la souris, dans la galerie elle-même.

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

**Le catalogue se gagne — et il parle de la salle où l'on est.** Une œuvre
n'est nommée qu'une fois rencontrée : le compteur « ◆ 2 / 4 » (haut-droite)
se déplie d'un clic et montre les œuvres **de cette salle** (et « ◆ — »
là où il n'y en a aucune : neuf salles sur quinze, l'entrée la première —
un compteur qui ne compte rien serait le premier chiffre que voit un
visiteur, et il ne dirait rien) — les trouvées
portent leur titre et s'y rejoignent d'un clic, les autres tiennent leur
rang sous un « ??? ». Un total global (« 3 / 47 ») écrasait le visiteur dès
le premier pas : le chiffre ne bougeait presque jamais, et la liste dépliée
était l'inventaire de la galerie entière — exactement ce que la carte se
donnait du mal à ne pas divulguer. Ramené à la pièce, le compteur se
remplit vite, se vide en changeant de salle, et redevient la seule question
qu'il doit poser : **ai-je fait le tour d'ici ?**

Ce qu'il y a AILLEURS se lit sur les portes. Chaque portail annonce, sous
le nom de la salle qu'il dessert, **le compte de ses œuvres** — « ◆ 1 / 4 »,
vert quand on les a toutes rencontrées. Un nom seul ne dit pas s'il vaut le
détour ; le compte promet sans rien dévoiler : quatre œuvres derrière cette
porte, une seule connue, jamais lesquelles. Une dernière ligne du panneau
rappelle combien de salles restent inconnues.

Une œuvre est découverte après quelques secondes à portée, ou dès qu'on
l'approche. Le catalogue **se garde d'une visite à l'autre** (voir « Mémoire
de visite ») : une galerie de cette taille ne se traverse pas d'un trait, et
repartir de zéro punissait qui revient.

*Conséquence assumée :* le jeton ◈ dévoile une « ??? » **de la salle où
l'on se trouve**. Dans une salle sans œuvre, il n'y a rien à dévoiler — mais
l'autre chemin du jeton, le `▸ ◈` de la visite guidée, continue de débloquer
la prochaine œuvre du parcours, où qu'elle soit.

**« Laisse-toi porter »** (barre `◂ ▸` en bas de l'écran, ou le menu) : la
visite guidée **rejoue les œuvres découvertes**, dans l'ordre du catalogue,
du n° 1 au dernier — la caméra vole de l'une à l'autre et se pose devant
chacune. Pendant la pause, `◂` / `▸` (boutons, ou flèches gauche/droite du
clavier) vont à la précédente ou à la suivante ; **tout autre geste rend la
main**. Avec `prefers-reduced-motion`, les travellings deviennent des
déplacements quasi instantanés.

**Le vol plané.** Certaines œuvres se contemplent en l'air — le tore de
« Gravité » flotte au centre du cube du belvédère. Reprendre la main là-haut
reposait le visiteur au sol quelques secondes plus tard : le suivi de sol le
rappelait, quelle que soit la hauteur, et l'on perdait la vue qu'on venait de
gagner. Il **y reste** désormais. `Controls.planer()` le laisse suspendu ;
tant qu'aucun sol n'est à portée de pas sous ses pieds (`EYE + CHUTE_MAX`),
le suivi de sol ne le réclame pas et l'anti-chute s'efface — il n'y a plus de
sol de référence, donc plus de vide à refuser. **Il vole alors au regard** :
avancer en regardant vers le bas fait descendre, lever la tête fait monter,
et l'on **se pose de soi-même** dès qu'un plancher repasse à portée — la
marche reprend sans que rien ne soit à faire. L'aide, en bas de l'écran, le
dit le temps du vol. La remise des commandes attend d'ailleurs son heure :
le geste qui arrête la visite est le plus souvent un clic sur l'œuvre qu'on
vient d'atteindre, et le travelling d'approche tire la même caméra. Un
portail, une bascule, un point d'arrivée reposent les pieds
(`resyncCollision`).

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

Elle vit à deux endroits, et ils ne racontent pas la même chose.

La **minimap** — un hublot rond, en haut à droite, sous le compteur — ne
montre que **la salle où l'on est** : son emprise, ses portes, et l'aiguille
du regard, qui bouge à chaque image. Tout y est tracé en coordonnées
**monde**, et ce n'est pas un détail : une pièce d'Escher bascule, le mur
devient le sol, et l'on marche dessus. En repère de pièce, la position du
visiteur cessait alors de bouger sur les deux axes dessinés — dix mètres de
marche déplaçaient l'aiguille de neuf centimètres, plaquée contre un bord.
Or `orientRoom` fait exactement ce qu'il faut : il tourne la pièce pour que
la surface qu'on foule repose À PLAT dans le monde. Le monde est donc le
seul repère où « le sol » veut toujours dire la même chose. Corollaire :
seules les portes **qu'on peut prendre d'ici** sont dessinées — au
belvédère, deux ou trois sur treize selon la gravité du moment. Elle a d'abord affiché un fragment du
plan général ; c'était illisible, un morceau de plan de métro dans un rond
de huit centimètres. Une minimap répond à deux questions et à deux
seulement : *où suis-je tourné*, et *où sont les portes*. Chaque porte y
porte son état — **pleine** si on l'a déjà franchie, **évidée** si la salle
d'après reste à découvrir, **rouge** si le passage est fermé pour l'instant.
La porte par laquelle on vient d'entrer ne rougit jamais : elle se referme
derrière soi par règle, et l'afficher comme un obstacle là où l'on vient de
marcher ferait peur pour rien.

Le **plan en grand** (clic sur la minimap, ou menu → Pièces → « Voir le
plan en grand ») montre le reste, et **prend toute la page**. Il a d'abord
vécu en vignette de 380 pixels au fond du menu, sous la liste des mêmes
salles : quinze pièces dans un timbre-poste, des noms qui se chevauchaient,
des traits qui se croisaient, et juste dessous la même chose en clair.
Aujourd'hui il porte le graphe des salles connues, les passages franchis, un
« ? » posé **au bord** de la salle du côté où mène une porte jamais prise,
et, sous chaque pièce, son **compte d'œuvres** (`◆ 2/3`, doré quand la salle
est épuisée). Deux règles de tracé le rendent lisible :

- les **traits partent du bord** des salles, pas de leur centre, et bombent
  légèrement — douze liens quittant un même centre faisaient une étoile ;
- **le texte se mesure en pixels, pas en mètres.** Le SVG travaille en
  mètres (c'est le repère du plan) ; un `font-size` en mètres donne des noms
  minuscules sur une grande galerie et énormes sur une petite. Les tailles
  se règlent donc après coup, à l'échelle réellement appliquée — et le nom
  se pose **dans** la salle quand il y tient, **sous** elle sinon.

Chaque salle du plan est un **vrai bouton** : atteignable au clavier, nommée
(« Aller dans “Jardin zen” — 1 œuvre vue sur 3 »), et qui mène où elle dit.
La liste du menu suit exactement la même mémoire : elle nomme les pièces
visitées et compte les autres sans les nommer (« 11 pièces encore
inconnues »). Une carte qui ménage la surprise à côté d'une liste qui la
vend n'aurait rien ménagé du tout.

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

**Menu de la visite** (Échap ou ☰) : le **plan en grand** et la liste des
pièces visitées, pour sauter directement dans l'une d'elles, visite audio, **partage** (Web Share sur
mobile, copie du lien sinon) avec **lien profond** `?room=pièce` /
`?work=œuvre` — celui qui l'ouvre arrive au même endroit, **sans écran
d'accueil** (l'audio se débloque au premier geste, règle des navigateurs) —,
**plein écran**, vue liste, raccourcis, langue, « Terminer la visite ».

**Après une bascule, on regarde devant soi.** Une bascule de gravité fait
une seule chose au regard : elle le **couche sur le nouvel horizon**. Le
**cap du monde ne bouge pas d'un degré** — on arrive tourné exactement là où
l'on regardait. Deux règles ont été essayées avant celle-là, et toutes deux
donnaient l'impression que la caméra « tourne à gauche » sans raison : garder
le regard tel quel plantait le nez dans les chaussures ou le plafond selon
ce qu'on regardait en entrant dans l'anneau, et faire *suivre la pièce* au
regard lui ajoutait exactement la rotation de la pièce — invisible dans le
code, très visible dans les jambes. Les caps cardinaux y survivaient par
hasard (les axes de bascule les laissent invariants), les autres viraient de
45°, ce qui rendait le défaut capricieux et long à voir. Le balayage de
`verif-belv-cap` mesure aujourd'hui huit caps × trois inclinaisons : l'écart
doit être nul partout.

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
sans dire pourquoi. Et une porte rouge **ne se franchit pas**, quelle que
soit la manière : le test vivait dans la seule boucle de proximité, si bien
que marcher dedans était refusé mais CLIQUER dessus passait outre. Un délai
qu'un clic contourne n'est pas un délai, c'est une décoration ; la garde vit
désormais dans le passage lui-même, là où tous les chemins se rejoignent.
Sauter d'une salle à l'autre par le menu ou le catalogue reste permis : ce
n'est pas franchir une porte, c'est se téléporter. Une porte et **sa jumelle** (la même ouverture vue de
l'autre côté) se ferment **ensemble** : un passage ne peut pas être ouvert
d'un bord et fermé de l'autre.

**Sauf la seule issue d'une salle** — et l'exception vaut la règle. Sept
salles de cette galerie n'ont qu'une porte : l'annexe, et les six faces du
belvédère. Y refermer le passage derrière soi ne donnait pas « le temps de
regarder où l'on est », mais dix secondes de cellule devant un panneau
rouge, sans rien d'autre à tenter. Le délai n'a de sens que lorsqu'il reste
un ailleurs ; sinon il n'empêche plus le rebond, il empêche de sortir. La
porte de retour ne se referme donc que si la salle offre **un autre
passage**. Le rebond immédiat, lui, reste écarté par le désarmement : on ne
repart pas dans une porte tant qu'on ne s'en est pas éloigné.

Et l'on ne voit jamais le décompte du
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
npm run test         # tests unitaires (370 assertions, 5 fichiers)
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

**Un fichier de configuration au lieu de cent soixante-quinze.** Le contenu
vit en un fichier par œuvre et par pièce — c'est ce qui le rend lisible,
versionnable, modifiable à la main. Le navigateur, lui, paie chaque fichier :
l'index, puis les œuvres par vagues de huit, soit une vingtaine d'allers-
retours **en série** avant que la scène puisse se construire. Le build
concatène donc `works/*.json` en `dist/works/works.json` (idem pour les
pièces), dans l'ordre de l'index. Le chargeur préférait déjà ce format —
c'est celui qu'exporte l'éditeur — il n'était simplement jamais produit.
`content/` garde ses fichiers séparés : ils restent la source de vérité, et
le repli si le combiné manque ou se lit mal.

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
  "lightIntensity": 4,             // 0 = pas de lumière du tout (économie GPU)
  "lightDistance": 14,             // portée en mètres (0 = infinie)
  "lightDecay": 1.8,               // vitesse d'extinction avec la distance
  "lightOffset": [0, 0.4, 1.6],    // position de la lampe, relative à l'objet
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
    // par DÉFAUT une piste est PONCTUELLE : placée dans l'espace en
    // binaural (HRTF), elle tourne autour de la tête quand on pivote
    { "file": "audio/goutte.wav", "radius": 20, "gain": 0.9 },
    // une piste peut porter SON modèle de distance (courbe « inverse »),
    // sa largeur et ses pondérations — elle prend alors le pas sur le
    // module HRTFPanner de l'œuvre :
    { "file": "audio/cloche.wav", "gain": 0.8,
      "spatial": { "refDistance": 3, "rolloff": 1.2, "maxDistance": 50,
                   "largeur": 1.4, "poidsDistance": 0.8, "poidsDirection": 1 } },
    // une NAPPE garde ses canaux d'origine (aucun panner — un PannerNode
    // replie son entrée en mono, la stéréo native y mourrait) :
    { "file": "audio/nappe-stereo.wav", "radius": 30, "gain": 0.7,
      "spatial": false },
    // un son EMPRUNTÉ porte sa source et son crédit, comme un modèle :
    // sans eux, la publication est refusée (voir « Attribution »)
    { "file": "assets/freesound/vent-42.mp3", "gain": 0.6,
      "source": "freesound",
      "credit": { "author": "A. Vento", "license": "Attribution",
                  "sourceUrl": "https://freesound.org/s/42" } }
  ],
  // — surcharges spatiales de L'ŒUVRE (chaque piste peut surcharger) —
  "audio": { "largeur": 1.2, "poidsDistance": 1, "poidsDirection": 1 },

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

**La spatialisation binaurale est la règle, pas un module**
(`engine/src/core/Spatialisation.js`). Chaque piste ponctuelle traverse une
VOIE : un `PannerNode` HRTF à **direction pure** (`rolloffFactor` 0 — il ne
fait qu'orienter) suivi d'un gain de **distance** séparé (modèle « inverse »,
élevé à la puissance `poidsDistance`). Deux contributions, deux nœuds :
l'histoire du projet a déjà montré ce que donnent deux courbes de distance
dans le même chemin. L'écoutant, lui, suit la caméra à chaque frame —
position ET orientation, via les AudioParams modernes (`positionX…upZ`,
lissés par `setTargetAtTime` : pas de craquement en pivotant vite). Trois
réglages, résolus piste → œuvre → galerie (`reglages.json`, bloc `audio`) :

- `largeur` — **exagération d'azimut** : à 1,5, une source à 20° du nez
  s'entend à 30°. Au-delà du réalisme, mais l'image s'élargit et se lit ;
  1 = neutre, l'élévation et la distance ne bougent pas ;
- `poidsDistance` — force des courbes de distance (toutes : voies, fondu
  spatial, mélangeur de couches). 1 = physique ; plus bas, l'atténuation
  s'aplatit et la **direction** redevient l'information dominante — une
  source proche mais de côté est nettement latéralisée, pas juste forte ;
- `poidsDirection` — part du signal qui passe par le panner (fondu wet/dry
  à puissance constante) ; 0 rend la voie omnidirective.

**Préparer ses fichiers.** Sources ponctuelles (gouttes, cloches, voix,
mécaniques) : **mono** — un panner replie de toute façon son entrée en mono,
autant maîtriser le repli soi-même. Nappes et ambiances (drones larges,
field recordings stéréo) : **stéréo + `"spatial": false`** — la piste va au
bus en direct, canaux intacts, gain par distance seulement. Les ambiances de
pièce (`ambience` des rooms) sont toujours des nappes. Le son d'une vidéo
(`videoSound`) suit le bus de l'œuvre, sans panner.

**Budget HRTF** (`maxHRTF` : 16 desktop, 6 GPU modeste, 4 mobile —
surchargeable dans `reglages.json`) : la convolution HRTF coûte cher par
source. Les voies les plus proches l'obtiennent ; les autres retombent sur
`equalpower` (gauche/droite correct, devant/derrière perdu), et la bascule
se fait sous un court voile de gain — changer `panningModel` en pleine onde
claque. Cohérent avec le budget de stems : mêmes distances, même cadence.

**La pièce qu'on entend — Verbity** (`engine/src/core/Reverb.js`, d'après
*Verbity* de Chris Johnson, MIT). La spatialisation dit OÙ est une source ;
la réverbération dit DANS QUOI. Sans elle, quinze pièces — un labo, un
jardin à ciel ouvert, une bibliothèque, un belvédère de cinquante mètres —
sonnaient toutes pareil, c'est-à-dire nulle part, et franchir une porte ne
s'entendait pas.

Un **départ / retour**, pas un effet par œuvre : une pièce est un lieu
COMMUN, et c'est ce qui fait qu'on entend ses œuvres ensemble. Chaque bus
d'œuvre envoie une part dans la réverbe ; le retour rentre par sa propre
tranche de console, sans départ (l'y renvoyer ferait une boucle qui monterait
jusqu'à saturer). Une seule instance : le visiteur n'est que dans une pièce
à la fois, et la queue de l'ancienne s'éteint pendant que la nouvelle
s'installe — c'est ce qu'on entend en passant une porte, et c'est gratuit.

Quatre réglages, dans `rooms/<pièce>.json` → `reverb`, et sous la main dans
l'onglet **Pièce** de l'éditeur :

| Réglage | Effet |
|---|---|
| `moteur` | `verbity` (une pièce) ou `galactique` (un espace) — voir plus bas |
| `envoi` | combien la pièce reçoit. **0 = pièce sèche**, et c'est le défaut |
| `taille` | l'ampleur du lieu — elle règle les DEUX étages (voir ci-dessous) |
| `duree` | combien la queue s'attarde |
| `sombre` | la matière : 0 pierre nue, 1 tenture |
| `premieres` | le niveau des premières réflexions — la pièce entendue de près |

Six **lieux tout faits** (`sec`, `salle`, `bibliotheque`, `couloir`,
`jardin`, `belvedere`) servent de point de départ ; choisir l'un d'eux écrit
ses cinq valeurs DÉPLIÉES, pour qu'on puisse les retoucher sans avoir à
deviner ce que le nom cachait. Une œuvre peut rester sèche dans une salle qui
résonne : `audio.envoi` la multiplie, `0` la coupe du lieu.

**Ce qui n'est PAS une pièce — Galactic2** (`engine/src/core/galactique-worklet.js`,
d'après *Galactic2* de Chris Johnson, MIT). Verbity fait des pièces : un
volume fermé, des murs qu'on devine, une queue qui décroît. C'est juste pour
un labo ou une bibliothèque, et c'est faux pour un belvédère de cinquante
mètres à ciel ouvert — là, rien ne renvoie, il y a de l'espace, et le son s'y
perd sans jamais vraiment rebondir. Aucun réglage de Verbity ne donne cela :
tirer sa `taille` au bout fait une pièce énorme, pas un dehors.

Galactic2 n'a donc **pas de taille** : un seul jeu de seize longueurs, mais
énorme (290 ms, « un stade de dix mille places »), et une CONTRE-RÉACTION QUI
SE NOURRIT — les quatre gains de retour ne sont pas constants, ils grandissent
avec ce qui les traverse et se rabotent d'un passe-haut dont le dosage suit ce
même état. C'est ce qui fait qu'à durée haute la queue ne meurt pas : elle
s'installe, se referme sur elle-même et devient un lieu. Les deux canaux
échangent leur premier retour et le moyennent : l'espace est commun aux deux
oreilles, c'est un dehors et pas deux salles.

Le moteur se choisit **par pièce**, dans l'onglet *Pièce* de l'éditeur ou
`reverb.moteur` du JSON, et un seul lieu tout fait le change (`belvedere`).
Les deux worklets sont montés à l'ouverture et un seul est alimenté — celui
qui dort n'est pas appelé et ne coûte rien, et l'on évite d'enregistrer un
module au milieu d'une visite. Au passage d'une porte, le retour se ferme en
60 ms, on échange, on rouvre en 300 : le tout tient dans le fondu au noir du
portail, et l'ancien moteur est VIDÉ en partant pour que sa queue ne revienne
pas par surprise à la pièce suivante.

Deux choses mesurées, qui ont décidé du réglage livré :

- **la queue tient.** Sur la même frappe, la pièce est à −55 dB après cinq
  secondes ; l'espace est encore à −23 dB. C'est tout le propos ;
- **`duree` est plus basse qu'elle n'en a l'air.** 0,75 sur ce moteur ne
  s'éteint plus (−8 dB après sept secondes) : le belvédère est livré à
  **0,5**, ce qui donne déjà une queue d'une douzaine de secondes.

Les premières réflexions, elles, restent ClearCoat dans les deux cas — une
salle est une salle de près, et même un dehors a un sol.

**La pièce entendue DE PRÈS — ClearCoat** (`engine/src/core/Premieres.js`,
d'après *ClearCoat* de Chris Johnson, MIT). Une queue de réverbe ne s'entend
que loin de la source, ou après elle : collé à une œuvre, elle est masquée
par le direct, et la salle disparaît alors qu'on est dedans. Ce qui la rend
audible de près, ce sont les **premiers retours des murs** — cinq à deux
cents millisecondes, assez tôt pour que l'oreille les fonde dans le son
lui-même. On n'entend pas une réverbération : on entend que la pièce est
petite.

Dix-sept salles, et le réglage n'est pas un temps mais une **salle**, en
places assises : de 96 (5 à 51 ms) à 1541 (24 à 203 ms). Chris ne les a pas
réglées, il les a cherchées — chaque jeu de seize longueurs est un tirage
retenu sur des centaines de milliers pour qu'aucun écho ne retombe sur un
autre. Deux détails qui font le montage :

- **le même départ que la queue.** Une œuvre n'envoie pas deux fois : le
  gain de départ qu'elle porte déjà alimente les deux étages, et le fader de
  la console agit sur les deux. Une œuvre sèche l'est des deux côtés ;
- **une seule ampleur pour les deux.** `taille` allonge la queue ET éloigne
  les premiers retours. Deux curseurs auraient permis une petite salle à
  longue queue — ce qui n'existe pas, et s'entend faux. L'inspecteur nomme la
  salle sous le curseur (« 225 places ») pendant qu'on le traîne.

Mesuré au nœud sur une frappe propre : à 225 places, le centre de gravité de
la réponse tombe à **67 ms** et tout est éteint en **365 ms**. C'est là toute
la différence avec la queue — ça arrive tôt, et ça ne traîne pas.

**La distance — s'éloigner, ce n'est pas seulement « moins fort ».**
Jusqu'ici, quitter une œuvre ne faisait que baisser son volume. Or l'oreille
ne juge pas une distance au volume : elle la juge au TIMBRE (l'air absorbe
les aigus, d'autant plus qu'il y en a à traverser) et au rapport
direct/réverbération (la part réfléchie, elle, ne faiblit presque pas). Deux
lois, une par indice, dans `engine/src/core/air-reglages.js` — c'est de la
physique, pas du DSP emprunté :

1. **la coupure**, `fc = 20 000 / (1 + d / dRef)`, portée par un passe-bas
   par voie (un biquad natif, pas un worklet : quinze worklets pour un
   passe-bas serait payer très cher ce que le navigateur fait en natif) ;
2. **le départ de réverbe remonte** de ce que la distance a ôté. Il est pris
   APRÈS l'atténuation — c'est ce qui permet au fader et au muet de la
   console d'agir aussi sur la réverbe — donc il tombait avec le direct et le
   rapport restait figé : on s'éloignait sans que la pièce se referme sur le
   son ;
3. **…et il TOMBE quand on approche.** L'autre moitié de la même loi, et
   elle manquait. Mesuré sinusoïde à l'appui : à un mètre d'une œuvre, la
   réverbe se tenait à **3,8 dB** sous le direct — on entendait la salle
   autant que l'œuvre — et le rapport s'AMÉLIORAIT en s'éloignant, l'inverse
   de ce que fait une pièce. En deçà de la distance critique (`proche`,
   10 m), le départ décroît linéairement jusqu'à un plancher de −16 dB : on
   ne supprime jamais la salle, il reste des murs. Après : **15,7 dB à un
   mètre**, et la pièce s'ouvre à mesure qu'on recule. Les premières
   réflexions partagent ce départ — approcher nettoie les deux étages d'un
   coup.

Ce que ce n'était PAS, mesuré aussi : de la saturation. La distorsion
harmonique du chemin complet (panner, air, distance, bus, console, limiteur)
tient entre **0,05 et 0,26 %** à toute distance — inaudible. Ce qu'on
entendait comme « saturé » était la pièce collée à l'oreille.

Quatre réglages, dans `reglages.json` → `audio.air` (une pièce peut les
redéfinir dans son propre `air`), et sous la main dans la **table d'écoute**
de l'éditeur :

| Réglage | Défaut | Effet |
|---|---|---|
| `actif` | `true` | couper pour comparer |
| `distance` | `12` | mètres où l'aigu tombe à 10 kHz |
| `intensite` | `1` | dose la loi, en octaves : 0 aucun air, 1 la loi entière |
| `reverbDistance` | `0.75` | combien le départ rattrape : 0 = rapport figé (l'ancien comportement) |
| `proche` | `10` | distance critique (m) : en deçà, la pièce se referme. 0 = pas de loi |

**L'œuvre qu'on n'atteindra pas — Distance2** (`engine/src/core/Lointain.js`,
d'après *Distance2* de Chris Johnson, MIT — lui-même l'hybride de ses
*Distance* et *Atmosphere*). L'air ci-dessus modèle la distance PARCOURUE, et
ça suffit pour une œuvre qu'on approche. Ceci est autre chose : une voix au
fond d'un couloir, un orage derrière une colline — quelque chose qui doit
rester hors d'atteinte même quand le visiteur est devant. Une cascade de
**treize limiteurs de pente**, chacun un peu plus lent que le précédent (les
seuils du nombre d'or, montés par pas de dix pour cent) : ils n'atténuent pas
l'aigu, ils empêchent le signal de MONTER vite — ce que l'air fait à un son
qui a traversé cent mètres, il en émousse les fronts.

Un seul réglage, `audio.lointain` d'une œuvre (0 à 1), avec son curseur dans
la section **Son** de l'inspecteur. À zéro — le défaut, et le cas de presque
toutes les œuvres — **aucun worklet n'est monté** : l'insertion n'existe que
si on la demande. Trois choses à savoir avant de s'en servir :

- il monte l'*atmosphère* et l'*assombrissement* de Chris ensemble : son
  avertissement est que l'atmosphère seule, poussée, ne fait pas un son
  lointain mais « le bruit d'une pression si forte qu'elle romprait l'air et
  vos tympans » ;
- **ça coûte du niveau**, et beaucoup : à mi-course, un son riche perd une
  quinzaine de décibels — les limiteurs n'attaquent que ce qui monte vite,
  donc un souffle perd tout et un bourdon grave presque rien. C'est l'effet
  lui-même ; une œuvre qu'on veut lointaine ET présente se remonte au
  **volume de l'objet**, qui est en aval et ne change pas son grain ;
- l'insertion est encadrée de deux gains inverses (`1/g` puis `g`) : Distance2
  n'est pas linéaire, ses seuils sont absolus, et il doit voir la source au
  niveau où elle a été écrite. Sans cela l'effet se retournait en s'éloignant
  — l'œuvre devenait plus CLAIRE à mesure qu'on la quittait.

**L'écoute de contrôle — Monitoring** (mode auteur, onglet Mixage). Six
loupes posées APRÈS le limiteur, là où se pose un casque, et chacune nomme
ce qu'elle apprend : **mono** (ce qui disparaît s'annulera sur un
haut-parleur de téléphone), **côté** (exactement ce que la spatialisation a
fabriqué), **graves** (vingt-six passe-bas en cascade — les ronflements que
le casque flatte), **crêtes** (clics et coupures de boucle, sans le corps),
et **casque ouvert** (la diaphonie de Chris : chaque oreille entend un peu
de l'autre, avec le retard d'une vraie tête — le binaural y tient-il ?). Un
geste de travail : rien n'est écrit, et la loupe se relâche en quittant
l'onglet.

**La table version SEPT, au choix** (`engine/src/core/console7-worklet.js`,
d'après *Console7Channel* et *Console7Buss* de Chris Johnson, MIT). La six
est une paire de courbes SANS MÉMOIRE, réciproques exactes l'une de l'autre :
c'est ce qui permet de l'écrire en `WaveShaperNode` natif, et c'est gratuit.
La sept ne l'est pas —

- l'encodage mêle **deux** saturations (Spiral à 80 %, la Density de
  ConsoleChannel à 20 %) et le décodage en mêle deux autres, à 61,8 et
  38,2 %. Ce ne sont plus des réciproques exactes, et c'est voulu : mesuré,
  une source seule ressort avec **3,8 %** d'écart, là où la six est exacte ;
- chaque étage porte un passe-bas à 20 kHz, et le fader est POURSUIVI ;
- surtout, la tranche sature au CUBE du fader puis se réamplifie d'un seul
  facteur. Une tranche baissée traverse donc beaucoup moins de distorsion —
  mesuré : **23,4 %** d'harmoniques au fader plein, **0,06 %** à mi-course.
  Chris écrit « fall back in the soundstage, subtly ». Dans cette galerie,
  c'est la DISTANCE qui tient le fader : une œuvre lointaine recule donc
  aussi en timbre, et c'est gratuit.

**Ce que ça coûte, mesuré.** Quinze tranches et une somme, trente secondes
rendues hors ligne : la six prend **19,9 ‰** du temps réel, la sept
**85,6 ‰** — un facteur **4,3**. C'est tenable sur un ordinateur, ça ne
l'est pas forcément sur un téléphone qui porte déjà quinze convolutions
HRTF, trois réverbes et cinq étages de maître. **La six reste donc le
défaut**, et la sept se demande par son nom dans l'onglet *Mixage*. Changer
de version refait les quinze encodeurs et le décodeur en direct, sans couper
le son — la suite navigateur le vérifie, tranches comptées avant et après.

Un détail du portage qui mérite d'être écrit, sans quoi quelqu'un le
« corrigera » : la vitesse de poursuite du fader ne redescend jamais à son
plancher de 64. La condition de Chris est `if (gainchase != inputgain)`, or
la poursuite est une moyenne pondérée qui converge à quelques ulps de sa
cible — mesuré, 3·10⁻¹⁵ — sans jamais l'atteindre. La vitesse se gare donc
juste sous la taille du bloc, soit une constante de lissage de deux
millisecondes et demie. Un test l'affirme dans ce sens-là.

**La table de mixage — Console6** (`engine/src/core/Console.js`, d'après
*Console6Channel* et *Console6Buss* de Chris Johnson, MIT ; son
encodage/décodage vient de torridgristle, MIT aussi). Chaque œuvre encode son
signal (`f(x) = x·(2−x)`), la somme se fait encodée, le maître décode
(`g(x) = x/(1+√(1−x))`, la réciproque exacte). Mesuré plutôt que supposé :

| scène | addition pure | par la table |
|---|---|---|
| une œuvre proche, seule | 0,70 | **0,70** — intacte |
| 1 proche + 4 lointaines | 0,90 | 1,00 |
| 6 œuvres à mi-distance | 0,90 | 1,00 |
| 15 audibles à la fois | 3,00 | **1,00** |

Une source seule traverse la table sans être touchée ; à plusieurs, la somme
s'ouvre un peu et surtout **plafonne**. C'est là que les sources « se font de
la place » : au plafond, et nulle part ailleurs. C'est donc une **couleur de
sommation**, pas un correcteur de niveau, et elle est livrée **éteinte** —
`audio.console.actif` dans `reglages.json`, ou la case dans l'onglet Mixage.
`audio.console.attaque` dose combien on la pousse : 0 la table s'efface et la
somme redevient une addition, 1 c'est le réglage de Chris.

**Sur quelle table la galerie a été mixée — Channel9**
(`engine/src/core/Pupitre.js`, d'après *Channel9* de Chris Johnson, MIT). On
croit qu'une console « colore », comme si elle ajoutait quelque chose. Elle
ENLÈVE : elle n'arrive pas à suivre. Le cœur du portage est un seuil sur ce
que le signal a le droit de changer d'un échantillon au suivant, et les cinq
tables ne diffèrent guère que par là :

| Table | Suit jusqu'à | Bande | Ce qu'on entend |
|---|---|---|---|
| Neve | 0,334 | 28,8 kHz | large et lente — elle arrondit les attaques |
| API | 0,600 | 27,2 kHz | plus vive, la même largeur |
| SSL | 0,849 | 23,0 kHz | la plus rapide — celle qu'on dit propre |
| Teac | 0,149 | 18,5 kHz | étroite et très lente — le quatre-pistes |
| Mackie | 0,092 | 19,7 kHz | la table de chambre, et elle s'entend |

Mesuré au nœud sur un créneau à 110 Hz : parmi les trois tables de studio,
l'écart au signal d'entrée se range exactement dans l'ordre des seuils (SSL
0,84 · API 1,02 · Neve 1,25), et les deux tables modestes altèrent davantage
(Teac 1,39 · Mackie 1,34) tout en gardant **deux fois moins d'aigu** au-dessus
de 5 kHz. Sur un échelon, la SSL est au but tout de suite ; la Teac et la
Mackie mettent trois échantillons.

Une PRÉCISION qui a coûté une première version des tests : le seuil de Chris
ne borne pas la pente mais une différence SECONDE — un changement de pente.
Une rampe rapide mais régulière traverse intacte, et c'est ce qui distingue
une table d'un vulgaire limiteur de pente. Un test le vérifie exprès, pour
que personne ne « corrige » le portage dans le mauvais sens.

Le pupitre est **éteint par défaut**, et c'est délibéré : c'est le seul étage
de la chaîne qui soit un parti pris et non une correction. Il se choisit par
son nom dans l'onglet *Mixage*, avec l'attaque (le *Drive* de Chris — 0,34 %
de distorsion à 0,1, 2,5 % à 0,9) et un niveau de sortie. Une galerie de sons
faits chez soi n'a aucune raison de sonner comme un studio de Londres, et
elle peut choisir de le dire.

Il n'y a **pas de repli natif**, contrairement à l'hygiène : un passe-bas se
refait à l'identique avec les nœuds du navigateur, un écrêtage de pente au
nombre d'or non. L'imiter de loin donnerait un « à peu près » qui porterait
le nom d'une Neve sans en être une. Sans worklet, le pupitre reste donc
éteint et le dit.

**La matière de la table — BussColors4** (`engine/src/core/Couleurs.js`,
d'après *BussColors4* de Chris Johnson, MIT). Le pupitre modèle la VITESSE
d'une console ; ceci modèle sa MATIÈRE. Chacune des huit est la réponse
impulsionnelle relevée sur du vrai matériel, en trente-trois prises de retard
dont les poids ne sont pas constants : ils bougent avec l'affaissement de
l'alimentation sous le signal, ce qu'une console fait quand on la pousse.

Dark (Focusrite MCI) · Rock (SSL) · Lush (Neve) · Vibe (Elation) ·
Holo (Precision 8) · Punch (API) · Steel (Calibre) · Tube (Manley).

Mesuré au nœud sur un créneau à 110 Hz, réglages au neutre : Steel garde le
plus d'aigu au-dessus de 4 kHz (2,6 %), Dark le moins (1,0 %), et Lush est
celle qui change le moins l'énergie du signal (0,493 contre 0,500 à l'entrée)
tout en le colorant. Les deux se cumulent avec le pupitre — une vraie table a
une vitesse ET une matière — mais chacun s'éteint tout seul.

**Attention aux deux gains** : ils sont centrés sur 0,5, pas sur zéro, avec
dix-huit décibels de part et d'autre. À un, la sortie multiplie par trente et
un ; le limiteur tiendra, mais il ne fera plus que cela.

Cinq cent vingt-huit coefficients, ce n'est pas quelque chose qu'on recopie à
la main : ils ont été **extraits du source de Chris par programme**, et
l'extraction validée en comparant ses blocs gauche et droit, qu'il a écrits
deux fois — ils concordent sur les deux cent soixante-quatre paires. Le seul
écart d'implémentation est un tampon circulaire au lieu de son décalage d'un
cran par échantillon ; le test réimplémente sa version naïve et exige
l'égalité **au bit près** sur les huit couleurs.

**Ce qui empêche la galerie d'être parfaite — ToTape6**
(`engine/src/core/Bande.js`, d'après *ToTape6* de Chris Johnson, MIT). Un
mixage fait chez soi sonne numérique moins par sa COULEUR que par sa
STABILITÉ : rien ne bouge, rien ne pèse, rien ne cède. La bande apporte les
trois d'un coup.

- **le pleurage.** La vitesse de défilement n'est pas constante, et le signal
  est relu d'un tampon à une position qui oscille. C'est une modulation de
  HAUTEUR, pas un effet posé dessus — et c'est le seul étage de toute la
  chaîne qui en fasse une. Mesuré au navigateur sur un sinus à 1 kHz, par
  l'écart de phase entre les deux moitiés d'un même tampon : **0,0016 rad**
  sans pleurage, **0,83** avec ;
- **la bosse de tête.** Une résonance dans le bas, non linéaire (l'état est
  cubé puis passé au sinus), qui donne du poids à ce qui n'en a pas. Mesuré :
  à 60 Hz, 0,431 → 0,660 ; à 4 kHz, 0,431 → 0,434, c'est-à-dire rien ;
- **l'écrasement.** Le « mojo » de Chris, `sin(x·|x|^¼·π/2) / |x|^¼`, qui
  aplatit très doucement bien avant d'écrêter. Relevé point par point, la
  courbe d'entrée-sortie : 0,1 → 0,157 · 0,5 → 0,745 · 0,9 → 1,113 · 2,0 →
  1,233. Elle se couche, elle ne casse pas, et rien ne sort au-dessus du
  plafond de 0,99.

Un détail qui n'en est pas un : le résidu. La bride que Chris pose sur la
bosse de tête cesse d'agir dès que l'état est plus petit qu'elle, donc la
bosse se GARE autour de 1,3·10⁻⁴ au lieu de rejoindre zéro — environ −105 dB
de continu après un long silence. C'est l'algorithme d'origine, c'est
inaudible, et l'Infrasonic de l'hygiène, juste derrière, l'ôte de toute
façon. Un test vérifie que cela ne dérive pas.

Le hasard du pleurage vient d'un générateur à nous et non du dither, qu'on
ne porte pas : il est donc **reproductible** d'une visite à l'autre. Ce n'est
pas un défaut ici, et cela rend le portage éprouvable.

**Les deux bornes de l'audible — Ultrasonic et Infrasonic**
(`engine/src/core/Hygiene.js`, d'après *Ultrasonic* et *Infrasonic* de Chris
Johnson, MIT). Ce qu'ils enlèvent, personne ne l'entend — et c'est justement
pour cela : ce qui s'y trouve n'est pas de la musique, c'est le déchet des
étages d'avant, et il coûte.

- **en bas**, chaque boucle de réverbe, chaque bloqueur de continu, chaque
  enveloppe laisse un résidu sous vingt hertz. Il ne s'entend pas, il OCCUPE
  — il mange de la marge et fait travailler le limiteur sur du vent ;
- **en haut**, les mises en forme non linéaires de la chaîne (Console6, la
  saturation sinus de Pressure4, l'écrêteur, le conditionnement de Galactic2)
  fabriquent des harmoniques au-dessus de vingt kilohertz. Le convertisseur
  d'un casque bon marché les replie en intermodulation, et cela, ça
  s'entend — comme une aigreur qu'on croit venir du mixage.

Un Butterworth d'**ordre dix** de chaque côté, en cinq biquads, avec les cinq
facteurs de qualité de Chris. Mesuré sur le nœud réellement installé, en
différentiel : **−3,01 dB pile** à 20 Hz et à 20 kHz, **−0,00 dB** à 100 Hz,
1 kHz et 10 kHz, et rien qui sorte à 5 Hz (−117 dB). Les deux se coupent
séparément, dans l'onglet *Mixage* — un filtre dont on n'entend pas l'effet
doit pouvoir se couper, sans quoi on ne saura jamais s'il fait quelque chose.

**AVANT LE LIMITEUR, jamais après**, et ce n'est pas un détail de goût : un
filtre raide augmente le facteur de crête d'un signal (il ôte des partiels,
ceux qui restent se réalignent). Mesuré sur du bruit blanc à ±0,9 — le pire
cas concevable, et pas ce que porte la galerie — la sortie monte à **1,57**,
du fait du coupe-haut ; sur un signal musical (un la à 0,9) elle ressort à
0,9000 exactement. Un plafond doit être le DERNIER mot sur les crêtes :
filtrer derrière l'écrêteur arrondirait ce qu'il vient d'écrêter et
repousserait des échantillons au-dessus du plafond qu'on venait de garantir.

Le worklet travaille en **double précision**, et c'est nécessaire : à vingt
hertz, les pôles du dernier biquad sont à 0,9996 du cercle unité. Le repli
natif — dix `BiquadFilterNode` — n'est pas une approximation : le navigateur
applique la même forme (K = tan(π·f/taux), Q linéaire), ce sont les mêmes
coefficients par un autre chemin.

**Le plafond, dernière version — Pressure5** (`engine/src/core/pression5-worklet.js`,
d'après *Pressure5* de Chris Johnson, MIT). Le limiteur était Pressure4 suivi
de ClipOnly2, deux étages qu'il fallait accorder l'un à l'autre. La cinq est
le tout d'un bloc, et Chris y a mis trois choses que la quatre n'avait pas :

- **deux passe-bas fixes à 24 kHz**, l'un devant la compression, l'autre
  entre elle et l'écrêteur. Un détecteur qui voit de l'ultrasonique réagit à
  ce que personne n'entend. (À 44,1 et 48 kHz ils sont sautés — la coupure
  tomberait au-dessus de Nyquist ; c'est le test de Chris lui-même) ;
- **« PawClaw »**, qui module la courbe du µ par la PENTE du signal : patte
  de velours sur ce qui glisse, griffe sur ce qui attaque. Mesuré, l'écart
  entre les deux bouts du curseur vaut **4,7 %** sur des attaques contre
  **1,7 %** sur une pente douce ;
- **ClipOnly2 est dedans**, après le mélange sec/traité, en filet même à
  mi-chemin.

Mesuré au navigateur, sur un sinus **trois fois trop fort** : les deux
tiennent le plafond à 0,955 exactement — c'est le devoir d'un plafond et il
est absolu. La cinq réduit de 9,9 dB pour y arriver, la quatre de 7,1.

Au réglage RÉELLEMENT LIVRÉ (pression 0,25, marge 0,75), les deux sont
**transparentes** : le gain du plafond, mesuré des deux côtés au même
instant, vaut **0,00 dB** pour l'une comme pour l'autre, et le voyant reste à
zéro. C'est exactement ce qu'on demande — brancher un plafond ne doit pas
changer le volume. Le sélecteur est dans l'onglet *Mixage*, et la différence
s'entend là où elles travaillent vraiment : sur les crêtes.

### Le rattrapage caché de la cinq, et deux pièges de mesure

Ce paragraphe garde une erreur de fermée, parce qu'elle est instructive et
qu'elle a failli en faire naître une autre.

**Le vrai défaut.** Chris fait précéder le µ de la cinq d'un rattrapage
`1/seuil`, sans réglage pour le rendre — la quatre, elle, a `compenser`. En
faisant de la cinq le défaut sans y penser, j'ai monté **toute la galerie de
+2,36 dB** et rapproché d'autant la saturation dont on venait de s'éloigner.
Rien ne le disait : les crêtes tenaient sous un, le limiteur ne réduisait
pas, toutes les suites passaient. Cela ne s'entendait que comme « ça sature
un peu trop quand on est proche ». La conversion vit maintenant dans
`sortiePression5()` / `gainNetPression5()` (`limiteur-reglages.js`), et
`test-pression5.mjs` éprouve la règle plutôt que de la rappeler en
commentaire : *brancher le plafond ne change pas le volume*, à toutes les
pressions.

**Le premier piège : mesurer un seul côté.** J'avais d'abord rapporté que la
quatre rabotait **−7,0 dB** au réglage livré. C'était faux. Ne relever que la
sortie et *supposer* l'entrée, c'est parier sur l'état de la marge, des
rampes de bascule et du gain d'entrée. La sonde mesure désormais l'entrée et
la sortie **au même instant**, par deux analyseurs : un rapport se mesure, il
ne se déduit pas. Sans quoi on « corrige » un étage sain.

**Le second : un état qui traîne.** Le vari-µ de Chris se relâche en
**v² échantillons** — des dizaines de secondes quand le signal est fort. La
quatre n'avait pas de `vider` : les remises à zéro de la sonde ne
l'atteignaient pas, et chaque relevé traînait la compression du relevé
précédent. `Pressure4` et `ClipOnly2` en ont un maintenant, et le processeur
répond à `{ vider: true }` comme les autres worklets.

**Et la marge ?** Mesurée sur la vraie galerie plutôt que sur un signal de
test : la somme ne dépasse **0,08** même à 2,41 m de l'œuvre la plus proche,
avec 0 dB de réduction du bout à l'autre — une vingtaine de décibels de
réserve. Aucun changement de `marge` n'était justifié ; c'est bien le
+2,36 dB qu'il fallait retirer.

**Le limiteur du maître — approcher, ce n'est pas « plus fort ».**
Le bus maître allait droit à la sortie. Quinze sources qui s'additionnent y
saturent, et l'approche d'une œuvre ne s'entendait que comme un volume qui
monte. Un **limiteur** est posé entre le maître et la sortie
(`engine/src/core/Limiteur.js`) : le plafond tient, et le son dont on
s'approche prend la place — tout le reste recule d'exactement ce qu'il gagne.
La proximité devient une **présence**, pas un niveau. C'est le vieux réflexe
du mixage : ce qui compresse le bus est ce qui commande le bus.

Deux étages, portés des plugins **Airwindows** de Chris Johnson (MIT, voir
[`../THIRD-PARTY-NOTICES.md`](../THIRD-PARTY-NOTICES.md)) dans un
AudioWorklet :

1. **Pressure4**, un compresseur *vari-µ* : sa constante de temps dépend du
   signal lui-même, ce qui lui donne une respiration qu'aucun couple
   attaque/relâchement fixe n'a. C'est lui qui fait le mixage proche/lointain.
   Son relâchement est **long** — environ deux secondes au réglage par défaut :
   la pièce se rouvre au lieu de pomper ;
2. **ClipOnly2**, un écrêteur qui **ne fait rien** tant que rien ne dépasse ;
   quand un échantillon passe le plafond, il adoucit ses voisins au lieu de le
   trancher.

**Et d'abord la MARGE, parce qu'un limiteur n'est pas un correcteur de
niveau.** Mesuré au labo : trois œuvres proches somment à 1,27 — au-dessus du
plein niveau. Le premier étage ne s'en émouvait guère (0,5 dB de réduction) et
c'est le second qui passait son temps à raboter les crêtes à son plafond
(0,955), ce qui s'entend comme une saturation permanente dès qu'on approche.
Aucun réglage de limiteur ne répare cela : une table de mixage, devant une
somme trop forte, **baisse l'entrée**. `marge` est ce fader, en tête de
chaîne — à `0.75`, la sortie crête à 0,81 au lieu de coller au plafond, et le
limiteur ne travaille plus que sur les vraies crêtes. La galerie sort deux
décibels et demi plus bas ; c'est le prix, et c'était le prix de l'honnêteté.

Quatre réglages, dans `reglages.json` → `audio.limiteur`, et sous la main dans
l'onglet **🎧 Mixage** de l'éditeur (avec un **voyant de réduction** sur la
tranche Maître : c'est exactement de cela que tout le reste recule) :

| Réglage | Défaut | Effet |
|---|---|---|
| `actif` | `true` | couper pour comparer — le geste le plus instructif |
| `marge` | `0.75` | de combien on baisse la somme AVANT de limiter |
| `pression` | `0.25` | combien il serre (le seuil de Pressure4) |
| `vitesse` | `0.5` | vitesse de relâchement |
| `douceur` | `0.5` | le grain : 0,5 neutre, ↓ ça s'étale, ↑ ça tient |
| `sortie` | `1` | niveau de sortie |
| `compenser` | `true` | rend le gain de rattrapage de Pressure4 |
| `caractere` | `0` | dose sa saturation sinus : 0 transparent, 1 le grain de Chris |

**Deux robinets autour de l'algorithme, et pourquoi.** Pressure4 multiplie
d'abord tout par `1/seuil` : c'est une partie de son son (on cherche la
densité), mais posé sur un bus qui allait bien, cela montait la galerie
entière de +3,5 dB et poussait le moindre passage dans la sinusoïde du second
étage — une saturation douce permanente, mesurée à 2 % de distorsion à
mi-échelle. `compenser` rend ce gain avant la sinusoïde ; `caractere` dose la
sinusoïde elle-même. Aux valeurs par défaut, un signal sous le seuil ressort
à **0,00 dB et 0,00 % de distorsion** : brancher le limiteur ne s'entend
plus, et l'on peut le couper pour comparer. À `caractere: 1` on retrouve
exactement le plugin de Chris.

Le limiteur tourne **aussi pour le visiteur** — ce n'est pas un outil
d'auteur. Si l'AudioWorklet manque (contexte non sécurisé, navigateur
ancien), un `DynamicsCompressorNode` suivi de la même saturation sinus prend
le relais : moins fin, mais la galerie n'est jamais sans plafond, et la
console dit lequel des deux tourne.

**Une œuvre suspendue rejoue en revenant.** Le budget de voix fond le gain
de chaque piste à zéro en suspendant (s'éloigner, changer de pièce) ; la
réactivation **rend ce gain** en recréant les sources. Longtemps elle ne l'a
pas fait : le monolithe quitté puis retrouvé restait muet pour toujours —
seules les œuvres à mélangeur de couches, qui reconduisent leurs gains
chaque frame, masquaient le défaut.

**Vérifier au casque — le protocole de trois minutes.** Casque OBLIGATOIRE
(et posé dans le bon sens : la plupart marquent L/R) — sur haut-parleur de
téléphone, le binaural s'effondre, c'est pour cela que l'écran d'accueil le
dit. Puis :

1. **Gauche/droite** — face au monolithe (labo), faites trois pas de côté
   vers la gauche : sa pulsation doit glisser franchement vers votre oreille
   DROITE (la source est maintenant à votre droite). Revenez, pas de côté à
   droite : elle passe à gauche. Si c'est inversé, le casque est à l'envers ;
2. **La traversée du champ** — immobile devant une œuvre sonore, pivotez
   lentement de 360° (Q/E ou souris). La source doit faire le tour complet
   de votre tête — gauche, derrière (son plus mat, c'est l'HRTF), droite,
   devant — sans saut ni craquement ;
3. **Devant/derrière** — dos à l'œuvre, elle doit sonner plus sourde et
   « hors champ » que de face, à volume comparable ;
4. **Distance vs direction** — approchez-vous par le côté : le son doit
   rester clairement latéralisé en devenant plus fort — s'il ne fait que
   monter, la direction est cassée (c'était le bogue d'origine) ;
5. **Les nappes** — une ambiance de pièce reste large et stable pendant
   toute la rotation : elle ne tourne PAS avec la tête, c'est voulu.

Ajout pas à pas : déposer les médias → créer le JSON → l'ajouter à
`works/index.json` → recharger. Ou plus simple : composer directement dans
**l'éditeur de scène** (ci-dessous) et exporter.

**Compatibilité du format.** Les scènes écrites avant le schéma v2
(`rotationY` scalaire, `scale` uniforme) se chargent telles quelles : la
migration est appliquée en mémoire au chargement, dans le runtime comme dans
l'éditeur. Vos anciens JSON n'ont rien à changer ; l'export, lui, écrit
toujours du v2.

### Décrire une pièce (rooms/*.json)

Lumière et matière d'une pièce (tout optionnel, réglable à l'œil dans
l'onglet **Pièce** de l'éditeur) :

```jsonc
{
  "keyLight": { "color": "#fff2e0", "intensity": 2.2,
                "azimuth": 210, "elevation": 55,
                "shadows": false },        // couper les ombres de CETTE pièce
  "envIntensity": 1,                       // ambiance IBL (image d'environnement)
  "ambient": { "color": "#404050", "intensity": 0.6 }, // lavis uniforme
  "floor": { "size": 40, "color": "#141420", "texture": "dalles",
             "textureRepeat": 2, "roughness": 0.4, "metalness": 0.1 },
  "shell": { "width": 26, "depth": 20, "height": 6.5, "texture": "pierre",
             "textureRepeat": 1.5, "roughness": 0.9, "metalness": 0 }
}
```

L'**ambiante** relève tout d'un même ton — l'outil des pièces trop sombres
qu'on ne veut pas récrire lampe à lampe (l'IBL, lui, éclaire par l'image et
teinte selon les normales). `textureRepeat` resserre le motif procédural ;
rugosité et métal font la matière — un sol ciré n'est pas un sable, même
sous la même texture.

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
🎧 Mixage (l'onglet du même nom, ci-dessous),
＋ Objet, gizmos ↔ / ⟳ / ⤢ (raccourcis
1 / 2 / 3), ⧉ dupliquer, 🗑 supprimer (Suppr), ⤓ Importer et ⤒ Exporter
(`galerie.json`, toute la galerie en un fichier), ☁ Publier… (le panneau
*Sauvegarde* : fichier, dossier `content/`, mise en ligne), ✕ quitter.

### Le volet droit : trois onglets

Le panneau de propriétés se lit en trois onglets — empilés, les réglages de
pièce vivaient sous huit sections d'œuvre, introuvables :

- **Pièce** — l'endroit : brume, architecture, matière des surfaces
  (texture, répétition, rugosité, métal — sol et murs), ciel, lumière clé
  (couleur, azimut, hauteur, **ombres par pièce**), ambiance IBL, **lumière
  ambiante**, arrivée, jetons, réglages généraux ;
- **Œuvre** — la sélection : transform, apparence (dont la **lumière
  d'appoint complète** : couleur, intensité, portée, décroissance, position
  de la lampe), matière, son, modules, attribution. Sélectionner un objet
  ouvre cet onglet ; tout désélectionner ramène à Pièce ;
- **🎧 Mixage** — tout ce qui s'écoute (ci-dessous).

La **hiérarchie** (volet gauche) ne déroule que la pièce courante — cliquer
une autre pièce y va, et la déplie. La recherche rouvre tout : on cherche
partout, c'est son objet.

### 🎧 L'onglet Mixage — la console

Le son est l'essence du projet : son atelier est **graphique**, dessiné en
continu (une frame d'écran = une frame de console). Un mixage ne se règle ni
à l'œil ni au JSON — il se règle **au casque, en marchant**, pendant que les
instruments disent ce que l'oreille croit entendre.

- **Le radar d'écoute** — vous au centre, le regard vers le haut, le cône du
  champ de vision en clair. Chaque source est posée à son **azimut rendu**
  (largeur comprise : on voit ce que le panner entend) et à sa distance —
  anneaux à 5, 10, 20, 40 m. Son **halo pulse à son niveau réel**, sa
  couleur dit son modèle (vert HRTF, gris equalpower), et une œuvre toute en
  nappes s'affiche en **anneau autour de la tête** : elle est partout, elle
  n'a pas d'azimut. **Cliquer une source la sélectionne** dans la scène ;
- **Les tranches** — une par œuvre sonore de la pièce : **VU vertical
  segmenté à crête tenue**, **fader vertical** (`baseGain`) et, dans le
  tiroir **≡**, un fader par piste — écrits au document par le chemin
  rapide, le son ne coupe jamais sous le doigt. **M / S** (muet / solo) sont
  des gestes de travail : ils débranchent le bus de l'œuvre du maître, rien
  n'est écrit nulle part, et tout se rebranche en quittant l'onglet — comme
  on relâche les solos en quittant une vraie console. Sous chaque tranche :
  la distance et le modèle appliqué (`HRTF ×3`, `equalpower`, `∿ nappe`) ;
- **La tranche maître** — VU de la sortie, **spectre en bandes
  logarithmiques** (comme l'oreille : en linéaire, un sub-grave de 55 Hz
  n'allumait qu'une barre sur seize), et le compte des voies HRTF en cours ;
- **l'œuvre sélectionnée** — ses réglages spatiaux par piste (distance de
  référence, décroissance, portée maximale, largeur) ;
- **la galerie** — largeur stéréo, pondérations, budget HRTF, rangés dans
  `reglages.json` à la publication ; **⧉ Copier le JSON** en prime ;
- **le détail des voies** (replié) — azimut, distance, modèle, gain.

Le placement d'une piste (**ponctuelle** binaurale / **nappe stéréo**) se
choisit dans l'onglet Œuvre, section Son. Rien de tout cela n'existe dans le
build visiteur — le garde-fou y veille, comme pour le reste de l'éditeur.

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
déposer dans `content/assets/` pour la version déployée (voir
« Sauvegarder, publier, mettre en ligne »).

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

**Un aller a toujours son retour, et c'est vérifié.** L'éditeur pose les deux
portes d'un coup, mais une galerie s'écrit aussi à la main ou par script — et
c'est ce qui était arrivé : le belvédère ouvrait sur six pièces qui n'avaient
aucune porte pour y revenir. On y tombait, et l'on n'en ressortait que par le
couloir, si on le trouvait. `scripts/test-portails.mjs` lit le contenu à
chaque `npm test` et refuse trois choses : une porte qui ne mène nulle part,
un passage à sens unique (les portails d'Escher exceptés — une pièce vers
elle-même est son propre retour), et une pièce qu'aucun chemin ne relie à
l'entrée.

### Les cartels : Slug, ou les lettres dessinées depuis leurs contours

**Le nom des salles est du lettrage vectoriel calculé au fragment**
(`engine/src/core/lettrage.js`), portage de l'algorithme **Slug** d'Eric
Lengyel — le moteur de texte de jeux AAA, dont le brevet a été versé au
domaine public en 2026 et les shaders de référence publiés en MIT/Apache-2
(https://github.com/EricLengyel/Slug ; le crédit est exigé, il est dans le
code, dans `content/LICENCES/slug-MIT.txt`, et le garde-fou refuse un build
qui l'aurait perdu). Chaque pixel résout les polynômes des Béziers
quadratiques du glyphe qui le concernent — deux rayons, un horizontal, un
vertical, pondérés — et en tire une couverture **analytique** :
l'anticrénelage est la fraction du pixel réellement couverte, le trait est
exact à tout grossissement. Les « bandes » de Lengyel (chaque glyphe découpe
son em en tranches qui listent leurs seules courbes, triées pour l'arrêt
anticipé) bornent le coût. Un cartel entier tient dans UN appel de dessin.

**C'est le troisième moteur de ces étiquettes, et chaque étape a payé la
suivante.** Le canevas (512 px étirés sur 2,60 m) devenait de la bouillie en
poussant la porte. Le SDF (troika) a réglé la netteté mais apporté deux
fuites réseau — la police par `fonts.gstatic.com`, puis un résolveur de
replis qui partait sur `cdn.jsdelivr.net` au premier caractère inconnu, et
c'est ce contrôle-là qui a révélé que le « ◆ » n'existe pas dans le latin
d'Inter (d'où le « • » des portes). Slug ferme le dossier : **les courbes
d'Inter sont dans le bundle** (`lettrage-inter.js`, généré depuis le `.woff`
par `genere-lettrage.mjs` — 126 caractères, 2 935 courbes, 2 188 paires de
crénage, 25 ko compressés). Plus de fichier de police, plus de worker, plus
d'atlas ; troika et ses 227 ko sont partis, et le paquet principal est passé
de 1 202 à **1 195 ko**. La police reste Inter (OFL 1.1), sous forme de
courbes.

**Et c'est PROUVÉ, par trois oracles indépendants.** Au nœud
(`test-lettrage.mjs`) : l'intégrale de la couverture égale l'aire
géométrique des contours (théorème de Green, calculée par un tout autre
chemin) à moins de 2 % sur neuf glyphes ; la couverture calculée avec les
seules courbes de la bande égale celle calculée avec toutes, sur 2 000
échantillons aléatoires — c'est exactement le pari du shader ; le fichier
généré est régénéré et comparé octet à octet. Au navigateur
(`verif-lettrage.cjs`) : un « Og » est rendu par le GPU dans une cible hors
écran et comparé pixel à pixel à la référence CPU — **16 384 pixels, écart
moyen 0,0001, accord binaire 100,00 %**, avec 150 pixels d'anticrénelage au
bord. GPU = CPU = géométrie. Deux écarts assumés à la référence, documentés
dans `lettrage.js` : pas de dilatation dynamique (un padding statique de
0,25 em la remplace, pour du texte jamais lisible sous quelques pixels), et
des textures float32 au lieu de float16/uint16.

**Et le BVH ? Mesuré, puis refusé — presque.** `three-mesh-bvh` (MIT) remplace
le balayage triangle par triangle du `Raycaster` par une descente d'arbre, et
la marche tire jusqu'à sept rayons par frame. Sur le papier, le belvédère de
cinquante mètres devait en souffrir. Relevé au navigateur :

| pièce | cibles | triangles | la plus grosse | passe de collision |
|---|---|---|---|---|
| belvédère | 58 | 676 | **12** | **0,192 ms** |
| labo | 12 | 100 | 12 | 0,062 ms |
| jardin | 4 | 28 | 12 | 0,012 ms |

Un centième de frame, et **pas une cible au-dessus de douze triangles** : le
labyrinthe n'est pas fait de masses lourdes mais d'une multitude de pavés. Le
coût est celui du nombre d'OBJETS, pas des triangles, et un arbre par
géométrie n'y peut rien. L'empaqueter revenait à livrer 20 ko compressés qui
ne font rien.

Il est donc chargé par `import()` **dynamique** : la bibliothèque vit dans son
propre morceau, le morceau n'est demandé que si une cible dépasse deux mille
triangles — un modèle importé, jamais une boîte — et la galerie
d'aujourd'hui ne le télécharge pas. Vérifié des deux côtés : en A/B, le
paquet principal passe de 1 201,78 à 1 202,00 ko (**+0,22 ko**), et
`verif-cartels.cjs` repère le morceau sur le disque puis prouve qu'aucune des
44 requêtes d'une visite complète ne le demande. La protection existe pour le
jour où quelqu'un posera un modèle de deux cent mille triangles ; elle ne
coûte rien avant.

**Le reste de la liste, mesuré puis refusé.** Trois autres candidats de la
même vague avaient l'air utiles sur le papier ; aucun n'a survécu à la
mesure, et c'est noté ici pour qu'on ne refasse pas l'étude dans six mois.

- **meshoptimizer / glTF-Transform** (compression de modèles au build) : la
  bibliothèque entière de modèles pèse **232 ko**, le plus gros fichier
  131 ko (la lune). Monter un pipeline de compression pour cela coûterait
  plus en entretien qu'il ne rendra jamais en octets.
- **`THREE.BatchedMesh`** (fondre les maillages en un appel de dessin) :
  compté sur soixante frames, appels de dessin par pièce — entrée 49, labo
  40, jardin 28, bibliothèque 20, archives 20, **belvédère 89** pour 267
  objets. La douleur WebGL commence à plusieurs centaines d'appels ; à
  quatre-vingt-neuf, une refonte du rendu (un matériau par lot, le culling à
  refaire) n'achèterait rien de perceptible.
- **fflate** (compresser `galerie.zip`) : l'archive utilise déjà
  `CompressionStream('deflate-raw')`, natif au navigateur, avec les médias
  déjà compressés rangés sans recompression (`state/Archive.js`). Le
  problème était résolu avant d'être posé.

La règle qui sort de cette vague : une dépendance s'ajoute sur une mesure,
jamais sur une réputation — et la mesure se garde dans un test ou ici.

**Et la chaîne elle-même se vérifie.** Les vingt-cinq suites s’enchaînent par
des `&&` : un script qui *plante* — pas qui échoue, qui plante — arrête tout
le reste sans afficher une seule croix. C'est arrivé. En accueillant la sept,
`Console.js` a gagné un `import … from './console7-worklet.js?raw'` : une
affaire d'empaqueteur, que le nœud ne sait pas résoudre. Comme
`test-console.mjs` importait `Console.js`, la chaîne s'arrêtait au neuvième
script sur vingt-deux, et **treize suites ne tournaient plus** — pendant que
le décompte final affichait paisiblement `0 ✗`. D'où la règle, désormais
éprouvée et non plus rappelée : un test n'importe que des `*-reglages.js`,
jamais un module que le nœud ne sait pas résoudre — la source d'un worklet
en `?raw`, ou un fichier importé pour son URL comme la police des cartels.
Le contrôle les cherche par la FORME de l'import, pas par une liste de
suffixes qu'il faudrait tenir à jour. La chaîne complète tient aujourd'hui
**856 ✓ / 0 ✗**.

### Sauvegarder, publier, mettre en ligne

Trois questions, dans l'ordre où on se les pose — et un seul endroit pour y
répondre : **☁ Publier…** ouvre le panneau *Sauvegarde*. La barre ne porte
plus que deux raccourcis, **⤓ Importer** et **⤒ Exporter**.

#### 1 · Garder un fichier

**⤒ Exporter** télécharge `galerie.zip` : **toute la galerie, rangée au plan
du dépôt**. On la décompresse à la racine de sa galerie et tout se met en
place — *rien à trier*. Ce qu'elle contient :

```
content/works/<id>.json      un fichier par objet, + works/index.json
content/rooms/<id>.json      un par pièce, + rooms/index.json
content/reglages.json        les réglages généraux
content/assets/…             VOS MÉDIAS IMPORTÉS, à leur place
content/….attribution.json   un crédit par modèle et par son emprunté
galerie.json                 la même galerie en un seul fichier
LISEZ-MOI.txt                où la décompresser
```

C'est la sauvegarde qu'on range sur une clé, qu'on envoie, qu'on rouvre sur
un autre ordinateur — et c'est aussi ce qui rend **Firefox et Safari
équivalents à Chrome** : ils n'ont pas l'écriture directe dans un dossier,
mais une archive se décompresse partout.

**⤓ Importer** relit l'archive **médias compris** — les images et les sons
reviennent sous leur chemin de contenu, rien à redéposer. Il accepte aussi un
`galerie.json` seul, un ancien `works.json` / `rooms.json`, ou un `content/`
que quelqu'un a zippé à la main.

Le zip est écrit sans bibliothèque tierce (`state/Archive.js`, ~150 lignes) :
les fichiers de moins de 8 ko partent en clair, deflate est gardé pour ce qui
pèse — cent soixante allers-retours de compression pour trente kilo-octets
gagnés faisaient de l'export une attente d'une minute.

Une **attribution incomplète refuse l'export**, comme partout ailleurs :
c'est une condition de licence, pas une préférence.

#### 2 · Écrire dans le dépôt local

Écrit la galerie **directement dans `content/`**, au format déjà en place
dans le dépôt — celui qui donne des diffs lisibles dans git :

- `works/<id>.json`, un fichier par objet, plus `works/index.json` ;
- `rooms/<id>.json`, un par pièce, plus `rooms/index.json` ;
- `reglages.json` (réglages généraux) ;
- un `<modèle>.attribution.json` par modèle et par son importé ;
- les médias importés en fichier, déposés dans `content/assets/`.

Au premier clic, le navigateur demande de désigner le dossier ; ensuite le
bouton porte son nom et un clic suffit. Avant d'écrire, un récapitulatif
**nomme tout** : combien d'objets et de pièces, combien de fichiers, et
surtout **ce qui va être effacé** — les fichiers d'objets supprimés depuis la
dernière publication, et le fichier combiné `works.json`/`rooms.json` s'il
traîne encore (le chargeur lui donne la priorité : laissé en place, il
masquerait toute la publication). Rien ne part en ligne : `git commit` reste
votre geste.

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

Firefox et Safari n'ont pas l'API d'écriture dans un dossier : le bouton y
retombe sur un téléchargement. Le chemin complet pour eux, c'est
**⤒ Exporter** — l'archive porte les mêmes fichiers, déjà rangés.

#### 3 · Mettre en ligne

**☁ Mettre en ligne** pousse la galerie sur le dépôt du site, **en un
commit**, sans terminal : lecture de la branche, arbre construit par-dessus
l'arbre courant, commit, référence avancée. Cinq requêtes pour toute la
galerie. Le site statique se reconstruit ensuite tout seul (GitHub Pages,
une minute ou deux).

**Chacun son compte.** Rien n'est câblé sur un dépôt particulier — quatre
réglages, gardés dans le navigateur :

| Réglage | Exemple | À quoi il sert |
|---|---|---|
| Dépôt | `auteur/depot` | l'adresse complète collée depuis GitHub est acceptée |
| Branche | *(vide)* | vide = branche par défaut du dépôt |
| Dossier de contenu | `galerie/content` | où vivent `works/` et `rooms/` dans le dépôt |
| Adresse du site | `https://auteur.github.io/galerie` | pour le lien « Voir le site » ; proposée d'après les deux premiers |

**Le jeton d'accès.** Un jeton GitHub *fine-grained* avec la seule permission
**Contents : Read and write** sur ce dépôt suffit — il se crée dans
*Settings → Developer settings → Personal access tokens*, et se révoque à
tout moment.

> Il est rangé **dans le navigateur seulement** (IndexedDB, sous sa propre
> clé), n'est jamais réaffiché en clair, et n'entre ni dans l'export, ni dans
> le brouillon, ni dans aucun fichier. **Aucune clé d'API n'a sa place dans
> un dépôt** — celle-ci pas davantage que les autres. Tout le module vit dans
> l'éditeur, absent du build visiteur : `api.github.com` est un hôte interdit
> pour `scripts/check-visitor-build.mjs`, qui échoue si la moindre trace en
> reste.

**Vérifier l'accès** lit — et ne fait que lire : le compte reconnu, le dépôt,
la branche, le droit d'écriture. Un jeton mal collé, expiré ou pris sur le
mauvais compte se voit là, et non au moment d'envoyer.

Avant d'envoyer, le même récapitulatif que la publication locale, **ce qui
sera effacé compris**. Ne partent que les `.json` orphelins de `works/` et
`rooms/` : un média, une page, un dossier voisin ne sont **jamais** touchés,
et si l'arbre distant est trop grand pour être listé entièrement, **rien**
n'est effacé. La référence avance **sans `force`** : si quelqu'un a poussé
pendant que vous composiez, l'envoi échoue au lieu d'écraser son travail.

Une attribution incomplète refuse la mise en ligne, avant tout appel réseau.

## Modules fournis

| Module | Rôle | Paramètres principaux |
|---|---|---|
| `SpatialCrossfade` | Volume global de l'œuvre selon la distance (smoothstep) | `radius`, `inner`, `maxGain` |
| `StemMixer` | Mixe chaque stem selon **son propre** rayon — les couches se révèlent en approchant | `innerRatio` |
| `HRTFPanner` | Distances binaurales de l'ŒUVRE (déclaratif : les voies des pistes les appliquent — le binaural lui-même est natif, voir « Sonorisation ») | `refDistance`, `maxDistance`, `rolloff` |
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
  suspendues — et parmi les pistes qui jouent, seules les `maxHRTF` plus
  proches gardent la convolution HRTF, les autres passent en `equalpower`
  (voir « Sonorisation ») ;
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
[`../THIRD-PARTY-NOTICES.md`](../THIRD-PARTY-NOTICES.md). **Un seul est
vendoré** : les plugins d'**Airwindows** (Chris Johnson), sous licence MIT,
portés en JavaScript — *Pressure4* et *ClipOnly2* au limiteur du maître,
*Console6* à la table de mixage, *Monitoring* à l'écoute de contrôle,
*Verbity* et *ClearCoat* aux pièces (la queue et ses premiers retours),
*Galactic2* aux espaces qui n'en sont pas, *Ultrasonic* et *Infrasonic* aux
bornes de l'audible, *Pressure5* au plafond, *Channel9* au pupitre, *BussColors4* à sa matière, *ToTape6* à la bande, et
*Distance2* au lointain. Chaque fichier porte le copyright, et la console de
mixage l'affiche.

La licence MIT demande deux choses et non une : le nom ET le texte de la
licence, *« included in all copies or substantial portions »*. Le texte
complet part donc avec le build, en `LICENCES/airwindows-MIT.txt`, et le
garde-fou de publication refuse un build où il manquerait — au même titre
qu'un build qui contiendrait du code d'éditeur.

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

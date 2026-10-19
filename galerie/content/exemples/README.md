# Les gabarits d'exemple

Deux fichiers à **copier** dans `content/works/` et `content/rooms/` pour
partir de quelque chose qui marche : une œuvre sonore posée sur une forme
simple, et une pièce qui la contient avec un passage vers l'entrée. Ils ne
sont pas chargés par la galerie (seuls `works/index.json` et
`rooms/index.json` disent ce qui se charge) — ils ne sont là que pour être
lus et copiés.

Les champs sont expliqués dans `README.md`, sections « Décrire une œuvre »
et « Décrire une pièce » ; le pas à pas est dans `DEMARRER.md`.

| Fichier | Quoi | Ce qu'il faut changer d'abord |
|---|---|---|
| `oeuvre-exemple.json` | une œuvre : forme, son, lumière, cartel | `id`, `title`, `description`, `position`, le son |
| `piece-exemple.json` | une pièce : coque, sol, lumière, œuvres, passage, jeton | `id`, `title`, `works`, le `to` du passage |

Le son de l'exemple pointe sur un fichier qui existe déjà dans
`content/audio/` : copié tel quel, l'exemple s'entend.

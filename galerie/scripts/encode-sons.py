#!/usr/bin/env python3
"""
ENCODER LES SONS LOURDS — Opus et AAC côte à côte, et le JSON qui les nomme.

Le moteur charge le format que le navigateur lit (engine/src/core/
formats-audio.js) : Opus dans WebM (Chrome, Firefox, Edge, Android), AAC
dans MP4 (Safari, iOS), sinon le fichier d'origine. Ce script produit les
deux fichiers à côté de l'original, pour chaque piste dont le fichier
dépasse un seuil, et écrit `formats` dans la fiche de l'œuvre :

    "file": "assets/x.mp3",
    "formats": { "webm": "assets/x.webm", "m4a": "assets/x.m4a" }

L'original reste : c'est lui que l'éditeur montre et que les crédits
citent, et c'est le repli des navigateurs qui ne liraient ni l'un ni
l'autre. Rien n'est raccourci, rien n'est coupé : même durée, même son,
seul l'encodage change.

Exige ffmpeg (avec libopus et l'encodeur aac) dans le PATH, ou son chemin
dans la variable FFMPEG. Idempotent : une piste déjà encodée (fichiers
présents et plus récents que l'original) n'est pas refaite.

    python3 scripts/encode-sons.py            # seuil 1 Mo, débits 64k / 96k
    python3 scripts/encode-sons.py --min-mo 0.5 --opus 48k --aac 80k
    python3 scripts/encode-sons.py --dry-run  # dit ce qu'il ferait
"""
import argparse
import json
import os
import shutil
import subprocess
import sys

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OEUVRES = os.path.join(RACINE, 'content', 'works')
CONTENU = os.path.join(RACINE, 'content')
ENCODABLES = ('.mp3', '.wav', '.flac', '.ogg', '.aif', '.aiff', '.m4a')


def ffmpeg():
    return os.environ.get('FFMPEG') or shutil.which('ffmpeg')


def encoder(ff, source, cible, args):
    cmd = [ff, '-hide_banner', '-loglevel', 'error', '-y', '-i', source, *args, cible]
    subprocess.run(cmd, check=True)


def a_jour(cible, source):
    return os.path.exists(cible) and os.path.getmtime(cible) >= os.path.getmtime(source)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--min-mo', type=float, default=1.0, help='taille minimale du fichier à encoder (Mo)')
    p.add_argument('--opus', default='64k', help='débit Opus (WebM)')
    p.add_argument('--aac', default='96k', help='débit AAC (MP4)')
    p.add_argument('--dry-run', action='store_true')
    a = p.parse_args()

    ff = None if a.dry_run else ffmpeg()
    if not a.dry_run and not ff:
        print('ffmpeg introuvable : installez-le, ou FFMPEG=/chemin/ffmpeg', file=sys.stderr)
        return 2

    seuil = a.min_mo * 1048576
    faits = 0
    for nom in sorted(os.listdir(OEUVRES)):
        if not nom.endswith('.json') or nom == 'index.json':
            continue
        chemin = os.path.join(OEUVRES, nom)
        with open(chemin, encoding='utf-8') as f:
            oeuvre = json.load(f)
        change = False
        for stem in oeuvre.get('stems') or []:
            fichier = stem.get('file')
            if not isinstance(fichier, str) or not fichier.lower().endswith(ENCODABLES):
                continue
            source = os.path.join(CONTENU, fichier)
            if not os.path.exists(source) or os.path.getsize(source) < seuil:
                continue
            base, _ = os.path.splitext(fichier)
            cibles = {'webm': base + '.webm', 'm4a': base + '.m4a'}
            print(f'{nom}: {fichier} ({os.path.getsize(source) / 1048576:.1f} Mo)')
            for cle, rel in cibles.items():
                abs_cible = os.path.join(CONTENU, rel)
                if a_jour(abs_cible, source):
                    print(f'   {cle}: à jour')
                elif a.dry_run:
                    print(f'   {cle}: à encoder → {rel}')
                else:
                    if cle == 'webm':
                        encoder(ff, source, abs_cible, ['-vn', '-c:a', 'libopus', '-b:a', a.opus, '-vbr', 'on', '-application', 'audio'])
                    else:
                        encoder(ff, source, abs_cible, ['-vn', '-c:a', 'aac', '-b:a', a.aac, '-movflags', '+faststart'])
                    print(f'   {cle}: {os.path.getsize(abs_cible) / 1048576:.1f} Mo → {rel}')
            if stem.get('formats') != cibles:
                stem['formats'] = cibles
                change = True
            faits += 1
        if change and not a.dry_run:
            with open(chemin, 'w', encoding='utf-8') as f:
                json.dump(oeuvre, f, ensure_ascii=False, indent=2)
                f.write('\n')
            print(f'   {nom}: formats écrits')
    print(f'{faits} piste(s) au-dessus de {a.min_mo} Mo')
    return 0


if __name__ == '__main__':
    sys.exit(main())

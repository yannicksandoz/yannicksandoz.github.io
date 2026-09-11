#!/usr/bin/env python3
"""
FRAGMENTER LES SONS LONGS — des segments de dix secondes, et le manifeste.

Une piste longue chargée d'un bloc coûte son poids entier au réseau avant
la première note, et tout son PCM décodé en mémoire pour la visite (cinq
minutes stéréo : 115 Mo). Découpée en SEGMENTS, le moteur (engine/src/core/
fragments.js) ne charge que ce qui va être entendu et rend le reste.

Chaque segment `i` couvre [i × segment, (i + 1) × segment + chevauchement] :
le court chevauchement répète le début du suivant, et le lecteur fond l'un
dans l'autre dessus. Deux formats côte à côte, comme encode-sons.py : Opus
dans WebM (Chrome, Firefox, Edge, Android), AAC dans MP4 (Safari, iOS).

Pour chaque piste retenue, le script écrit :

    content/<base>.frag/000.webm, 001.webm, …   et les .m4a
    content/<base>.fragments.json                (durée, segment, n, formats)

et, dans le JSON de l'œuvre ou de la pièce, `"fragments": "<base>.fragments.json"`.
`file` reste (l'éditeur le montre, les crédits le citent) mais NE PART PLUS
EN LIGNE : le build le retire, et le garde-fou refuse un original publié
avec ses fragments. Les `formats` entiers d'encode-sons.py deviennent
inutiles : la clé est retirée et les fichiers .webm/.m4a entiers effacés
(sauf --garder-entiers).

Le fichier source peut vivre HORS du dépôt (les masters n'y ont pas leur
place) : --sources DOSSIER le cherche là, sous le même chemin relatif, puis
sous son seul nom, si `file` manque dans content/.

Exige ffmpeg (libopus + aac) dans le PATH, ou FFMPEG=/chemin/ffmpeg.
Idempotent : une piste dont le manifeste et tous les segments sont plus
récents que la source n'est pas refaite.

    python3 scripts/fragmente-sons.py                 # pistes ≥ 1 Mo (ou déjà en formats)
    python3 scripts/fragmente-sons.py banc-entree     # ces œuvres seulement (ids ou fichiers)
    python3 scripts/fragmente-sons.py --segment 8 --chevauchement 0.08 --opus 48k
    python3 scripts/fragmente-sons.py --dry-run
"""
import argparse
import json
import math
import os
import re
import shutil
import subprocess
import sys

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONTENU = os.path.join(RACINE, 'content')
OEUVRES = os.path.join(CONTENU, 'works')
PIECES = os.path.join(CONTENU, 'rooms')
ENCODABLES = ('.mp3', '.wav', '.flac', '.ogg', '.oga', '.opus', '.aif', '.aiff', '.m4a', '.webm')
VERSION = 1


def ffmpeg():
    return os.environ.get('FFMPEG') or shutil.which('ffmpeg')


def duree_de(ff, source):
    """La durée en secondes, lue dans la sortie de `ffmpeg -i` (pas de ffprobe requis)."""
    r = subprocess.run([ff, '-hide_banner', '-i', source], capture_output=True, text=True)
    m = re.search(r'Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)', r.stderr)
    if not m:
        raise RuntimeError(f'durée introuvable pour {source}')
    h, mn, s = m.groups()
    return int(h) * 3600 + int(mn) * 60 + float(s)


def plan(duree, segment, chevauchement):
    """Le même découpage que fragments.js : planFragments(duree, segment, chevauchement)."""
    out = []
    i = 0
    while i * segment < duree:
        debut = i * segment
        out.append((i, debut, round(min(segment + chevauchement, duree - debut), 3)))
        i += 1
    return out


def encoder(ff, source, debut, longueur, cible, args):
    cmd = [ff, '-hide_banner', '-loglevel', 'error', '-y', '-i', source,
           '-ss', f'{debut:.3f}', '-t', f'{longueur:.3f}', '-vn', *args, cible]
    subprocess.run(cmd, check=True)


def trouver_source(fichier, sources):
    """Le fichier dans content/, sinon dans le dossier des sources (même chemin, puis nom seul)."""
    cand = [os.path.join(CONTENU, fichier)]
    if sources:
        cand.append(os.path.join(sources, fichier))
        cand.append(os.path.join(sources, os.path.basename(fichier)))
    for c in cand:
        if os.path.exists(c):
            return c
    return None


def pistes(dossier):
    """(chemin du JSON, document, liste des pistes) pour chaque œuvre ou pièce."""
    for nom in sorted(os.listdir(dossier)):
        if not nom.endswith('.json') or nom == 'index.json':
            continue
        chemin = os.path.join(dossier, nom)
        with open(chemin, encoding='utf-8') as f:
            doc = json.load(f)
        liste = doc.get('stems') if dossier == OEUVRES else doc.get('ambience')
        if isinstance(liste, list) and liste:
            yield chemin, doc, liste


def a_jour(manifeste_abs, source, n, dossier_abs):
    if not os.path.exists(manifeste_abs) or os.path.getmtime(manifeste_abs) < os.path.getmtime(source):
        return False
    for i in range(n):
        for ext in ('webm', 'm4a'):
            f = os.path.join(dossier_abs, f'{i:03d}.{ext}')
            if not os.path.exists(f) or os.path.getmtime(f) < os.path.getmtime(source):
                return False
    return True


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('cibles', nargs='*', help='ids d\'œuvres ou de pièces à traiter (tous sinon)')
    p.add_argument('--min-mo', type=float, default=1.0, help='taille minimale de la source (Mo) ; 0 = toutes')
    p.add_argument('--segment', type=float, default=10.0, help='longueur nominale d\'un segment (s)')
    p.add_argument('--chevauchement', type=float, default=0.1, help='queue répétée au début du suivant (s)')
    p.add_argument('--opus', default='64k', help='débit Opus (WebM)')
    p.add_argument('--aac', default='96k', help='débit AAC (MP4)')
    p.add_argument('--sources', default=os.environ.get('GALERIE_SOURCES'), help='dossier des masters hors dépôt')
    p.add_argument('--garder-entiers', action='store_true', help='ne pas effacer les .webm/.m4a entiers')
    p.add_argument('--dry-run', action='store_true')
    a = p.parse_args()

    ff = None if a.dry_run else ffmpeg()
    if not a.dry_run and not ff:
        print('ffmpeg introuvable : installez-le, ou FFMPEG=/chemin/ffmpeg', file=sys.stderr)
        return 2
    seuil = a.min_mo * 1048576
    voulus = set(a.cibles)
    faits = 0

    for dossier in (OEUVRES, PIECES):
        for chemin, doc, liste in pistes(dossier):
            ident = doc.get('id') or os.path.basename(chemin)[:-5]
            if voulus and ident not in voulus and os.path.basename(chemin) not in voulus:
                continue
            change = False
            for piste in liste:
                fichier = piste.get('file')
                if not isinstance(fichier, str) or not fichier.lower().endswith(ENCODABLES):
                    continue
                source = trouver_source(fichier, a.sources)
                if not source:
                    if piste.get('fragments'):
                        continue  # déjà fragmenté, la source vit ailleurs : rien à refaire
                    print(f'{ident}: {fichier} introuvable (content/ ou --sources)', file=sys.stderr)
                    continue
                poids = os.path.getsize(source)
                if not voulus and poids < seuil and not piste.get('formats') and not piste.get('fragments'):
                    continue
                base, _ = os.path.splitext(fichier)
                dossier_rel = base + '.frag'
                manifeste_rel = base + '.fragments.json'
                dossier_abs = os.path.join(CONTENU, dossier_rel)
                manifeste_abs = os.path.join(CONTENU, manifeste_rel)
                print(f'{ident}: {fichier} ({poids / 1048576:.1f} Mo)')
                if a.dry_run:
                    print(f'   → {dossier_rel}/NNN.webm + .m4a, {manifeste_rel}')
                    faits += 1
                    continue
                duree = duree_de(ff, source)
                decoupe = plan(duree, a.segment, a.chevauchement)
                if a_jour(manifeste_abs, source, len(decoupe), dossier_abs):
                    print(f'   à jour : {len(decoupe)} segments')
                else:
                    os.makedirs(dossier_abs, exist_ok=True)
                    total = 0
                    for i, debut, longueur in decoupe:
                        webm = os.path.join(dossier_abs, f'{i:03d}.webm')
                        m4a = os.path.join(dossier_abs, f'{i:03d}.m4a')
                        encoder(ff, source, debut, longueur, webm,
                                ['-c:a', 'libopus', '-b:a', a.opus, '-vbr', 'on', '-application', 'audio'])
                        encoder(ff, source, debut, longueur, m4a,
                                ['-c:a', 'aac', '-b:a', a.aac, '-movflags', '+faststart'])
                        total += os.path.getsize(webm) + os.path.getsize(m4a)
                    manifeste = {
                        'version': VERSION, 'duree': round(duree, 3), 'segment': a.segment,
                        'chevauchement': a.chevauchement, 'n': len(decoupe),
                        'formats': {'webm': f'{dossier_rel}/{{i}}.webm', 'm4a': f'{dossier_rel}/{{i}}.m4a'}
                    }
                    with open(manifeste_abs, 'w', encoding='utf-8') as f:
                        json.dump(manifeste, f, ensure_ascii=False, indent=2)
                        f.write('\n')
                    print(f'   {len(decoupe)} segments de {a.segment} s, {duree:.1f} s, '
                          f'{total / 1048576:.1f} Mo pour les deux formats → {manifeste_rel}')
                if piste.get('fragments') != manifeste_rel:
                    piste['fragments'] = manifeste_rel
                    change = True
                # les fichiers entiers d'encode-sons.py n'ont plus de raison d'être
                if 'formats' in piste:
                    entiers = piste.pop('formats')
                    change = True
                    if not a.garder_entiers and isinstance(entiers, dict):
                        for rel in entiers.values():
                            abs_ = os.path.join(CONTENU, str(rel))
                            if os.path.exists(abs_):
                                os.remove(abs_)
                                print(f'   effacé : {rel} (entier, remplacé par les fragments)')
                faits += 1
            if change and not a.dry_run:
                with open(chemin, 'w', encoding='utf-8') as f:
                    json.dump(doc, f, ensure_ascii=False, indent=2)
                    f.write('\n')
                print(f'   {os.path.basename(chemin)}: fragments écrits')
    print(f'{faits} piste(s) traitée(s)')
    return 0


if __name__ == '__main__':
    sys.exit(main())

#!/usr/bin/env python3
"""
LES NIVEAUX DES SONS — la sonie de chaque piste (EBU R128), et ce qu'elle
devient une fois les gains du JSON appliqués.

Deux pistes « au même gain » ne s'entendent pas au même niveau : la sonie
(LUFS) approche l'oreille, le gain non. Ce script mesure chaque fichier
(ffmpeg, filtre ebur128), applique le gain de piste × le gain d'œuvre
(`baseGain`) et compare à une cible :

    œuvre           piste                       LUFS  crête  gain  base  effectif  écart  gain→cible
    banc-jardin     waterfall-…mp3             -45.9  -19.0  0.95  0.65     -50.1  -30.1        2.00*

« écart » : effectif − cible (négatif : plus faible que la cible) ;
« gain→cible » : le gain de piste qui y amènerait, l'œuvre gardant son
gain, borné à [0, 2] comme le curseur de l'éditeur — une étoile dit que la
borne est atteinte : le fichier lui-même est à normaliser.

Le même sonomètre existe dans le moteur (engine/src/core/loudness.js), pour
la Table d'écoute de l'éditeur ; ce script est la version hors ligne, sur
tous les fichiers d'un coup, sans ouvrir le navigateur.

    python3 scripts/niveaux-sons.py                 # cible -18 LUFS
    python3 scripts/niveaux-sons.py --cible -20
    python3 scripts/niveaux-sons.py --json          # pour d'autres outils

Exige ffmpeg dans le PATH, ou son chemin dans FFMPEG. Rien n'est écrit :
ce script mesure et propose, il ne décide pas à la place de l'auteur.
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
OEUVRES = os.path.join(RACINE, 'content', 'works')
CONTENU = os.path.join(RACINE, 'content')
GAIN_MAX = 2.0


def ffmpeg():
    return os.environ.get('FFMPEG') or shutil.which('ffmpeg')


def mesurer(ff, chemin):
    """(LUFS intégré, crête dBFS, LRA) via ebur128 ; None si illisible/silence."""
    r = subprocess.run([ff, '-hide_banner', '-nostats', '-i', chemin, '-af', 'ebur128=peak=true', '-f', 'null', '-'],
                       capture_output=True, text=True)
    resume = r.stderr[r.stderr.rfind('Summary:'):]
    lufs = re.search(r'I:\s+(-?[\d.]+) LUFS', resume)
    crete = re.search(r'Peak:\s+(-?[\d.]+) dBFS', resume)
    lra = re.search(r'LRA:\s+([\d.]+) LU', resume)
    if not lufs:
        return None
    l = float(lufs.group(1))
    return (None if l <= -70 else l, float(crete.group(1)) if crete else None, float(lra.group(1)) if lra else None)


def db(g):
    return 20 * math.log10(g) if g > 0 else float('-inf')


def gain_pour_cible(lufs, cible, base):
    g = 10 ** ((cible - lufs) / 20) / (base or 1)
    return max(0.0, min(GAIN_MAX, round(g, 2)))


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--cible', type=float, default=-18.0, help='sonie effective visée (LUFS)')
    p.add_argument('--json', action='store_true', help='sortie JSON plutôt que tableau')
    a = p.parse_args()
    ff = ffmpeg()
    if not ff:
        print('ffmpeg introuvable : installez-le, ou FFMPEG=/chemin/ffmpeg', file=sys.stderr)
        return 2

    lignes = []
    cache = {}
    for nom in sorted(os.listdir(OEUVRES)):
        if not nom.endswith('.json') or nom == 'index.json':
            continue
        with open(os.path.join(OEUVRES, nom), encoding='utf-8') as f:
            oeuvre = json.load(f)
        base = float(oeuvre.get('baseGain', 1) or 0)
        for stem in oeuvre.get('stems') or []:
            fichier = stem.get('file')
            if not isinstance(fichier, str):
                continue
            chemin = os.path.join(CONTENU, fichier)
            if not os.path.exists(chemin):
                lignes.append({'oeuvre': oeuvre.get('id', nom), 'piste': fichier, 'erreur': 'fichier absent'})
                continue
            if chemin not in cache:
                cache[chemin] = mesurer(ff, chemin)
            m = cache[chemin]
            gain = float(stem.get('gain', 1) if stem.get('gain') is not None else 1)
            ligne = {'oeuvre': oeuvre.get('id', nom), 'piste': fichier, 'gain': gain, 'base': base}
            if not m or m[0] is None:
                ligne['erreur'] = 'illisible ou silence'
            else:
                lufs, crete, lra = m
                eff = lufs + db(gain * base) if gain * base > 0 else None
                ligne.update({'lufs': lufs, 'crete': crete, 'lra': lra, 'effectif': eff,
                              'ecart': (eff - a.cible) if eff is not None else None,
                              'gainCible': gain_pour_cible(lufs, a.cible, base)})
            lignes.append(ligne)

    if a.json:
        print(json.dumps({'cible': a.cible, 'pistes': lignes}, ensure_ascii=False, indent=2))
        return 0

    print(f"cible : {a.cible:.1f} LUFS (effectif = LUFS + 20·log10(gain × base))")
    print(f"{'œuvre':18} {'piste':42} {'LUFS':>6} {'crête':>6} {'gain':>5} {'base':>5} {'effectif':>8} {'écart':>6} {'gain→cible':>10}")
    for l in lignes:
        piste = os.path.basename(l['piste'])[:42]
        if 'erreur' in l:
            print(f"{l['oeuvre']:18} {piste:42}   ({l['erreur']})")
            continue
        borne = '*' if l['gainCible'] in (0.0, GAIN_MAX) else ' '
        print(f"{l['oeuvre']:18} {piste:42} {l['lufs']:6.1f} {l['crete'] if l['crete'] is not None else float('nan'):6.1f} "
              f"{l['gain']:5.2f} {l['base']:5.2f} {l['effectif']:8.1f} {l['ecart']:+6.1f} {l['gainCible']:9.2f}{borne}")
    effs = [l['effectif'] for l in lignes if l.get('effectif') is not None]
    if effs:
        print(f"\n{len(effs)} piste(s) : effectif de {min(effs):.1f} à {max(effs):.1f} LUFS, étendue {max(effs) - min(effs):.1f} LU ; "
              f"* = borne du curseur atteinte, le fichier est à normaliser")
    return 0


if __name__ == '__main__':
    sys.exit(main())

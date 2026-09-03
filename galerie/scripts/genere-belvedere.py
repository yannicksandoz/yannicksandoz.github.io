#!/usr/bin/env python3
"""Belvédère « Relativity » — cube de 50 m, six gravités.

Le principe de la gravure d'Escher : trois plans MUTUELLEMENT PERPENDICULAIRES
se partagent l'espace (ici le sol, le mur est et le mur nord). Un escalier mène
de chacun au suivant ; son sommet ABOUTIT au mur cible, si bien qu'après la
bascule on se retrouve debout sur son arête, à quelques décimètres du nouveau
sol — la continuité est physique, pas scénarisée.

Tout est auteuré dans le « monde du plan » (ce que voit le visiteur qui se tient
sur ce plan), puis converti en coordonnées locales de la pièce par l'inverse de
l'orientation. Les mêmes matrices que RoomManager.orientRoom, et des assertions
vérifient que chaque escalier touche bien son mur et que chaque arrivée tombe
juste au-dessus du nouveau sol.

DEUX ÉCHELLES. Le dessin se fait à 50 m (SIZE), là où les volées de 8 m et les
cellules de 50 cm se raisonnent ; la pièce LIVRÉE fait 24 m — tout est réduit
par K à l'écriture (positions, cellules, échelles, sphères, jetons). Les
fichiers existants ne sont pas écrasés : leur GÉOMÉTRIE est remplacée, leurs
réglages de main (textures, lumières, émissions) sont gardés. Ce qui n'est pas
au générateur — les corniches d'emprise, les lavages, la gerbe, les portails
reposés par la charte — reste tel quel.

L'ACCESSIBILITÉ est une assertion : au-dessus de toute surface foulable et de
tout point du sol, LIBRE mètres d'air (la tête du visiteur), sinon le script
refuse d'écrire. Et « sans seuil en bas » : plus aucune dalle au pied des
volées — on s'y engage depuis le sol, d'un pas.
"""
import json, math, os

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', 'content'))

SIZE = 50.0          # cube DE DESSIN : largeur = profondeur = hauteur (80 au
                     # départ, resserré à 50 — mêmes plans, volées plus courtes)
K = 0.48             # échelle de LIVRAISON : 50 m de dessin → 24 m de pièce
WALL_T = 0.35        # épaisseur des murs (RoomManager)
HALF = SIZE / 2
LIBRE = 2.4 / K      # hauteur d'air garantie au-dessus de tout ce qu'on foule
                     # (2,4 m livrés : les yeux à 2,2 m, la tête à 2,3 m)

# ---------------------------------------------------------------- matrices --
def rx(a):
    c, s = math.cos(a), math.sin(a)
    return [[1, 0, 0], [0, c, -s], [0, s, c]]

def ry(a):
    c, s = math.cos(a), math.sin(a)
    return [[c, 0, s], [0, 1, 0], [-s, 0, c]]

def rz(a):
    c, s = math.cos(a), math.sin(a)
    return [[c, -s, 0], [s, c, 0], [0, 0, 1]]

def mmul(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(3)) for j in range(3)]
            for i in range(3)]

def mvec(m, v):
    return [sum(m[i][k] * v[k] for k in range(3)) for i in range(3)]

def transpose(m):
    return [[m[j][i] for j in range(3)] for i in range(3)]

I3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
D90 = math.pi / 2

# orientRoom : world = R · local + (0, lift, 0)
PLANES = {
    'sol':     (I3, 0.0),
    'est':     (rz(-D90), HALF),   # le mur est (x = +40) devient le sol
    'nord':    (rx(-D90), HALF),   # le mur nord (z = -40) devient le sol
    'ouest':   (rz(D90), HALF),    # le mur ouest (x = -40)
    'sud':     (rx(D90), HALF),    # le mur sud (z = +40)
    'plafond': (rx(2 * D90), SIZE) # le plafond (y = 80)
}

def to_local(plane, world):
    R, lift = PLANES[plane]
    return mvec(transpose(R), [world[0], world[1] - lift, world[2]])

def to_world(plane, local):
    R, lift = PLANES[plane]
    w = mvec(R, local)
    return [w[0], w[1] + lift, w[2]]

def local_rot(plane, world_rot):
    """Euler XYZ (degrés) donnant `world_rot` une fois la pièce orientée."""
    M = mmul(transpose(PLANES[plane][0]), world_rot)
    m11, m12, m13 = M[0]
    _, m22, m23 = M[1]
    _, m32, m33 = M[2]
    y = math.asin(max(-1.0, min(1.0, m13)))
    if abs(m13) < 0.999999:
        x, z = math.atan2(-m23, m33), math.atan2(-m12, m11)
    else:
        x, z = math.atan2(m32, m22), 0.0
    return [round(math.degrees(v), 3) for v in (x, y, z)]

# ------------------------------------------------------------- escalier ----
# Pente à ~27° (deux cellules de course par contremarche). À 45°, l'escalier
# se lisait comme une rampe et la montée butait ; à 27° il a l'allure des
# volées de « Relativity » et le pas reste franc.
CELL = 0.5
WIDE = 7                      # 3,5 m de large : on s'y croise

def stair_grid(rise_steps):
    """Grille pleine : masse sous chaque marche (un escalier se heurte)."""
    run_cells = rise_steps * 2
    dims = [WIDE, rise_steps, run_cells]
    grid = [0] * (WIDE * rise_steps * run_cells)
    for z in range(run_cells):
        top = min(rise_steps - 1, z // 2)
        for y in range(top + 1):
            for x in range(WIDE):
                grid[x + WIDE * (y + rise_steps * z)] = 1
    cells, run, val = [], 1, grid[0]
    for v in grid[1:]:
        if v == val:
            run += 1
        else:
            cells += [run, val]
            run, val = 1, v
    cells += [run, val]
    return dims, cells

works = []

def add(w):
    works.append(w)
    return w

# LA MATIÈRE DES MASSES : blanc laqué. Une volée à 0,3 de rugosité renvoie
# les rubans de lumière et les corniches d'en face (reflets.js) — c'est ce
# qui fait la cage d'escalier de Hadid : des surfaces qui portent la lumière
# des autres. Le style fluide décide de la couleur ; la matière est ici.
MATIERE = {'roughness': 0.3, 'metalness': 0.0}

def modele_voxel(dims, cells, color):
    return {'type': 'voxel', 'dims': dims, 'cell': CELL,
            'palette': [color], 'cells': cells, **MATIERE}

# LE SERPENTIN. En style fluide, le moteur fait ONDOYER les masses allongées
# (engine/src/core/serpentin.js, loiSerpentin) : un S à trois ventres,
# d'amplitude jusqu'à 0,7 fois la largeur (1,18 m livrés pour une volée),
# extrémités fixes, et une largeur de 1,2 à 1,44 fois la nominale. Le rendu,
# le collider et la charte appliquent cette loi ; le générateur DOIT la
# connaître, sinon il dessine des lobes droits contre des volées qui
# s'écartent d'un mètre, et juge des chevauchements sur des grilles
# droites. Port fidèle, en unités de DESSIN : le seuil d'allongement se
# juge en mètres livrés (long · K), l'amplitude est linéaire en l'échelle.
try:
    FLUIDE = json.load(open(f'{ROOT}/reglages.json')).get('style') == 'fluide'
except (OSError, ValueError):
    FLUIDE = False
BASE_SERPENTIN, GONFLEMENT_SERPENTIN = 1.2, 0.24

def loi_serpentin(dims):
    if not FLUIDE:
        return None
    lx, lz = dims[0] * CELL, dims[2] * CELL
    long_, larg = max(lx, lz), min(lx, lz)
    if long_ * K < 5 or long_ < larg * 2.2:
        return None
    axe = 0 if lx >= lz else 2
    A = min(long_ * 0.17, larg * 0.7)
    phase = ((dims[0] * 3 + dims[1] * 5 + dims[2] * 7) % 13) / 13 * 2 * math.pi
    def forme(t):
        return math.sin(math.pi * t) * (0.70 * math.sin(math.pi * 3 * t + phase)
                                        + 0.32 * math.sin(math.pi * 5 * t + 1.6 * phase))
    crete = max(abs(forme(i / 240)) for i in range(241))
    g = A / crete if crete > 1e-6 else 0.0
    return {'axe': axe, 'decalage': lambda t: g * forme(t),
            'gonflement': lambda t: BASE_SERPENTIN + GONFLEMENT_SERPENTIN * math.sin(math.pi * t)}

def stair(id_, plane, start, end_h, lane, heading, color, base=0.0, walkable=True,
          lisiere=None):
    """Escalier posé sur `plane`, dans le repère de ce plan.

    start   : abscisse de départ le long de la course (monde du plan)
    end_h   : hauteur atteinte au sommet (m)
    lane    : position latérale (monde du plan)
    heading : 'x+', 'x-', 'z+' ou 'z-' — direction de la montée
    """
    rise = int(round(end_h / CELL))
    dims, cells = stair_grid(rise)
    run_len = dims[2] * CELL          # longueur au sol
    half_run = run_len / 2
    HEAD = {'z+': 0, 'z-': 180, 'x+': 90, 'x-': -90}
    rot_y = HEAD[heading]
    sign = 1 if heading[1] == '+' else -1
    # Une grille voxel a sa BASE à y = 0 de l'objet (voxel.js cellCenter) et
    # n'est centrée qu'en x et z : l'origine se pose donc au pied de la volée,
    # à mi-course, et surtout PAS à mi-hauteur.
    if heading[0] == 'x':
        centre = [start + sign * half_run, base, lane]
    else:
        centre = [lane, base, start + sign * half_run]
    w = {
        'id': id_, 'title': 'Escalier', 'description': '',
        'position': [round(v, 3) for v in to_local(plane, centre)],
        'rotation': local_rot(plane, ry(math.radians(rot_y))),
        'scale': [1, 1, 1], 'modules': [], 'role': 'decor',
        'walkable': walkable, 'loadDistance': 240,
        'model': modele_voxel(dims, cells, color),
        'lightIntensity': 0, '_plan': plane
    }
    add(w)
    # sommet, dans le monde du plan : le bord haut de la dernière marche
    if heading[0] == 'x':
        top = [start + sign * run_len, base + end_h, lane]
    else:
        top = [lane, base + end_h, start + sign * run_len]
    if lisiere:
        w['model']['lisiere'] = {'cote': lisiere, **LISIERE}
    return w, top

# LA LISIÈRE : la ligne de lumière appartient à la masse (voxel.js
# buildLisiere) — tracée le long du bord du dessus, dans la grille, puis
# serpentée par la même loi que les pavés. Une par masse, sur le bord
# extérieur ; en pourtour sur un lobe.
LISIERE = {'couleur': '#d9ccff', 'emissive': 0.9}

def slab(id_, plane, centre, size, color, walkable=True, lisiere=None, masque=None):
    """Balcon : dalle MINCE, foulable — les repos de « Relativity », devenus
    les rubans de béton blanc de Hadid. `rubans` : les côtés ('n', 's',
    'e', 'o' du monde du plan) qui portent un ruban de lumière."""
    nx, nz = int(size[0] / CELL), int(size[1] / CELL)
    ny = 1                                     # 50 cm de dessin, 24 livrés
    dims = [nx, ny, nz]
    if masque:
        # une dalle DÉCOUPÉE : le masque dit quelles colonnes sont pleines
        grid = [1 if masque((x + 0.5) / nx * 2 - 1, (z + 0.5) / nz * 2 - 1) else 0
                for z in range(nz) for x in range(nx)]
        cells, run, val = [], 1, grid[0]
        for v in grid[1:]:
            if v == val:
                run += 1
            else:
                cells += [run, val]
                run, val = 1, v
        cells += [run, val]
    else:
        cells = [nx * ny * nz, 1]              # plein
    # base à y = 0 de l'objet : on descend d'une épaisseur pour que la face
    # supérieure du palier affleure la hauteur demandée. LIFT : six
    # centimètres de plus, car une dalle posée EXACTEMENT au niveau d'une
    # crête présente deux faces coplanaires — le GPU ne sait pas laquelle
    # est devant et le pied de l'escalier se met à grésiller.
    LIFT = 0.06
    c = [centre[0], centre[1] - ny * CELL + LIFT, centre[2]]
    add({
        'id': id_, 'title': 'Balcon', 'description': '',
        'position': [round(v, 3) for v in to_local(plane, c)],
        'rotation': local_rot(plane, I3),
        'scale': [1, 1, 1], 'modules': [], 'role': 'decor',
        'walkable': walkable, 'loadDistance': 240,
        'model': modele_voxel(dims, cells, color),
        'lightIntensity': 0, '_plan': plane
    })
    if lisiere:
        works[-1]['model']['lisiere'] = {'cote': lisiere, **LISIERE}

def walkway(id_, plane, a, b, width, top_h, color, walkable=True, lisiere=None):
    """Passerelle : une dalle qui RELIE — le sommet d'une volée au mur,
    dans le monde du plan. `a` et `b` sont les deux bouts (x, z), la face
    supérieure affleure `top_h`."""
    cx, cz = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
    lx = max(abs(b[0] - a[0]), width)
    lz = max(abs(b[1] - a[1]), width)
    slab(id_, plane, [cx, top_h, cz], (lx, lz), color, walkable=walkable, lisiere=lisiere)

def prop(id_, title, plane, centre, model, rot_y=0, light=None, scale=None):
    w = {
        'id': id_, 'title': title, 'description': '',
        'position': [round(v, 3) for v in to_local(plane, centre)],
        'rotation': local_rot(plane, ry(math.radians(rot_y))),
        'scale': scale or [1, 1, 1], 'modules': [], 'role': 'decor',
        'model': model, 'lightIntensity': 0, 'loadDistance': 240
    }
    if light:
        w['lightColor'], w['lightIntensity'] = light
    return add(w)

# Une lanterne éclaire, elle n'éblouit pas : « selfLit » l'écarte de toutes
# les lumières (la sienne comprise, qui la lavait à bout portant) — il ne
# lui reste que son émission.
LANT = {'shape': 'cylinder', 'color': '#4a4266', 'emissiveColor': '#cbb4ff',
        'roughness': 0.55, 'metalness': 0.0, 'emissive': 0.6}
ARCH = {'shape': 'box', 'color': '#2b2440',
        'roughness': 0.9, 'metalness': 0.05, 'emissive': 0.04}

def lantern(id_, plane, pos, rot_y=0, intensity=2.4):
    # intensity 0 : la lanterne GARDE sa lueur (selfLit + émission + bloom)
    # mais ne coûte pas un poste de PointLight au shader — voir README,
    # « budget de lumières »
    w = prop(id_, 'Lanterne', plane, [pos[0], pos[1] + 1.1, pos[2]], LANT,
             rot_y=rot_y, light=('#cbb4ff', intensity), scale=[0.5, 1.2, 0.5])
    w['selfLit'] = True
    return w

def pillar(id_, plane, pos, h, rot_y=0):
    prop(id_, 'Pilier', plane, [pos[0], h / 2, pos[2]], ARCH,
         rot_y=rot_y, scale=[1.2, h / 1.5, 1.2])

# --------------------------------------------------------------- parcours --
# Trois volées enchaînées ; chacune finit contre le mur qui deviendra le sol.
INNER = HALF - WALL_T / 2       # face intérieure des murs : 39,825

bascules = []

RING_Y = 0.25    # l'anneau de retour est POSÉ sur le nouveau sol, pas flottant

def bascule(plane_from, top_world, to_plane, label, retour=None, decalage=(0, 0)):
    """Anneau au sommet ; l'arrivée est ce même point vu depuis le plan cible.

    `retour` ajoute l'anneau symétrique, à plat au point d'arrivée : on
    revient par où l'on est venu. Sans lui, une volée ne fonctionne que
    dans un sens — on monte, on bascule, et le chemin du retour n'existe
    plus. L'anneau est désarmé à l'arrivée (on se tient dedans) et ne se
    réarme qu'une fois la zone quittée : pas de va-et-vient involontaire.
    """
    local = to_local(plane_from, top_world)
    arr = to_world(to_plane, local)
    # `decalage` écarte le point de chute (repère du plan d'arrivée) : le
    # sommet d'une volée peut toucher le mur cible juste contre le flanc
    # d'une autre volée — on atterrirait le nez dans la masse.
    arr = [arr[0] + decalage[0], arr[1], arr[2] + decalage[1]]
    # UNE SEULE SPHÈRE pour les deux sens. Deux anneaux — un pour partir, un
    # pour revenir — obligeaient à poser deux objets à deux endroits ; une
    # sphère flotte au sommet de la volée, et ce MÊME point de la pièce se
    # retrouve à hauteur d'homme une fois le monde pivoté. Le sens du saut
    # est donné par le plan sur lequel on se tient.
    transferts = [{
        'depuis': plane_from, 'vers': to_plane, 'label': label,
        'arrival': [round(arr[0], 2), round(arr[1] + 2.2, 2), round(arr[2], 2)]
    }]
    if retour:
        transferts.append({
            'depuis': to_plane, 'vers': plane_from, 'label': retour,
            'arrival': [round(top_world[0], 2), round(top_world[1] + 2.2, 2),
                        round(top_world[2], 2)]
        })
    bascules.append({
        'position': [round(v, 2) for v in local],
        'radius': 2.2,
        'transferts': transferts,
        'label': label,
        '_pose': plane_from
    })
    return local, arr

# À 50 m, les volées font 8 m de haut (16 m de course) : le pied se pose à
# 0,3 + 16 du mur pour que la crête le touche.
H_MAIN = 8.0
RUN = 2 * H_MAIN
# la voie des volées : centre de la face ± VOIE. Sur le sol et le plafond,
# ±15 — leurs volées s'écartent pour laisser le CENTRE à la tour, posée sur
# l'axe de la pièce, mais pas plus : une volée serpentine s'écarte de sa
# voie de 2,1 m (ses bouts, élargis) à 4,7 m (son ventre), et vue du mur
# voisin, cette bande de 2,6 m doit tenir tout entière AU-DESSUS de la tête
# (5 m du mur) ou sous la poitrine (2,5) — à 17 comme à 18,5, elle passait
# à hauteur de front ; à 15, son ventre reste à 5,1 m.
# Sur les quatre murs, ±6,5 (la ligne des 3,12 m) : à 8, la volée est → sud
# enjambait la crête de la volée sol → est à 1,9 m ; à 6,5, 2,6 m d'air.
VOIE = {'sol': 15.0, 'plafond': 15.0, 'est': 6.5, 'ouest': 6.5, 'nord': 6.5, 'sud': 6.5}

# ── LES DOUZE ARÊTES : une volée par arête, deux par gravité ─────────────
# Une arête du cube joint deux faces ; la volée se pose sur l'une (PLAN) et
# monte vers l'autre (VERS). Répartition : deux volées par plan, PARALLÈLES
# et OPPOSÉES, l'une à la voie +VOIE, l'autre à −VOIE du centre de la face —
# un S par gravité, le centre libre pour le tore et la tour. Le sens de la
# montée, le pied, la crête, le côté du lobe et celui de la lisière se
# DÉDUISENT des matrices, jamais ne se devinent.
#
# SYMÉTRIE. Chaque volée a son image par le demi-tour autour de chacun des
# trois axes de la pièce (le groupe D2) : la table ci-dessous est close par
# ces trois demi-tours, et tout ce qui suit (tour, lanternes, bancs, gerbes,
# jetons) l'est aussi — voir l'assertion « symétrie » en fin de script.
NOMS = {'sol': 'Sol', 'plafond': 'Plafond', 'est': 'Mur est', 'ouest': 'Mur ouest',
        'nord': 'Mur nord', 'sud': 'Mur sud'}
# normale réelle de chaque face, et la coordonnée réelle de sa surface
FACES_REELLES = {'est': ([1, 0, 0], INNER), 'ouest': ([-1, 0, 0], -INNER),
                 'sud': ([0, 0, 1], INNER), 'nord': ([0, 0, -1], -INNER),
                 'plafond': ([0, 1, 0], SIZE), 'sol': ([0, -1, 0], 0.0)}
ARETES = [
    # (plan, vers, côté de la voie : +1 ou −1 par rapport au centre de la face).
    # Sol et plafond montent vers est et ouest : leurs volées courent en x,
    # à z = ±15, et la tour jumelle tient entre les deux : chaque bras vit
    # dans le quadrant OPPOSÉ à la volée de son côté (x > 0 : z < 0).
    ('sol', 'est', +1), ('sol', 'ouest', -1),
    ('plafond', 'est', +1), ('plafond', 'ouest', -1),
    ('est', 'nord', +1), ('est', 'sud', -1),
    ('ouest', 'nord', +1), ('ouest', 'sud', -1),
    ('nord', 'sol', +1), ('nord', 'plafond', -1),
    ('sud', 'sol', -1), ('sud', 'plafond', +1)
]
TEINTES = {'sol': '#5b5478', 'plafond': '#4a4a66', 'est': '#3f5c4e',
           'ouest': '#5c4a44', 'nord': '#6a4a54', 'sud': '#44584a'}

def monde_de(plane, reel):
    """Un point RÉEL de la pièce, vu dans le monde du plan."""
    R, lift = PLANES[plane]
    w = mvec(R, reel)
    return [w[0], w[1] + lift, w[2]]

def vecteur_monde(plane, reel):
    """Un VECTEUR réel, vu dans le monde du plan (sans translation)."""
    return mvec(PLANES[plane][0], reel)

def cap_vers(plane, face):
    """Le cap ('x+', 'x-', 'z+', 'z-') qui, dans le monde du plan, mène à la face."""
    n = vecteur_monde(plane, FACES_REELLES[face][0])
    for axe, i in (('x', 0), ('z', 2)):
        if abs(n[i]) > 0.5:
            return f"{axe}{'+' if n[i] > 0 else '-'}"
    raise AssertionError(f'{face} n\'est pas une face voisine de {plane}')

def lobe(id_, plane, centre, size, color, axe=0, cote=1, voie=0.0, bord=None):
    """Le LOBE : une dalle mince qui ÉPOUSE le flanc de la volée — son bord
    intérieur est le bord de la volée telle qu'elle se voit (`bord`, la loi
    du serpentin), à un dixième près — et s'arrondit vers le vide en demi
    super-ellipse (exposant 2,5 — l'arrondi des balcons de Hadid), lisière
    en pourtour. Le belvédère d'une volée. `axe` est l'axe de la montée,
    `cote` le côté de la voie par rapport au centre de la face : le lobe est
    de l'autre côté (intérieur), `e` compte les mètres depuis l'axe de la
    voie vers lui. L'arrondi commence à 3,75 m de l'axe et finit à 5,75."""
    n = 2.5
    lat = 2 - axe
    def masque(u, v):
        P = [centre[0] + u * size[0] / 2, 0.0, centre[2] + v * size[1] / 2]
        long_n = (P[axe] - centre[axe]) / (size[axe // 2] / 2)
        e = (P[lat] - voie) * -cote
        dehors = max(0.0, (e - 3.75) / 2.0)
        if abs(long_n) ** n + dehors ** n > 1.0:
            return False
        # `e` est le CENTRE de la colonne : on garde toute colonne dont une
        # part dépasse le flanc — la première chevauche donc la volée d'au
        # plus une cellule (24 cm livrés), et il n'y a JAMAIS de jour entre
        # les deux. Avec une marge, il restait des fentes de 7 à 17 cm où la
        # sonde anti-chute ne trouvait pas de sol : un pas refusé sans
        # raison visible. Le recouvrement est une lisse le long du bord de
        # la volée, au plus à hauteur de genou ; les contrôles de
        # chevauchement et de hauteur libre exemptent ce couple (meme_arete).
        return e + CELL / 2 > (bord(P[axe]) if bord else 1.75)
    slab(id_, plane, centre, size, color, lisiere='pourtour', masque=masque)

def arete(plane, face, cote):
    """Pose la volée d'une arête : montée, lobe, sphère aller-retour."""
    cap = cap_vers(plane, face)
    axe = 0 if cap[0] == 'x' else 2
    signe = 1 if cap[1] == '+' else -1
    lat = 2 - axe                                   # l'axe de la voie
    centre = monde_de(plane, [0.0, HALF, 0.0])      # le centre de la face
    voie = round(centre[lat] + cote * VOIE[plane], 2)
    # la surface de la face cible, dans le monde du plan, le long de la montée
    surface = FACES_REELLES[face][1]
    normale = FACES_REELLES[face][0]
    reel_face = [normale[i] * abs(surface) if normale[i] else 0.0 for i in range(3)]
    mur = monde_de(plane, reel_face)[axe]
    crete = mur - signe * 0.3
    pied = crete - signe * RUN
    id_ = f'escalier-{plane}-{face}'
    # la lisière : le bord EXTÉRIEUR (loin du centre de la face). « gauche »
    # est le −x local ; tourné par le cap, il pointe vers ±voie
    HEAD = {'z+': 0, 'z-': 180, 'x+': 90, 'x-': -90}
    gauche = mvec(ry(math.radians(HEAD[cap])), [-1, 0, 0])[lat]
    lisiere = 'gauche' if gauche * cote > 0 else 'droite'
    w, top = stair(id_, plane, pied, H_MAIN, voie, cap, TEINTES[plane], lisiere=lisiere)
    # le lobe : contre la crête, côté INTÉRIEUR (vers le centre de la face),
    # à la hauteur de la crête. Côté extérieur, son arrondi surplombait le
    # sol de la face voisine entre poitrine et tête (2 à 6 m du mur) ; côté
    # intérieur, il en est à plus de 9 m — de l'air pour la tête.
    # La dalle du lobe couvre de l'axe de la voie à 6 m vers l'intérieur ;
    # le masque en retire ce que la volée serpentine occupe (et remplit ce
    # qu'elle libère) : le lobe suit la courbe, marche après marche.
    demi = WIDE * CELL / 2
    LOBE = (6.0, 6.0)                               # le long de la montée × en travers
    c = [0.0, H_MAIN, 0.0]
    c[axe] = crete - signe * LOBE[0] / 2
    c[lat] = voie - cote * LOBE[1] / 2
    size = (LOBE[0], LOBE[1]) if axe == 0 else (LOBE[1], LOBE[0])
    loi = loi_serpentin(w['model']['dims'])
    # le lobe est-il du côté +x ou −x LOCAL de la volée ? Le serpentin
    # décale vers le +x local ; vu du lobe, c'est vers lui ou loin de lui
    # selon le cap (les volées des murs nord et sud l'ont à leur −x)
    sl = 1 if mvec(ry(math.radians(HEAD[cap])), [1, 0, 0])[lat] * -cote > 0 else -1
    def bord(X):
        """Le flanc de la volée côté lobe, à l'abscisse X, tel qu'il se voit."""
        if not loi:
            return demi
        t = min(1.0, max(0.0, (X - pied) * signe / RUN))
        return demi * loi['gonflement'](t) + sl * loi['decalage'](t)
    lobe(f'lobe-{plane}-{face}', plane, c, size, TEINTES[plane], axe=axe, cote=cote,
         voie=voie, bord=bord)
    # la sphère : 1,2 m avant la crête, au-dessus des dernières marches ; le
    # point de chute, vu de la face cible, est poussé au-delà de la crête de
    # la volée (qui y est une falaise) le long de SA montée — 2,5 m au-dessus
    # de sa hauteur, en direction du « haut » du plan de départ
    sommet = [0.0, H_MAIN, 0.0]
    sommet[axe] = top[axe] - signe * 1.2
    sommet[lat] = voie
    # le « haut » du plan de départ, en réel : real = Rᵀ · monde
    haut_reel = mvec(transpose(PLANES[plane][0]), [0, 1, 0])
    haut_cible = vecteur_monde(face, haut_reel)
    decalage = (round(2.5 * haut_cible[0], 2), round(2.5 * haut_cible[2], 2))
    bascule(plane, sommet, face, NOMS[face], retour=f'Retour : {NOMS[plane]}',
            decalage=decalage)
    # PREUVES : la crête touche la face, le pied est dans la face
    near(top[axe], mur - signe * 0.3, 0.6, f'{id_} atteint {face}')
    assert abs(pied) <= SIZE + 1 and abs(voie) <= SIZE + 1, f'{id_} : hors du cube'

def near(a, b, tol, what):
    assert abs(a - b) <= tol, f'{what} : {a:.2f} ≠ {b:.2f} (±{tol})'

for plane, face, cote in ARETES:
    arete(plane, face, cote)

# ── LA TOUR JUMELLE : deux gravités INVERSES qui se font face ────────────
# La gravure de « Relativity » : un même espace sert deux mondes
# tête-bêche. Deux tours identiques — deux BRAS en spirale (volée posée,
# galerie à 6 m, volée-lame, galerie à 9,5 m, volée-lame) qui montent en
# tournant dans le même sens jusqu'à une plate-forme commune à 13 m, au
# CENTRE de la face — se construisent aux mêmes coordonnées de leur plan,
# l'une sur le sol, l'autre sur le plafond : dans la pièce, la seconde pend
# au-dessus de la première, marches renversées vers le bas. Le second bras
# est l'image du premier par le demi-tour autour de l'axe vertical : la
# tour est un moulinet, et le tore flotte sur son axe. Au sommet de
# chacune, un anneau bascule sur le sommet de l'AUTRE : on échange les
# gravités inverses en marchant.

def stair_double(id_, plane, start, end_h, lane, heading, color, base=0.0):
    """Volée-LAME : une épaisseur constante d'un mètre suit la pente — le
    dessous est donc lui aussi un escalier, renversé. C'est ce qui rend la
    tour jumelle lisible : vue d'en bas, la volée du plafond montre ses
    marches. Pied de marche à base + 1, crête à base + end_h + 0,5."""
    rise = int(round(end_h / CELL))
    THICK = 2
    run_cells = rise * 2
    dims = [WIDE, rise + THICK, run_cells]
    grid = [0] * (WIDE * (rise + THICK) * run_cells)
    for z in range(run_cells):
        s = min(rise - 1, z // 2)
        for y in range(s, s + THICK):
            for x in range(WIDE):
                grid[x + WIDE * (y + (rise + THICK) * z)] = 1
    cells, run, val = [], 1, grid[0]
    for v in grid[1:]:
        if v == val:
            run += 1
        else:
            cells += [run, val]
            run, val = 1, v
    cells += [run, val]
    run_len = run_cells * CELL
    HEAD = {'z+': 0, 'z-': 180, 'x+': 90, 'x-': -90}
    sign = 1 if heading[1] == '+' else -1
    if heading[0] == 'x':
        centre = [start + sign * run_len / 2, base, lane]
    else:
        centre = [lane, base, start + sign * run_len / 2]
    add({
        'id': id_, 'title': 'Escalier', 'description': '',
        'position': [round(v, 3) for v in to_local(plane, centre)],
        'rotation': local_rot(plane, ry(math.radians(HEAD[heading]))),
        'scale': [1, 1, 1], 'modules': [], 'role': 'decor',
        'walkable': True, 'loadDistance': 240,
        'model': modele_voxel(dims, cells, color),
        'lightIntensity': 0, '_plan': plane
    })
    # la crête : le bord haut de la dernière marche, à base + end_h + 0,5
    if heading[0] == 'x':
        return [start + sign * run_len, base + end_h + 0.5, lane]
    return [lane, base + end_h + 0.5, start + sign * run_len]

def raccord(quoi, top, heading, centre, size):
    """PREUVE de raccord : la crête `top` d'une volée touche le bord de la
    dalle (`centre`, `size`, dans le monde du plan) à sa hauteur. Une volée
    de 6 m de montée court 12 m, pas 16 : sans cette preuve, un bras s'est
    arrêté quatre mètres avant sa galerie et le script n'a rien dit."""
    sign = 1 if heading[1] == '+' else -1
    p = list(top)
    p[0 if heading[0] == 'x' else 2] += sign * 0.3           # un pas au-delà
    dedans = (abs(p[0] - centre[0]) <= size[0] / 2 + 1e-6
              and abs(p[2] - centre[2]) <= size[1] / 2 + 1e-6)
    assert dedans, f'{quoi} : la crête {[round(v, 2) for v in top]} ne touche pas la dalle {centre}'
    near(top[1], centre[1], 0.1, f'{quoi} : hauteur de crête')

def anneau(plane_from, pos_world, to_plane, arr_world, label):
    """Sphère à ARRIVÉE EXPLICITE (repère du plan cible) — l'échange des
    tours. Les deux sommets sont deux points DIFFÉRENTS de la pièce (les
    tours partagent leurs coordonnées de plan, pas leur point de pièce) :
    chacun porte donc sa sphère, à sens unique, et les deux se répondent."""
    bascules.append({
        'position': [round(v, 2) for v in to_local(plane_from, pos_world)],
        'radius': 2.2,
        'transferts': [{
            'depuis': plane_from, 'vers': to_plane, 'label': label,
            'arrival': [round(arr_world[0], 2), round(arr_world[1] + 2.2, 2),
                        round(arr_world[2], 2)]
        }],
        'label': label,
        '_pose': plane_from
    })

PLATEAU = 10.0        # la plate-forme haute : 10 × 10 de dessin, au centre
SOMMET = 13.0         # sa hauteur : galeries à 6 et 9,5, crête à base + montée + 0,5
PORTEE = 15.0         # l'axe des galeries d'un bras (x = ±15) : la galerie
                      # finit à 7,8 du mur est ou ouest et la volée-lame f2,
                      # qui serpente de 2 m vers le mur, à 5,3 — plus que la
                      # tête du visiteur qui y marche (LIBRE) ; plus près,
                      # elle serait un piège à hauteur de front dans cette
                      # gravité
BRAS_Z = -7.0         # la voie de la volée posée d'un bras : z = −7 pour
                      # le bras +x, +7 pour le bras −x — le quadrant OPPOSÉ
                      # à la volée de sol du même côté (sol → est à z = +15,
                      # x > 0). Côte à côte, la volée serpentait de 2,2 m
                      # vers f1 et f1 de 1,6 m vers elle : elles se
                      # touchaient (contrôle par cellules vues). Et pas plus
                      # loin que 7 : f1 serpente jusqu'à z = ∓11,6, à 2,4 m
                      # (LIBRE) de la crête et du lobe de la volée nord → sol
                      # (z = ∓16,5), qui sont un sol pour la gravité nord

def bras(plane, s, t1, t2):
    """Un bras de la spirale, `s` = +1 (côté +x) ou −1 : le bras −1 est
    l'IMAGE du bras +1 par le demi-tour autour de l'axe vertical (x → −x,
    z → −z, caps retournés). Les lisières ourlent le bord extérieur."""
    n = f'tour-{plane}-{"a" if s > 0 else "b"}'
    ext_x = 'droite' if s > 0 else 'gauche'        # le bord ±x d'une dalle longue en z
    ext_z = 'gauche' if s > 0 else 'droite'        # le bord −z (bras +x) d'une dalle longue en x
    # F1 : du sol du plan à la première galerie (volée classique, posée),
    # le long de z = ∓7, de x = ±1 à x = ±13 (6 m de montée, 12 de
    # course) ; « droite » (le +x local tourné par le cap) est le bord loin
    # du centre pour les deux bras
    cap1 = 'x+' if s > 0 else 'x-'
    _, top1 = stair(f'{n}-f1', plane, s * (PORTEE - 14.0), 6.0, s * BRAS_Z, cap1, t1, lisiere='droite')
    # G1 : galerie basse (h 6), 4 × 4 au bout de F1 — carrée, son axe long
    # est x et son bord extérieur le côté ∓z
    g1 = [s * PORTEE, 6.0, s * BRAS_Z]
    slab(f'{n}-g1', plane, g1, (4.0, 4.0), t2, lisiere=ext_z)
    raccord(f'{n}-f1', top1, cap1, g1, (4.0, 4.0))
    # F2 : G1 → G2, volée-lame le long de x = ±15, vers le centre en z (4 m
    # de montée, 8 de course : trop courte pour serpenter, elle reste droite)
    cap2 = 'z+' if s > 0 else 'z-'
    top2 = stair_double(f'{n}-f2', plane, s * (BRAS_Z + 2.0), 4.0, s * PORTEE, cap2, t1, base=5.0)
    # G2 : galerie médiane (h 9,5), 4 × 5 — longue en z, bord extérieur ±x
    g2 = [s * PORTEE, 9.5, s * (BRAS_Z + 12.5)]
    slab(f'{n}-g2', plane, g2, (4.0, 5.0), t2, lisiere=ext_x)
    raccord(f'{n}-f2', top2, cap2, g2, (4.0, 5.0))
    # F3 : G2 → plate-forme, volée-lame courte (4 m de montée, 8 de course)
    # le long de z = ±3,5, vers le centre en x ; sa crête touche le bord
    # de la plate-forme
    cap3 = 'x-' if s > 0 else 'x+'
    top3 = stair_double(f'{n}-f3', plane, s * (PORTEE - 2.0), SOMMET - 9.5 + 0.5, s * 3.5,
                        cap3, t1, base=8.5)
    raccord(f'{n}-f3', top3, cap3, [0.0, SOMMET, 0.0], (PLATEAU, PLATEAU))
    # colonnade : chaque galerie porte sur son pilier
    pillar(f'{n}-p1', plane, [s * PORTEE, 0, s * BRAS_Z], 5.4)
    pillar(f'{n}-p2', plane, [s * PORTEE, 0, s * (BRAS_Z + 12.5)], 8.9)

def tour(plane, teintes):
    t1, t2 = teintes
    bras(plane, +1, t1, t2)
    bras(plane, -1, t1, t2)
    # la plate-forme — le belvédère de la tour, ourlé en pourtour, sur
    # quatre piliers d'angle ; la lanterne de la face brûle dessous
    slab(f'tour-{plane}-g3', plane, [0.0, SOMMET, 0.0], (PLATEAU, PLATEAU), t2,
         lisiere='pourtour')
    for k, (px, pz) in enumerate(((4.0, 4.0), (-4.0, 4.0), (-4.0, -4.0), (4.0, -4.0))):
        pillar(f'tour-{plane}-p{k + 1}', plane, [px, 0, pz], SOMMET - 0.6)

tour('sol', ('#6c6288', '#565070'))
tour('plafond', ('#5a6a80', '#485668'))
# l'échange : du centre d'une plate-forme au centre de l'autre — les deux
# anneaux se répondent, chaque monde renversé rend ce qu'il a pris
anneau('sol', [0.0, SOMMET, 0.0], 'plafond', [0.0, SOMMET, 0.0], 'Tour inverse (plafond)')
anneau('plafond', [0.0, SOMMET, 0.0], 'sol', [0.0, SOMMET, 0.0], 'Tour inverse (sol)')

# ── mobilier : lanternes, bancs, gerbes ──────────────────────────────────
# UNE lanterne par gravité, AU centre de sa face : elle dit « ceci est un
# sol » (sur le sol et le plafond, elle brûle sous la plate-forme de la
# tour). Intensité 2,4 ; la lumière d'ambiance vient des corniches et des
# lisières.
for plan_l in PLANES:
    cl = monde_de(plan_l, [0.0, HALF, 0.0])
    lantern(f'lanterne-bel-{plan_l}-1', plan_l, [cl[0], 0, cl[2]], intensity=2.4)

# deux bancs par tour, sous le bord de la plate-forme, de part et d'autre
# de la lanterne sur l'axe x, tournés vers elle (le banc regarde vers +z :
# un quart de tour) — hors des volées f1, qui serpentent jusqu'à z = ∓2,4
BANC = {'type': 'gltf', 'url': 'library/models/banc.glb', 'fit': 1.8,
        'source': 'library', 'texture': 'bois-use', 'roughness': 0.78,
        'metalness': 0.0}
for plan_b in ('sol', 'plafond'):
    for k, xb in enumerate((6.0, -6.0)):
        prop(f'banc-bel-{plan_b}-{k + 1}', 'Banc', plan_b, [xb, 0, 0.0], dict(BANC),
             rot_y=-90 if xb > 0 else 90)
        works[-1]['credit'] = {'author': 'Galerie', 'license': 'CC0-1.0',
                               'sourceUrl': 'https://github.com/yannicksandoz/yannicksandoz.github.io'}

# quatre gerbes de lumière aux coins de la pièce, sur les sommets d'un
# TÉTRAÈDRE inscrit dans le cube (deux coins du plafond, les deux coins
# opposés du sol) — l'orbite d'un coin sous les trois demi-tours. Chacune
# vise le centre. Les gerbes ne sont pas des lumières : des rayons émissifs
# (README, « gerbe »), portée 34 livrée à l'échelle de l'objet.
COIN = HALF - 0.6
for k, (sx, haut, sz) in enumerate(((-1, True, -1), (1, True, 1), (-1, False, 1), (1, False, -1))):
    y = SIZE - 0.6 if haut else 0.6
    add({
        'id': f'gerbe-bel-{k + 1}', 'title': 'Gerbe', 'role': 'decor',
        'position': [sx * COIN, y, sz * COIN], 'rotation': [0, 0, 0],
        'scale': [1, 1, 1],
        'model': {'shape': 'gerbe', 'nombre': 7, 'portee': 34.0, 'ouverture': 13,
                  'vers': [-sx, -1 if haut else 1, -sz],
                  'color': '#cbb4ff', 'emissive': 0.32, 'rayonBout': 0.789},
        'solid': False, 'cartel': False, 'loadDistance': 130
    })

add({
    'id': 'gravite', 'title': 'Gravité',
    'description': "Un tore suspendu au centre d'un cube qui n'a pas décidé où "
        "est le bas. Six faces, douze arêtes, une volée par arête : montez, et "
        "au sommet l'espace pivote autour de vous — le mur devient sol, la "
        "pièce se relit entière. Le labyrinthe n'a pas de plan : il a six.",
    'position': [0, HALF, 0], 'rotation': [35, 0, 20], 'scale': [3, 3, 3],
    'model': {'shape': 'torus', 'color': '#d8a8ff',
              'roughness': 0.35, 'metalness': 0.5, 'emissive': 0.35},
    'lightColor': '#d8a8ff', 'lightIntensity': 9, 'loadDistance': 240,
    'modules': [{'type': 'FocusCamera', 'params': {'distance': 11}}]
})

# ── ambiance : puits de lumière le long de la clé, essaims de lucioles ────
# (primitives d'ambiance du moteur — additives, jamais des cibles ; voir
# le README, « faisceau » et « lucioles »)
def ambiance(id_, model, pos, rot=(0, 0, 0)):
    add({
        'id': id_, 'title': 'Décor', 'description': '',
        'position': list(pos), 'rotation': list(rot), 'scale': [1, 1, 1],
        'modules': [], 'role': 'decor', 'model': model,
        'lightIntensity': 0.0, 'loadDistance': 240
    })

# (les trois faisceaux ont cédé la place aux gerbes et aux lavages posés à
# la main — voir les fichiers emprise-bel-*, lavage-bel-*, que ce script
# conserve sans les connaître). Un essaim sous chaque plate-forme.
ambiance('lucioles-bel-1',
         {'shape': 'lucioles', 'size': 16.0, 'count': 40, 'seed': 11,
          'color': '#ffd97a', 'emissive': 1.1, 'dotSize': 0.24},
         (0.0, 8.0, 0.0))
ambiance('lucioles-bel-2',
         {'shape': 'lucioles', 'size': 16.0, 'count': 40, 'seed': 23,
          'color': '#ffd97a', 'emissive': 1.1, 'dotSize': 0.24},
         (0.0, SIZE - 8.0, 0.0))

# --------------------------------------------------------------- pièce ----
room = {
    'id': 'belvedere', 'title': 'Belvédère',
    'spawn': [0, 2.2, 14],
    # brume « Hokusai » : bleu ardoise, calibrée pour qu'à 50 m les faces
    # lointaines bleuissent autant qu'à 80 m avec l'ancienne densité
    'fogColor': '#1d2748',
    'fogDensity': 0.014,
    # Pas de quadrillage : au loin, ses lignes se serrent en un moiré qui
    # scintille au ras des murs — « Relativity » n'a pas de carrelage.
    # Sol exactement à la taille du cube : rien ne dépasse dehors.
    'floor': {'size': SIZE, 'color': '#171226', 'grid': False},
    'shell': {'width': SIZE, 'depth': SIZE, 'height': SIZE, 'color': '#241c34',
              'ceiling': True, 'texture': 'pierre',
              'wallColors': {'nord': '#3a4a86', 'sud': '#7a3f34',
                             'est': '#35704c', 'ouest': '#7a6330',
                             'plafond': '#453163'}},
    # Un grand cube avale la lumière : clé plus franche et rebond d'IBL
    # plus généreux que dans les salles — sans quoi les plans hauts (plafond,
    # murs lointains) se lisent en silhouette.
    'keyLight': {'color': '#e0c4ff', 'intensity': 2.8, 'azimuth': 315,
                 'elevation': 58},
    'envIntensity': 1.5,
    'works': [w['id'] for w in works],
    'bascules': bascules,
    'jetons': [[15.0, 1.0, -8.0], [-15.0, 1.0, 8.0]],   # au pied des volées-lames f2
    'portals': [
        {'to': 'couloir-est', 'position': [0, 0, 21.5], 'rotationY': 180,
         'label': 'Couloir', 'arrival': [0, 2.2, -6]},
        {'to': 'entree', 'position': [-21.5, 0, 12.5], 'rotationY': 90,
         'label': 'Entrée', 'arrival': [0, 2.2, 12]},
        # un portail par gravité : explorer les plans, c'est gagner des
        # raccourcis — celui du mur est mène au labo…
        {'to': 'labo',
         'position': [round(v, 3) for v in to_local('est', [16.0, 0.0, -14.0])],
         'rotation': local_rot('est', ry(math.radians(0))),
         'label': 'Labo', 'arrival': [0, 2.2, 16]},
        # …celui du mur nord aux archives
        {'to': 'archives',
         'position': [round(v, 3) for v in to_local('nord', [-15.0, 0.0, -12.5])],
         'rotation': local_rot('nord', ry(math.radians(90))),
         'label': 'Archives', 'arrival': [0, 2.2, 6]},
        # …celui du mur ouest au jardin
        {'to': 'jardin',
         'position': [round(v, 3) for v in to_local('ouest', [-16.0, 0.0, 16.0])],
         'rotation': local_rot('ouest', ry(math.radians(180))),
         'label': 'Jardin', 'arrival': [0, 2.2, 10]},
        # …celui du mur sud à la bibliothèque
        {'to': 'bibliotheque',
         'position': [round(v, 3) for v in to_local('sud', [15.0, 0.0, 37.5])],
         'rotation': local_rot('sud', ry(math.radians(-90))),
         'label': 'Bibliothèque', 'arrival': [0, 2.2, 6]},
        # …et celui du plafond débouche sur l'allée, à ciel ouvert
        {'to': 'allee',
         'position': [round(v, 3) for v in to_local('plafond', [-11.0, 0.0, -11.0])],
         'rotation': local_rot('plafond', ry(math.radians(0))),
         'label': 'Allée', 'arrival': [0, 2.2, 9]}
    ]
}

# ------------------------------------------------ les six chambres Face --
# Une porte par face intérieure du cube, chacune ouvrant sur une chambre
# cubique de 25 m à la COULEUR de sa face — six antichambres, prêtes à
# recevoir des œuvres. Le portail de retour rend le visiteur sur le plan
# d'où il est parti (champ `plane` du portail).

def teinte(hexa, f):
    """Assombrit (f < 1) ou éclaircit (f > 1) une couleur hex."""
    r, g, b = (int(hexa[i:i + 2], 16) for i in (1, 3, 5))
    borne = lambda v: max(0, min(255, round(v * f)))
    return f'#{borne(r):02x}{borne(g):02x}{borne(b):02x}'

FACES = [
    # (id, titre, plan, couleur de la face, position du portail
    #  dans le monde du plan, centre du monde du plan)
    ('face-1', 'Face 1', 'sol',     '#241c34', (14.0, -18.0), (0.0, 0.0)),
    ('face-2', 'Face 2', 'est',     '#35704c', (6.0, 14.0),   (25.0, 0.0)),
    ('face-3', 'Face 3', 'nord',    '#3a4a86', (12.0, -6.0),  (0.0, -25.0)),
    ('face-4', 'Face 4', 'ouest',   '#7a6330', (-8.0, -14.0), (-25.0, 0.0)),
    ('face-5', 'Face 5', 'sud',     '#7a3f34', (16.0, 8.0),   (0.0, 25.0)),
    ('face-6', 'Face 6', 'plafond', '#453163', (8.0, -16.0),  (0.0, 0.0))
]

oeuvres_faces = []
chambres = []
for fid, titre, plane, couleur, (px, pz), (cx, cz) in FACES:
    # le portail du belvédère, posé sur la face, tourné vers le centre
    dx, dz = cx - px, cz - pz
    n = math.hypot(dx, dz) or 1.0
    cap = math.degrees(math.atan2(dx, dz))
    porte = {
        'to': fid,
        'label': titre,
        'arrival': [0, 2.2, 8]
    }
    if plane == 'sol':
        porte['position'] = [round(px, 2), 0, round(pz, 2)]
        porte['rotationY'] = round(cap, 1)
    else:
        porte['position'] = [round(v, 3) for v in to_local(plane, [px, 0.0, pz])]
        porte['rotation'] = local_rot(plane, ry(math.radians(cap)))
    room['portals'].append(porte)

    # la lanterne de la chambre, lueur à la couleur de la face
    lueur = teinte(couleur, 2.2)
    oeuvres_faces.append({
        'id': f'lanterne-{fid}', 'title': 'Lanterne', 'description': '',
        'position': [6.0, 1.1, -6.0], 'rotation': [0, 0, 0],
        'scale': [0.5, 1.2, 0.5], 'modules': [], 'role': 'decor',
        'model': {'shape': 'cylinder', 'color': teinte(couleur, 0.6),
                  'emissiveColor': lueur, 'roughness': 0.55,
                  'metalness': 0.0, 'emissive': 0.6},
        'lightColor': lueur, 'lightIntensity': 2.4,
        'selfLit': True, 'loadDistance': 240
    })

    # retour : trois mètres en retrait de la porte, face au centre du plan
    retour = [round(px + dx / n * 3, 2), 2.2, round(pz + dz / n * 3, 2)]
    chambre = {
        'id': fid, 'title': titre,
        'spawn': [0, 2.2, 8],
        'fogColor': teinte(couleur, 0.55),
        'fogDensity': 0.02,
        'floor': {'size': 25.0, 'color': teinte(couleur, 0.45), 'grid': False},
        'shell': {'width': 25.0, 'depth': 25.0, 'height': 25.0,
                  'color': couleur, 'ceiling': True, 'texture': 'pierre'},
        'keyLight': {'color': lueur, 'intensity': 2.4,
                     'azimuth': 315, 'elevation': 55},
        'envIntensity': 1.2,
        'works': [f'lanterne-{fid}'],
        'portals': [{
            'to': 'belvedere', 'position': [0, 0, 10.5], 'rotationY': 180,
            'label': 'Belvédère', 'plane': plane, 'arrival': retour
        }]
    }
    if fid == 'face-6':   # la plus haute perchée cache un jeton
        chambre['jetons'] = [[-6.0, 1.0, 6.0]]
    chambres.append(chambre)

# ------------------------------------------------------------- contrôles --
# chaque arrivée tombe-t-elle juste au-dessus du nouveau sol (y ≈ 2,2 + marge) ?
for b in bascules:
    for t in b['transferts']:
        y = t['arrival'][1] - 2.2
        assert -0.2 <= y <= 18.0, (
            f"{t['label']} : arrivée à {y:.2f} m du sol (hors plage)")

# Tout objet doit tenir DANS le cube — le piège classique : sur le plan
# « est », l'abscisse du monde du plan est la hauteur d'origine (donc [0, 80]),
# et sur « nord » la profondeur vaut [-80, 0]. Un signe oublié et l'objet
# passe sous le sol.
for w in works:
    x, y, z = w['position']
    assert -HALF - 2 <= x <= HALF + 2, f"{w['id']} : x hors du cube ({x})"
    assert -HALF - 2 <= z <= HALF + 2, f"{w['id']} : z hors du cube ({z})"
    assert -1.5 <= y <= SIZE + 2, f"{w['id']} : y hors du cube ({y})"

# Aucune masse foulable ne doit en traverser une autre : deux volées de plans
# différents se rejoignent dans l'arête où les murs se touchent, et rien ne le
# signale à l'œil nu — seule une boîte englobante le dit.
def aabb(w):
    m = w['model']
    if m.get('type') != 'voxel':
        return None
    dx, dy, dz = [n * m['cell'] for n in m['dims']]
    coins = []
    ex, ey, ez = math.radians(w['rotation'][0]), math.radians(w['rotation'][1]), \
        math.radians(w['rotation'][2])
    R = mmul(mmul(rx(ex), ry(ey)), rz(ez))     # ordre XYZ de three.js
    for sx in (-dx / 2, dx / 2):
        for sy in (0.0, dy):                    # base à y = 0 (voxel.js)
            for sz in (-dz / 2, dz / 2):
                v = mvec(R, [sx, sy, sz])
                coins.append([v[i] + w['position'][i] for i in range(3)])
    lo = [min(c[i] for c in coins) for i in range(3)]
    hi = [max(c[i] for c in coins) for i in range(3)]
    return lo, hi

masses = [(w['id'], aabb(w)) for w in works if w.get('walkable')]
masses = [(i, b) for i, b in masses if b]
JEU = 0.3          # on tolère de se frôler, pas de se traverser
def meme_arete(a, b):
    """Une volée et SON lobe : la dalle du lobe couvre le flanc de la volée
    (le masque la découpe sur la courbe), leurs boîtes se recouvrent par
    construction — c'est le contrôle par cellules, plus bas, qui les juge."""
    pa, pb = a.split('-', 1), b.split('-', 1)
    return {pa[0], pb[0]} == {'escalier', 'lobe'} and pa[1] == pb[1]
for i in range(len(masses)):
    for j in range(i + 1, len(masses)):
        (na, (loa, hia)), (nb, (lob, hib)) = masses[i], masses[j]
        if meme_arete(na, nb):
            continue
        chevauche = all(loa[k] < hib[k] - JEU and lob[k] < hia[k] - JEU
                        for k in range(3))
        assert not chevauche, (
            f'{na} et {nb} se traversent : '
            f'{[round(v, 1) for v in loa]}–{[round(v, 1) for v in hia]} vs '
            f'{[round(v, 1) for v in lob]}–{[round(v, 1) for v in hib]}')

# Une arrivée (bascule) et un anneau ne doivent JAMAIS tomber DANS une masse
# foulable : on y atterrirait coincé dans l'escalier, ou l'anneau serait
# inatteignable. Le test se fait dans le MONDE DU PLAN concerné — c'est là
# que « le haut » a un sens : se tenir sur la face supérieure d'une volée
# est le but, être enseveli sous elle est le défaut.
def aabb_plan(plane, w):
    """Boîte englobante de `w` dans le monde du plan `plane`."""
    m = w['model']
    if m.get('type') != 'voxel':
        return None
    dx, dy, dz = [n * m['cell'] for n in m['dims']]
    ex, ey, ez = [math.radians(v) for v in w['rotation']]
    R = mmul(mmul(rx(ex), ry(ey)), rz(ez))
    coins = []
    for sx in (-dx / 2, dx / 2):
        for sy in (0.0, dy):
            for sz in (-dz / 2, dz / 2):
                v = mvec(R, [sx, sy, sz])
                local = [v[i] + w['position'][i] for i in range(3)]
                coins.append(to_world(plane, local))
    lo = [min(c[i] for c in coins) for i in range(3)]
    hi = [max(c[i] for c in coins) for i in range(3)]
    return lo, hi

CORPS = 0.6
def enseveli(plane, monde):
    for w in works:
        if not w.get('walkable'):
            continue
        b = aabb_plan(plane, w)
        if not b:
            continue
        lo, hi = b
        horiz = all(lo[k] - CORPS <= monde[k] <= hi[k] + CORPS for k in (0, 2))
        sous = lo[1] - 0.2 <= monde[1] <= hi[1] - 0.5
        if horiz and sous:
            return w['id']
    return None

for b in bascules:
    for t in b['transferts']:
        pieds = [t['arrival'][0], t['arrival'][1] - 2.2, t['arrival'][2]]
        dedans = enseveli(t['vers'], pieds)
        assert not dedans, f"arrivée « {t['label']} » ensevelie dans {dedans}"
    # La sphère flotte : elle n'a pas à être « posée » quelque part, mais
    # elle ne doit pas être noyée dans une masse — on la juge depuis le plan
    # d'où on la prend en premier.
    plan_pose = b.get('_pose', 'sol')
    dedans = enseveli(plan_pose, to_world(plan_pose, b['position']))
    assert not dedans, f"sphère « {b['label']} » ensevelie dans {dedans}"

# UNE LIGNE PAR MASSE : toute masse foulable porte exactement une lisière
# (les volées-lames de la tour se lisent par leur double face, elles n'en
# ont pas) ; rien d'autre ne brille que les lanternes
for w in works:
    if not w.get('walkable') or w['model'].get('type') != 'voxel':
        continue
    lame = w['id'].startswith('tour-') and '-f' in w['id'] and not w['id'].endswith('f1')
    assert lame or w['model'].get('lisiere'), f"{w['id']} : masse sans lisière"
    assert not (lame and w['model'].get('lisiere')), f"{w['id']} : une lame ne s'ourle pas"

# identifiants uniques
ids = [w['id'] for w in works]
assert len(ids) == len(set(ids)), 'identifiants dupliqués'

# ------------------------------------------------------------ symétrie ----
# Le belvédère est SYMÉTRIQUE : le demi-tour autour de chacun des trois
# axes de la pièce (par son centre) envoie chaque masse, chaque pilier,
# lanterne, banc, gerbe, essaim, sphère et jeton sur un autre du même
# genre et de la même boîte. Une pièce sans dessus ni dessous n'a pas de
# raison d'avoir un côté : rien n'est écrit qui rompe le groupe D2.
def demi_tour(axe, p):
    x, y, z = p
    if axe == 'y':
        return [-x, y, -z]
    if axe == 'x':
        return [x, SIZE - y, -z]
    return [-x, SIZE - y, z]

def boite(w):
    b = aabb(w)
    if b:
        return b
    x, y, z = w['position']
    return ([x, y, z], [x, y, z])

def boite_image(axe, b):
    lo, hi = (demi_tour(axe, b[0]), demi_tour(axe, b[1]))
    return ([min(lo[i], hi[i]) for i in range(3)], [max(lo[i], hi[i]) for i in range(3)])

def meme_boite(a, b, tol=0.06):
    return all(abs(a[0][i] - b[0][i]) <= tol and abs(a[1][i] - b[1][i]) <= tol
               for i in range(3))

SYMETRIQUES = ('Escalier', 'Balcon', 'Pilier', 'Lanterne', 'Banc', 'Gerbe', 'Décor')
familles = {}
for w in works:
    if w['title'] in SYMETRIQUES:
        familles.setdefault(w['title'], []).append(w)
for axe in ('x', 'y', 'z'):
    for titre, membres in familles.items():
        for w in membres:
            image = boite_image(axe, boite(w))
            assert any(meme_boite(image, boite(v)) for v in membres), (
                f"{w['id']} : pas d'image par le demi-tour autour de {axe}")
    points = [b['position'] for b in bascules]         # local = repère de la pièce
    for p in points:
        q = demi_tour(axe, p)
        assert any(all(abs(q[i] - r[i]) <= 0.06 for i in range(3)) for r in points), (
            f'sphère en {p} : pas d\'image par le demi-tour autour de {axe}')
    for j in room['jetons']:
        q = demi_tour(axe, j)
        # les jetons sont POSÉS : leur image par x ou z est au plafond, on
        # ne la demande qu'à l'axe vertical
        if axe == 'y':
            assert any(all(abs(q[i] - r[i]) <= 0.06 for i in range(3)) for r in room['jetons']), (
                f'jeton en {j} : pas d\'image par le demi-tour vertical')

# ------------------------------------------------------ hauteur libre ----
# L'ACCESSIBILITÉ, mesurée. Sur chaque plan, on remplit une grille de
# cellules de dessin (50 cm) avec toutes les masses foulables, quel que
# soit le plan qui les a posées (une volée du plan est traverse le monde du
# plan sol en falaise). Puis, pour chaque cellule de surface (pleine, vide
# au-dessus) et pour chaque colonne du sol, on exige LIBRE mètres d'air :
# aucune AUTRE masse dans cette hauteur. C'est exactement ce que la tête du
# visiteur (Controls.HEAD) refuse au jeu — une galerie trop basse, une
# volée qui enjambe un passage à hauteur de front.
def cellules_pleines(w):
    """Les cellules pleines d'une grille voxel, décodées de leur RLE."""
    m = w['model']
    dims, cells = m['dims'], m['cells']
    pleines, i = [], 0
    for k in range(0, len(cells), 2):
        run, val = cells[k], cells[k + 1]
        if val:
            for j in range(i, i + run):
                x = j % dims[0]
                y = (j // dims[0]) % dims[1]
                z = j // (dims[0] * dims[1])
                pleines.append((x, y, z))
        i += run
    return pleines

def cellules_vues(w):
    """Les cellules pleines de `w` telles qu'elles se VOIENT, dans le repère
    de l'objet : (centre, demi-largeur latérale, axe latéral) — le serpentin
    déplace et élargit chaque cellule en travers de l'axe long."""
    m = w['model']
    dims, cell = m['dims'], m['cell']
    loi = loi_serpentin(dims)
    out = []
    for (x, y, z) in cellules_pleines(w):
        c = [(x + 0.5 - dims[0] / 2) * cell, (y + 0.5) * cell, (z + 0.5 - dims[2] / 2) * cell]
        if not loi:
            out.append((c, None, None))
            continue
        if loi['axe'] == 2:
            t, lat = (z + 0.5) / dims[2], 0
        else:
            t, lat = (x + 0.5) / dims[0], 2
        g = loi['gonflement'](t)
        c[lat] = c[lat] * g + loi['decalage'](t)
        out.append((c, cell * g / 2, lat))
    return out

chevauchements = {}
def occupation(plane, croisements=None):
    """{(ix, iy, iz): id} des cellules pleines des masses foulables, dans
    le monde du plan `plane`, en cellules de dessin — les masses telles
    qu'elles se voient (serpentin compris). `croisements` reçoit, par paire
    de masses, le nombre de cellules qu'elles se disputent."""
    occ = {}
    for w in works:
        if not w.get('walkable') or w['model'].get('type') != 'voxel':
            continue
        # les masses des AUTRES plans sont des falaises ici, pas des chemins :
        # on les inscrit (elles peuvent surplomber un chemin), mais leurs
        # faces ne sont pas des surfaces foulables dans ce monde
        propre[w['id']] = w.get('_plan') == plane
        ex, ey, ez = [math.radians(v) for v in w['rotation']]
        R = mmul(mmul(rx(ex), ry(ey)), rz(ez))
        for (c, demi, lat) in cellules_vues(w):
            # une cellule élargie couvre plusieurs colonnes : on inscrit
            # chaque cellule de dessin dont le centre tombe dans sa largeur
            if demi is None:
                centres = [c]
            else:
                k0 = math.ceil((c[lat] - demi + 0.01) / CELL - 0.5)
                k1 = math.floor((c[lat] + demi - 0.01) / CELL - 0.5)
                centres = []
                for k in range(k0, k1 + 1):
                    d = list(c)
                    d[lat] = (k + 0.5) * CELL
                    centres.append(d)
            for d in centres:
                v = mvec(R, d)
                local = [v[i] + w['position'][i] for i in range(3)]
                p = to_world(plane, local)
                # les centres tombent à k + ½ cellule : on arrondit avant de
                # prendre la partie entière, sinon un angle d'Euler arrondi à
                # trois décimales fait basculer une cellule de bord dans la
                # colonne voisine
                cle = tuple(math.floor(round(p[i] / CELL, 3)) for i in range(3))
                if croisements is not None and cle in occ and occ[cle] != w['id']:
                    paire = tuple(sorted((occ[cle], w['id'])))
                    croisements[paire] = croisements.get(paire, 0) + 1
                occ[cle] = w['id']
    return occ

# AUCUNE MASSE N'EN TRAVERSE UNE AUTRE, telles qu'elles se voient : les
# boîtes droites ne savent rien du serpentin (une volée qui ondoie d'un
# mètre peut en rencontrer une autre à mi-course, ou son propre lobe).
# Quelques cellules partagées sont un frôlement d'arrondi ; au-delà, on se
# traverse.
propre = {}
occupation('sol', chevauchements)
graves = {p: n for p, n in chevauchements.items() if n > 4 and not meme_arete(*p)}
assert not graves, 'CHEVAUCHEMENTS (cellules vues) :\n  ' + '\n  '.join(
    f'{a} et {b} : {n} cellules' for (a, b), n in graves.items())

LIBRE_CELLS = int(math.ceil(LIBRE / CELL))        # 10 cellules de 50 cm
POITRINE_CELLS = int(math.ceil(1.15 / K / CELL))  # 5 : sous ça, c'est un mur
YEUX_CELLS = 8                                    # 1,92 m livrés : les yeux (2,2)
                                                  # et la tête (2,3) vivent dans [8, 10)
fautes = []
for plane in PLANES:
    propre = {}
    occ = occupation(plane)
    colonnes = {}
    for (ix, iy, iz), wid in occ.items():
        colonnes.setdefault((ix, iz), []).append((iy, wid))
    for (ix, iz), piles in colonnes.items():
        piles.sort()
        # la colonne en MASSES contiguës [bas, haut, id du dessus]
        runs = []
        for iy, wid in piles:
            if runs and iy == runs[-1][1] + 1:
                runs[-1][1], runs[-1][2] = iy, wid
            else:
                runs.append([iy, iy, wid])
        # le sol : la première masse d'une colonne qui ne touche pas le sol.
        # Sous la poitrine, une masse est un mur qu'on contourne (le rayon de
        # poitrine l'arrête) ; entre la poitrine et la tête, c'est un piège
        # SI elle monte jusqu'aux yeux : on passe dessous et l'on s'y cogne
        # la caméra. Une marche mince à 1,2 m — le flanc d'une volée
        # serpentine vue d'une autre gravité — passe sous les yeux : on la
        # traverse du buste, la caméra n'y entre pas.
        a, b, w0 = runs[0]
        if POITRINE_CELLS <= a < LIBRE_CELLS and b >= YEUX_CELLS:
            fautes.append(f'{plane} : {w0} surplombe le sol à {a * CELL * K:.2f} m '
                          f'livrés en ({ix * CELL * K:.1f}, {iz * CELL * K:.1f})')
        # chaque surface foulable de CE plan : de l'air jusqu'à LIBRE
        # au-dessus (une masse plus bas barre le chemin, ou cogne la caméra)
        for k in range(len(runs) - 1):
            _, haut, wid = runs[k]
            a2, _, wid2 = runs[k + 1]
            if not propre.get(wid):
                continue                     # une falaise d'un autre plan
            if meme_arete(wid, wid2):
                continue                     # la lisse du lobe sur le bord de sa volée
            if wid2 != wid and a2 - haut - 1 < LIBRE_CELLS:
                fautes.append(f'{plane} : {wid2} passe à {(a2 - haut - 1) * CELL * K:.2f} m '
                              f'au-dessus de {wid} en ({ix * CELL * K:.1f}, {iz * CELL * K:.1f})')
# on ne signale chaque couple qu'une fois
vus, resume = set(), []
for f in fautes:
    cle = f.split(' en (')[0]
    if cle not in vus:
        vus.add(cle)
        resume.append(f)
assert not resume, 'HAUTEUR LIBRE :\n  ' + '\n  '.join(resume)

# ------------------------------------------------------------- écriture ---
# Tout se LIVRE à l'échelle K (voir l'en-tête) ; un fichier existant garde
# ses réglages de main et ne reçoit que la géométrie.
PREFIXES = ('escalier-', 'palier-r', 'passerelle-r', 'ruban-', 'lobe-', 'lanterne-bel',
            'pilier-bel', 'stele-belvedere', 'lanterne-belvedere',
            'banc-bel', 'faisceau-bel', 'lucioles-bel', 'tour-', 'gerbe-bel')
GEOMETRIE = ('position', 'rotation', 'scale', 'walkable', 'solid')

def livrer(w):
    """Copie de `w` à l'échelle K."""
    d = json.loads(json.dumps(w))
    d.pop('_plan', None)
    d['position'] = [round(v * K, 3) for v in d['position']]
    m = d.get('model', {})
    if m.get('type') == 'voxel':
        # une grille se réduit par sa CELLULE, jamais par son échelle : le
        # collider et la charte lisent la cellule
        m['cell'] = round(m['cell'] * K, 4)
    else:
        d['scale'] = [round(v * K, 4) for v in d.get('scale', [1, 1, 1])]
        if m.get('type') == 'gltf' and 'fit' in m:
            m['fit'] = round(m['fit'] * K, 3)
        elif 'size' in m:
            m['size'] = round(m['size'] * K, 3)
    # une lampe à l'échelle : la règle relevée sur le contenu existant
    if d.get('lightIntensity'):
        d['lightIntensity'] = round(d['lightIntensity'] * 0.45, 3)
    if m.get('emissive') and m.get('shape') not in ('box',):
        m['emissive'] = round(m['emissive'] * 0.45, 3)
    return d

def fusionner(nouveau, chemin):
    """Le fichier existant garde la main sur tout ce qui n'est pas géométrie."""
    if not os.path.exists(chemin):
        return nouveau
    # les rubans n'ont pas de réglage de main : le générateur les possède
    if nouveau['id'].startswith('ruban-'):
        return nouveau
    ancien = json.load(open(chemin))
    for k in GEOMETRIE:
        if k in nouveau:
            ancien[k] = nouveau[k]
        elif k in ancien and k not in ('solid',):
            del ancien[k]
    if 'model' in nouveau:
        am = ancien.setdefault('model', {})
        nm = nouveau['model']
        if nm.get('type') == 'voxel':
            for k in ('type', 'dims', 'cell', 'cells'):
                am[k] = nm[k]
            for k in MATIERE:
                am.setdefault(k, nm[k])
            # la lisière est de la géométrie : elle suit, ou disparaît
            if 'lisiere' in nm:
                am['lisiere'] = nm['lisiere']
            else:
                am.pop('lisiere', None)
        else:
            for k in ('shape', 'type'):
                if k in nm:
                    am[k] = nm[k]
    return ancien

existants = set(os.listdir(f'{ROOT}/works'))
for f in sorted(existants):
    # préfixes RÉSERVÉS au belvédère : « escalier-couloir » appartient au
    # couloir des fenêtres et ne doit surtout pas être emporté
    if f.startswith(PREFIXES) and f[:-5] not in ids:
        os.remove(f'{ROOT}/works/{f}')

for w in works:
    chemin = f"{ROOT}/works/{w['id']}.json"
    d = fusionner(livrer(w), chemin)
    with open(chemin, 'w') as f:
        json.dump(d, f, ensure_ascii=False, indent=2)
        f.write('\n')
# les lanternes des chambres Face : seulement si elles n'existent pas
for w in oeuvres_faces:
    chemin = f"{ROOT}/works/{w['id']}.json"
    if os.path.exists(chemin):
        continue
    with open(chemin, 'w') as f:
        json.dump(w, f, ensure_ascii=False, indent=2)
        f.write('\n')

for b in bascules:
    b.pop('_pose', None)
    b['position'] = [round(v * K, 3) for v in b['position']]
    b['radius'] = round(b['radius'] * K, 3)
    for t in b['transferts']:
        t['arrival'] = [round(v * K, 2) for v in t['arrival']]

# LA PIÈCE : le fichier existant garde ses réglages (lumière, brume,
# réverbération, portails reposés par la charte) ; le générateur ne lui
# donne que ses masses, ses sphères et ses jetons.
chemin_piece = f'{ROOT}/rooms/belvedere.json'
if os.path.exists(chemin_piece):
    piece = json.load(open(chemin_piece))
    conserves = [i for i in piece.get('works', [])
                 if not i.startswith(PREFIXES) and i not in ids]
    piece['works'] = ids + conserves
    piece['bascules'] = bascules
    piece['jetons'] = [[round(v * K, 2) for v in j] for j in room['jetons']]
else:
    piece = dict(room)
    piece['spawn'] = [round(v * K, 2) for v in room['spawn']]
    piece['jetons'] = [[round(v * K, 2) for v in j] for j in room['jetons']]
    piece['floor'] = {**room['floor'], 'size': SIZE * K}
    piece['shell'] = {**room['shell'], 'width': SIZE * K, 'depth': SIZE * K, 'height': SIZE * K}
    for p in piece['portals']:
        p['position'] = [round(v * K, 2) for v in p['position']]
with open(chemin_piece, 'w') as f:
    json.dump(piece, f, ensure_ascii=False, indent=2)
    f.write('\n')

idx = [n for n in json.load(open(f'{ROOT}/works/index.json'))
       if not n.startswith(PREFIXES) or n[:-5] in ids]
for w in works + oeuvres_faces:
    n = f"{w['id']}.json"
    if n not in idx:
        idx.append(n)
json.dump(idx, open(f'{ROOT}/works/index.json', 'w'), ensure_ascii=False, indent=2)
open(f'{ROOT}/works/index.json', 'a').write('\n')

# les six chambres Face + leur registre de pièces — jamais réécrites si
# elles existent (leurs lumières ont été réglées à la main)
for c in chambres:
    chemin = f"{ROOT}/rooms/{c['id']}.json"
    if os.path.exists(chemin):
        continue
    with open(chemin, 'w') as f:
        json.dump(c, f, ensure_ascii=False, indent=2)
        f.write('\n')
ridx = json.load(open(f'{ROOT}/rooms/index.json'))
for c in chambres:
    n = f"{c['id']}.json"
    if n not in ridx:
        ridx.append(n)
json.dump(ridx, open(f'{ROOT}/rooms/index.json', 'w'), ensure_ascii=False, indent=2)
open(f'{ROOT}/rooms/index.json', 'a').write('\n')

print(f'{len(works)} objets — cube {SIZE:.0f} m de dessin, {SIZE * K:.0f} m livrés, '
      f'6 plans, {len(bascules)} bascules, {len(chambres)} chambres Face')
for b in bascules:
    sens = ' / '.join(f"{t['depuis']}→{t['vers']}" for t in b['transferts'])
    print(f"  sphère {b['label']:22s} {b['position']}  [{sens}]")
print('assertions géométriques : OK')

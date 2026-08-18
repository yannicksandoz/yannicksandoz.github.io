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
"""
import json, math, os

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', 'content'))

SIZE = 50.0          # cube : largeur = profondeur = hauteur (80 au départ,
                     # resserré à 50 — mêmes plans, volées plus courtes)
WALL_T = 0.35        # épaisseur des murs (RoomManager)
HALF = SIZE / 2

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

def stair(id_, plane, start, end_h, lane, heading, color, base=0.0, walkable=True):
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
        'model': {'type': 'voxel', 'dims': dims, 'cell': CELL,
                  'palette': [color], 'cells': cells},
        'lightIntensity': 0
    }
    add(w)
    # sommet, dans le monde du plan : le bord haut de la dernière marche
    if heading[0] == 'x':
        top = [start + sign * run_len, base + end_h, lane]
    else:
        top = [lane, base + end_h, start + sign * run_len]
    return w, top

def slab(id_, plane, centre, size, color, walkable=True):
    """Palier : dalle épaisse, foulable — les repos de « Relativity »."""
    nx, nz = int(size[0] / CELL), int(size[1] / CELL)
    ny = 2                                     # 1 m d'épaisseur
    dims = [nx, ny, nz]
    cells = [nx * ny * nz, 1]                  # plein
    # base à y = 0 de l'objet : on descend d'une épaisseur pour que la face
    # supérieure du palier affleure la hauteur demandée. LIFT : six
    # centimètres de plus, car une dalle posée EXACTEMENT au niveau du sol
    # présente deux faces coplanaires — le GPU ne sait pas laquelle est
    # devant et le pied de l'escalier se met à grésiller.
    LIFT = 0.06
    c = [centre[0], centre[1] - ny * CELL + LIFT, centre[2]]
    add({
        'id': id_, 'title': 'Palier', 'description': '',
        'position': [round(v, 3) for v in to_local(plane, c)],
        'rotation': local_rot(plane, I3),
        'scale': [1, 1, 1], 'modules': [], 'role': 'decor',
        'walkable': walkable, 'loadDistance': 240,
        'model': {'type': 'voxel', 'dims': dims, 'cell': CELL,
                  'palette': [color], 'cells': cells},
        'lightIntensity': 0
    })

def walkway(id_, plane, a, b, width, top_h, color, walkable=True):
    """Passerelle : une dalle qui RELIE — le sommet d'une volée au mur,
    dans le monde du plan. `a` et `b` sont les deux bouts (x, z), la face
    supérieure affleure `top_h`."""
    cx, cz = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
    lx = max(abs(b[0] - a[0]), width)
    lz = max(abs(b[1] - a[1]), width)
    slab(id_, plane, [cx, top_h, cz], (lx, lz), color, walkable=walkable)

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
    bascules.append({
        'position': [round(v, 2) for v in local],
        'rotation': local_rot(plane_from, I3),
        'radius': 2.2,
        'plane': to_plane,
        'arrival': [round(arr[0], 2), round(arr[1] + 2.2, 2), round(arr[2], 2)],
        'label': label,
        '_pose': plane_from
    })
    if retour:
        r_local = to_local(to_plane, [arr[0], RING_Y, arr[2]])
        bascules.append({
            'position': [round(v, 2) for v in r_local],
            'rotation': local_rot(to_plane, I3),
            'radius': 2.2,
            'plane': plane_from,
            'arrival': [round(top_world[0], 2), round(top_world[1] + 2.2, 2),
                        round(top_world[2], 2)],
            'label': retour,
            '_pose': to_plane
        })
    return local, arr

# À 50 m, les volées principales font 8 m de haut (16 m de course) : le
# pied se pose à INNER − course − 0,3 pour que la crête touche le mur.
H_MAIN = 8.0
RUN = 2 * H_MAIN
PIED = round(INNER - RUN - 0.3, 2)        # ≈ 8,5 : départ des volées murales

# ── plan SOL : on monte vers l'est ────────────────────────────────────────
S1_LANE, S1_H = 6.0, H_MAIN
s1, top1 = stair('escalier-r1', 'sol', PIED, S1_H, S1_LANE, 'x+', '#5b5478')
# Vue du plan est, la volée S1 se couche en falaise le long du nouveau sol :
# le point de chute se décale au-delà de sa crête, sinon on atterrit dedans.
loc1, arr1 = bascule('sol', [top1[0] - 1.2, S1_H, S1_LANE], 'est', 'Mur est',
                     retour='Retour au sol', decalage=(2.5, 0))
slab('palier-r1', 'sol', [PIED - 3, 0.0, S1_LANE], (6.0, 6.0), '#4c4668')

# ── plan EST : le sol est le mur est ; on monte vers le nord ──────────────
# après la bascule on arrive vers (x ≈ hauteur atteinte, z = voie)
S2_LANE = round(arr1[0], 2)
S2_H = H_MAIN
s2, top2 = stair('escalier-r2', 'est', -PIED, S2_H, S2_LANE, 'z-', '#3f5c4e')
# le sommet de S2 aboutit contre le flanc de sa propre volée, vue du plan
# nord : on pose le pied trois mètres et demi à côté, au ras de S3
loc2, arr2 = bascule('est', [S2_LANE, S2_H, top2[2] + 1.2], 'nord', 'Mur nord',
                     retour='Retour au mur est', decalage=(-3.5, 0))
slab('palier-r2', 'est', [S2_LANE, 0.0, -(PIED - 2.8)], (6.0, 6.0), '#365042')

# ── plan NORD : le sol est le mur nord ; on remonte vers le sol d'origine ──
# 6 m de côté : la volée du plan nord passe à côté de la rampe du plan
# est au lieu de la traverser (les deux murs se rejoignent ici).
S3_LANE = round(arr2[0], 2) - 6
# Volée courte : son pied tombe à côté du point de chute, six mètres sur la
# gauche — on atterrit sur une arête, on fait un pas de côté, on repart.
S3_H = 4.0
s3, top3 = stair('escalier-r3', 'nord', -8.5, S3_H, S3_LANE, 'z+', '#6a4a54')
# de retour sur le sol d'origine, la volée S3 surplombe le point de chute
# comme un auvent : trois mètres vers le centre et l'on retrouve le ciel
loc3, arr3 = bascule('nord', [S3_LANE, S3_H, top3[2] - 1.2], 'sol', 'Sol',
                     retour='Retour au mur nord', decalage=(0, 3))
slab('palier-r3', 'nord', [S3_LANE, 0.0, -11.5], (6.0, 6.0), '#5c4048')

# Repères des trois nouveaux plans, PROUVÉS par les matrices (et non
# devinés) : le monde du plan ouest s'étend en x ∈ [-SIZE, 0] (0 = sol
# réel, -SIZE = plafond réel) ; celui du plan sud en z ∈ [0, SIZE] ; celui
# du plafond en x, z ∈ [-HALF, HALF] comme le sol.
PIED_HAUT = round(SIZE - 0.5 - RUN, 2)    # départ des volées vers le plafond

# ── plan OUEST : une volée du sol y mène, et l'on en revient ─────────────
S7_LANE, S7_H = -2.0, H_MAIN
s7, top7 = stair('escalier-r7', 'sol', -PIED, S7_H, S7_LANE, 'x-', '#5c4a44')
loc7, arr7 = bascule('sol', [top7[0] + 1.2, S7_H, S7_LANE], 'ouest', 'Mur ouest',
                     retour='Retour au sol (ouest)', decalage=(-2.5, 0))
slab('palier-r7', 'sol', [-(PIED - 3), 0.0, S7_LANE], (6.0, 6.0), '#4c3e3a')

# ── plan SUD : même chose, plein sud ─────────────────────────────────────
S8_LANE, S8_H = -12.0, H_MAIN
s8, top8 = stair('escalier-r8', 'sol', PIED, S8_H, S8_LANE, 'z+', '#44584a')
loc8, arr8 = bascule('sol', [S8_LANE, S8_H, top8[2] - 1.2], 'sud', 'Mur sud',
                     retour='Retour au sol (sud)', decalage=(0, 2.5))
slab('palier-r8', 'sol', [S8_LANE, 0.0, PIED - 3], (6.0, 6.0), '#3a4c40')

# ── PLAFOND : on y grimpe depuis le plan ouest ───────────────────────────
# (dans le monde du plan ouest, le plafond réel est le mur à x = -SIZE)
S9_LANE, S9_H = 6.0, H_MAIN
s9, top9 = stair('escalier-r9', 'ouest', -PIED_HAUT, S9_H, S9_LANE, 'x-', '#4a4a66')
loc9, arr9 = bascule('ouest', [top9[0] + 1.2, S9_H, S9_LANE], 'plafond', 'Plafond',
                     retour='Retour au mur ouest', decalage=(2.5, 0))
slab('palier-r9', 'ouest', [-(PIED_HAUT - 3), 0.0, S9_LANE], (6.0, 6.0), '#3e3e56')

# ── LE LABYRINTHE : le graphe complet du cube ────────────────────────────
# Un cube a douze paires de faces adjacentes. Les six volées ci-dessus n'en
# relient que six : les six autres arêtes manquaient, et le belvédère se
# parcourait comme une boucle, pas comme un labyrinthe. Chaque paire reçoit
# sa volée + sa bascule aller-retour : de n'importe quel plan, QUATRE
# passages partent vers les quatre plans voisins.
#
# Décalages d'arrivée : vue du plan cible, la volée qui vient de la toucher
# est une falaise contre le mur partagé — le point de chute est poussé de
# 2,5 m au-delà de sa crête (vérifié par enseveli(), pas à l'œil).

# est → sud (la volée grimpe plein sud sur le mur est)
S10_LANE, S10_H = 12.0, H_MAIN
s10, top10 = stair('escalier-r10', 'est', PIED, S10_H, S10_LANE, 'z+', '#3f6a54')
bascule('est', [S10_LANE, S10_H, top10[2] - 1.2], 'sud', 'Mur sud',
        retour="Retour au mur est", decalage=(-2.5, 0))
slab('palier-r10', 'est', [S10_LANE, 0.0, PIED - 3], (6.0, 6.0), '#365c48')

# nord → ouest
S11_LANE, S11_H = -12.0, H_MAIN
s11, top11 = stair('escalier-r11', 'nord', -PIED, S11_H, S11_LANE, 'x-', '#6a5444')
bascule('nord', [top11[0] + 1.2, S11_H, S11_LANE], 'ouest', 'Mur ouest',
        retour='Retour au mur nord', decalage=(0, 2.5))
slab('palier-r11', 'nord', [-(PIED - 3), 0.0, S11_LANE], (6.0, 6.0), '#5c4838')

# sud → plafond (dans le monde du plan sud, le plafond réel est à z = +SIZE)
S12_LANE, S12_H = 5.0, H_MAIN
s12, top12 = stair('escalier-r12', 'sud', PIED_HAUT, S12_H, S12_LANE, 'z+', '#585444')
bascule('sud', [S12_LANE, S12_H, top12[2] - 1.2], 'plafond', 'Plafond',
        retour='Retour au mur sud', decalage=(0, 2.5))
slab('palier-r12', 'sud', [S12_LANE, 0.0, PIED_HAUT - 3], (6.0, 6.0), '#4a4838')

# nord → plafond (le plafond réel est à z = -SIZE du monde du plan nord)
S13_LANE, S13_H = -5.0, H_MAIN
s13, top13 = stair('escalier-r13', 'nord', -PIED_HAUT, S13_H, S13_LANE, 'z-', '#4a5a6a')
bascule('nord', [S13_LANE, S13_H, top13[2] + 1.2], 'plafond', 'Plafond',
        retour='Retour au mur nord', decalage=(0, -2.5))
slab('palier-r13', 'nord', [S13_LANE, 0.0, -(PIED_HAUT - 3)], (6.0, 6.0), '#3e4c5a')

# sud → ouest
S14_LANE, S14_H = 19.0, H_MAIN
s14, top14 = stair('escalier-r14', 'sud', -PIED, S14_H, S14_LANE, 'x-', '#5a4a62')
bascule('sud', [top14[0] + 1.2, S14_H, S14_LANE], 'ouest', 'Mur ouest',
        retour='Retour au mur sud', decalage=(0, -2.5))
slab('palier-r14', 'sud', [-(PIED - 3), 0.0, S14_LANE], (6.0, 6.0), '#4c3e54')

# est → plafond (le plafond réel est à x = +SIZE du monde du plan est)
S15_LANE, S15_H = -15.0, H_MAIN
s15, top15 = stair('escalier-r15', 'est', PIED_HAUT, S15_H, S15_LANE, 'x+', '#44606a')
bascule('est', [top15[0] - 1.2, S15_H, S15_LANE], 'plafond', 'Plafond',
        retour='Retour au mur est', decalage=(-2.5, 0))
slab('palier-r15', 'est', [PIED_HAUT - 3, 0.0, S15_LANE], (6.0, 6.0), '#38525c')

# ── volées d'agrément : la densité de la gravure — RATTACHÉES au mur par
#    des passerelles (une volée qui finit dans le vide est une erreur, pas
#    un mystère) ─────────────────────────────────────────────────────────
# À 50 m : volées de 7 m (14 m de course), crête vers ±14,5 — le palier la
# touche (centre à crête ± 3,5), la passerelle court du palier au mur.
stair('escalier-r4', 'sol', -0.5, 7.0, -10.0, 'x-', '#4a4468')
stair('escalier-r5', 'est', 0.5, 7.0, 19.0, 'z+', '#3a5058')
stair('escalier-r6', 'nord', -2.0, 6.0, -4.0, 'x-', '#584464')
# les paliers TOUCHENT la crête de leur volée : un interstice de 30 cm
# est un piège à visiteur, pas un détail
stair('escalier-r16', 'ouest', 0.5, 7.0, -12.0, 'z+', '#564639')
stair('escalier-r17', 'plafond', 0.5, 7.0, -6.0, 'x+', '#514266')
stair('escalier-r18', 'sud', 0.5, 7.0, 28.0, 'x+', '#3d5a50')
slab('palier-r4', 'sol', [-18.0, 7.0, -10.0], (7.0, 7.0), '#443e5c')
slab('palier-r5', 'est', [19.0, 7.0, 18.0], (7.0, 7.0), '#33474e')
slab('palier-r16', 'ouest', [-12.0, 7.0, 18.0], (7.0, 7.0), '#4a3c30')
slab('palier-r17', 'plafond', [18.0, 7.0, -6.0], (7.0, 7.0), '#453858')
slab('palier-r18', 'sud', [18.0, 7.0, 28.0], (7.0, 7.0), '#344e44')
walkway('passerelle-r4', 'sol', (-21.5, -10.0), (-24.5, -10.0), 3.0, 7.0, '#3e3852')
walkway('passerelle-r5', 'est', (19.0, 21.5), (19.0, 24.5), 3.0, 7.0, '#2e4046')
walkway('passerelle-r6', 'nord', (-14.0, -4.0), (-24.5, -4.0), 3.0, 6.0, '#4e3c58')
walkway('passerelle-r16', 'ouest', (-12.0, 21.5), (-12.0, 24.5), 3.0, 7.0, '#40342a')
walkway('passerelle-r17', 'plafond', (21.5, -6.0), (24.5, -6.0), 3.0, 7.0, '#3b3050')
walkway('passerelle-r18', 'sud', (21.5, 28.0), (24.5, 28.0), 3.0, 7.0, '#2c443c')

# ── mobilier : lanternes sur chaque plan, piliers d'angle ────────────────
# Budget de lumières : quatre lanternes éclairent « pour rien » (plafond
# loin de tout, secondes lanternes d'une face) — intensité 0, halo gardé.
lantern('lanterne-bel-sol-1', 'sol', [7.5, 0, 2.5])
lantern('lanterne-bel-sol-2', 'sol', [-12.5, 0, 7.5])
lantern('lanterne-bel-sol-3', 'sol', [2.5, 0, -14.0])
lantern('lanterne-bel-est-1', 'est', [S2_LANE + 5, 0, -2.5], intensity=3.2)
lantern('lanterne-bel-est-2', 'est', [7.5, 0, 11.0], intensity=0.0)
lantern('lanterne-bel-nord-1', 'nord', [S3_LANE - 5, 0, -9.0], intensity=3.2)
lantern('lanterne-bel-nord-2', 'nord', [-9.0, 0, -16.0], intensity=0.0)
# chaque gravité habitée a sa lumière posée au sol — sans elle, un plan se
# lit comme un mur, pas comme un pays
lantern('lanterne-bel-ouest-1', 'ouest', [-19.0, 0, -7.5])
lantern('lanterne-bel-sud-1', 'sud', [11.0, 0, 5.0])
lantern('lanterne-bel-plafond-1', 'plafond', [7.5, 0, 9.0], intensity=0.0)
lantern('lanterne-bel-plafond-2', 'plafond', [-16.0, 0, 5.0], intensity=0.0)
pillar('pilier-bel-1', 'sol', [-19.0, 0, -19.0], 10.0)
pillar('pilier-bel-2', 'sol', [19.0, 0, -19.0], 10.0)
pillar('pilier-bel-3', 'est', [16.0, 0, 21.0], 9.0)
pillar('pilier-bel-4', 'ouest', [-41.0, 0, -17.5], 8.0)
pillar('pilier-bel-5', 'sud', [-8.0, 0, 41.0], 8.0)

prop('banc-belvedere', 'Banc', 'est', [S2_LANE + 3, 0, 2.5],
     {'type': 'gltf', 'url': 'library/models/banc.glb',
      'fit': 1.8, 'source': 'library'}, rot_y=30)
works[-1]['credit'] = {'author': 'Galerie', 'license': 'CC0-1.0',
                       'sourceUrl': 'https://github.com/yannicksandoz/yannicksandoz.github.io'}

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

ambiance('faisceau-bel-1',
         {'shape': 'faisceau', 'size': 6.0, 'color': '#cbb4ff', 'emissive': 0.5},
         (0.0, 21.0, -4.0), rot=(0.30, 0.0, 0.30))
ambiance('faisceau-bel-2',
         {'shape': 'faisceau', 'size': 5.0, 'color': '#cbb4ff', 'emissive': 0.45},
         (14.0, 19.0, -6.0), rot=(0.30, 0.0, 0.30))
ambiance('faisceau-bel-3',
         {'shape': 'faisceau', 'size': 4.5, 'color': '#e0c4ff', 'emissive': 0.42},
         (-10.0, 19.0, 9.0), rot=(0.30, 0.0, 0.30))
ambiance('lucioles-bel-1',
         {'shape': 'lucioles', 'size': 16.0, 'count': 40, 'seed': 11,
          'color': '#ffd97a', 'emissive': 1.1, 'dotSize': 0.24},
         (0.0, 8.0, 0.0))
ambiance('lucioles-bel-2',
         {'shape': 'lucioles', 'size': 11.0, 'count': 24, 'seed': 23,
          'color': '#ffd97a', 'emissive': 0.95, 'dotSize': 0.2},
         (-2.5, 3.5, -7.5))

# --------------------------------------------------------------- pièce ----
room = {
    'id': 'belvedere', 'title': 'Belvédère',
    'spawn': [0, 2.2, 19],
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
    'jetons': [[19.0, 1.0, -5.0], [-16.0, 1.0, 16.0]],
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

# ------------------------------------------------------------- contrôles --
def near(a, b, tol, what):
    assert abs(a - b) <= tol, f'{what} : {a:.2f} ≠ {b:.2f} (±{tol})'

# chaque escalier de parcours touche-t-il le mur qui deviendra son sol ?
near(top1[0], INNER, 1.5, 'S1 atteint le mur est')
near(top2[2], -INNER, 1.5, 'S2 atteint le mur nord (repère du plan est)')
near(top3[2], -0.5, 1.5, "S3 atteint le sol d'origine (repère du plan nord)")
near(top7[0], -INNER, 1.5, 'S7 atteint le mur ouest')
near(top8[2], INNER, 1.5, 'S8 atteint le mur sud')
near(top9[0], -SIZE + 0.5, 1.5, 'S9 atteint le plafond (repère du plan ouest)')
near(top10[2], INNER, 1.5, 'S10 atteint le mur sud (repère du plan est)')
near(top11[0], -INNER, 1.5, 'S11 atteint le mur ouest (repère du plan nord)')
near(top12[2], SIZE - 0.5, 1.5, 'S12 atteint le plafond (repère du plan sud)')
near(top13[2], -SIZE + 0.5, 1.5, 'S13 atteint le plafond (repère du plan nord)')
near(top14[0], -INNER, 1.5, 'S14 atteint le mur ouest (repère du plan sud)')
near(top15[0], SIZE - 0.5, 1.5, 'S15 atteint le plafond (repère du plan est)')

# chaque arrivée tombe-t-elle juste au-dessus du nouveau sol (y ≈ 2,2 + marge) ?
for b in bascules:
    y = b['arrival'][1] - 2.2
    assert -0.2 <= y <= 12.5, (
        f"{b['label']} : arrivée à {y:.2f} m du sol (hors plage)")

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
for i in range(len(masses)):
    for j in range(i + 1, len(masses)):
        (na, (loa, hia)), (nb, (lob, hib)) = masses[i], masses[j]
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
    pieds = [b['arrival'][0], b['arrival'][1] - 2.2, b['arrival'][2]]
    dedans = enseveli(b['plane'], pieds)
    assert not dedans, f"arrivée « {b['label']} » ensevelie dans {dedans}"
    # l'anneau se juge depuis le plan d'où on le prend : celui sur lequel
    # il est posé à plat — c'est le plan de DÉPART, pas celui de la cible
    plan_pose = b.get('_pose', 'sol')
    dedans = enseveli(plan_pose, to_world(plan_pose, b['position']))
    assert not dedans, f"anneau « {b['label']} » enseveli dans {dedans}"

# identifiants uniques
ids = [w['id'] for w in works]
assert len(ids) == len(set(ids)), 'identifiants dupliqués'

# ------------------------------------------------------------- écriture ---
import os
for f in os.listdir(f'{ROOT}/works'):
    # préfixes RÉSERVÉS au belvédère : « escalier-couloir » appartient au
    # couloir des fenêtres et ne doit surtout pas être emporté
    if f.startswith(('escalier-r', 'palier-r', 'passerelle-r', 'lanterne-bel',
                     'pilier-bel', 'stele-belvedere', 'lanterne-belvedere',
                     'banc-belvedere', 'faisceau-bel', 'lucioles-bel')):
        os.remove(f'{ROOT}/works/{f}')

for w in works:
    with open(f"{ROOT}/works/{w['id']}.json", 'w') as f:
        json.dump(w, f, ensure_ascii=False, indent=2)
        f.write('\n')

for b in bascules:
    b.pop('_pose', None)

with open(f'{ROOT}/rooms/belvedere.json', 'w') as f:
    json.dump(room, f, ensure_ascii=False, indent=2)
    f.write('\n')

idx = [n for n in json.load(open(f'{ROOT}/works/index.json'))
       if not n.startswith(('escalier-r', 'palier-r', 'passerelle-r',
                            'lanterne-bel', 'pilier-bel',
                            'stele-belvedere', 'lanterne-belvedere',
                            'banc-belvedere', 'faisceau-bel', 'lucioles-bel'))]
for w in works:
    n = f"{w['id']}.json"
    if n not in idx:
        idx.append(n)
json.dump(idx, open(f'{ROOT}/works/index.json', 'w'), ensure_ascii=False, indent=2)
open(f'{ROOT}/works/index.json', 'a').write('\n')

print(f'{len(works)} objets — cube {SIZE:.0f} m, 6 plans, {len(bascules)} bascules')
for b in bascules:
    print(f"  {b['label']:18s} → plan {b['plane']:5s} anneau local {b['position']}"
          f" → arrivée {b['arrival']}")
print('assertions géométriques : OK')

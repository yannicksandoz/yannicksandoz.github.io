#!/usr/bin/env python3
"""Pochoir à cappuccino MUZOO : les deux yeux (O) du logo, découpés dans un disque.

Usage :
    python3 pochoir_muzoo.py [muzoo-logo.svg | muzoo-logo.stl]

La source peut être le SVG officiel ou le logo 3D (STL) : les contours des O
sont alors repris de la coupe du STL. Sans argument, le SVG officiel est téléchargé depuis muzoo.ch.
Sorties (à côté du script) : pochoir-muzoo.stl, pochoir-muzoo.png
Réglé pour du PETG, buse 0,4 mm, couches de 0,16 mm.
"""
import math
import sys
import tempfile
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

import manifold3d as m3d
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import trimesh
from matplotlib.patches import PathPatch
from matplotlib.path import Path as MplPath
from shapely import affinity
from shapely.geometry import LineString, Point, Polygon, box
from shapely.ops import unary_union
from svgpathtools import parse_path

SVG_URL = "https://muzoo.ch/wp-content/uploads/2021/06/muzoo-logo.svg"
OUT_DIR = Path(__file__).resolve().parent

# --- Paramètres (mm) ---------------------------------------------------------
DISC_D = 95.0          # diamètre du disque
# Impression prévue : PETG, buse 0,4 mm, couches de 0,16 mm.
NOZZLE = 0.4
LAYER_H = 0.16
THICK = 12 * LAYER_H   # 1,92 mm : 12 couches entières
CHAMFER = 3 * LAYER_H  # 0,48 mm à 45° sur les arêtes extérieures, dessus et dessous
EYES_W = 60.0          # largeur totale des deux yeux
TAB_L = 25.0 * 2.5     # manche : dépassement radial (62,5 mm)
TAB_W = 15.0           # largeur du manche au départ du disque
TAB_END_W = 20.0       # largeur au bout
TAB_CORNER_R = 4.0     # rayon des coins du bout du manche
TAB_FILLET = 5.0       # congés de raccord manche/disque
MIN_SOLID = 0.9        # largeur minimale de toute zone pleine : 2 lignes de buse
MIN_GAP = 1.5          # distance minimale entre deux ouvertures distinctes
BRIDGE_W = 0.9         # largeur de l'attache de chaque îlot
BRIDGE_DEG = 225.0     # sud-ouest : diamétralement opposée à la pupille, radiale
BRIDGE_FILLET = 0.3    # arrondi en plan aux deux jonctions de l'attache
GAZE_DEG = 45.0        # direction du regard : nord-est
SEG = 96               # points par courbe de Bézier / quart de cercle


# --- 1. Extraction des deux O du SVG ----------------------------------------
def load_eyes(svg_path):
    """Retourne [(anneau_ext, trou_int, centre_pupille, r_pupille), ...] en unités SVG, y vers le haut."""
    root = ET.parse(svg_path).getroot()
    ns = "{http://www.w3.org/2000/svg}"
    circles = [(float(c.get("cx")), float(c.get("cy")), float(c.get("r")))
               for c in root.iter(ns + "circle")]
    rings = []
    for p in root.iter(ns + "path"):
        subs = parse_path(p.get("d")).continuous_subpaths()
        polys = []
        for sp in subs:
            pts = [seg.point(t) for seg in sp for t in np.linspace(0, 1, SEG, endpoint=False)]
            polys.append(Polygon([(z.real, -z.imag) for z in pts]))
        if len(polys) != 2:
            continue  # M, U, Z : ignorés (un seul contour, ou groupe de lettres)
        outer, inner = sorted(polys, key=lambda g: -g.area)
        if outer.contains(inner):
            rings.append((outer, inner))
    eyes = []
    for outer, inner in rings:
        for cx, cy, r in circles:
            if inner.contains(Point(cx, -cy)):
                eyes.append((outer, inner, (cx, -cy), r))
    assert len(eyes) == 2, f"attendu 2 yeux, trouvé {len(eyes)}"
    return sorted(eyes, key=lambda e: e[2][0])


def load_eyes_stl(stl_path):
    """Même sortie que load_eyes, à partir du logo 3D (coupe à mi-épaisseur).
    Dans le STL les deux O sont déjà fusionnés : le contour extérieur est commun aux deux yeux."""
    m = trimesh.load_mesh(stl_path)
    man = m3d.Manifold(m3d.Mesh(vert_properties=np.asarray(m.vertices, dtype=np.float32),
                                tri_verts=np.asarray(m.faces, dtype=np.uint32)))
    zmid = float(m.bounds[:, 2].mean())
    rings = [Polygon(r) for r in man.slice(zmid).to_polygons()]
    solids = [g for g in rings if g.exterior.is_ccw]
    holes = [g for g in rings if not g.exterior.is_ccw]
    eyes = []
    for outer in solids:
        inside = [h for h in holes if outer.contains(h)]
        if len(inside) != 2:
            continue  # M, U, Z et pupilles : ignorés
        for inner in inside:
            pup = next(g for g in solids if inner.contains(g))
            x0, y0, x1, y1 = pup.bounds
            eyes.append((outer, inner, ((x0 + x1) / 2, (y0 + y1) / 2), (x1 - x0 + y1 - y0) / 4))
    assert len(eyes) == 2, f"attendu 2 yeux, trouvé {len(eyes)}"
    return sorted(eyes, key=lambda e: e[2][0])


def logo_eyes_mm(eyes):
    """Les yeux du logo, non modifiés, à l'échelle et à la position du pochoir."""
    s = EYES_W / (eyes[1][0].bounds[2] - eyes[0][0].bounds[0])
    ring = unary_union([e[0] for e in eyes]).difference(unary_union([e[1] for e in eyes]))
    x0, y0, x1, y1 = ring.bounds
    g = unary_union([ring] + [Point(e[2]).buffer(e[3], quad_segs=SEG) for e in eyes])
    return affinity.scale(affinity.translate(g, -(x0 + x1) / 2, -(y0 + y1) / 2), s, s, origin=(0, 0))


def describe(eyes, s):
    if eyes[0][0].equals(eyes[1][0]):  # source STL : contour extérieur commun
        i, r = eyes[0][1], eyes[0][3]
        ob, ib = eyes[0][0].bounds, i.bounds
        print("Proportions du logo 3D (unités STL -> mm pochoir, échelle %.5f)" % s)
        for name, a in (("Largeur totale des yeux", ob[2] - ob[0]), ("Hauteur des yeux", ob[3] - ob[1]),
                        ("O intérieur, largeur", ib[2] - ib[0]), ("O intérieur, hauteur", ib[3] - ib[1]),
                        ("Épaisseur anneau (horiz.)", ib[0] - ob[0]), ("Diamètre pupille", 2 * r),
                        ("Entraxe des deux O", eyes[1][2][0] - eyes[0][2][0])):
            print(f"  {name:36s} {a:7.2f} -> {a * s:6.2f} mm")
        return
    o, i, c, r = eyes[0]
    ox0, oy0, ox1, oy1 = o.bounds
    ix0, iy0, ix1, iy1 = i.bounds
    sep = eyes[1][2][0] - eyes[0][2][0]
    total = eyes[1][0].bounds[2] - ox0
    rows = [
        ("O extérieur (l × h)", ox1 - ox0, oy1 - oy0),
        ("O intérieur (l × h)", ix1 - ix0, iy1 - iy0),
        ("Épaisseur anneau (horiz. / vert.)", ix0 - ox0, iy0 - oy0),
        ("Diamètre pupille", 2 * r, None),
        ("Entraxe des deux O", sep, None),
        ("Chevauchement des deux O", (ox1 - ox0) - sep, None),
        ("Largeur totale des yeux", total, None),
    ]
    print("Proportions du logo (unités SVG -> mm, échelle %.5f)" % s)
    for name, a, b in rows:
        if b is None:
            print(f"  {name:36s} {a:7.2f} -> {a * s:6.2f} mm")
        else:
            print(f"  {name:36s} {a:7.2f} × {b:6.2f} -> {a * s:5.2f} × {b * s:5.2f} mm")


# --- 2. Motif modifié --------------------------------------------------------
def tangent_pupil(inner, centre, r):
    """Glisse la pupille à 45° (NE) jusqu'à la tangence intérieure avec l'anneau."""
    ux, uy = math.cos(math.radians(GAZE_DEG)), math.sin(math.radians(GAZE_DEG))
    lo, hi = 0.0, 200.0
    for _ in range(60):
        mid = (lo + hi) / 2
        p = Point(centre[0] + ux * mid, centre[1] + uy * mid)
        if inner.contains(p) and inner.exterior.distance(p) >= r:
            lo = mid
        else:
            hi = mid
    return (centre[0] + ux * lo, centre[1] + uy * lo), lo


def build_openings(eyes):
    """Motif 2D en mm, centré sur l'origine. Retourne (motif sans attaches, infos)."""
    x0 = eyes[0][0].bounds[0]
    x1 = eyes[1][0].bounds[2]
    s = EYES_W / (x1 - x0)
    describe(eyes, s)

    parts, centres, pupils, shifts = [], [], [], []
    for outer, inner, c, r in eyes:
        pc, shift = tangent_pupil(inner, c, r)
        parts.append(Point(pc).buffer(r, quad_segs=SEG))
        centres.append(c)
        pupils.append((pc, r))
        shifts.append(shift)
    rings = unary_union([e[0] for e in eyes]).difference(unary_union([e[1] for e in eyes]))
    motif = unary_union(parts + [rings])
    bx0, by0, bx1, by1 = motif.bounds
    ox, oy = (bx0 + bx1) / 2, (by0 + by1) / 2

    def to_mm(g):
        return affinity.scale(affinity.translate(g, -ox, -oy), s, s, origin=(0, 0))

    motif = to_mm(motif)
    # Fermeture morphologique : comble toute matière plus fine que MIN_SOLID
    # (deux lignes de buse). Elle soude la pupille tangente à l'anneau et émousse
    # les deux pointes de matière entre les O ; le reste du contour est inchangé.
    rr = MIN_SOLID / 2 + 0.005
    motif = motif.buffer(rr, quad_segs=32).buffer(-rr, quad_segs=32)

    # Une attache radiale par œil : sans elle, le croissant de matière à
    # l'intérieur de chaque anneau serait un îlot détaché du disque.
    ux, uy = math.cos(math.radians(BRIDGE_DEG)), math.sin(math.radians(BRIDGE_DEG))
    bridges = []
    for (cx, cy) in centres:
        cmm = to_mm(Point(cx, cy))
        strip = box(4, -BRIDGE_W / 2, 40, BRIDGE_W / 2)  # part du croissant, hors pupille
        strip = affinity.translate(affinity.rotate(strip, BRIDGE_DEG, origin=(0, 0)), cmm.x, cmm.y)
        cut = strip.intersection(motif)
        pieces = list(cut.geoms) if hasattr(cut, "geoms") else [cut]
        piece = min(pieces, key=lambda g: g.distance(cmm))  # la seule traversée de l'anneau
        t = [(x - cmm.x) * ux + (y - cmm.y) * uy for x, y in piece.exterior.coords]
        ends = [(cmm.x + ux * d, cmm.y + uy * d) for d in (min(t), max(t))]
        # déborde de 0,05 mm aux deux bouts pour une coupe franche, largeur inchangée
        bridges.append(dict(shape=strip.intersection(piece.buffer(0.05)), ends=ends))

    info = dict(scale=s, shifts_mm=[d * s for d in shifts], bridges=bridges,
                pupils_mm=[(to_mm(Point(p)), r * s) for p, r in pupils],
                inner_mm=[to_mm(e[1]) for e in eyes], motif=motif)
    return motif, info


# --- 3. Pochoir 2D -> 3D -----------------------------------------------------
def build_body():
    """Contour extérieur : disque + manche évasé à coins arrondis, congés au raccord."""
    R = DISC_D / 2
    disc = Point(0, 0).buffer(R, quad_segs=128)
    r = TAB_CORNER_R
    y1, y2 = -(R + TAB_L - r), -(R + TAB_L)       # fin de l'évasement, bout du manche
    k = (TAB_END_W - TAB_W) / 2 / (-R - y1)       # pente : TAB_W au bord du disque, TAB_END_W en y1
    w0 = TAB_W / 2 - 6 * k                        # prolongé de 6 mm dans le disque pour l'ancrage
    handle = Polygon([(-w0, -R + 6), (w0, -R + 6), (TAB_END_W / 2, y1), (TAB_END_W / 2, y2),
                      (-TAB_END_W / 2, y2), (-TAB_END_W / 2, y1)])
    handle = handle.buffer(-r).buffer(r, quad_segs=32)  # coins de 4 mm (ceux du haut sont noyés dans le disque)
    body = unary_union([disc, handle])
    f = TAB_FILLET
    return body.buffer(f, quad_segs=48).buffer(-f, quad_segs=48).simplify(0.002)


def build_plate(body, motif, info):
    """Plaque 2D : contour − motif + attaches, avec arrondis aux jonctions des attaches."""
    plate = body.difference(motif.difference(unary_union([b["shape"] for b in info["bridges"]])))
    zones = unary_union([Point(e).buffer(BRIDGE_W / 2 + BRIDGE_FILLET + 0.4)
                         for b in info["bridges"] for e in b["ends"]])
    f = BRIDGE_FILLET
    filled = plate.buffer(f, quad_segs=16).buffer(-f, quad_segs=16)  # comble les angles rentrants
    plate = unary_union([plate, filled.intersection(zones)])
    return plate.simplify(0.002)  # retire les micro-segments (tolérance 2 µm)


def inset_ring(xy, d):
    """Décale un contour CCW vers l'intérieur de d, sommet par sommet (même nombre de points)."""
    e_prev = xy - np.roll(xy, 1, axis=0)
    e_next = np.roll(xy, -1, axis=0) - xy
    n_prev = np.c_[-e_prev[:, 1], e_prev[:, 0]] / np.linalg.norm(e_prev, axis=1)[:, None]
    n_next = np.c_[-e_next[:, 1], e_next[:, 0]] / np.linalg.norm(e_next, axis=1)[:, None]
    m = n_prev + n_next
    m /= np.linalg.norm(m, axis=1)[:, None]
    return xy + m * (d / (m * n_prev).sum(axis=1))[:, None]


def build_solid(body, plate):
    """Corps chanfreiné dessus/dessous sur son pourtour, puis ouvertures percées à bords francs."""
    from shapely.geometry.polygon import orient
    full = np.asarray(orient(body, 1.0).exterior.coords)[:-1]
    small = inset_ring(full, CHAMFER)
    assert Polygon(small).is_valid
    n = len(full)
    levels = [(small, 0.0), (full, CHAMFER), (full, THICK - CHAMFER), (small, THICK)]
    verts = np.vstack([np.c_[r, np.full(n, z)] for r, z in levels])
    i = np.arange(n)
    j = (i + 1) % n
    tris = []
    for k in range(3):
        a, b = k * n, (k + 1) * n
        tris += [np.c_[a + i, a + j, b + j], np.c_[a + i, b + j, b + i]]
    cap = np.asarray(m3d.triangulate([small]))
    tris += [cap[:, ::-1], cap + 3 * n]  # dessous (normale vers le bas), dessus
    outer = m3d.Manifold(m3d.Mesh(vert_properties=verts.astype(np.float32),
                                  tri_verts=np.vstack(tris).astype(np.uint32)))
    assert outer.status() == m3d.Error.NoError, outer.status()
    holes = [np.asarray(orient(Polygon(h), 1.0).exterior.coords)[:-1] for h in plate.interiors]
    cutter = m3d.Manifold.extrude(m3d.CrossSection(holes, m3d.FillRule.Positive), THICK + 2).translate((0, 0, -1))
    man = outer - cutter
    mm = man.to_mesh()
    mesh = trimesh.Trimesh(vertices=np.asarray(mm.vert_properties)[:, :3],
                           faces=np.asarray(mm.tri_verts), process=True)
    return mesh, man, Polygon(small)


# --- 4. Mesures --------------------------------------------------------------
def min_web(plate, step=0.05):
    """Épaisseur locale minimale de matière : depuis chaque point des contours
    d'ouverture, rayon lancé dans la matière selon la normale, jusqu'au contour
    suivant. Retourne (largeur min, point)."""
    best, where = 1e9, None
    boundary = plate.boundary
    for hole in plate.interiors:
        ring = LineString(hole.coords)
        n = max(int(ring.length / step), 8)
        for k in range(n):
            d = k * step
            p, q = ring.interpolate(d), ring.interpolate(d + 1e-4)
            tx, ty = q.x - p.x, q.y - p.y
            L = math.hypot(tx, ty)
            if L == 0:
                continue
            for nx, ny in ((-ty / L, tx / L), (ty / L, -tx / L)):
                if not plate.contains(Point(p.x + nx * 1e-3, p.y + ny * 1e-3)):
                    continue
                ray = LineString([(p.x + nx * 1e-3, p.y + ny * 1e-3),
                                  (p.x + nx * best, p.y + ny * best)])
                hit = ray.intersection(boundary)
                if not hit.is_empty:
                    w = hit.distance(Point(p.x, p.y))
                    if w < best:
                        best, where = w, (p.x, p.y)
    return best, where


def bridge_widths(plate, bridge):
    """Largeur de l'attache mesurée sur la plaque finie, perpendiculairement à son axe,
    en 9 points de sa partie droite (hors arrondis de jonction)."""
    (x0, y0), (x1, y1) = bridge["ends"]
    L = math.hypot(x1 - x0, y1 - y0)
    ux, uy = (x1 - x0) / L, (y1 - y0) / L
    m = BRIDGE_FILLET + 0.5
    out = []
    for d in np.linspace(m, L - m, 9):
        cx, cy = x0 + ux * d, y0 + uy * d
        chord = LineString([(cx + uy * 3, cy - ux * 3), (cx - uy * 3, cy + ux * 3)]).intersection(plate)
        segs = list(chord.geoms) if hasattr(chord, "geoms") else [chord]
        out.append(min(segs, key=lambda g: g.distance(Point(cx, cy))).length)
    return min(out), max(out), L


def junction_width(info, k):
    """Largeur de la soudure pupille/anneau : corde du motif le long du contour intérieur d'origine."""
    pc, r = info["pupils_mm"][k]
    near = info["inner_mm"][k].exterior.intersection(pc.buffer(r + 1.5))
    inside = near.intersection(info["motif"].buffer(-0.01))
    return inside.length


# --- 5. Aperçu ---------------------------------------------------------------
def preview(plate, path, top_face=None):
    fig, ax = plt.subplots(figsize=(7, 10.5), dpi=200)
    verts, codes = [], []
    for ring in [plate.exterior, *plate.interiors]:
        xy = np.asarray(ring.coords)
        verts += xy.tolist()
        codes += [MplPath.MOVETO] + [MplPath.LINETO] * (len(xy) - 2) + [MplPath.CLOSEPOLY]
    ax.add_patch(PathPatch(MplPath(verts, codes), facecolor="#6f4e37", edgecolor="#2b1d14", lw=0.8))
    if top_face is not None:  # arête intérieure du chanfrein
        x, y = top_face.exterior.xy
        ax.plot(x, y, color="#2b1d14", lw=0.5)
    R = DISC_D / 2
    ax.annotate("", (-R, R + 4), (R, R + 4), arrowprops=dict(arrowstyle="<->", color="#444"))
    ax.text(0, R + 5, f"Ø {DISC_D:g} mm", ha="center", va="bottom", fontsize=9, color="#444")
    ax.annotate("", (-EYES_W / 2, -22), (EYES_W / 2, -22), arrowprops=dict(arrowstyle="<->", color="#eee"))
    ax.text(0, -24, f"{EYES_W:g} mm", ha="center", va="top", fontsize=9, color="#eee")
    ax.text(TAB_END_W / 2 + 2, -R - TAB_L / 2,
            f"manche {TAB_L:g} mm\n{TAB_W:g} → {TAB_END_W:g} mm de large\ncoins R{TAB_CORNER_R:g}, congés R{TAB_FILLET:g}",
            va="center", fontsize=9, color="#444")
    ax.text(R * 0.72, -R * 0.86, f"chanfrein {CHAMFER:g} mm\ndessus et dessous", fontsize=8, color="#444")
    ax.set_xlim(-R - 6, R + 6)
    ax.set_ylim(-R - TAB_L - 4, R + 12)
    ax.set_aspect("equal")
    ax.axis("off")
    ax.set_title(f"pochoir-muzoo — vue de dessus (épaisseur {THICK:.2f} mm, attaches de {BRIDGE_W:g} mm)", fontsize=10)
    fig.savefig(path, bbox_inches="tight", facecolor="white")
    plt.close(fig)


def main():
    if len(sys.argv) > 1:
        svg = Path(sys.argv[1])
    else:
        svg = Path(tempfile.mkdtemp()) / "muzoo-logo.svg"
        urllib.request.urlretrieve(SVG_URL, svg)
    eyes = load_eyes_stl(svg) if svg.suffix.lower() == ".stl" else load_eyes(svg)
    motif, info = build_openings(eyes)
    body = build_body()
    plate = build_plate(body, motif, info)
    assert plate.geom_type == "Polygon", "le pochoir 2D n'est pas d'un seul tenant"
    mesh, man, top_face = build_solid(body, plate)

    stl = OUT_DIR / "pochoir-muzoo.stl"
    mesh.export(stl)
    preview(plate, OUT_DIR / "pochoir-muzoo.png", top_face=top_face)

    # Vérifications sur le fichier relu
    chk = trimesh.load_mesh(stl)
    bodies = len(chk.split(only_watertight=False))
    solid, solid_at = min_web(plate)
    gaps = [a.distance(b) for i, a in enumerate(plate.interiors) for b in list(plate.interiors)[i + 1:]]
    # Îlots : composantes de la plaque privée de ses attaches, hors corps principal
    loose = body.difference(motif)
    comps = sorted(loose.geoms, key=lambda g: -g.area)
    islands = comps[1:]
    links = [sum(b["shape"].buffer(0.06).intersects(isl) for b in info["bridges"]) for isl in islands]
    ext = chk.extents
    R = DISC_D / 2
    hw = lambda y: LineString([(-40, y), (40, y)]).intersection(body).length / 2
    print("\nVérifications")
    print(f"  watertight            : {chk.is_watertight}")
    print(f"  winding cohérent      : {chk.is_winding_consistent}")
    print(f"  corps                 : {bodies}")
    print(f"  manifold3d status     : {man.status().name}, genus {man.genus()}")
    print(f"  dimensions (x,y,z)    : {ext[0]:.2f} × {ext[1]:.2f} × {ext[2]:.2f} mm")
    print(f"  couches               : {round(THICK / LAYER_H)} × {LAYER_H:g} = {THICK:.2f} mm ; chanfrein {round(CHAMFER / LAYER_H)} × {LAYER_H:g} = {CHAMFER:.2f} mm")
    print(f"  volume                : {chk.volume / 1000:.2f} cm³, {len(chk.faces)} triangles")
    zs = np.unique(np.round(chk.vertices[:, 2], 4))
    print(f"  niveaux z des sommets : {zs.tolist()}")
    top = chk.vertices[np.abs(chk.vertices[:, 2] - THICK) < 1e-4]
    mid = chk.vertices[np.abs(chk.vertices[:, 2] - CHAMFER) < 1e-4]
    print(f"  Ø disque : {2 * np.hypot(mid[:, 0], mid[:, 1])[mid[:, 1] > 0].max():.2f} mm au plus large, "
          f"{2 * np.hypot(top[:, 0], top[:, 1])[top[:, 1] > 0].max():.2f} mm sur les faces")
    print(f"  manche   : dépasse de {-body.bounds[1] - R:.2f} mm, largeur {2 * hw(-R - 30):.2f} mm à mi-longueur, "
          f"{2 * hw(-R - TAB_L + TAB_CORNER_R):.2f} mm au bout ({TAB_W:g} mm nominal au bord du disque, sous les congés)")
    inset_err = top_face.exterior.hausdorff_distance(body.buffer(-CHAMFER).exterior)
    print(f"  chanfrein : retrait {CHAMFER:.2f} mm sur {CHAMFER:.2f} mm de haut (45°), écart au décalage exact {inset_err:.4f} mm")
    ob = motif.bounds
    print(f"  motif (l × h)         : {ob[2] - ob[0]:.2f} × {ob[3] - ob[1]:.2f} mm, "
          f"centre ({(ob[0] + ob[2]) / 2:.2f}, {(ob[1] + ob[3]) / 2:.2f})")
    print(f"  déplacement pupilles  : {info['shifts_mm'][0]:.2f} / {info['shifts_mm'][1]:.2f} mm à {GAZE_DEG:g}°")
    print(f"  soudure pupille/anneau: {junction_width(info, 0):.2f} / {junction_width(info, 1):.2f} mm")
    print(f"  ouvertures            : {len(plate.interiors)}"
          + (f", distance min entre elles {min(gaps):.3f} mm" if gaps else " (une seule : aucune paire à mesurer)"))
    print(f"  îlots                 : {len(islands)}, attaches par îlot : {links}")
    bw = [bridge_widths(plate, b) for b in info["bridges"]]
    for name, (lo, hi, L) in zip(("gauche", "droit"), bw):
        print(f"  attache œil {name:6s}    : largeur {lo:.3f} à {hi:.3f} mm, longueur {L:.2f} mm, à {BRIDGE_DEG:g}°")
    print(f"  largeur min de matière : {solid:.3f} mm en ({solid_at[0]:.1f}, {solid_at[1]:.1f})")
    ref = logo_eyes_mm(eyes)
    zone = unary_union([pc.buffer(r + 2.5) for pc, r in info["pupils_mm"]]
                       + [g.centroid.buffer(info["pupils_mm"][0][1] + 0.5) for g in info["inner_mm"]])
    dev = ref.boundary.difference(zone).hausdorff_distance(motif.boundary.difference(zone))
    print(f"  écart au logo (hors pupilles et attaches) : max {dev:.3f} mm")
    tol = 0.005
    ok = (chk.is_watertight and bodies == 1 and len(islands) == 2 and links == [1, 1]
          and solid >= MIN_SOLID - tol and all(lo >= BRIDGE_W - tol and hi <= BRIDGE_W + tol for lo, hi, _ in bw)
          and (not gaps or min(gaps) >= MIN_GAP)
          and abs(ext[2] - THICK) < 1e-4 and len(zs) == 4)
    print("  =>", "OK" if ok else "ÉCHEC")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

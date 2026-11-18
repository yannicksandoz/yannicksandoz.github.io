#!/usr/bin/env python3
"""Pochoir à cappuccino MUZOO : les deux yeux (O) du logo, découpés dans un disque.

Usage :
    python3 pochoir_muzoo.py [muzoo-logo.svg | muzoo-logo.stl]

La source peut être le SVG officiel ou le logo 3D (STL) : les contours des O
sont alors repris de la coupe du STL. Sans argument, le SVG officiel est téléchargé depuis muzoo.ch.
Sorties (à côté du script) : pochoir-muzoo.stl, pochoir-muzoo.png
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
THICK = 1.0            # épaisseur
EYES_W = 60.0          # largeur totale des deux yeux
TAB_L, TAB_W = 25.0, 15.0   # languette : dépassement radial × largeur
MIN_WEB = 1.5          # largeur minimale de matière entre ouvertures
BRIDGE_W = 2.0         # largeur des ponts qui retiennent l'intérieur des yeux
BRIDGE_ANGLES = (135.0, 315.0)  # perpendiculaires au regard (45°)
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
    """Ouvertures 2D en mm, centrées sur l'origine. Retourne (ouvertures, infos)."""
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
    # Fermeture morphologique : comble toute matière plus fine que MIN_WEB.
    # Elle n'est appliquée qu'autour des pupilles déplacées : c'est elle qui soude
    # la pupille tangente à l'anneau (congé de raccord). Partout ailleurs le
    # contour du logo est conservé tel quel, pointes entre les deux O comprises.
    rr = MIN_WEB / 2 + 0.01
    closed = motif.buffer(rr, quad_segs=32).buffer(-rr, quad_segs=32)
    near_pupils = unary_union([to_mm(Point(p)).buffer(r * s + MIN_WEB + 0.2) for p, r in pupils])
    motif = unary_union([motif, closed.intersection(near_pupils)])

    # Ponts : sans eux, le croissant de matière à l'intérieur de chaque anneau
    # serait un îlot détaché du disque.
    bridges = []
    for (cx, cy) in centres:
        cmm = to_mm(Point(cx, cy))
        for a in BRIDGE_ANGLES:
            strip = box(4, -BRIDGE_W / 2, 40, BRIDGE_W / 2)  # part du croissant, hors pupille
            strip = affinity.rotate(strip, a, origin=(0, 0))
            strip = affinity.translate(strip, cmm.x, cmm.y)
            # ne garder que la traversée de l'anneau (pas la pupille ni l'autre œil)
            cut = strip.intersection(motif)
            pieces = list(cut.geoms) if hasattr(cut, "geoms") else [cut]
            piece = min(pieces, key=lambda g: g.distance(cmm))
            # déborde de 0,05 mm aux deux bouts pour une coupe franche, largeur inchangée
            bridges.append(strip.intersection(piece.buffer(0.05)))
    openings = motif.difference(unary_union(bridges))

    # Pointes vives du logo (jonction des deux O) : sommets à angle marqué du contour extérieur
    xy = np.asarray(motif.exterior.coords)[:-1]
    d1, d2 = xy - np.roll(xy, 1, axis=0), np.roll(xy, -1, axis=0) - xy
    turn = np.degrees(np.abs(np.arctan2(d1[:, 0] * d2[:, 1] - d1[:, 1] * d2[:, 0], (d1 * d2).sum(axis=1))))
    cusps = [tuple(p) for p in xy[turn > 30]]

    info = dict(cusps=cusps, scale=s, shifts_mm=[d * s for d in shifts],
                pupils_mm=[(to_mm(Point(p)), r * s) for p, r in pupils],
                inner_mm=[to_mm(e[1]) for e in eyes], motif=motif)
    return openings, info


# --- 3. Pochoir 2D -> 3D -----------------------------------------------------
def build_plate(openings):
    R = DISC_D / 2
    disc = Point(0, 0).buffer(R, quad_segs=128)
    tab = box(-TAB_W / 2, -(R + TAB_L), TAB_W / 2, -R + 2.0)  # 2 mm d'ancrage dans le disque
    plate = unary_union([disc, tab]).difference(openings)
    return plate.simplify(0.002)  # retire les micro-segments (tolérance 2 µm)


def extrude(plate):
    polys = list(plate.geoms) if hasattr(plate, "geoms") else [plate]
    contours = []
    for p in polys:
        contours.append(np.asarray(p.exterior.coords)[:-1])
        contours += [np.asarray(h.coords)[:-1] for h in p.interiors]
    cs = m3d.CrossSection(contours, m3d.FillRule.EvenOdd)
    man = m3d.Manifold.extrude(cs, THICK)
    mm = man.to_mesh()
    mesh = trimesh.Trimesh(vertices=np.asarray(mm.vert_properties)[:, :3],
                           faces=np.asarray(mm.tri_verts), process=True)
    return mesh, man


# --- 4. Mesures --------------------------------------------------------------
def min_web(plate, skip=(), step=0.05):
    """Épaisseur locale minimale de matière, hors pointes vives `skip` : depuis chaque point des contours
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
            if L == 0 or any(math.hypot(p.x - cx, p.y - cy) < 1.0 for cx, cy in skip):
                continue  # pointe vive du logo : coin de matière pleine, pas une cloison
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


def junction_width(info, k):
    """Largeur de la soudure pupille/anneau : corde du motif le long du contour intérieur d'origine."""
    pc, r = info["pupils_mm"][k]
    near = info["inner_mm"][k].exterior.intersection(pc.buffer(r + 1.5))
    inside = near.intersection(info["motif"].buffer(-0.01))
    return inside.length


# --- 5. Aperçu ---------------------------------------------------------------
def preview(plate, path, ref=None):
    fig, ax = plt.subplots(figsize=(7, 8.4), dpi=200)
    verts, codes = [], []
    for ring in [plate.exterior, *plate.interiors]:
        xy = np.asarray(ring.coords)
        verts += xy.tolist()
        codes += [MplPath.MOVETO] + [MplPath.LINETO] * (len(xy) - 2) + [MplPath.CLOSEPOLY]
    ax.add_patch(PathPatch(MplPath(verts, codes), facecolor="#6f4e37", edgecolor="#2b1d14", lw=0.8))
    if ref is not None:  # contour du logo d'origine, en surimpression
        for g in getattr(ref.boundary, "geoms", [ref.boundary]):
            x, y = g.xy
            ax.plot(x, y, color="#e8452c", lw=0.7, ls=(0, (4, 2)))
        ax.plot([], [], color="#e8452c", lw=0.7, ls=(0, (4, 2)), label="contour du logo d'origine")
        ax.legend(loc="lower left", fontsize=8, frameon=False)
    R = DISC_D / 2
    ax.annotate("", (-R, R + 4), (R, R + 4), arrowprops=dict(arrowstyle="<->", color="#444"))
    ax.text(0, R + 5, f"Ø {DISC_D:g} mm", ha="center", va="bottom", fontsize=9, color="#444")
    ax.annotate("", (-EYES_W / 2, -22), (EYES_W / 2, -22), arrowprops=dict(arrowstyle="<->", color="#eee"))
    ax.text(0, -24, f"{EYES_W:g} mm", ha="center", va="top", fontsize=9, color="#eee")
    ax.text(TAB_W / 2 + 2, -R - TAB_L / 2, f"languette {TAB_L:g} × {TAB_W:g} mm",
            va="center", fontsize=9, color="#444")
    ax.set_xlim(-R - 6, R + 6)
    ax.set_ylim(-R - TAB_L - 4, R + 12)
    ax.set_aspect("equal")
    ax.axis("off")
    ax.set_title("pochoir-muzoo — vue de dessus (épaisseur 1 mm)", fontsize=10)
    fig.savefig(path, bbox_inches="tight", facecolor="white")
    plt.close(fig)


def main():
    if len(sys.argv) > 1:
        svg = Path(sys.argv[1])
    else:
        svg = Path(tempfile.mkdtemp()) / "muzoo-logo.svg"
        urllib.request.urlretrieve(SVG_URL, svg)
    eyes = load_eyes_stl(svg) if svg.suffix.lower() == ".stl" else load_eyes(svg)
    openings, info = build_openings(eyes)
    plate = build_plate(openings)
    assert plate.geom_type == "Polygon", "le pochoir 2D n'est pas d'un seul tenant"
    mesh, man = extrude(plate)

    stl = OUT_DIR / "pochoir-muzoo.stl"
    mesh.export(stl)
    preview(plate, OUT_DIR / "pochoir-muzoo.png", ref=logo_eyes_mm(eyes))

    # Vérifications sur le fichier relu
    chk = trimesh.load_mesh(stl)
    bodies = len(chk.split(only_watertight=False))
    web, where = min_web(plate, skip=info["cusps"])
    gaps = [a.distance(b) for i, a in enumerate(plate.interiors) for b in list(plate.interiors)[i + 1:]]
    ext = chk.extents
    print("\nVérifications")
    print(f"  watertight            : {chk.is_watertight}")
    print(f"  winding cohérent      : {chk.is_winding_consistent}")
    print(f"  corps                 : {bodies}")
    print(f"  manifold3d status     : {man.status().name}, genus {man.genus()}")
    print(f"  dimensions (x,y,z)    : {ext[0]:.2f} × {ext[1]:.2f} × {ext[2]:.2f} mm")
    print(f"  volume                : {chk.volume / 1000:.2f} cm³, {len(chk.faces)} triangles")
    print(f"  ouvertures            : {len(plate.interiors)}")
    ob = openings.bounds
    print(f"  motif (l × h)         : {ob[2] - ob[0]:.2f} × {ob[3] - ob[1]:.2f} mm, "
          f"centre ({(ob[0] + ob[2]) / 2:.2f}, {(ob[1] + ob[3]) / 2:.2f})")
    print(f"  marge motif/bord      : {DISC_D / 2 - max(math.hypot(x, y) for x, y in openings.convex_hull.exterior.coords):.2f} mm")
    print(f"  déplacement pupilles  : {info['shifts_mm'][0]:.2f} / {info['shifts_mm'][1]:.2f} mm à {GAZE_DEG:g}°")
    print(f"  soudure pupille/anneau: {junction_width(info, 0):.2f} / {junction_width(info, 1):.2f} mm")
    print(f"  distance min entre ouvertures distinctes : {min(gaps):.3f} mm")
    print(f"  largeur min de matière (épaisseur locale): {web:.3f} mm en ({where[0]:.1f}, {where[1]:.1f})")
    # Fidélité au logo : écart entre les ouvertures (hors ponts) et les O d'origine,
    # en dehors de la zone des pupilles déplacées.
    ref = logo_eyes_mm(eyes)
    zone = unary_union([pc.buffer(r + 2.5) for pc, r in info["pupils_mm"]]
                       + [Point(e[2]).buffer(e[3] + 0.5) for e in
                          [(None, None, (g.centroid.x, g.centroid.y), info["pupils_mm"][0][1]) for g in info["inner_mm"]]])
    diff = info["motif"].symmetric_difference(ref).difference(zone)
    dev = max((ref.boundary.difference(zone).hausdorff_distance(info["motif"].boundary.difference(zone)), 0))
    print(f"  écart au logo (hors pupilles) : max {dev:.3f} mm, surface {diff.area:.2f} mm² sur {ref.area:.0f} mm²")
    ok = chk.is_watertight and bodies == 1 and web >= MIN_WEB and min(gaps) >= MIN_WEB
    print(f"  pointes vives conservées du logo : {len(info['cusps'])} en "
          + ", ".join(f"({x:.1f}, {y:.1f})" for x, y in info["cusps"]))
    print("  =>", "OK" if ok else "ÉCHEC")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

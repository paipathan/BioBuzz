"""
Turret idler gear (38T, module 1.2, 4 mm thick), re-bored for a tight fit on the goBILDA 8 mm REX shaft.

    cad/.venv/Scripts/python.exe -I cad/turret/gear38.py [--af 7.05]

REX shaft = 7.00 mm across-flats hex with the corners turned down to 8.00 mm diameter (goBILDA's own
REX bores, e.g. the 20T slip-fit gear in the turret CAD, are a 7.00 mm hex).

The original Onshape part (source/gear38_original.step) has a 7.20 mm across-flats hex bore with
corner reliefs. 0.2 mm of clearance lets the gear turn about +/-3.2 deg on the shaft, which is
about +/-1.2 deg (2.4 deg total) at the turret through the 38:100 mesh, before any wear or
oversize printing. Play vs. clearance for a REX-shaped bore (centre fixed, printed to size):

    across flats   7.00   7.05   7.10   7.15   7.20   7.25
    gear  +/-deg   0.00   0.77   1.54   2.34   3.16   4.00
    turret +/-deg  0.00   0.29   0.59   0.89   1.20   1.52

The teeth (zero-backlash involute, ~1 mm tip land) are left exactly as they are. Only the bore
changes:
  * REX-shaped bore: hex AF across flats, corners rounded to AF + 1.0 mm diameter, so the whole
    length of every flat carries load. Default AF 7.05: FDM holes usually print 0.05-0.15 mm
    small, so this ends up a snug or light-press fit. Print the coupon and re-run with --af if
    your printer is different.
  * 0.4 mm 45 deg lead-in chamfer on both faces (shaft entry + elephant's foot)

Outputs (out/), laid flat at Z = 0 and centred on the origin:
  gear38_af7p05.stl / .step   <- print this (the name follows --af)
  bore_coupon.stl             4 mm test plate with REX holes AF 6.95 ... 7.25, engraved with the size
"""
import argparse
from pathlib import Path

from build123d import (
    Align, Box, BuildPart, BuildSketch, Circle, Compound, Cylinder, Locations, Mode, Plane, Pos,
    RegularPolygon, Text, export_step, export_stl, extrude, import_step, insert,
)

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
SRC = HERE / "source" / "gear38_original.step"

THICK = 4.0          # gear thickness (unchanged)
REX_ROUND = 1.0      # REX corner diameter minus across-flats (8.00 - 7.00)
CHAMFER = 0.4        # lead-in chamfer depth at each face
DEFAULT_AF = 7.05
COUPON_AFS = [6.95, 7.00, 7.05, 7.10, 7.15, 7.20, 7.25]


def rex_profile(af: float):
    """REX-shaped hole: hex `af` across flats (flats normal to X, as in the original) with the
    corners rounded off at diameter af + REX_ROUND."""
    with BuildSketch() as sk:
        RegularPolygon(af / 2, 6, major_radius=False, rotation=30)
        Circle((af + REX_ROUND) / 2, mode=Mode.INTERSECT)
    return sk.sketch


def rex_bore(af: float, depth: float, chamfer: float = CHAMFER):
    """Bore cutter, base at Z=0: straight REX profile plus a 45 deg lead-in at each face."""
    with BuildPart() as bp:
        insert(rex_profile(af))
        extrude(amount=depth)
        for z0, d in ((0, 1), (depth, -1)):
            insert(rex_profile(af + 2 * chamfer).moved(Pos(0, 0, z0)))
            extrude(amount=chamfer * d, taper=45)
    return bp.part


def section_size(shape, z: float):
    sec = shape.intersect(Box(60, 60, 0.002).translate((0, 0, z)))
    bb = (Compound(list(sec)) if isinstance(sec, list) else sec).bounding_box()
    return round(bb.size.X, 3), round(bb.size.Y, 3)


def build_gear(af: float):
    g = import_step(str(SRC))
    bb = g.bounding_box()
    c = bb.center()
    g = g.translate((-c.X, -c.Y, -bb.min.Z))  # centre on origin, bottom face on Z=0
    assert abs(g.bounding_box().size.Z - THICK) < 1e-3
    # fill the old bore (its corner reliefs reach r = 5.16) and cut the new one
    g = g + Cylinder(6.0, THICK, align=(Align.CENTER, Align.CENTER, Align.MIN))
    g = g - rex_bore(af, THICK)
    return g


def build_coupon():
    pitch = 14.0
    length = pitch * len(COUPON_AFS) + 4
    plate = Box(length, 22, THICK, align=(Align.CENTER, Align.CENTER, Align.MIN))
    for i, af in enumerate(COUPON_AFS):
        x = -length / 2 + 2 + pitch * (i + 0.5)
        plate = plate - rex_bore(af, THICK).moved(Pos(x, 3, 0))
        with BuildPart() as label:
            with BuildSketch(Plane.XY.offset(THICK)):
                with Locations((x, -7)):
                    Text(f"{af:.2f}", font_size=3.4, align=(Align.CENTER, Align.CENTER))
            extrude(amount=-0.6)
        plate = plate - label.part
    return plate


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--af", type=float, default=DEFAULT_AF)
    a = ap.parse_args()
    OUT.mkdir(exist_ok=True)

    g = build_gear(a.af)
    print("bore (across flats, across corners) at mid-depth:", section_size(rex_bore(a.af, THICK), THICK / 2))
    print("bore at the faces:", section_size(rex_bore(a.af, THICK), 0.001))
    print("gear valid:", g.is_valid, " solids:", len(g.solids()), " bbox:", g.bounding_box().size,
          " volume: %.1f" % g.volume)
    tag = f"af{a.af:.2f}".replace(".", "p")
    export_stl(g, str(OUT / f"gear38_{tag}.stl"), tolerance=0.005, angular_tolerance=0.1)
    export_step(g, str(OUT / f"gear38_{tag}.step"))

    cp = build_coupon()
    print("coupon valid:", cp.is_valid, " solids:", len(cp.solids()), " bbox:", cp.bounding_box().size)
    export_stl(cp, str(OUT / "bore_coupon.stl"), tolerance=0.005, angular_tolerance=0.1)
    print("wrote", OUT)


if __name__ == "__main__":
    main()

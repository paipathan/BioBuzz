"""
Launcher V5 hood v2: a drop-in replacement for the small rectangular hood channel.

    cad/.venv/Scripts/python.exe cad/launcher_v5/hood_v2.py            # default (5.5 mm squeeze)
    cad/.venv/Scripts/python.exe cad/launcher_v5/hood_v2.py 4.0 7.0    # extra test variants

Frame = the Launcher V5 Onshape/STL frame converted to mm: flywheel axis along Y through the
origin, +Z up, the plate tail (and the hood) toward -X.

Why it changes (see README.md): the stock hood squeezes the ball only ~1.5 mm, and its straight
face ends ~3.6 mm above the point where the ball leaves the tyre. So small ball-size or grip
differences move the release onto the hood's top corner, which changes the launch angle.

v2 keeps the stock ~71.4 deg face angle (so the existing shot tuning stays close), then:
  * moves the face closer to the wheel for more squeeze (SQUEEZE, nominal ball),
  * runs the straight face EXTEND mm past the release point, so the ball always leaves the
    tyre while it is still on the flat face (launch angle = face angle),
  * adds a full-length trough (R 37) so the ball stays centred the whole way, not just at the bottom,
  * keeps the bottom lead-in no closer to the wheel than the stock hood (the feed path from
    below sees the same edge), and nothing hangs below the plates' bottom edge (Z = -42.3),
  * bolts on through BOTH plate holes per side, (-94.93, -37.61) as today and the spare
    (-77.15, -34.34), so it can't pivot. Both use M4 heat-set inserts (5.6 mm holes), like the stock part.
"""
import json
import math
import sys
from pathlib import Path

from build123d import (Axis, Box, Circle, Cylinder, Location, Plane, Polyline, Pos, Rot, extrude,
                       export_step, export_stl, make_face)

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
OUT.mkdir(exist_ok=True)

# ---- fixed geometry measured from Launcher V5.stl (mm) ---------------------------------
R_WHEEL = 36.0            # Ø72 tyre
BALL_D = 71.1             # nominal game piece
PLATE_INNER_Y = 46.0      # plate inner faces at |Y| = 46 (92 mm gap)
PLATE_BOTTOM_Z = -42.3    # flat bottom edge of the side plates
STOCK_FACE_D = 106.0      # stock hood bottom edge distance from the axle (at Z = -42.3), approx
HOLES = [(-94.93, -37.61), (-77.15, -34.34)]   # plate holes used for mounting (X, Z)
INSERT_HOLE_D = 5.6       # M4 heat-set insert hole (same as stock part)
INSERT_DEPTH = 10.0

# ---- design parameters --------------------------------------------------------------------
FACE_ANGLE = 71.4         # deg above horizontal, measured from the stock hood's straight face
SQUEEZE = 5.5             # mm, nominal ball, at the closest point of the straight face
EXTEND = 30.0             # mm of straight face past the release contact point
LEADIN = 14.0             # mm length of the bottom lead-in ramp
TROUGH_R = 37.0           # trough radius (ball radius 35.55)
LAND = 10.0               # trough wall height above the trough bottom
BACK_T = 8.0              # material behind the trough bottom
CHEEK_INNER_Y = 37.0      # cheeks run from |Y| = 37 to the plates (ball is |Y| <= 35.55)
BOSS_R = 6.5


def build(squeeze=SQUEEZE, name="hood_v2"):
    th = math.radians(FACE_ANGLE)
    u = (-math.cos(th), math.sin(th))          # up the face, in XZ
    n = (-math.sin(th), -math.cos(th))         # away from the wheel (into the hood), in XZ
    rb = BALL_D / 2
    d = BALL_D + R_WHEEL - squeeze             # axle -> trough-bottom line distance
    p = d - rb                                 # axle -> ball-centre path
    h = math.sqrt((rb + R_WHEEL) ** 2 - p ** 2)  # half-length of the tyre contact window
    foot = (d * n[0], d * n[1])                # trough-bottom point nearest the axle

    def g(t, z_local):
        """local (t along the face, z_local toward the wheel) -> global (X, Z)"""
        return (foot[0] + t * u[0] - z_local * n[0], foot[1] + t * u[1] - z_local * n[1])

    # bottom: where the stock hood's bottom edge sits (d = STOCK_FACE_D) at the plate bottom line
    recede = STOCK_FACE_D - d
    # t where the receded lead-in point (t, -recede) sits on the plate bottom line
    t_bot = (PLATE_BOTTOM_Z - (foot[1] + recede * n[1])) / u[1]
    t_top = h + EXTEND
    length = t_top - t_bot + 4

    # local frame: X = up the face, Z = toward the wheel, origin at the foot point
    plane = Plane(origin=(foot[0], 0, foot[1]), x_dir=(u[0], 0, u[1]), z_dir=(-n[0], 0, -n[1]))
    loc = Location(plane)

    body = Pos((t_bot + t_top) / 2, 0, (LAND - BACK_T) / 2) * Box(length, 2 * CHEEK_INNER_Y, LAND + BACK_T)
    trough = Pos((t_bot + t_top) / 2, 0, TROUGH_R) * (Rot(0, 90, 0) * Cylinder(TROUGH_R, length + 10))
    body = body - trough
    # lead-in: a flat that recedes from the trough bottom to `recede` behind it at t_bot
    wedge_pts = [(t_bot - 6, -recede - 6 * recede / LEADIN), (t_bot + LEADIN, 0.0),
                 (t_bot + LEADIN, 60.0), (t_bot - 6, 60.0)]
    wedge = extrude(make_face(Polyline(*wedge_pts, close=True)).rotate(Axis.X, 90), amount=60, both=True)
    body = body - wedge
    body = loc * body

    # cheeks: hull-like polygon in XZ joining the body footprint and both bolt bosses
    corners = [g(t_bot - 2, -BACK_T), g(t_top + 2, -BACK_T), g(t_top + 2, LAND), g(t_bot - 2, LAND)]
    hx, hz = HOLES[1]
    hx0, hz0 = HOLES[0]
    prof = [corners[0], corners[1], corners[2], corners[3],
            (hx, hz + BOSS_R), (hx + BOSS_R, hz),
            (hx + BOSS_R, min(corners[0][1], PLATE_BOTTOM_Z) - 2)]   # below Z=-42.3 is trimmed later
    cheek_face = make_face(Polyline(*prof, close=True))
    OVERLAP = 1.0                                   # cheeks overlap the body (coplanar fuses are flaky)
    cheek_w = PLATE_INNER_Y - CHEEK_INNER_Y + OVERLAP
    part = body
    for side in (1, -1):
        y0 = CHEEK_INNER_Y - OVERLAP if side > 0 else -PLATE_INNER_Y   # cheek spans y0 .. y0 + cheek_w
        # face drawn in XY with Y = global Z; +90 about X maps (x, y, 0) -> (x, 0, y)
        c = extrude(cheek_face.rotate(Axis.X, 90), amount=cheek_w, dir=(0, 1, 0))
        part = part.fuse(Pos(0, y0, 0) * c)
        for (x, z) in HOLES:
            boss = Pos(x, y0 + cheek_w / 2, z) * (Rot(90, 0, 0) * Cylinder(BOSS_R, cheek_w))
            part = part.fuse(boss)
    part = part.clean()
    if len(part.solids()) != 1:
        raise RuntimeError(f"{name}: expected one solid, got {len(part.solids())}")

    # nothing below the plates' bottom edge
    part = part - Pos(0, 0, PLATE_BOTTOM_Z - 50) * Box(600, 200, 100)
    # insert holes from both end faces
    for (x, z) in HOLES:
        for side in (1, -1):
            y0 = side * (PLATE_INNER_Y - INSERT_DEPTH / 2)
            part = part - Pos(x, y0, z) * (Rot(90, 0, 0) * Cylinder(INSERT_HOLE_D / 2, INSERT_DEPTH + 0.02))

    info = dict(name=name, face_angle_deg=FACE_ANGLE, squeeze_nominal_mm=squeeze,
                trough_bottom_line_from_axle_mm=round(d, 2), contact_window_mm=round(2 * h, 1),
                release_contact_xz=[round(v, 1) for v in g(h, 0)],
                straight_face_top_xz=[round(v, 1) for v in g(t_top, 0)],
                bottom_edge_from_axle_mm=STOCK_FACE_D, volume_mm3=round(part.volume, 0),
                bbox_mm=[[round(v, 1) for v in part.bounding_box().min],
                         [round(v, 1) for v in part.bounding_box().max]])
    export_step(part, str(OUT / f"{name}.step"))
    export_stl(part, str(OUT / f"{name}.stl"), tolerance=0.02, angular_tolerance=0.1)
    (OUT / f"{name}.json").write_text(json.dumps(info, indent=2))
    print(json.dumps(info))
    return part


if __name__ == "__main__":
    build()
    for s in sys.argv[1:]:
        build(float(s), name=f"hood_v2_sq{float(s):.1f}")

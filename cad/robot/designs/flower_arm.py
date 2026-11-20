"""
Flower arm v1 - servo direct drive.

The existing flower arms pivot on the intake axle and are lifted by a string from the
goBILDA dual-spool winch on the right-side servo. This replaces them with arms that pivot
on the servo axis itself, run forward above the intake, and drop down to the SAME tip foot
(the flower ramp bolts to the same three holes at the same height in the DOWN pose).

    cad/.venv/Scripts/python.exe cad/robot/designs/flower_arm.py [--analyse] [--render]

Fixed by the existing robot (do not change without re-checking):
  servo axis (goBILDA 2000-0025-0002 spline) .... X 121.0, Z 152.9, axis along Y
  arm inner faces (ramp sits between) ........... Y -162.36 (right), +161.12 (left)
  ramp screw holes in DOWN pose ................. (325.9, 1.5) (334.1, 1.7) (341.6, 1.5)
"""
import json
import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "tools"))
from robotcad import ROOT, export_new, leaves, load_robot, render  # noqa: E402

from build123d import (Axis, Box, Circle, Compound, Cylinder, Face, Kind, Location, Plane,  # noqa: E402
                       Polygon, Pos, Rectangle, Rot, Vector, extrude, import_step, offset)

NAME = "flower_arm"

# ------------------------------------------------------------------ parameters (mm)
PX, PZ = 121.0, 152.9                 # servo / arm pivot axis
Y_R_IN, Y_L_IN = -162.36, 161.12      # arm inner faces (unchanged -> ramp fits as today)
T = 6.0                               # arm plate thickness (grows outboard)
BEAM_TOP, BEAM_BOT = 169.0, 137.0     # horizontal run over the intake (32 tall)
ELBOW = (262.0, 153.0)                # front corner; keeps 16 mm off the front bumper plate
FOOT_END = (316.0, 2.0)               # where the drop leg meets the foot
LEG_W = 32.0
HUB_R = 22.0                          # arm boss around the servo axis
FOOT = dict(x0=300.0, x1=351.03, z0=-14.36, z1=13.6, r=3.0)   # same envelope as today's foot
TIP_HOLES = [(325.9, 1.5), (334.1, 1.7), (341.6, 1.5)]          # 3.5 mm, ramp screws
ACC_HOLE = (348.5, 11.1)                                        # 5.08 mm (exists on old arm)
LIGHTEN = [(160.0, 153.0), (195.0, 153.0), (230.0, 153.0), (289.0, 76.0)]
FILLET = 8.0

GOBILDA_R = 11.31                     # goBILDA pattern: 4x M4 on a 16 mm square
HUB_Y = (-151.37, -159.37)            # goBILDA 1908 25T servo hub (32 mm, 8 mm) on the spline
QB_HOLES = [(173.4, 133.8), (173.4, 165.8)]   # tapped M4 on the +Y edge of the left quad block
BRKT_Y = (154.18, 158.18)             # left idler bracket, 4 mm plate, flush on the quad block

# robot parts this design removes (index ids from index/parts.json)
REMOVED = {62: "old right flower arm", 195: "old left flower arm",
           252: "goBILDA dual-spool winch on servo",
           78: "old right arm pivot bearing", 174: "old right arm shim", 182: "old right arm shim",
           3: "old left arm pivot bearing", 262: "old left arm shim", 184: "old left arm shim"}

ORANGE, GREY, RAMP = "#ff7a00", "#9aa0a6", "#a5a5a5"


# ------------------------------------------------------------------ geometry
def arm_profile():
    """2D arm outline in local (x=X, y=Z) coordinates, holes not yet cut."""
    ex, ez = ELBOW
    fx, fz = FOOT_END
    hub = Pos(PX, PZ) * Circle(HUB_R)
    beam = Pos((PX + ex) / 2, (BEAM_TOP + BEAM_BOT) / 2) * Rectangle(ex - PX, BEAM_TOP - BEAM_BOT)
    elbow = Pos(ex, ez) * Circle(LEG_W / 2)
    dx, dz = fx - ex, fz - ez
    leg = Pos((ex + fx) / 2, (ez + fz) / 2) * Rot(0, 0, math.degrees(math.atan2(dz, dx))) * \
        Rectangle(math.hypot(dx, dz), LEG_W)
    legend = Pos(fx, fz) * Circle(LEG_W / 2)
    f = FOOT
    foot = Pos((f["x0"] + f["x1"]) / 2, (f["z0"] + f["z1"]) / 2) * \
        Rectangle(f["x1"] - f["x0"], f["z1"] - f["z0"])
    body = hub + beam + elbow + leg + legend + foot
    # close concave corners: grow then shrink by the fillet radius
    body = offset(offset(body, FILLET, kind=Kind.ARC), -FILLET, kind=Kind.ARC)
    faces = body.faces()
    assert len(faces) == 1, f"arm profile split into {len(faces)} faces"
    return faces[0]


def holes(side):
    h = []
    if side == "R":
        h.append(Pos(PX, PZ) * Circle(7.0))                         # hub boss / screw relief
        for a in range(0, 360, 90):
            h.append(Pos(PX + GOBILDA_R * math.cos(math.radians(a)),
                         PZ + GOBILDA_R * math.sin(math.radians(a))) * Circle(2.15))
    else:
        h.append(Pos(PX, PZ) * Circle(7.0))                         # 14 mm flanged bearing
    for x, z in TIP_HOLES:
        h.append(Pos(x, z) * Circle(1.75))
    h.append(Pos(*ACC_HOLE) * Circle(2.54))
    for x, z in LIGHTEN:
        h.append(Pos(x, z) * Circle(7.0))
    out = h[0]
    for k in h[1:]:
        out += k
    return out


PLANE_XZ_AT = lambda y: Plane(origin=(0, y, 0), x_dir=(1, 0, 0), z_dir=(0, -1, 0))  # local y = +Z


def build():
    prof = arm_profile()
    right_face = PLANE_XZ_AT(Y_R_IN) * (prof - holes("R"))
    left_face = PLANE_XZ_AT(Y_L_IN) * (prof - holes("L"))
    right = extrude(right_face, amount=T)                       # Y_R_IN -> Y_R_IN - T
    left = extrude(left_face, amount=T, dir=(0, 1, 0))          # Y_L_IN -> Y_L_IN + T

    # right boss between hub face and arm (3 mm), drilled to match
    boss_len = abs(HUB_Y[1] - Y_R_IN)
    boss = Pos(PX, (HUB_Y[1] + Y_R_IN) / 2, PZ) * Rot(90, 0, 0) * Cylinder(17, boss_len)
    boss -= Pos(PX, (HUB_Y[1] + Y_R_IN) / 2, PZ) * Rot(90, 0, 0) * Cylinder(7, boss_len)
    for a in range(0, 360, 90):
        boss -= Pos(PX + GOBILDA_R * math.cos(math.radians(a)), (HUB_Y[1] + Y_R_IN) / 2,
                    PZ + GOBILDA_R * math.sin(math.radians(a))) * Rot(90, 0, 0) * Cylinder(2.15, boss_len)
    right = right + boss

    hub = Pos(PX, sum(HUB_Y) / 2, PZ) * Rot(90, 0, 0) * Cylinder(16, abs(HUB_Y[1] - HUB_Y[0]))

    # left idler bracket: plate on the quad block's outboard face, carrying the pivot pin
    bx = Pos(PX, PZ) * Circle(13) + Pos(174.4, 150.8) * Rectangle(14, 46)
    bx += Polygon((PX, PZ + 13), (167.4, 173.8), (167.4, 127.8), (PX, PZ - 13))
    bx = offset(offset(bx, 6, kind=Kind.ARC), -6, kind=Kind.ARC)
    bx -= Pos(PX, PZ) * Circle(4.0)
    for x, z in QB_HOLES:
        bx -= Pos(x, z) * Circle(2.15)
    bx -= Pos(146, 152.9) * Circle(8)
    bracket = extrude(PLANE_XZ_AT(BRKT_Y[0]) * bx, amount=BRKT_Y[1] - BRKT_Y[0], dir=(0, 1, 0))

    pin = Pos(PX, (BRKT_Y[0] + Y_L_IN + T + 1.5) / 2, PZ) * Rot(90, 0, 0) * \
        Cylinder(4, Y_L_IN + T + 1.5 - BRKT_Y[0])
    bearing = Pos(PX, Y_L_IN + 2.5, PZ) * Rot(90, 0, 0) * (Cylinder(7, 5) - Cylinder(4, 5))

    # flower ramp from its own STEP, holes aligned to the arm tip holes
    rc = import_step(str(ROOT / "source" / "extra" / "flower_ramp.step"))
    ramp = next(c for c in rc.children if "Cube" not in (c.label or ""))
    ramp = Pos(325.9 - 326.22, Y_L_IN - 0.0, 1.5 - 1.95) * ramp

    return dict(right_arm=right, left_arm=left, hub=hub, bracket=bracket, pin=pin,
                bearing=bearing, ramp=ramp)


MOVING = ("right_arm", "left_arm", "ramp", "bearing")
PIVOT_AXIS = Axis((PX, 0, PZ), (0, 1, 0))


def posed(parts, alpha):
    """alpha = degrees the arm is raised from DOWN (tip goes up)."""
    out = {}
    for k, s in parts.items():
        out[k] = s.rotate(PIVOT_AXIS, -alpha) if (k in MOVING and alpha) else s
    return out


def scene_parts(parts, alpha):
    p = posed(parts, alpha)
    return {"right_arm": (p["right_arm"], ORANGE), "left_arm": (p["left_arm"], ORANGE),
            "left_bracket": (p["bracket"], ORANGE), "servo_hub": (p["hub"], GREY),
            "pivot_pin": (p["pin"], GREY), "bearing": (p["bearing"], GREY),
            "flower_ramp": (p["ramp"], RAMP)}


def hide_boxes():
    idx = json.load(open(ROOT / "index" / "parts.json", encoding="utf-8"))["parts"]
    out = []
    for i in REMOVED:
        c = idx[i]["center"]
        out.append([c[0] - 0.6, c[1] - 0.6, c[2] - 0.6, c[0] + 0.6, c[1] + 0.6, c[2] + 0.6])
    return out


if __name__ == "__main__":
    parts = build()
    for k, s in parts.items():
        bb = s.bounding_box()
        print(f"{k:10s} vol {s.volume:9.0f} mm3  bbox X {bb.min.X:.1f}..{bb.max.X:.1f}  "
              f"Y {bb.min.Y:.1f}..{bb.max.Y:.1f}  Z {bb.min.Z:.1f}..{bb.max.Z:.1f}")
    if "--analyse" in sys.argv:
        import flower_arm_analysis
        flower_arm_analysis.run(parts)
    if "--export" in sys.argv:
        poses = json.loads((ROOT / "designs" / "out" / f"{NAME}_poses.json").read_text())
        for pose, alpha in poses.items():
            export_new(f"{NAME}_{pose}", scene_parts(parts, alpha), step=(pose == "down"))
        # printable parts (DOWN pose geometry, which is the as-designed orientation)
        from build123d import export_stl
        for k in ("right_arm", "left_arm", "bracket"):
            export_stl(parts[k], str(ROOT / "designs" / "out" / f"{NAME}_{k}.stl"))

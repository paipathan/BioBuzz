"""
Transfer ramp v2: patched cut-out + flip-up servo stopper ahead of the top axle.

    cad/.venv/Scripts/python.exe -I cad/transfer/stopper_v1.py

Frame: the Transfer STL export converted from inches to mm. The axles run along Y, +Z is up, and
the ramp climbs from +X (intake end) toward -X (turret). Robot frame = this frame + (-48.5, 0, +182.2).

Outputs (out/):
  ramp_patched.stl      stock ramp with the old arm-swing slot filled in (nothing else changed)
  ramp_v2.stl           patched ramp + flap slot + integrated servo mount  <- print this
  stopper_flap.stl      the flap that bolts to the servo horn            <- print this
  servo_v2.stl, horn_v2.stl, flap_open.stl   the servo/horn/flap placed (for checks + renders)
  stopper.json          key numbers
"""
import json
import sys
from pathlib import Path

import numpy as np
import trimesh
from manifold3d import CrossSection, Manifold, OpType

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
sys.path.insert(0, str(HERE / "tools"))
from ball_path import path_for, resample, R, RW, A3, A4  # noqa: E402

# ---------------------------------------------------------------- parameters
GAP = 4.0          # ball-surface to top-axle wheel clearance at the stop (mm)
H = 32.0           # flap tip height above the ramp surface (closed)
TIP_R = 4.0        # tip rounding
FT = 8.0           # finger thickness along the ramp
PT = 12.0          # flap width (Y), centred on Y=0
D_PIVOT = 25.0     # servo axis depth below the ramp running surface
BACK = 28.0        # servo axis sits this far behind (downhill of) the finger face (keeps the servo 6 mm above the drive motor)
HUB_R = 17.0       # flap hub radius (covers the Ø32 goBILDA horn)
CLEAR = 1.0        # slot clearance around the moving flap
OPEN_MARGIN = 6.0  # extra rotation past "just below the surface"
PLATE_T = 7.0      # servo mount plate thickness (Y)
M4_INSERT_D = 5.6  # heat-set insert hole


def to_tm(m: Manifold) -> trimesh.Trimesh:
    g = m.to_mesh()
    return trimesh.Trimesh(np.asarray(g.vert_properties)[:, :3], np.asarray(g.tri_verts), process=True)


def to_mf(t: trimesh.Trimesh) -> Manifold:
    from manifold3d import Mesh
    return Manifold(Mesh(vert_properties=np.asarray(t.vertices, np.float32), tri_verts=np.asarray(t.faces, np.uint32)))


# ---------------------------------------------------------------- 1. patch the old slot (mirror of the intact +Y side)
stock = trimesh.load(HERE / "out" / "stock_ramp.stl")
mir = stock.copy(); mir.apply_transform(np.diag([1, -1, 1, 1]))
if mir.volume < 0: mir.invert()
slot_box = Manifold.cube([85, 44.5, 16]).translate([-40, -48.5, -52.5])   # covers Y -48.5..-4, Z -52.5..-36.5
patched = to_mf(stock) + (to_mf(mir) ^ slot_box)
to_tm(patched).export(OUT / "ramp_patched.stl")

# ---------------------------------------------------------------- 2. stop pose
ramp_tm = to_tm(patched)
ss, P = resample(path_for(ramp_tm), 0.05)
np.save(OUT / "path_patched.npy", P[::2])
d4 = np.linalg.norm(P - A4, axis=1)
i = np.where(d4 > RW + R + GAP)[0]; i = i[i < d4.argmin()][-1]
C = P[i]
t = P[i + 40] - P[i - 40]; t /= np.linalg.norm(t)
n = np.array([-t[1], t[0]])
if n @ (A4 - C) < 0: n = -n            # n points from the ramp toward the wheels
Pc = C - R * n                          # ball/ramp contact
# local frame (u along travel, v off the ramp, w = +Y)
M = np.eye(4); M[:3, 0] = [t[0], 0, t[1]]; M[:3, 1] = [n[0], 0, n[1]]; M[:3, 2] = [0, 1, 0]; M[:3, 3] = [Pc[0], 0, Pc[1]]
assert np.linalg.det(M[:3, :3]) > 0
M34 = M[:3, :]


def L(u, v):  # local (u, v) -> global XZ
    return Pc + u * t + v * n


# ramp surface height v_s(u) at Y=0 in the local frame (concave ramp rises ahead)
from trimesh.intersections import mesh_plane  # noqa: E402
seg = mesh_plane(ramp_tm, [0, 1, 0], [0, 0, 0])[:, :, [0, 2]]
seg = np.concatenate([np.linspace(s0, s1, max(2, int(np.linalg.norm(s1 - s0) / 0.3) + 2)) for s0, s1 in seg])
loc = np.c_[(seg - Pc) @ t, (seg - Pc) @ n]


def surf_v(u, band=1.0):
    sel = np.abs(loc[:, 0] - u) < band
    vv = loc[sel, 1]
    return vv[vv > -3].max() if np.any(vv > -3) else 0.0


def back_v(u, band=1.0):
    sel = (np.abs(loc[:, 0] - u) < band) & (loc[:, 1] < -1)
    return loc[sel, 1].max()


# ---------------------------------------------------------------- 3. flap (2D in u,v; rotates about O)
c_ctr_v = H - TIP_R
u_f = np.sqrt((R + TIP_R) ** 2 - (R - c_ctr_v) ** 2) - TIP_R     # finger face so the ball just touches the tip
O = np.array([u_f - BACK, -D_PIVOT])
finger = (CrossSection.square([FT, H - TIP_R + 14]).translate([u_f, -14])
          + CrossSection.circle(TIP_R, 48).translate([u_f + TIP_R, H - TIP_R])
          + CrossSection.square([FT - 2 * TIP_R, TIP_R]).translate([u_f + TIP_R, H - TIP_R]))
finger = finger.hull() if False else finger
hub = CrossSection.circle(HUB_R, 96).translate(O.tolist())
web = CrossSection.batch_hull([CrossSection.circle(10, 48).translate(O.tolist()),
                               CrossSection.square([FT, 10]).translate([u_f, -14])])
flap2d = hub + web + finger
# horn bolt pattern: goBILDA 25T servo horn, 4x M4 on a 16 mm square + centre clearance
holes = CrossSection.circle(4.5, 32).translate(O.tolist())
for dx in (-8, 8):
    for dy in (-8, 8):
        holes += CrossSection.circle(2.2, 24).translate([O[0] + dx, O[1] + dy])
flap2d_solid = flap2d - holes


def rot2d(cs: CrossSection, deg: float) -> CrossSection:
    return cs.translate((-O).tolist()).rotate(deg).translate(O.tolist())


def place(m: Manifold) -> Manifold:
    return m.transform(M34)


def flap3d(deg: float, cs=None, grow=0.0) -> Manifold:
    c = cs if cs is not None else flap2d_solid
    if grow: c = c.offset(grow, circular_segments=48)
    w = PT + 2 * grow
    return place(Manifold.extrude(rot2d(c, deg), w).translate([0, 0, -w / 2]))


# opening angle: rotate clockwise (tip forward/down) until the whole finger is below the running surface
def max_rel_height(deg):
    pts = np.asarray(rot2d(flap2d, deg).to_polygons()[0]) if len(rot2d(flap2d, deg).to_polygons()) == 1 else \
        np.vstack(rot2d(flap2d, deg).to_polygons())
    pts = pts[pts[:, 0] > O[0] + 5]
    return max(p[1] - surf_v(p[0]) for p in pts)


a = 0.0
while max_rel_height(-a) > -1.0:
    a += 0.5
OPEN = a + OPEN_MARGIN
print(f"finger face u_f={u_f:.2f}  pivot O(u,v)={np.round(O, 2)}  just-clear at {a:.1f} deg -> OPEN={OPEN:.1f} deg (clockwise)")

flap_closed = flap3d(0.0)
flap_open = flap3d(-OPEN)

# slot = flap swept through closed..open, grown by CLEAR
sweep2d = CrossSection()
for deg in np.linspace(3.0, -OPEN - 3.0, 77):
    sweep2d += rot2d(flap2d, deg)
sweep2d = sweep2d.offset(CLEAR, circular_segments=48).simplify(0.02)
sweep = place(Manifold.extrude(sweep2d, PT + 2 * CLEAR).translate([0, 0, -(PT + 2 * CLEAR) / 2]))

# ---------------------------------------------------------------- 4. servo + integrated mount
servo_stock = trimesh.load(HERE / "out" / "servo_stock.stl")
horn_stock = trimesh.load(HERE / "out" / "horn_stock.stl")
# stock servo frame: spline axis at X 59.5, Y -73.5 pointing +Z; flange top face at Z -66.5, body length along X
S0 = np.eye(4); S0[:3, 3] = [-59.5, 73.5, 66.5]                 # -> servo local: spline at origin, w=+Z, l=+X
# servo local (l, wid, w) -> flap local (u, v, y): w (output) -> -y, l -> -u (body extends uphill), wid -> v
HORN_FACE_Y = PT / 2                                            # horn outer face touches the flap
W_HORN_TOP = -49.0 + 66.5                                       # 17.5: horn face height above flange top
R_s = np.array([[-1, 0, 0], [0, 1, 0], [0, 0, -1]], float)     # columns: images of l, wid, w in (u, v, y)
S1 = np.eye(4); S1[:3, :3] = R_s; S1[:3, 3] = [O[0], O[1], HORN_FACE_Y + W_HORN_TOP]
T_servo = M @ S1 @ S0
servo_v2 = servo_stock.copy(); servo_v2.apply_transform(T_servo)
horn_v2 = horn_stock.copy(); horn_v2.apply_transform(T_servo)
flange_y = HORN_FACE_Y + W_HORN_TOP                             # flange top face (spline side), global Y

# mount plate in (u, v) on the spline side of the flange: Y from flange_y - PLATE_T to flange_y
# servo footprint in flap-local: l in [-30.0, 10.3] -> u in [O_u - 10.3, O_u + 30.0]; width v in O_v +- 10
bu0, bu1 = O[0] - 10.3 - 0.4, O[0] + 30.0 + 0.4
bv0, bv1 = O[1] - 10.0 - 0.4, O[1] + 10.0 + 0.4
pu0, pu1 = O[0] - 17.3 - 5.0, O[0] + 37.2 + 5.0     # covers the flange tabs
pv0 = O[1] - 10.0 - 7.0
plate_top = 6.0                                    # trimmed back to just under the running surface below
us = np.linspace(pu0 - 2, pu1 + 2, 80)
below = CrossSection([([(pu0 - 2, pv0 - 20)] + [(u, surf_v(u) - 1.5) for u in us] + [(pu1 + 2, pv0 - 20)])[::-1]])
plate2d = CrossSection.square([pu1 - pu0, plate_top - pv0]).translate([pu0, pv0]) \
    - CrossSection.square([bu1 - bu0, bv1 - bv0]).translate([bu0, bv0])
for lu in (-34.0, 14.0):                 # flange slot centres along the body (stock: X 25.5 / 73.5)
    for wv in (-5.0, 5.0):
        plate2d -= CrossSection.circle(M4_INSERT_D / 2, 24).translate([O[0] - lu, O[1] + wv])
plate = place(Manifold.extrude(plate2d, PLATE_T).translate([0, 0, flange_y - PLATE_T]))
# gusset tying the plate's outer edge back to the ramp on the far side of the servo
gusset2d = CrossSection.square([pu1 - pu0, plate_top - (bv1 + 1.0)]).translate([pu0, bv1 + 1.0])
gusset = place(Manifold.extrude(gusset2d, 6.0).translate([0, 0, flange_y + 0.0]))
# keep the gusset clear of the servo body (it sits beyond the body's v range, so only the band above it)
mount = plate + gusset
mount = mount ^ place(Manifold.extrude(below, 80).translate([0, 0, -40]))   # never above the running surface
mount = mount - place(Manifold.cube([bu1 - bu0, bv1 - bv0, 60]).translate([bu0, bv0, flange_y - 30]))
# grooves for the 1.4 mm ribs on the spline side of the servo's flange tabs (tab centreline, l -37.5..-29.5 / 9.8..17.8)
for g0, g1 in ((O[0] + 29.0, O[0] + 38.5), (O[0] - 18.5, O[0] - 9.5)):
    mount = mount - place(Manifold.cube([g1 - g0, 3.0, 2.0]).translate([g0, O[1] - 1.5, flange_y - 2.0]))

ramp_v2 = patched + mount
ramp_v2 = ramp_v2 - sweep

# ---------------------------------------------------------------- 5. export
OUT.mkdir(exist_ok=True)
to_tm(ramp_v2).export(OUT / "ramp_v2.stl")
flap_print = Manifold.extrude(flap2d_solid, PT)            # flat, in its own frame, for printing
to_tm(flap_print).export(OUT / "stopper_flap.stl")
to_tm(flap_closed).export(OUT / "flap_closed.stl")
to_tm(flap_open).export(OUT / "flap_open.stl")
servo_v2.export(OUT / "servo_v2.stl"); horn_v2.export(OUT / "horn_v2.stl")
to_tm(mount).export(OUT / "_mount_only.stl")

info = {
    "gap_to_top_wheels_mm": GAP,
    "stop_ball_centre_xz": np.round(C, 2).tolist(),
    "ball_ramp_contact_xz": np.round(Pc, 2).tolist(),
    "travel_dir_deg": float(np.degrees(np.arctan2(t[1], t[0]))),
    "clear_of_A3_wheels_mm": float(np.linalg.norm(C - A3) - R - RW),
    "finger_face_u": float(u_f),
    "contact_angle_below_travel_deg": float(np.degrees(np.arctan2(R - c_ctr_v, u_f + TIP_R))),
    "pivot_xz": np.round(L(*O), 2).tolist(),
    "open_rotation_deg_clockwise_seen_from_+Y": float(OPEN),
    "flange_face_y": float(flange_y),
    "T_local_to_global": M.tolist(),
    "T_servo": T_servo.tolist(),
    "flap_print_volume_cm3": flap_print.volume() / 1000,
    "ramp_v2_volume_cm3": ramp_v2.volume() / 1000,
}
(OUT / "stopper.json").write_text(json.dumps(info, indent=1))
print(json.dumps({k: v for k, v in info.items() if not k.startswith("T_")}, indent=1))

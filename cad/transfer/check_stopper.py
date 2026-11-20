"""
Clearance checks for stopper_v1 (run after it):
    cad/.venv/Scripts/python.exe -I cad/transfer/check_stopper.py [--robot]

- closed flap vs the ball at the stop pose (should just touch) and vs every earlier ball position
- open flap vs the ball at every position along the path (must clear)
- flap at every angle while opening vs the stopped ball (must not shove it back)
- flap at every angle vs the new ramp, servo/horn vs ramp, everything vs the rest of the transfer
- with --robot: new parts vs the full robot STEP (robot frame = this frame + (-48.5, 0, +182.2))
"""
import json
import sys
from pathlib import Path

import numpy as np
import trimesh
from manifold3d import Manifold, Mesh

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
sys.path.insert(0, str(HERE))
R = 35.5

info = json.loads((OUT / "stopper.json").read_text())
C = np.array(info["stop_ball_centre_xz"])
path = np.load(OUT / "path_patched.npy")


def mf(t):
    return Manifold(Mesh(vert_properties=np.asarray(t.vertices, np.float32), tri_verts=np.asarray(t.faces, np.uint32)))


def ivol(a, b):
    return (mf(a) ^ mf(b)).volume()


def surface_pts(t, n=60000):
    p, _ = trimesh.sample.sample_surface_even(t, n)
    return np.vstack([p, t.vertices])


def ball_clear(pts, centres_xz, y=0.0):
    """min over centres of (distance from centre to flap points) - R  (negative = interference)."""
    best = np.inf
    for c in centres_xz:
        d = np.linalg.norm(pts - [c[0], y, c[1]], axis=1).min() - R
        best = min(best, d)
    return best


ok = True


def report(name, val, good):
    global ok
    ok &= good
    print(f"  {'OK ' if good else 'BAD'} {name}: {val}")


# re-create flap poses from the design module (cheap: import does the whole build, so read STLs instead)
import importlib.util  # noqa: E402
spec = importlib.util.spec_from_file_location("design", HERE / "stopper_v1.py")
print("rebuilding design ...")
import contextlib, io  # noqa: E401,E402
with contextlib.redirect_stdout(io.StringIO()):
    design = importlib.util.module_from_spec(spec); spec.loader.exec_module(design)
to_tm = design.to_tm

ramp = trimesh.load(OUT / "ramp_v2.stl")
servo = trimesh.load(OUT / "servo_v2.stl"); horn = trimesh.load(OUT / "horn_v2.stl")
rest = trimesh.load(OUT / "_rest.stl")
k_stop = np.argmin(np.linalg.norm(path - C, axis=1))
before = path[:k_stop:4]
allpos = path[::4]

print("ball vs flap")
closed = to_tm(design.flap_closed); pc = surface_pts(closed)
report("closed flap vs ball at stop (gap, mm, ~0 = touching)", round(ball_clear(pc, [C]), 2), abs(ball_clear(pc, [C])) < 0.4)
report("closed flap vs all earlier ball positions (min gap)", round(ball_clear(pc, before), 2), ball_clear(pc, before) > -0.4)
openf = to_tm(design.flap_open); po = surface_pts(openf)
g = ball_clear(po, allpos)
report("open flap vs ball anywhere on the path (min gap, mm)", round(g, 2), g > 0.5)
worst = np.inf
for deg in np.linspace(0, -design.OPEN, 33)[1:]:
    p = surface_pts(to_tm(design.flap3d(deg)), 20000)
    worst = min(worst, ball_clear(p, [C]))
report("flap while opening vs the stopped ball (min gap, mm; must not go negative)", round(worst, 2), worst > -0.4)

mount_pts = surface_pts(trimesh.load(OUT / "_mount_only.stl"), 30000)
g = ball_clear(mount_pts, allpos)
report("servo mount vs ball anywhere on the path (min gap, mm)", round(g, 2), g > 0.5)
for yb in (-11.0, 11.0):   # ball can drift sideways on the flat part of the ramp
    g = min(ball_clear(mount_pts, allpos, yb), ball_clear(po, allpos, yb))
    report(f"mount + open flap vs ball shifted to Y={yb:+.0f} (min gap, mm)", round(g, 2), g > 0.5)

print("flap vs ramp / servo")
wv = 0.0
for deg in np.linspace(2, -design.OPEN - 2, 25):
    wv = max(wv, ivol(to_tm(design.flap3d(deg)), ramp))
report("flap (all angles, closed-2..open+2 deg) vs ramp_v2, overlap mm^3", round(wv, 2), wv < 1.0)
report("servo body vs ramp_v2, overlap mm^3", round(ivol(servo, ramp), 2), ivol(servo, ramp) < 5.0)
hv = 0.0
for deg in np.linspace(0, -360, 37):     # horn is round, but check anyway
    hv = max(hv, ivol(horn, ramp)); break
report("horn vs ramp_v2, overlap mm^3", round(hv, 2), hv < 1.0)

print("vs rest of the transfer (plates, wheels, shafts, motors)")
for name, t in [("ramp_v2", ramp), ("servo", servo), ("horn", horn), ("flap closed", closed), ("flap open", openf)]:
    # rest is a soup of many shells; test per shell by bbox prefilter
    v = 0.0
    for s in rest.split(only_watertight=False):
        if not s.is_watertight: continue
        b0, b1 = s.bounds; c0, c1 = t.bounds
        if np.all(b1 > c0) and np.all(c1 > b0):
            v += ivol(t, s)
    tol = 250.0 if name == "ramp_v2" else 1.0   # stock ramp already overlaps the plate bolts/holes slightly
    report(f"{name} vs transfer parts, overlap mm^3", round(v, 1), v < tol)

if "--robot" in sys.argv:
    print("vs full robot (STEP)")
    sys.path.insert(0, str(HERE.parent / "robot" / "tools"))
    from robotcad import load_robot, leaves, world_bbox  # noqa: E402
    robot = load_robot()
    D = np.array([-48.5, 0, 182.2])
    news = {"servo": servo, "horn": horn, "flap_open": openf, "flap_closed": closed,
            "mount": trimesh.load(OUT / "_mount_only.stl")}
    for path_, leaf in leaves(robot):
        name = "/".join(str(p) for p in path_)
        if "Transfer" in name:
            continue
        lo, hi, _ = world_bbox(leaf)
        lo = np.array(lo) - D; hi = np.array(hi) - D
        for nn, t in news.items():
            c0, c1 = t.bounds
            if np.all(hi > c0 - 2) and np.all(c1 + 2 > lo):
                vs, fs = leaf.tessellate(0.2)
                lt = trimesh.Trimesh(np.array([[v.X, v.Y, v.Z] for v in vs]) - D, np.array(fs))
                try:
                    v = ivol(t, lt) if lt.is_watertight else float("nan")
                except Exception:
                    v = float("nan")
                gap = np.linalg.norm(surface_pts(t, 5000)[:, None, :] - lt.vertices[None, ::max(1, len(lt.vertices) // 3000)], axis=2).min()
                print(f"  near: {nn} ~ {name[-70:]}  overlap {v:.1f} mm^3, closest {gap:.1f} mm")
print("ALL OK" if ok else "SOME CHECKS FAILED")

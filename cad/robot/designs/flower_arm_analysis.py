"""
Checks for flower_arm.py:
  * static new parts vs robot (bracket, hub, pin)
  * sweep: moving parts vs robot every STEP degrees from DOWN to MAX_ALPHA
  * 18" starting-size envelope per pose
  * shooter: which launch elevations the arm/ramp would intercept, per pose, over ALL turret yaws

Shot model (from the CAD section through the Undershooter):
  ball (71 mm) leaves the hood with its centre R0 = 115.6 mm out from the turret axis
  (turret axis X -27.97, Y 0) at Z0 = 289.2 mm. Current hood in CAD ~30 deg elevation.
  The turret can point anywhere (479 deg range), so a part at horizontal distance d from the
  turret axis is in danger from the shot aimed straight at it.  Paths are checked for exit
  speeds 6 and 9 m/s plus straight-line, with ball radius + 10 mm margin.
"""
import json
import math
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "tools"))
from robotcad import ROOT, leaves, load_robot  # noqa: E402

import flower_arm as F  # noqa: E402

TURRET = (-27.97, 0.0)
R0, Z0 = 115.6, 289.2
BALL_R, MARGIN = 35.5, 10.0
SPEEDS = (6000.0, 9000.0, None)      # mm/s
G = 9810.0
STEP, MAX_ALPHA = 5, 180
REAR_X = -187.33                      # rearmost frame plate
SIZE = 457.2                          # 18 in
FLOOR_Z = -14.4                       # lowest real robot point (old arm foot) - floor is at or below
IGNORE = {106}                        # servo spline: the new hub sits on it by design


def overlaps(bb, mn, mx, pad=0.0):
    return not (bb.max.X + pad < mn[0] or bb.min.X - pad > mx[0] or bb.max.Y + pad < mn[1] or
                bb.min.Y - pad > mx[1] or bb.max.Z + pad < mn[2] or bb.min.Z - pad > mx[2])


def hits(shape, idx, L, skip):
    bb = shape.bounding_box()
    out = []
    for p in idx:
        if p["id"] in skip or not overlaps(bb, p["min"], p["max"]):
            continue
        try:
            v = (L[p["id"]][1] & shape).volume
        except Exception:
            v = 0.0
        if v > 0.5:
            out.append((p["id"], p["path"][:60], round(v, 1)))
    return out


def blocked_angles(pts_dz):
    """Return boolean array over THETAS: True where some point is within BALL_R+MARGIN of a path."""
    d = pts_dz[:, 0] - R0
    z = pts_dz[:, 1] - Z0
    keep = d > -BALL_R
    d, z = d[keep], z[keep]
    blocked = np.zeros(len(THETAS), bool)
    s = np.linspace(0, max(800.0, d.max() + 100), 400)          # horizontal travel samples
    for i, th in enumerate(np.radians(THETAS)):
        for v in SPEEDS:
            zc = s * math.tan(th)
            if v:
                zc = zc - G * s ** 2 / (2 * (v * math.cos(th)) ** 2)
            # distance from each point to the polyline (approx: nearest sample)
            dd = (d[:, None] - s[None, :]) ** 2 + (z[:, None] - zc[None, :]) ** 2
            if (dd.min(axis=1) < (BALL_R + MARGIN) ** 2).any():
                blocked[i] = True
                break
    return blocked


THETAS = np.arange(5, 86, 1.0)


def intervals(mask):
    out, start = [], None
    for th, b in zip(THETAS, mask):
        if b and start is None:
            start = th
        if not b and start is not None:
            out.append((start, th - 1)); start = None
    if start is not None:
        out.append((start, THETAS[-1]))
    return out


def run(parts):
    robot = load_robot()
    L = list(leaves(robot))
    idx = json.load(open(ROOT / "index" / "parts.json", encoding="utf-8"))["parts"]
    skip = set(F.REMOVED) | IGNORE
    report = {"static": {}, "sweep": []}

    for k in ("bracket", "hub", "pin"):
        h = hits(parts[k], idx, L, skip)
        report["static"][k] = h
        print(f"static {k}: {h or 'clear'}")

    # moving point cloud (tessellated once, rotated numerically)
    pts = []
    for k in F.MOVING:
        vs, _ = parts[k].tessellate(0.5)
        pts += [(v.X, v.Y, v.Z) for v in vs]
    pts = np.unique(np.round(np.array(pts), 0), axis=0)
    print(f"{len(pts)} sample points on moving parts")

    for alpha in range(0, MAX_ALPHA + 1, STEP):
        a = math.radians(alpha)
        rx, rz = pts[:, 0] - F.PX, pts[:, 2] - F.PZ
        X = F.PX + rx * math.cos(a) - rz * math.sin(a)
        Z = F.PZ + rx * math.sin(a) + rz * math.cos(a)
        Y = pts[:, 1]
        dturret = np.hypot(X - TURRET[0], Y - TURRET[1])
        blocked = blocked_angles(np.column_stack([dturret, Z]))
        posed = F.posed(parts, alpha)
        col = []
        for k in F.MOVING:
            col += [(k,) + h for h in hits(posed[k], idx, L, skip)]
        ramp_bb = posed["ramp"].bounding_box()
        row = dict(alpha=alpha, max_x=round(float(X.max()), 1), max_z=round(float(Z.max()), 1),
                   ramp_min_z=round(ramp_bb.min.Z, 1), fits_18=bool(X.max() <= REAR_X + SIZE and
                                                                     Z.max() <= FLOOR_Z + SIZE),
                   blocked=[list(map(float, i)) for i in intervals(blocked)], collisions=col)
        report["sweep"].append(row)
        print(f"a={alpha:3d}  maxX {row['max_x']:6.1f}  maxZ {row['max_z']:6.1f}  rampZmin {row['ramp_min_z']:6.1f}"
              f"  18in {'Y' if row['fits_18'] else '-'}  blocks {row['blocked'] or 'none'}"
              f"  hits {[(c[0], c[2][:25], c[3]) for c in col] or 'none'}")

    out = ROOT / "designs" / "out"
    out.mkdir(parents=True, exist_ok=True)
    (out / f"{F.NAME}_analysis.json").write_text(json.dumps(report, indent=1))
    return report

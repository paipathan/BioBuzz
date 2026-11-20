"""
Shooter clearance diagram for the flower arm.

X axis = horizontal distance from the turret axis (the turret can aim anywhere, so every
part is drawn at its distance from the turret axis = worst case aim straight at it).
Shows ball paths (71 mm ball, as a band) for several launch elevations, and the arm + ramp
outline at each pose.
"""
import json
import math
import sys
from pathlib import Path

import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "tools"))
from robotcad import ROOT  # noqa: E402
import flower_arm as F  # noqa: E402
import flower_arm_analysis as A  # noqa: E402


def cloud(parts, alpha, tris=False):
    pts, tri = [], []
    for k in F.MOVING:
        vs, fs = parts[k].tessellate(0.8)
        base = len(pts)
        pts += [(v.X, v.Y, v.Z) for v in vs]
        tri += [(a + base, b + base, c + base) for a, b, c in fs]
    p = np.array(pts)
    a = math.radians(alpha)
    rx, rz = p[:, 0] - F.PX, p[:, 2] - F.PZ
    X = F.PX + rx * math.cos(a) - rz * math.sin(a)
    Z = F.PZ + rx * math.sin(a) + rz * math.cos(a)
    d = np.hypot(X - A.TURRET[0], p[:, 1] - A.TURRET[1])
    if tris:
        return d, Z, np.array(tri)
    return d, Z, X


def main(parts, poses, out_png):
    fig, ax = plt.subplots(figsize=(12, 8.5))
    s = np.linspace(0, 700, 300)
    for th, col in ((20, "#9ecae1"), (30, "#4292c6"), (45, "#2171b5"), (60, "#08519c")):
        t = math.radians(th)
        for v, ls in ((6000.0, "-"),):
            zc = s * math.tan(t) - A.G * s ** 2 / (2 * (v * math.cos(t)) ** 2)
            ax.fill_between(A.R0 + s, A.Z0 + zc - A.BALL_R / math.cos(t), A.Z0 + zc + A.BALL_R / math.cos(t),
                            color=col, alpha=0.18, lw=0)
            ax.plot(A.R0 + s, A.Z0 + zc, ls, color=col, lw=1.2, label=f"{th}° launch (ball band)")
    ax.plot([A.R0], [A.Z0], "ko")
    ax.annotate("ball leaves hood", (A.R0, A.Z0), (A.R0 - 90, A.Z0 + 40), arrowprops=dict(arrowstyle="->"))
    colors = {"down": "#7f7f7f", "raised": "#ff7a00", "stow": "#d62728"}
    for name, alpha in poses.items():
        from matplotlib.collections import PolyCollection
        d, z, tri = cloud(parts, alpha, tris=True)
        polys = np.stack([np.column_stack([d[t], z[t]]) for t in tri.T], axis=1)
        ax.add_collection(PolyCollection(polys, facecolor=colors.get(name, "k"), edgecolor="none", alpha=0.55))
        i = np.argmax(z)
        ax.annotate(f"{name.upper()} ({alpha}°)", (d[i], z[i]), (d[i] + 15, z[i] + 15),
                    color=colors.get(name, "k"), fontsize=11, weight="bold")
    ax.axhline(A.FLOOR_Z, color="brown", lw=0.8)
    ax.text(10, A.FLOOR_Z + 4, "approx. floor", color="brown", fontsize=8)
    ax.set_xlim(0, 700); ax.set_ylim(-40, 650)
    ax.set_aspect("equal"); ax.grid(True, lw=0.3)
    ax.set_xlabel("horizontal distance from turret axis (mm)  [turret aimed straight at the part]")
    ax.set_ylabel("height Z (mm, robot frame)")
    ax.set_title("Flower arm vs. shooter ball path (arm + ramp points at each pose)")
    ax.legend(loc="upper left", fontsize=8)
    fig.tight_layout()
    fig.savefig(out_png, dpi=110)
    print("wrote", out_png)


if __name__ == "__main__":
    parts = F.build()
    poses = json.loads((ROOT / "designs" / "out" / f"{F.NAME}_poses.json").read_text())
    main(parts, poses, ROOT / "renders" / f"{F.NAME}_shot_clearance.png")

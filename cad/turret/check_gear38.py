"""Checks + a comparison picture for gear38.py outputs.

    cad/.venv/Scripts/python.exe -I cad/turret/check_gear38.py
"""
from pathlib import Path

import numpy as np
import trimesh
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from build123d import Align, Box, Compound, Cylinder, import_step

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
NEW = "gear38_af7p05"

# --- printable meshes
for name in (NEW, "bore_coupon"):
    m = trimesh.load(OUT / f"{name}.stl")
    print(f"{name:14s} watertight={m.is_watertight} winding={m.is_winding_consistent} "
          f"bodies={m.body_count} extents={np.round(m.extents, 3)} vol={m.volume:.1f}")

# --- teeth unchanged
orig = import_step(str(HERE / "source" / "gear38_original.step"))
bb = orig.bounding_box(); c = bb.center()
orig = orig.translate((-c.X, -c.Y, -bb.min.Z))
new = import_step(str(OUT / f"{NEW}.step"))
core = Cylinder(6.0, 4.0, align=(Align.CENTER, Align.CENTER, Align.MIN))
to, tn = orig - core, new - core
print(f"tooth region (r > 6) difference: {(to - tn).volume + (tn - to).volume:.5f} mm^3")


# --- picture
def loops(solid, z=2.0):
    sec = solid.intersect(Box(80, 80, 0.002).translate((0, 0, z)))
    sec = Compound(list(sec)) if isinstance(sec, list) else sec
    face = max(sec.faces(), key=lambda f: f.area)
    out = []
    for w in [face.outer_wire()] + list(face.inner_wires()):
        pts = []
        for e in w.order_edges():
            seg = [(p.X, p.Y) for p in (e.position_at(t) for t in np.linspace(0, 1, 30))]
            if pts and np.hypot(*np.subtract(seg[-1], pts[-1])) < np.hypot(*np.subtract(seg[0], pts[-1])):
                seg.reverse()  # edge parameterised against the loop direction
            pts += seg
        out.append(np.array(pts))
    return out


t = np.linspace(0, 2 * np.pi, 721)
r = np.minimum(4.0, 3.5 / np.cos(((t + np.pi / 6) % (np.pi / 3)) - np.pi / 6))
fig, axs = plt.subplots(1, 3, figsize=(15, 5.2))
for ax, (title, s, zoom) in zip(axs, (("original bore: 7.20 AF hex + corner reliefs", orig, True),
                                      ("new bore: REX 7.05 AF / 8.05 corners", new, True),
                                      ("new gear, mid-height section", new, False))):
    L = loops(s)
    ax.fill(L[0][:, 0], L[0][:, 1], color="#c9ccd1", ec="#333", lw=0.5)
    for q in L[1:]:
        ax.fill(q[:, 0], q[:, 1], color="white", ec="#333", lw=0.8)
    if zoom:
        ax.plot(r * np.cos(t), r * np.sin(t), color="#d14", lw=1.2, label="REX shaft (7.00 AF / 8.00)")
        ax.set_xlim(-6.5, 6.5); ax.set_ylim(-6.5, 6.5); ax.legend(loc="lower right", fontsize=8)
    ax.set_aspect("equal"); ax.set_title(title); ax.grid(alpha=.3)
fig.tight_layout()
(HERE / "renders").mkdir(exist_ok=True)
fig.savefig(HERE / "renders" / "gear38_bore_compare.png", dpi=130)
print("wrote renders/gear38_bore_compare.png")

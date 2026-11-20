"""
Shaded views of a hood design installed on Launcher V5 (matplotlib, no Blender needed).

    python cad/launcher_v5/render_hood.py [hood_v2]
"""
import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import trimesh
from matplotlib.collections import PolyCollection

HERE = Path(__file__).resolve().parent
name = sys.argv[1] if len(sys.argv) > 1 else "hood_v2"
YAW, PITCH = (float(sys.argv[2]), float(sys.argv[3])) if len(sys.argv) > 3 else (35.0, -60.0)

m = trimesh.load(HERE / "source" / "launcher_v5.stl")
m.apply_scale(25.4)
parts = [p for p in m.split(only_watertight=False) if len(p.faces) > 100]
stock = min(parts, key=lambda p: p.bounds.mean(0)[0])
hood = trimesh.load(HERE / "out" / f"{name}.stl")
ball = trimesh.creation.icosphere(subdivisions=3, radius=71.1 / 2)
info = __import__("json").loads((HERE / "out" / f"{name}.json").read_text())
# ball drawn at the release point
rc = np.array(info["release_contact_xz"])
th = np.radians(info["face_angle_deg"])
n = np.array([-np.sin(th), -np.cos(th)])
c = rc - n * 71.1 / 2
ball.apply_translation([c[0], 0, c[1]])


def draw(ax, meshes, yaw, pitch, title):
    R = trimesh.transformations.euler_matrix(np.radians(pitch), 0, np.radians(yaw), "rxyz")[:3, :3]
    # camera looks along -Z of the rotated frame
    polys, shades, cols = [], [], []
    light = np.array([0.3, 0.5, 1.0])
    light /= np.linalg.norm(light)
    for mesh, col, alpha in meshes:
        v = mesh.vertices @ R.T
        f = mesh.faces
        nrm = mesh.face_normals @ R.T
        tri = v[f]
        polys.append(tri)
        shade = 0.35 + 0.65 * np.clip(np.abs(nrm @ light), 0, 1)
        rgba = np.array(matplotlib.colors.to_rgba(col))
        cc = np.tile(rgba, (len(f), 1))
        cc[:, :3] *= shade[:, None]
        cc[:, 3] = alpha
        cols.append(cc)
    tri = np.concatenate(polys)
    cc = np.concatenate(cols)
    order = np.argsort(tri[:, :, 2].mean(1))
    ax.add_collection(PolyCollection(tri[order][:, :, :2], facecolors=cc[order], edgecolors="none"))
    ax.autoscale()
    ax.set_aspect("equal")
    ax.axis("off")
    ax.set_title(title)


others = [p for p in parts if p is not stock]
scene_new = [(p, "#9aa3a8", 1.0) for p in others] + [(hood, "#ff7a00", 1.0), (ball, "#fab601", 0.55)]
scene_old = [(p, "#9aa3a8", 1.0) for p in others] + [(stock, "#4a7ab0", 1.0)]
fig, axs = plt.subplots(1, 3, figsize=(22, 8))
draw(axs[0], scene_old, yaw=YAW, pitch=PITCH, title="stock hood (blue)")
draw(axs[1], scene_new, yaw=YAW, pitch=PITCH, title=f"{name} (orange), ball at release")
draw(axs[2], [(hood, "#ff7a00", 1.0)], yaw=-120, pitch=-55, title=f"{name} alone: trough, lead-in, 2 inserts per side")
plt.tight_layout()
out = HERE / "renders" / f"{name}_iso.png"
plt.savefig(out, dpi=80)
print("wrote", out)

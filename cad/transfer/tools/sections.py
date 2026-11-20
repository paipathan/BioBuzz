import sys, numpy as np, trimesh, matplotlib
matplotlib.use("Agg"); import matplotlib.pyplot as plt
m = trimesh.load("source/transfer.stl"); m.apply_scale(25.4)
ys = [float(v) for v in sys.argv[1:]] or [0.0]
fig, axs = plt.subplots(1, len(ys), figsize=(9*len(ys), 8))
axs = np.atleast_1d(axs)
for ax, y in zip(axs, ys):
    from trimesh.intersections import mesh_plane
    seg = mesh_plane(m, [0,1,0], [0,y,0])
    from matplotlib.collections import LineCollection
    ax.add_collection(LineCollection(seg[:, :, [0, 2]], lw=0.6, colors="k")); ax.autoscale()
    ax.set_aspect("equal"); ax.grid(True, lw=0.3); ax.set_title(f"section Y={y} mm  (X right, Z up)")
    ax.set_xticks(np.arange(-40, 280, 20)); ax.set_yticks(np.arange(-200, 40, 20))
plt.tight_layout(); plt.savefig("renders/sections.png", dpi=110)

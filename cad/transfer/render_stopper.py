"""Section drawing (matplotlib) + Blender renders of ramp v2 and the stopper.
    cad/.venv/Scripts/python.exe -I cad/transfer/render_stopper.py
"""
import json, subprocess, sys
from pathlib import Path
import numpy as np, trimesh, matplotlib
matplotlib.use("Agg"); import matplotlib.pyplot as plt
from matplotlib.collections import LineCollection
from trimesh.intersections import mesh_plane
HERE = Path(__file__).resolve().parent; OUT = HERE / "out"; REN = HERE / "renders"
info = json.loads((OUT / "stopper.json").read_text())
R = 35.5; A3 = (114.01, -55.92); A4 = (75.61, -20.13)

def sec(mesh, y):
    s = mesh_plane(mesh, [0, 1, 0], [0, y, 0]); return s[:, :, [0, 2]] if len(s) else np.zeros((0, 2, 2))

# balls: one at the stop pose, one queued behind it
c = info["stop_ball_centre_xz"]; pth = np.load(OUT / "path_patched.npy")
k = np.argmin(np.linalg.norm(pth - c, axis=1)); d = np.linalg.norm(pth - pth[k], axis=1)
j = np.where((d > 71) & (np.arange(len(pth)) < k))[0][-1]
for name, cc in [("_ball_stop", c), ("_ball_queue", pth[j])]:
    b = trimesh.creation.icosphere(4, R); b.apply_translation([cc[0], 0, cc[1]]); b.export(OUT / f"{name}.stl")

ramp = trimesh.load(OUT / "ramp_v2.stl"); stock = trimesh.load(OUT / "stock_ramp.stl")
fc = trimesh.load(OUT / "flap_closed.stl"); fo = trimesh.load(OUT / "flap_open.stl")
servo = trimesh.load(OUT / "servo_v2.stl"); rest = trimesh.load(OUT / "_rest.stl")
fig, axs = plt.subplots(1, 2, figsize=(20, 10))
for ax, (title, y, lim) in zip(axs, [("Section at Y = 0 (ball centreline), looking from +Y", 0.0, (-40, 140, -160, 10)),
                                     ("Same section, zoomed: closed (red) and open (blue dashed)", 0.0, (-15, 75, -150, -60))]):
    ax.add_collection(LineCollection(sec(rest, -20.0), lw=.4, colors="0.7"))
    ax.add_collection(LineCollection(sec(ramp, y), lw=1.2, colors="#b07020"))
    ax.add_collection(LineCollection(sec(fc, y), lw=1.6, colors="#d23c3c"))
    ax.add_collection(LineCollection(sec(fo, y), lw=1.2, colors="#2060d0", linestyles="--"))
    ax.add_collection(LineCollection(sec(servo, 30.0), lw=.9, colors="#333840"))
    c = info["stop_ball_centre_xz"]
    ax.add_patch(plt.Circle(c, R, color="#f5d90a", alpha=.45))
    for a, lab in [(A3, "axle 3"), (A4, "top axle")]:
        ax.add_patch(plt.Circle(a, 24, fill=False, color="g", lw=1)); ax.add_patch(plt.Circle(a, 24 + R, fill=False, color="g", lw=.5, ls=":"))
        ax.text(a[0], a[1], lab, ha="center", va="center", fontsize=9, color="g", clip_on=True)
    p = info["pivot_xz"]; ax.plot(*p, "k+", ms=12); ax.text(p[0] + 3, p[1] - 6, "servo axis", fontsize=9)
    ax.set_xlim(lim[0], lim[1]); ax.set_ylim(lim[2], lim[3]); ax.set_aspect("equal"); ax.grid(True, lw=.3); ax.set_title(title)
    ax.set_xlabel("X (mm)"); ax.set_ylabel("Z (mm)")
axs[0].text(c[0] + 2, c[1] - 6, f"ball stops {info['gap_to_top_wheels_mm']:.0f} mm\nshort of top wheels", fontsize=9)
axs[0].text(-35, 5, "grey: wheels/plates at Y=-20   dark: servo at Y=+30   dotted green: ball-centre contact limit", fontsize=8)
plt.tight_layout(); plt.savefig(REN / "stopper_section.png", dpi=90)

W = str(OUT).replace("\\", "/")
BL = "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe"
def blend(out, views, files, extra=()):
    subprocess.run([BL, "-b", "-P", str(HERE / "tools" / "render_stl.py"), "--", "--out", str(REN / out), "--views", views,
                    "--size", "1400x1100", *extra, *[f"{W}/{f}" for f in files]], check=True, capture_output=True)
common = ["servo_v2.stl:333840", "horn_v2.stl:9aa0aa"]
blend("stopper_closed", "inside=0.9:0.55:0.35,behind=-0.75:0.45:-0.5",
      ["ramp_v2.stl:f0a050", "flap_closed.stl:d23c3c", *common, "_ball_stop.stl:f5d90a", "_ball_queue.stl:f5d90a"],
      ["--target", "20,0,-95", "--scale", "230"])
blend("stopper_open", "inside=0.9:0.55:0.35,behind=-0.75:0.45:-0.5",
      ["ramp_v2.stl:f0a050", "flap_open.stl:2060d0", *common], ["--target", "20,0,-95", "--scale", "230"])
blend("ramp_stock", "slot=-0.6:-1:0.3", ["stock_ramp.stl:f0a050"], ["--target", "0,-30,-45", "--scale", "140"])
blend("ramp_patched", "slot=-0.6:-1:0.3", ["ramp_patched.stl:f0a050"], ["--target", "0,-30,-45", "--scale", "140"])
blend("stopper_assembly", "iso=0.7:1:0.55", ["ramp_v2.stl:f0a050", "flap_closed.stl:d23c3c", *common,
      "_ball_stop.stl:f5d90a", "_rest.stl:b8c4d0"])
print("done")

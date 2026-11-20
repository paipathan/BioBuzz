"""
Check a hood design against Launcher V5: collisions, then ball squeeze / release angle vs ball size.

    python cad/launcher_v5/check_hood.py [hood_v2 hood_v2_sq4.0 ...]

Needs trimesh, scipy, rtree, matplotlib (system Python has them; the cad venv lacks scipy).
The stock hood is analysed too, for comparison. Results go to out/check_<name>.json and
renders/hood_compare.png.
"""
import json
import sys
from pathlib import Path

import numpy as np
import trimesh
from scipy.spatial import cKDTree

HERE = Path(__file__).resolve().parent
IN = 25.4
R_WHEEL, WHEEL_HALF_W = 36.0, 32.0
BALLS = (70.0, 70.5, 71.1, 71.7, 72.2)


def load_launcher():
    m = trimesh.load(HERE / "source" / "launcher_v5.stl")
    m.apply_scale(IN)
    parts = [p for p in m.split(only_watertight=False) if len(p.faces) > 100]
    stock = min(parts, key=lambda p: p.bounds.mean(0)[0])          # hood channel = furthest -X part
    others = [p for p in parts if p is not stock]
    return stock, others


def collisions(hood, others):
    """Volume-ish overlap test: hood surface samples inside other watertight parts and vice versa.
    Points within 0.15 mm of a face count as contact (the hood is meant to touch the plates)."""
    hits = []
    hs, _ = trimesh.sample.sample_surface_even(hood, 60000)
    for i, p in enumerate(others):
        name = f"part{i} ctr={np.round(p.bounds.mean(0), 1).tolist()} size={np.round(p.extents, 1).tolist()}"
        if p.is_watertight:
            inside = p.contains(hs)
            if inside.any():
                d = trimesh.proximity.ProximityQuery(p).signed_distance(hs[inside])
                deep = d[d > 0.15]
                if len(deep):
                    hits.append((name, int(len(deep)), float(deep.max())))
            ps, _ = trimesh.sample.sample_surface_even(p, 20000)
            inside2 = hood.contains(ps)
            if inside2.any():
                d = trimesh.proximity.ProximityQuery(hood).signed_distance(ps[inside2])
                deep = d[d > 0.15]
                if len(deep):
                    hits.append((name + " (in hood)", int(len(deep)), float(deep.max())))
    # wheels are not watertight: analytic cylinder check
    v = hood.vertices
    near = (np.abs(v[:, 1]) < WHEEL_HALF_W) & (np.hypot(v[:, 0], v[:, 2]) < R_WHEEL + 0.5)
    if near.any():
        hits.append(("tyre cylinder", int(near.sum()), float(R_WHEEL - np.hypot(v[near, 0], v[near, 2]).min())))
    return hits


def ball_map(hood, h=0.5):
    """Distance from ball-centre grid points (y = 0 plane) to the hood surface (negative = inside)."""
    xs = np.arange(-125, -30, h)
    zs = np.arange(-75, 45, h)
    X, Z = np.meshgrid(xs, zs)
    C = np.stack([X.ravel(), np.zeros(X.size), Z.ravel()], 1)
    sp, _ = trimesh.sample.sample_surface_even(hood, 500000)
    dist, _ = cKDTree(np.vstack([sp, hood.vertices])).query(C)
    inside = np.concatenate([hood.contains(C[i:i + 20000]) for i in range(0, len(C), 20000)])
    return X, Z, np.where(inside, -dist, dist).reshape(X.shape)


def release(X, Z, dg, D):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    rb = D / 2
    cs = plt.contour(X, Z, dg, levels=[rb])
    plt.close()
    segs = [s for s in cs.allsegs[0] if len(s) > 10]
    if not segs:
        return None
    seg = max(segs, key=len)
    seg = seg[(seg[:, 0] > -100) & (seg[:, 1] < 40)]
    seg = seg[np.argsort(seg[:, 1])]
    sq = rb + R_WHEEL - np.hypot(seg[:, 0], seg[:, 1])
    on = np.where(sq > 0)[0]
    if len(on) == 0:
        return dict(ball=D, squeeze=0.0)
    i0, i1 = on[0], on[-1]
    k = 7
    a, b = seg[max(i1 - k, 0)], seg[min(i1 + k, len(seg) - 1)]
    v = b - a
    length = float(np.sum(np.hypot(*np.diff(seg[i0:i1 + 1], axis=0).T)))
    return dict(ball=D, squeeze=round(float(sq.max()), 2), contact_mm=round(length, 1),
                release_deg=round(float(np.degrees(np.arctan2(v[1], -v[0]))), 1),
                release_centre=[round(float(x), 1) for x in seg[i1]], seg=seg, on=on)


def main(names):
    stock, others = load_launcher()
    results = {}
    designs = [("stock", stock)] + [(n, trimesh.load(HERE / "out" / f"{n}.stl")) for n in names]
    for name, hood in designs:
        print(f"\n== {name}: watertight={hood.is_watertight} volume={hood.volume:.0f} mm3")
        if name != "stock":
            hits = collisions(hood, others)
            print("  collisions:", "none" if not hits else hits)
        X, Z, dg = ball_map(hood)
        rows = [release(X, Z, dg, D) for D in BALLS]
        for r in rows:
            if r is None or r.get("squeeze", 0) == 0:
                print(f"  ball Ø{r['ball'] if r else '?'}: no tyre contact")
            else:
                print(f"  ball Ø{r['ball']}: squeeze {r['squeeze']:4.2f} mm, contact {r['contact_mm']:4.1f} mm, "
                      f"release {r['release_deg']:5.1f}°")
        results[name] = dict(rows=rows, X=X, Z=Z, dg=dg, hood=hood,
                             collisions=None if name == "stock" else hits)
        out = {k: v for k, v in results[name].items() if k in ("collisions",)}
        out["rows"] = [{k: v for k, v in r.items() if k not in ("seg", "on")} for r in rows if r]
        (HERE / "out" / f"check_{name}.json").write_text(json.dumps(out, indent=2))
    plot(results)


def plot(results):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    m = trimesh.load(HERE / "source" / "launcher_v5.stl")
    m.apply_scale(IN)
    plate = [p for p in m.split(only_watertight=False) if abs(p.bounds.mean(0)[1] - 47.6) < 1][0]
    names = list(results)
    fig, axs = plt.subplots(1, len(names), figsize=(7.5 * len(names), 8))
    axs = np.atleast_1d(axs)
    for ax, name in zip(axs, names):
        r = results[name]
        for e in plate.section(plane_origin=[0, 47.6, 0], plane_normal=[0, 1, 0]).discrete:
            ax.fill(e[:, 0], e[:, 2], color="#e3e8e8", zorder=0)
        ax.add_patch(plt.Circle((0, 0), R_WHEEL, color="#e8a33c"))
        ax.add_patch(plt.Circle((0, 0), 28, color="w"))
        for yy, alpha in ((0, .85), (41, .35)):
            sec = r["hood"].section(plane_origin=[0, yy, 0], plane_normal=[0, 1, 0])
            if sec is not None:
                for e in sec.discrete:
                    ax.fill(e[:, 0], e[:, 2], color="#4a7ab0", alpha=alpha)
        nominal = next(x for x in r["rows"] if x and x["ball"] == 71.1)
        if "seg" in nominal:
            seg, on = nominal["seg"], nominal["on"]
            sq = 71.1 / 2 + R_WHEEL - np.hypot(seg[on, 0], seg[on, 1])
            ax.scatter(seg[on, 0], seg[on, 1], c=sq, cmap="inferno_r", s=6, vmin=0, vmax=7, zorder=5)
            c = seg[on[-1]]
            ax.add_patch(plt.Circle(c, 71.1 / 2, fill=False, color="#6a4c93", lw=1.6))
            ang = np.radians(nominal["release_deg"])
            ax.annotate("", xy=c + 45 * np.array([-np.cos(ang), np.sin(ang)]), xytext=c,
                        arrowprops=dict(arrowstyle="-|>", lw=2, color="#6a4c93"))
        txt = "ball Ø  squeeze  release\n" + "\n".join(
            f"{x['ball']:5.1f}  {x.get('squeeze', 0):4.1f} mm  " +
            (f"{x['release_deg']:5.1f}°" if x.get("squeeze", 0) > 0 else "  none")
            for x in r["rows"] if x)
        ax.text(-160, -95, txt, family="monospace", fontsize=9, va="bottom", bbox=dict(fc="w", ec="#999"))
        ax.set_xlim(-165, 50)
        ax.set_ylim(-100, 60)
        ax.set_aspect("equal")
        ax.grid(alpha=.25)
        ax.set_title(f"{name}: hood section (dark = ball centreline, light = cheek)")
    plt.tight_layout()
    (HERE / "renders").mkdir(exist_ok=True)
    plt.savefig(HERE / "renders" / "hood_compare.png", dpi=85)
    print("\nwrote", HERE / "renders" / "hood_compare.png")


if __name__ == "__main__":
    main(sys.argv[1:] or ["hood_v2"])

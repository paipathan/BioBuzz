"""Ball-centre path at Y=0: for each ray from the ramp arc centre, the point whose 2D distance to the
ramp section is exactly R (ball resting on the ramp)."""
import numpy as np, trimesh
from trimesh.intersections import mesh_plane
R = 71.0 / 2; RW = 24.0
C0 = np.array([213.8, 65.9])
A3 = np.array([114.01, -55.92]); A4 = np.array([75.61, -20.13])

def seg_dist(P, S):
    a, b = S[:, 0], S[:, 1]; ab = b - a; L = (ab ** 2).sum(1) + 1e-12
    t = np.clip(((P[:, None, :] - a) * ab).sum(2) / L, 0, 1)
    q = a + t[..., None] * ab
    return np.linalg.norm(P[:, None, :] - q, axis=2).min(1)

def path_for(ramp, y=0.0):
    S = mesh_plane(ramp, [0, 1, 0], [0, y, 0])[:, :, [0, 2]]
    a0 = np.arctan2(S[..., 1] - C0[1], S[..., 0] - C0[0])
    angs = np.linspace(a0.max(), a0.min(), 1500)  # bottom-right -> top-left
    rho = np.linspace(120, 262, 1500)
    out = []
    for a in angs:
        P = C0 + rho[:, None] * np.array([np.cos(a), np.sin(a)])
        d = seg_dist(P, S)
        hit = np.where(d <= R)[0]
        if len(hit) == 0: continue
        k = hit[0]
        if k == 0: continue
        # linear interp between k-1 and k
        f = (d[k - 1] - R) / (d[k - 1] - d[k]); out.append(P[k - 1] + f * (P[k] - P[k - 1]))
    return np.array(out)

def resample(path, step=0.25):
    s = np.r_[0, np.cumsum(np.linalg.norm(np.diff(path, axis=0), axis=1))]
    ss = np.arange(0, s[-1], step)
    return ss, np.c_[np.interp(ss, s, path[:, 0]), np.interp(ss, s, path[:, 1])]

if __name__ == "__main__":
    import sys
    ramp = trimesh.load(sys.argv[1] if len(sys.argv) > 1 else "out/stock_ramp.stl")
    ss, P = resample(path_for(ramp))
    np.save("out/ball_path.npy", P)
    d3 = np.linalg.norm(P - A3, axis=1); d4 = np.linalg.norm(P - A4, axis=1)
    i3 = np.where(d3 < RW + R)[0]; i4 = np.where(d4 < RW + R)[0]
    print("path length %.0f" % ss[-1])
    print("A3 contact s=%.1f..%.1f   A4 contact s=%.1f..%.1f" % (ss[i3[0]], ss[i3[-1]], ss[i4[0]], ss[i4[-1]]))
    print("A3 max squeeze %.1f  A4 max squeeze %.1f" % (RW + R - d3.min(), RW + R - d4.min()))
    for k in [i3[-1], i4[0]]:
        print("s=%.1f centre %s d3=%.1f d4=%.1f" % (ss[k], np.round(P[k], 1), d3[k], d4[k]))

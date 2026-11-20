"""
robotcad - helpers for working with the team robot CAD (Onshape STEP export).

Typical use from a design script (run with cad/.venv/Scripts/python.exe):

    import sys; sys.path.insert(0, r"<repo>/cad/robot/tools")
    from robotcad import load_robot, find, world_bbox, collisions, export_new, render

    robot = load_robot()                 # cached after first run (~60s cold, faster warm)
    wheels = find(robot, "Gecko")        # regex search on part labels
    print(world_bbox(robot))

    from build123d import *
    bracket = Pos(0, 120, 60) * Box(40, 20, 3)     # model the new thing in robot coordinates
    print(collisions(robot, bracket))              # which existing parts it hits
    export_new("my_bracket", {"bracket": (bracket, "#ff7a00")})   # -> designs/out/*.glb/.step
    render("my_bracket", ghost=True)               # -> renders/my_bracket_<view>.png

Coordinate frame (as exported from Onshape, millimetres):
    +X = front (intake end), +Y = robot left, +Z = up.  Z=0 is the bottom face of
    the frame rails. See cad/robot/README.md for the subsystem map.
"""
from __future__ import annotations

import json
import re
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent          # cad/robot
SOURCE_STEP = ROOT / "source" / "robot.step"
CACHE_BREP = ROOT / "source" / "robot_cache.brep"      # gitignored, rebuilt from STEP
CACHE_META = ROOT / "source" / "robot_cache.json"
INDEX_DIR = ROOT / "index"
OUT_DIR = ROOT / "designs" / "out"


# ---------------------------------------------------------------- loading
def load_robot(force: bool = False):
    """Return the full robot as a build123d Compound (assembly tree with labels/colors).

    Uses a pickle cache next to the STEP; it is invalidated automatically when the
    STEP file is newer than the cache.
    """
    from build123d import import_step

    if (not force and CACHE_BREP.exists() and CACHE_META.exists()
            and CACHE_BREP.stat().st_mtime >= SOURCE_STEP.stat().st_mtime):
        t = time.time()
        try:
            robot = _load_cache()
            print(f"[robotcad] loaded cache in {time.time() - t:.1f}s")
            return robot
        except Exception as e:
            print(f"[robotcad] cache unreadable ({e}); re-parsing STEP")

    t = time.time()
    robot = import_step(str(SOURCE_STEP))
    print(f"[robotcad] parsed STEP in {time.time() - t:.1f}s")
    try:
        _save_cache(robot)
    except Exception as e:  # cache is an optimisation only
        print(f"[robotcad] could not write cache: {e}")
        CACHE_BREP.unlink(missing_ok=True)
        CACHE_META.unlink(missing_ok=True)
    return robot


def _save_cache(robot):
    """BREP of all leaves (in order) + JSON describing the tree, labels and colours."""
    from build123d import Compound, export_brep

    flat = []

    def rec(n):
        kids = list(getattr(n, "children", ()) or ())
        node = {"label": n.label, "color": tuple(n.color) if n.color is not None else None}
        if kids:
            node["children"] = [rec(k) for k in kids]
        else:
            node["leaf"] = len(flat)
            flat.append(n)
        return node

    tree = rec(robot)
    export_brep(Compound(flat), str(CACHE_BREP))
    CACHE_META.write_text(json.dumps(tree), encoding="utf-8")


def _load_cache():
    from build123d import Color, Compound, Shape, import_brep

    flat = list(import_brep(str(CACHE_BREP)))  # top-level sub-shapes, original order
    # import_brep returns a Compound; iterating gives its direct children
    tree = json.loads(CACHE_META.read_text(encoding="utf-8"))

    def build(node):
        if "leaf" in node:
            s = flat[node["leaf"]]
            s = Shape.cast(s.wrapped) if not hasattr(s, "label") else s
        else:
            s = Compound(children=[build(k) for k in node["children"]])
        s.label = node["label"] or ""
        if node["color"] is not None:
            s.color = Color(*node["color"])
        return s

    return build(tree)


# ---------------------------------------------------------------- queries
def clean_label(label: str | None) -> str:
    """Onshape labels come through with '_' for spaces and a mangled (R) sign."""
    if not label:
        return ""
    return label.replace("�", "").replace("®", "")


def leaves(node, path=()):
    """Yield (path_tuple, solid_or_shape) for every leaf part in the tree."""
    kids = list(getattr(node, "children", ()) or ())
    here = path + (clean_label(node.label),)
    if not kids:
        yield here, node
    else:
        for k in kids:
            yield from leaves(k, here)


def find(robot, pattern: str, flags=re.IGNORECASE):
    """All nodes (any depth) whose label matches the regex/substring `pattern`."""
    rx = re.compile(pattern, flags)
    out = []

    def rec(n):
        if rx.search(clean_label(n.label)):
            out.append(n)
        for k in (getattr(n, "children", ()) or ()):
            rec(k)

    rec(robot)
    return out


def world_bbox(shape):
    """(min_xyz, max_xyz, size_xyz) as plain tuples, mm."""
    bb = shape.bounding_box()
    return ((bb.min.X, bb.min.Y, bb.min.Z),
            (bb.max.X, bb.max.Y, bb.max.Z),
            (bb.size.X, bb.size.Y, bb.size.Z))


def color_hex(shape) -> str | None:
    c = getattr(shape, "color", None)
    if c is None:
        return None
    r, g, b, *_ = tuple(c)
    return "#%02x%02x%02x" % (round(r * 255), round(g * 255), round(b * 255))


def interferes(a, b, tol: float = 1e-3) -> float:
    """Volume (mm^3) of overlap between two shapes; 0 means no collision."""
    common = a & b
    try:
        return max(0.0, common.volume) if common is not None else 0.0
    except Exception:
        return 0.0


def collisions(robot, new_shape, min_volume: float = 1.0):
    """List (label, overlap_mm3) for existing parts that the new shape collides with.

    Cheap bbox prefilter, then exact boolean on candidates only.
    """
    nb = new_shape.bounding_box(optimal=False)
    hits = []
    for path, part in leaves(robot):
        pb = part.bounding_box(optimal=False)   # loose but fast prefilter
        if (pb.max.X < nb.min.X or pb.min.X > nb.max.X or
                pb.max.Y < nb.min.Y or pb.min.Y > nb.max.Y or
                pb.max.Z < nb.min.Z or pb.min.Z > nb.max.Z):
            continue
        v = interferes(part, new_shape)
        if v >= min_volume:
            hits.append(("/".join(path[1:]), v))
    return sorted(hits, key=lambda h: -h[1])


# ---------------------------------------------------------------- export
def _colored(shape, color, label):
    from build123d import Color
    s = shape
    if color is not None:
        s.color = Color(color) if not isinstance(color, Color) else color
    s.label = label
    return s


BLENDER = Path(r"C:/Program Files/Blender Foundation/Blender 5.2/blender.exe")
ROBOT_GLB = INDEX_DIR / "robot.glb"
ROBOT_BLEND = INDEX_DIR / "robot.blend"   # pre-baked by extract.py; loads ~10x faster


def export_new(name: str, new_parts: dict, step: bool = True, stl: bool = False):
    """Write the NEW parts only: designs/out/<name>.glb (+ <name>.step, optional per-part STL).

    new_parts: {label: shape} or {label: (shape, "#rrggbb")}, modelled in robot coordinates.
    Objects are named 'NEW:<label>' so render() can frame / highlight them.
    """
    from build123d import Compound, export_gltf, export_step, export_stl

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    news = []
    for label, v in new_parts.items():
        shape, color = (v if isinstance(v, tuple) else (v, "#ff7a00"))
        news.append(_colored(shape, color, f"NEW:{label}"))
        if stl:
            export_stl(shape, str(OUT_DIR / f"{name}_{label}.stl"))
    comp = Compound(children=news, label=name)
    glb = OUT_DIR / f"{name}.glb"
    export_gltf(comp, str(glb), binary=True, linear_deflection=0.1, angular_deflection=0.2)
    if step:
        export_step(comp, str(OUT_DIR / f"{name}.step"))
    print(f"[robotcad] wrote {glb}")
    return glb


def render(name: str, views="iso,front,side,top", focus: str | None = "NEW:",
           ghost: bool = False, hide: str | None = None, with_robot: bool = True,
           size="1400x1050", extra_glbs=(), save_blend=False, engine="workbench",
           hide_boxes=None, out_name=None, glb_name=None, rotate=(), margin=None):
    """Render designs/out/<name>.glb over the robot with headless Blender.

    Returns the list of PNG paths (renders/<name>_<view>.png).
    hide: regex of robot part names to drop (e.g. the part a new design replaces).
    focus=None frames the whole robot; ghost=True fades the robot around the new parts.
    """
    import subprocess

    out_prefix = ROOT / "renders" / (out_name or name)
    out_prefix.parent.mkdir(parents=True, exist_ok=True)
    use_base = with_robot and ROBOT_BLEND.exists()
    glbs = ([ROBOT_GLB] if with_robot and not use_base else []) + list(extra_glbs)
    new_glb = OUT_DIR / f"{glb_name or name}.glb"
    if new_glb.exists():
        glbs.append(new_glb)
    cmd = [str(BLENDER), "-b", "-P", str(ROOT / "tools" / "render.py"), "--"]
    if use_base:
        cmd += ["--base", str(ROBOT_BLEND)]
    for g in glbs:
        cmd += ["--glb", str(g)]
    cmd += ["--out", str(out_prefix), "--views", views, "--size", size, "--engine", engine]
    if focus and new_glb.exists():
        cmd += ["--focus", focus]
    if ghost:
        cmd += ["--ghost"]
    if hide:
        cmd += ["--hide", hide]
    if hide_boxes:
        cmd += ["--hide-boxes", json.dumps(hide_boxes)]
    for r in rotate:
        cmd += ["--rotate", json.dumps(r)]
    if margin:
        cmd += ["--margin", str(margin)]
    if save_blend:
        cmd += ["--save-blend"]
    r = subprocess.run(cmd, capture_output=True, text=True)
    pngs = [line.split("wrote ", 1)[1].strip() for line in r.stdout.splitlines()
            if line.startswith("[render] wrote") and line.strip().endswith(".png")]
    if r.returncode or not pngs:
        print(r.stdout[-3000:], r.stderr[-3000:])
        raise RuntimeError("Blender render failed")
    for p in pngs:
        print(f"[robotcad] {p}")
    return pngs

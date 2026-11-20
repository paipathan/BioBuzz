"""
Headless Blender renderer for robot scenes.

    "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b -P cad/robot/tools/render.py -- \
        --glb cad/robot/index/robot.glb [--glb other.glb ...] \
        --out cad/robot/renders/robot  [--views iso,front,side,top,back,iso_back] \
        [--focus NEW:] [--ghost] [--engine workbench|eevee] [--size 1600x1200] [--save-blend]

  --glb      one or more glTF/GLB files (meshes keep their part names and colours)
  --out      output prefix; writes <out>_<view>.png
  --views    comma list of: iso, iso_back, iso_left, front, back, left, right, top, bottom,
             or custom "name=x:y:z" (direction from the robot to the camera)
  --focus    regex on object names; camera frames those objects instead of everything
             (new parts exported by robotcad.export_scene are named 'NEW:<label>')
  --ghost    draw every object NOT matching --focus semi-transparent so the new part pops
  --hide     regex on object names to drop from the scene entirely
  --hide-boxes  JSON list of mm boxes; robot parts whose centre is inside are dropped
                (use for parts with generic names like Part_1)
  --base     start from a pre-baked .blend (index/robot.blend) instead of importing GLBs
  --save-blend  also save <out>.blend to open/tweak interactively (use --views "" to only save)

Robot frame: +X = front (intake), +Y = robot left, +Z = up (mm in CAD, metres in Blender).
"""
import argparse
import math
import re
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--glb", action="append", default=[])
ap.add_argument("--base", default=None, help=".blend to start from (pre-baked robot, much faster than --glb)")
ap.add_argument("--out", required=True)
ap.add_argument("--views", default="iso,front,side,top")
ap.add_argument("--focus", default=None)
ap.add_argument("--ghost", action="store_true")
ap.add_argument("--hide", default=None)
ap.add_argument("--rotate", default=None, action="append",
                help='JSON {"boxes":[[x0,y0,z0,x1,y1,z1],..],"point":[x,y,z],"axis":[0,0,1],"deg":a} mm; '
                     'rotates robot parts centred in the boxes (e.g. turn the turret)')
ap.add_argument("--hide-boxes", default=None, help='JSON [[x0,y0,z0,x1,y1,z1],...] mm: drop robot parts centred inside')
ap.add_argument("--engine", default="workbench")
ap.add_argument("--size", default="1600x1200")
ap.add_argument("--margin", type=float, default=None,
                help="frame size multiplier (default 1.15 whole robot, 2.2 with --focus)")
ap.add_argument("--save-blend", action="store_true")
args = ap.parse_args(argv)
import os
args.out = os.path.abspath(args.out)
args.glb = [os.path.abspath(g) for g in args.glb]
args.base = os.path.abspath(args.base) if args.base else None

# ------------------------------------------------------------------ scene
if args.base:
    bpy.ops.wm.open_mainfile(filepath=args.base)
    for o in [o for o in bpy.data.objects if o.type in ("CAMERA", "LIGHT")]:
        bpy.data.objects.remove(o, do_unlink=True)
else:
    bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
if args.hide_boxes:
    # remove existing robot parts whose bbox centre (mm) falls in any box [x0,y0,z0,x1,y1,z1]
    import json
    boxes = json.loads(args.hide_boxes)
    n = 0
    for o in [o for o in scene.objects if o.type == "MESH"]:
        c = sum((o.matrix_world @ Vector(b) for b in o.bound_box), Vector()) / 8 * 1000
        if any(b[0] <= c.x <= b[3] and b[1] <= c.y <= b[4] and b[2] <= c.z <= b[5] for b in boxes):
            bpy.data.objects.remove(o, do_unlink=True); n += 1
    print(f"[render] hid {n} parts by box")
for spec in args.rotate or []:
    import json
    from mathutils import Matrix
    r = json.loads(spec)
    pt = Vector(r["point"]) / 1000
    R = Matrix.Translation(pt) @ Matrix.Rotation(math.radians(r["deg"]), 4, Vector(r["axis"])) @         Matrix.Translation(-pt)
    n = 0
    for o in [o for o in scene.objects if o.type == "MESH"]:
        c = sum((o.matrix_world @ Vector(b) for b in o.bound_box), Vector()) / 8 * 1000
        if any(b[0] <= c.x <= b[3] and b[1] <= c.y <= b[4] and b[2] <= c.z <= b[5] for b in r["boxes"]):
            o.matrix_world = R @ o.matrix_world; n += 1
    print(f"[render] rotated {n} parts by {r['deg']} deg")
for path in args.glb:
    bpy.ops.import_scene.gltf(filepath=path)

meshes = [o for o in scene.objects if o.type == "MESH"]
if args.hide:
    rx = re.compile(args.hide, re.I)
    for o in list(meshes):
        if rx.search(o.name) or (o.parent and rx.search(o.parent.name)):
            bpy.data.objects.remove(o, do_unlink=True)
    meshes = [o for o in scene.objects if o.type == "MESH"]


def full_name(o):
    """Object name plus ancestors (glTF importer puts labels on parent empties sometimes)."""
    names, p = [o.name], o.parent
    while p:
        names.append(p.name)
        p = p.parent
    return " / ".join(names)


focus_rx = re.compile(args.focus, re.I) if args.focus else None
focus = [o for o in meshes if focus_rx and focus_rx.search(full_name(o))]
if focus_rx and not focus:
    print(f"[render] WARNING: --focus {args.focus!r} matched nothing; framing everything")

# ------------------------------------------------------------------ materials
if args.ghost and focus:
    ghost = bpy.data.materials.new("ghost")
    ghost.diffuse_color = (0.75, 0.78, 0.82, 0.18)
    ghost.use_nodes = True
    bsdf = next(n for n in ghost.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (0.75, 0.78, 0.82, 1)
    bsdf.inputs["Alpha"].default_value = 0.18
    try:
        ghost.surface_render_method = "BLENDED"
    except Exception:
        pass
    fset = set(focus)
    for o in meshes:
        if o not in fset:
            o.data.materials.clear()
            o.data.materials.append(ghost)

# glTF importer stores colour on the Principled node; workbench "MATERIAL" colour reads
# material.diffuse_color, so copy it across.
for m in bpy.data.materials:
    if m.use_nodes and m.node_tree:
        b = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if b:
            c = list(b.inputs["Base Color"].default_value)
            a = b.inputs["Alpha"].default_value
            m.diffuse_color = (c[0], c[1], c[2], a)

# ------------------------------------------------------------------ bounds
def bounds(objs):
    lo = Vector((1e9, 1e9, 1e9)); hi = Vector((-1e9, -1e9, -1e9))
    for o in objs:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            lo = Vector(map(min, lo, w)); hi = Vector(map(max, hi, w))
    return lo, hi


def framing_set(objs):
    """Drop tiny stray parts far from everything else so they don't wreck the zoom."""
    if len(objs) < 10:
        return objs
    big = [o for o in objs if max(o.dimensions) > 0.012]  # > 12 mm
    if not big:
        return objs
    blo, bhi = bounds(big)
    pad = (bhi - blo) * 0.1
    keep = []
    for o in objs:
        c = o.matrix_world @ (sum((Vector(b) for b in o.bound_box), Vector()) / 8)
        if all(blo[i] - pad[i] <= c[i] <= bhi[i] + pad[i] for i in range(3)):
            keep.append(o)
    return keep


if args.margin is None:
    args.margin = 2.2 if focus else 1.15
lo, hi = bounds(framing_set(focus or meshes))
center = (lo + hi) / 2
radius = max((hi - lo).length / 2, 1e-3)
# whole-scene bounds: the camera must always stay outside these
slo, shi = bounds(framing_set(meshes))
scene_center = (slo + shi) / 2
scene_radius = max((shi - slo).length / 2, radius)


def exit_distance(p, d):
    """Distance from p along unit d until leaving the scene bbox."""
    t = 1e9
    for i in range(3):
        if abs(d[i]) > 1e-9:
            t = min(t, ((shi[i] if d[i] > 0 else slo[i]) - p[i]) / d[i])
    return max(t, 0.0)

# ------------------------------------------------------------------ render setup
w, h = (int(v) for v in args.size.lower().split("x"))
scene.render.resolution_x, scene.render.resolution_y = w, h
scene.render.film_transparent = False
world = scene.world or bpy.data.worlds.new("w"); scene.world = world
world.color = (0.94, 0.95, 0.97)

if args.engine == "workbench":
    scene.render.engine = "BLENDER_WORKBENCH"
    sh = scene.display.shading
    sh.light = "STUDIO"
    sh.color_type = "MATERIAL"
    sh.show_cavity = True
    sh.cavity_type = "BOTH"
    sh.show_object_outline = True
    sh.object_outline_color = (0.1, 0.1, 0.1)
    sh.show_specular_highlight = True
    sh.background_type = "WORLD"
    sh.background_color = (0.94, 0.95, 0.97)
    scene.display.render_aa = "8"
else:
    for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
        try:
            scene.render.engine = eng
            break
        except TypeError:
            continue
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3.0
    sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(30))
    scene.collection.objects.link(sun)
    world.use_nodes = True
    bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs[0].default_value = (0.9, 0.92, 0.95, 1); bg.inputs[1].default_value = 1.0

cam_data = bpy.data.cameras.new("cam")
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
cam_data.clip_start = scene_radius * 0.01
cam_data.clip_end = scene_radius * 100

VIEWS = {  # direction FROM centre TO camera, robot frame (+X front, +Y left, +Z up)
    "iso": (1.0, -0.9, 0.75),
    "iso_back": (-1.0, 0.9, 0.75),
    "iso_left": (1.0, 0.9, 0.75),
    "front": (1, 0, 0), "back": (-1, 0, 0),
    "side": (0, -1, 0), "right": (0, -1, 0), "left": (0, 1, 0),
    "top": (0, 0, 1), "bottom": (0, 0, -1),
}

def auto_side(view, vec):
    """With --focus, flip iso/side views so the camera is on the same side as the new part."""
    if not focus or view not in ("iso", "iso_back", "iso_left", "side"):
        return vec
    x, y, z = vec
    off = center - scene_center
    if abs(off.y) > 0.01 and y != 0:
        y = abs(y) * (1 if off.y > 0 else -1)
    if view.startswith("iso") and abs(off.x) > 0.01:
        x = abs(x) * (1 if off.x > 0 else -1)
    return (x, y, z)


# custom views: "name=x:y:z" (direction from target to camera, robot frame)
for spec in [v.strip() for v in args.views.split(",") if "=" in v]:
    nm, vec = spec.split("=", 1)
    VIEWS[nm] = tuple(float(t) for t in vec.split(":"))
args.views = ",".join(v.split("=", 1)[0] for v in args.views.split(","))

for view in [v.strip() for v in args.views.split(",") if v.strip()]:
    d = Vector(auto_side(view, VIEWS[view])).normalized()
    ortho = view in ("front", "back", "side", "right", "left", "top", "bottom")
    cam_data.type = "ORTHO" if ortho else "PERSP"
    if ortho:
        # size the ortho window to the bbox projected on the view plane
        ext = hi - lo
        if view in ("front", "back"):
            span = (ext.y, ext.z)
        elif view in ("top", "bottom"):
            span = (ext.x, ext.y)
        else:
            span = (ext.x, ext.z)
        aspect = w / h
        cam_data.ortho_scale = max(span[0], span[1] * aspect) * args.margin
        dist = exit_distance(center, d) + scene_radius * 0.5
    else:
        cam_data.lens = 50
        fov = 2 * math.atan(cam_data.sensor_width / (2 * cam_data.lens)) * min(1, h / w)
        want = 0.8 * radius * args.margin / math.sin(fov / 2)
        outside = exit_distance(center, d) + scene_radius * 0.15
        dist = max(want, outside)
        if dist > want:  # pushed back to stay outside the robot: zoom in with the lens
            half = math.asin(min(0.99, 0.8 * radius * args.margin / dist))
            short_side = cam_data.sensor_width * min(1, h / w)
            cam_data.lens = short_side / (2 * math.tan(half))
    cam.location = center + d * dist
    # look-at: top/bottom views put the robot front (+X) at the top of the image
    up_world = Vector((1, 0, 0)) if view in ("top", "bottom") else Vector((0, 0, 1))
    fwd = -d
    right = fwd.cross(up_world).normalized()
    up = right.cross(fwd).normalized()
    from mathutils import Matrix
    rot = Matrix((right, up, -fwd)).transposed()  # camera looks down its -Z
    cam.rotation_euler = rot.to_euler()
    scene.render.filepath = f"{args.out}_{view}.png"
    bpy.ops.render.render(write_still=True)
    print(f"[render] wrote {scene.render.filepath}")

if args.save_blend:
    bpy.ops.wm.save_as_mainfile(filepath=f"{args.out}.blend")
    print(f"[render] wrote {args.out}.blend")

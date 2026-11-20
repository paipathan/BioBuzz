"""
Blender: orthographic section-style view of the robot.

    blender -b -P section.py -- --base index/robot.blend --out renders/x.png \
        --origin X Y Z --normal NX NY NZ --up UX UY UZ --width 300 [--keep regex] [--grid 10]

Looks along -normal from the +normal side, clipping everything in front of the plane through
`origin` (so you see the cut face and what's behind it). Units in mm (robot frame).
--keep restricts to objects whose name (or parent) matches the regex.
--grid draws a mm grid (spacing) in the plane, labelled in plane coordinates.
"""
import argparse, math, os, re, sys
import bpy
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index("--") + 1:]
ap = argparse.ArgumentParser()
ap.add_argument("--base", required=True)
ap.add_argument("--glb", action="append", default=[])
ap.add_argument("--out", required=True)
ap.add_argument("--origin", nargs=3, type=float, required=True)
ap.add_argument("--normal", nargs=3, type=float, required=True)
ap.add_argument("--up", nargs=3, type=float, default=[0, 0, 1])
ap.add_argument("--width", type=float, default=300)
ap.add_argument("--depth", type=float, default=2000, help="how far behind the plane to show (mm)")
ap.add_argument("--keep", default=None)
ap.add_argument("--size", default="1400x1050")
a = ap.parse_args(argv)

bpy.ops.wm.open_mainfile(filepath=os.path.abspath(a.base))
for g in a.glb:
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(g))
scene = bpy.context.scene
for o in [o for o in bpy.data.objects if o.type in ("CAMERA", "LIGHT")]:
    bpy.data.objects.remove(o, do_unlink=True)

if a.keep:
    rx = re.compile(a.keep, re.I)
    for o in list(scene.objects):
        if o.type != "MESH":
            continue
        names = [o.name] + ([o.parent.name] if o.parent else [])
        if not any(rx.search(n) for n in names):
            bpy.data.objects.remove(o, do_unlink=True)

for m in bpy.data.materials:
    if m.use_nodes and m.node_tree:
        b = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if b:
            c = list(b.inputs["Base Color"].default_value)
            m.diffuse_color = (c[0], c[1], c[2], b.inputs["Alpha"].default_value)

S = 0.001  # mm -> m
o = Vector(a.origin) * S
n = Vector(a.normal).normalized()
up = Vector(a.up)
up = (up - n * up.dot(n)).normalized()
right = up.cross(n).normalized()  # camera right when looking along -n

cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
scene.collection.objects.link(cam)
scene.camera = cam
cam.data.type = "ORTHO"
cam.data.ortho_scale = a.width * S
offset = 1.0  # camera 1 m in front of plane, clip so the plane is the near face
cam.location = o + n * offset
cam.rotation_euler = Matrix((right, up, n)).transposed().to_euler()
cam.data.clip_start = offset
cam.data.clip_end = offset + a.depth * S

w, h = (int(v) for v in a.size.split("x"))
scene.render.resolution_x, scene.render.resolution_y = w, h
scene.render.engine = "BLENDER_WORKBENCH"
sh = scene.display.shading
sh.light = "STUDIO"; sh.color_type = "MATERIAL"
sh.show_cavity = True; sh.show_object_outline = True
sh.background_type = "WORLD"
scene.world = scene.world or bpy.data.worlds.new("w")
scene.world.color = (1, 1, 1)
scene.render.filepath = os.path.abspath(a.out)
bpy.ops.render.render(write_still=True)
print("[section] wrote", scene.render.filepath, "| right=", tuple(round(v, 3) for v in right),
      "up=", tuple(round(v, 3) for v in up), "px/mm=", w / a.width)

"""Headless Blender: render mm STLs in their own frame.
blender -b -P render_stl.py -- --out prefix --views name=x:y:z,... [--size WxH] [--ortho] [--target x:y:z --dist d] file.stl[:RRGGBB[:alpha]] ...
"""
import bpy, sys, math, argparse
from mathutils import Vector
argv = sys.argv[sys.argv.index("--") + 1:]
ap = argparse.ArgumentParser(); ap.add_argument("--out"); ap.add_argument("--views"); ap.add_argument("--size", default="1400x1000")
ap.add_argument("--target", default=None); ap.add_argument("--scale", type=float, default=None); ap.add_argument("files", nargs="+")
a = ap.parse_args(argv)
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
objs = []
for spec in a.files:
    parts = spec.split(":") if not spec[1:3] == ":/" else [spec[:2] + spec[2:].split(":")[0]] + spec[2:].split(":")[1:]
    path = parts[0]; col = parts[1] if len(parts) > 1 else "c8ccd2"; al = float(parts[2]) if len(parts) > 2 else 1.0
    bpy.ops.wm.stl_import(filepath=path)
    o = bpy.context.selected_objects[0]
    rgb = [int(col[i:i+2], 16) / 255 for i in (0, 2, 4)]
    o.color = (*rgb, al)
    objs.append(o)
sh = sc.display.shading
try: sc.render.engine = "BLENDER_WORKBENCH"
except TypeError: pass
sh = sc.display.shading; sh.light = "STUDIO"; sh.color_type = "OBJECT"; sh.show_cavity = True; sh.cavity_type = "BOTH"
sh.show_xray = False; sh.show_backface_culling = False
sc.render.film_transparent = False
w, h = map(int, a.size.split("x")); sc.render.resolution_x, sc.render.resolution_y = w, h
sc.world = bpy.data.worlds.new("w"); sc.world.color = (0.93, 0.93, 0.94)
pts = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
lo = Vector([min(p[i] for p in pts) for i in range(3)]); hi = Vector([max(p[i] for p in pts) for i in range(3)])
ctr = Vector(map(float, a.target.split(","))) if a.target else (lo + hi) / 2
size = a.scale or (hi - lo).length * 0.75
cam_d = bpy.data.cameras.new("c"); cam_d.type = "ORTHO"; cam_d.ortho_scale = size; cam_d.clip_end = 1e5
cam = bpy.data.objects.new("c", cam_d); sc.collection.objects.link(cam); sc.camera = cam
for v in a.views.split(","):
    name, d = v.split("=")
    d = Vector(map(float, d.split(":"))).normalized()
    cam.location = ctr + d * 3000
    up = Vector((0, 0, 1)) if abs(d.z) < 0.95 else Vector((0, 1, 0))
    cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler() if False else (-d).to_track_quat("-Z", "Y").to_euler()
    # keep +Z up
    q = (-d).to_track_quat("-Z", "Z" if abs(d.z) < 0.95 else "Y"); cam.rotation_euler = q.to_euler()
    import os; sc.render.filepath = os.path.abspath(f"{a.out}_{name}.png"); bpy.ops.render.render(write_still=True)
    print("[r] wrote", sc.render.filepath)

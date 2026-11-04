"""
Printable FTC field-panel quick release pin (cotterless detent style).

The real pin uses a spring-loaded ball near the tip. This version replaces the
spring with a compliant split shank: a slot splits the end of the shank into two
prongs, and each prong carries a detent ridge. Pushing the pin in, the shallow
lead-in ramp squeezes the prongs together; once the ridge clears the far side
of the panel link, the prongs spring back and the steeper locking ramp holds it.
A firm pull cams the prongs back in and the pin comes out - same push-in /
pull-out behaviour as the steel pin, no ring needed.

Prints lying flat: the shank has flats top and bottom, so the whole part sits
on the bed with the slot vertical. The prongs then flex in the plane of the
layers, which is the strong direction.

Run inside Blender (Scripting tab or MCP). All units are millimetres.
"""
import bpy
import bmesh
import math
import os
from mathutils import Matrix

# ---- parameters (mm) -------------------------------------------------------
SHANK_D     = 4.60    # real pin is 0.188" (4.78); link holes are 0.190" (4.83).
                      # Undersized so FDM over-extrusion (~+0.1) still slides through
FLAT_H      = 4.30    # flat-to-flat thickness (print-bed flats); keeps Z wobble in the hole small
GRIP_L      = 33.35   # "effective length" 1.313": head face to start of locking ramp
TOTAL_L     = 38.10   # 1.5": head face to end of the lead-in ramp (pilot adds PILOT_L)
BUMP_H      = 0.50    # detent ridge height per side (the "ball"); ~0.39 overlap with a 0.190" hole
LOCK_L      = 0.40    # locking ramp length -> ~45 deg, sets pull-out force
CREST_L     = 0.50    # flat top of the ridge
TIP_R       = 1.70    # nose radius; lead-in ramp runs crest -> TOTAL_L (~15 deg)
PILOT_L     = 1.50    # straight pilot past the ramp. On bottom-rail joints the floor stops
                      # the tip; this keeps the ridge clear of the link's bottom wall (not wedged)
PILOT_CHAMF = 0.30
SLOT_W      = 1.20    # slot width; must exceed 2 * (ridge interference)
SLOT_START  = 20.0    # slot begins this far from the head. Larger = softer prongs
FILLET      = 0.30    # small root fillet under the head
HEAD_W      = 24.0    # pull-loop handle width
HEAD_L      = 17.0    # handle depth along the pin axis
HEAD_ROUND  = 4.0     # outer corner radius of the handle
SIDE_WALL   = 3.5     # loop side bar width
BACK_WALL   = 5.0     # back bar (finger pull); wide enough to carry a line of text
FRONT_WALL  = 5.0     # solid bar the shank roots into (stop face) - keep this beefy
WINDOW_ROUND = 2.0    # inner corner radius, avoids stress risers in the loop

# engraving on the top face of the handle (top face only: no overhangs, no bridging).
# Reads upright with the pin hanging handle-up, shank pointing down.
TEXT_TOP    = "ABHAY"       # on the back bar (top when the pin is in the field)
TEXT_BOTTOM = "WAS HERE"    # on the front bar, next to the shank
TEXT_FONT   = "C:/Windows/Fonts/impact.ttf"   # heavy strokes survive a 0.4 mm nozzle
TEXT_CAP    = 3.0     # letter height (mm)
TEXT_DEPTH  = 0.5     # engrave depth (~3-4 layers); leaves 3.8 mm of handle
TEXT_SPACING = 1.25   # letter spacing so the walls between letters stay printable
TEXT_MARGIN = 0.9     # minimum solid border around the text
SEGMENTS    = 96

OUT_DIR = os.path.dirname(os.path.abspath(__file__)) if "__file__" in dir() else ""

R = SHANK_D / 2.0


def apply_boolean(target, cutter, operation):
    mod = target.modifiers.new("bool", "BOOLEAN")
    mod.operation = operation
    mod.solver = "EXACT"
    mod.object = cutter
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(cutter, do_unlink=True)


def mesh_object(name, bm):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def box(name, x0, x1, y0, y1, z0, z1):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x = x0 if v.co.x < 0 else x1
        v.co.y = y0 if v.co.y < 0 else y1
        v.co.z = z0 if v.co.z < 0 else z1
    return mesh_object(name, bm)


def shank():
    """Revolved shank profile along +Y, head face at y = 0."""
    crest_end = GRIP_L + LOCK_L + CREST_L
    profile = [
        (-1.0,                R + FILLET),
        (0.0,                 R + FILLET),
        (FILLET,              R),
        (GRIP_L,              R),
        (GRIP_L + LOCK_L,     R + BUMP_H),
        (crest_end,           R + BUMP_H),
        (TOTAL_L,             TIP_R),
        (TOTAL_L + PILOT_L - PILOT_CHAMF, TIP_R),
        (TOTAL_L + PILOT_L,   TIP_R - PILOT_CHAMF),
    ]
    bm = bmesh.new()
    rings = []
    for y, r in profile:
        ring = []
        for i in range(SEGMENTS):
            a = 2 * math.pi * i / SEGMENTS
            ring.append(bm.verts.new((r * math.cos(a), y, r * math.sin(a))))
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        for i in range(SEGMENTS):
            j = (i + 1) % SEGMENTS
            bm.faces.new((a[i], a[j], b[j], b[i]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])
    bm.normal_update()
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_object("QuickReleasePin", bm)


def rounded_box(name, x0, x1, y0, y1, z0, z1, radius):
    """Box with its four vertical (Z) edges rounded."""
    ob = box(name, x0, x1, y0, y1, z0, z1)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    vertical = [e for e in bm.edges
                if abs(e.verts[0].co.z - e.verts[1].co.z) > 1e-6]
    bmesh.ops.bevel(bm, geom=vertical, offset=radius, segments=12,
                    affect="EDGES", profile=0.5)
    bm.to_mesh(ob.data)
    bm.free()
    return ob


def handle():
    """Pull-loop handle; its front bar is the stop face the effective length is measured from."""
    return rounded_box("handle", -HEAD_W / 2, HEAD_W / 2, -HEAD_L, 0.0, -3.0, 3.0, HEAD_ROUND)


def handle_window():
    """Finger hole. Leaves a solid front bar where the shank roots in."""
    return rounded_box("window",
                       -HEAD_W / 2 + SIDE_WALL, HEAD_W / 2 - SIDE_WALL,
                       -HEAD_L + BACK_WALL, -FRONT_WALL,
                       -5.0, 5.0, WINDOW_ROUND)


def text_cutter(body, y_center, max_width):
    """Extruded text mesh centred on (0, y_center), cutting TEXT_DEPTH into the top face."""
    curve = bpy.data.curves.new("txt", "FONT")
    curve.body = body
    curve.font = bpy.data.fonts.load(TEXT_FONT, check_existing=True)
    curve.align_x = "CENTER"
    curve.space_character = TEXT_SPACING
    curve.resolution_u = 6
    top = FLAT_H / 2
    half_t = (TEXT_DEPTH + 1.0) / 2      # extrudes +-half_t about z=0
    curve.extrude = half_t
    ob = bpy.data.objects.new("txt", curve)
    bpy.context.scene.collection.objects.link(ob)
    deps = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(deps))
    bpy.data.objects.remove(ob, do_unlink=True)
    bpy.data.curves.remove(curve)

    bm = bmesh.new()
    bm.from_mesh(me)
    bpy.data.meshes.remove(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    xs = [v.co.x for v in bm.verts]
    ys = [v.co.y for v in bm.verts]
    w, h = max(xs) - min(xs), max(ys) - min(ys)
    s = min(TEXT_CAP / h, max_width / w)
    cx, cy = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2
    for v in bm.verts:
        # rotated 180 deg about Z so it reads with the shank pointing down
        v.co.x = -(v.co.x - cx) * s
        v.co.y = -(v.co.y - cy) * s + y_center
        v.co.z += top - TEXT_DEPTH + half_t   # spans [top - TEXT_DEPTH, top + 1]
    print(f"text '{body}': {w * s:.1f} x {h * s:.2f} mm")
    return mesh_object("text_" + body, bm)


def text_fit_width(y_center):
    """Usable text width on a handle bar, staying inside the rounded outer corners."""
    # closest approach of the text to the handle's front (y=0) or back (y=-HEAD_L) edge
    y_edge = min(-(y_center + TEXT_CAP / 2), (y_center - TEXT_CAP / 2) + HEAD_L)
    dy = max(0.0, HEAD_ROUND - y_edge)
    half = HEAD_W / 2 - HEAD_ROUND + math.sqrt(HEAD_ROUND ** 2 - dy ** 2)
    return 2 * (half - TEXT_MARGIN)


def slot_cutters():
    y0 = SLOT_START + SLOT_W / 2
    cut = box("slot", -SLOT_W / 2, SLOT_W / 2, y0, TOTAL_L + 5, -5, 5)
    # rounded slot root to spread bending stress
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=48,
                          radius1=SLOT_W / 2, radius2=SLOT_W / 2, depth=10,
                          matrix=Matrix.Translation((0, y0, 0)))
    return cut, mesh_object("slot_root", bm)


def build():
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 0.001
    scene.unit_settings.length_unit = "MILLIMETERS"

    old = bpy.data.objects.get("QuickReleasePin")
    if old:
        bpy.data.objects.remove(old, do_unlink=True)

    pin = shank()
    apply_boolean(pin, handle(), "UNION")
    # flats top and bottom -> flat-to-flat FLAT_H, lies flat on the bed
    apply_boolean(pin, box("slab", -50, 50, -50, 50, -FLAT_H / 2, FLAT_H / 2), "INTERSECT")
    apply_boolean(pin, handle_window(), "DIFFERENCE")
    for body, y in ((TEXT_TOP, -HEAD_L + BACK_WALL / 2), (TEXT_BOTTOM, -FRONT_WALL / 2)):
        if body:
            apply_boolean(pin, text_cutter(body, y, text_fit_width(y)), "DIFFERENCE")
    for cutter in slot_cutters():
        apply_boolean(pin, cutter, "DIFFERENCE")

    # bed at z = 0
    pin.data.transform(Matrix.Translation((0, 0, FLAT_H / 2)))
    pin.color = (0.95, 0.55, 0.1, 1.0)
    return pin


def export(pin, out_dir):
    bpy.ops.object.select_all(action="DESELECT")
    pin.select_set(True)
    bpy.context.view_layer.objects.active = pin
    bpy.ops.wm.stl_export(filepath=os.path.join(out_dir, "quick_release_pin.stl"),
                          export_selected_objects=True, global_scale=1.0,
                          use_scene_unit=False)


if __name__ == "__main__":
    p = build()
    if OUT_DIR:
        export(p, OUT_DIR)

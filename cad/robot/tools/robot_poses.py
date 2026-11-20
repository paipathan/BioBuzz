"""
Re-posing movable robot mechanisms for renders and checks.

Turret: rotates about a vertical axis at X -27.97, Y 0. In the Nov 2026 export the shooter
points at yaw -63.06 deg (toward front-right). yaw 0 = shooting straight forward (+X),
+90 = toward robot left (+Y).

    from robot_poses import turret_scene
    parts, boxes = turret_scene(robot, idx, L, yaw=0)
    export_new("turret_fwd", parts)            # rotated turret parts
    render(..., hide_boxes=boxes)              # hides the original turret parts
"""
from build123d import Axis

TURRET_AXIS = Axis((-27.97, 0.0, 0.0), (0.0, 0.0, 1.0))
TURRET_YAW_IN_CAD = -63.06


def turret_ids(idx):
    """Parts that rotate with the turret (shooter, ring gear, gussets)."""
    out = []
    for p in idx:
        path = p["path"]
        if (path.startswith("Turret_V2_<1>/Undershooter_<1>/") or
                path.startswith("Turret_V2_<1>/Gusset") or
                path.startswith("Turret_V2_<1>/Spur_gear__100")):
            out.append(p["id"])
    return out


def turret_scene(idx, L, yaw=0.0):
    """Return ({label: (shape, colour)}, hide_boxes) with the turret turned to `yaw` degrees."""
    delta = yaw - TURRET_YAW_IN_CAD
    parts, boxes = {}, []
    for i in turret_ids(idx):
        p = idx[i]
        shape = L[i][1].rotate(TURRET_AXIS, delta)
        parts[f"turret_{i}"] = (shape, p["color"] or "#888888")
        c = p["center"]
        boxes.append([c[0] - 0.6, c[1] - 0.6, c[2] - 0.6, c[0] + 0.6, c[1] + 0.6, c[2] + 0.6])
    return parts, boxes


def turret_rotate_spec(idx, yaw=0.0):
    """For robotcad.render(rotate=[...]): turns the turret in Blender (fast, no re-meshing)."""
    boxes = []
    for i in turret_ids(idx):
        c = idx[i]["center"]
        boxes.append([c[0] - 0.6, c[1] - 0.6, c[2] - 0.6, c[0] + 0.6, c[1] + 0.6, c[2] + 0.6])
    return {"boxes": boxes, "point": [-27.97, 0.0, 0.0], "axis": [0, 0, 1],
            "deg": yaw - TURRET_YAW_IN_CAD}

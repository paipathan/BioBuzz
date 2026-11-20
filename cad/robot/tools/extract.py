"""
Re-run whenever source/robot.step is replaced with a fresh Onshape export.

    cad/.venv/Scripts/python.exe cad/robot/tools/extract.py

Writes:
    index/parts.json   every leaf part: path, label, color, world bbox, centre, volume
    index/parts.csv    same, spreadsheet-friendly
    index/robot.glb    full robot mesh (names + colours kept) for Blender / viewers
    index/robot.blend  same, pre-baked for fast headless renders
    renders/robot_*.png  overview renders
"""
import csv
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from robotcad import INDEX_DIR, color_hex, leaves, load_robot, world_bbox  # noqa: E402

from build123d import export_gltf  # noqa: E402


def main(force=False):
    robot = load_robot(force=force)
    INDEX_DIR.mkdir(parents=True, exist_ok=True)

    rows = []
    for i, (path, part) in enumerate(leaves(robot)):
        mn, mx, sz = world_bbox(part)
        try:
            vol = part.volume
        except Exception:
            vol = 0.0
        rows.append({
            "id": i,
            "path": "/".join(path[1:]),
            "label": path[-1],
            "parent": path[-2] if len(path) > 2 else "",
            "color": color_hex(part),
            "min": [round(v, 2) for v in mn],
            "max": [round(v, 2) for v in mx],
            "size": [round(v, 2) for v in sz],
            "center": [round((a + b) / 2, 2) for a, b in zip(mn, mx)],
            "volume_mm3": round(vol, 1),
        })

    mn, mx, sz = world_bbox(robot)
    (INDEX_DIR / "parts.json").write_text(json.dumps({
        "source": "source/robot.step",
        "units": "mm",
        "bbox": {"min": mn, "max": mx, "size": sz},
        "parts": rows,
    }, indent=1), encoding="utf-8")

    with open(INDEX_DIR / "parts.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["id", "path", "color", "cx", "cy", "cz", "sx", "sy", "sz", "volume_mm3"])
        for r in rows:
            w.writerow([r["id"], r["path"], r["color"], *r["center"], *r["size"], r["volume_mm3"]])

    export_gltf(robot, str(INDEX_DIR / "robot.glb"), binary=True,
                linear_deflection=0.5, angular_deflection=0.5)
    print(f"{len(rows)} leaf parts; overall size {sz[0]:.0f} x {sz[1]:.0f} x {sz[2]:.0f} mm")

    # pre-bake a .blend (GLB import is the slow part of every render) + overview renders
    import subprocess
    from robotcad import BLENDER, ROOT
    subprocess.run([str(BLENDER), "-b", "-P", str(ROOT / "tools" / "render.py"), "--",
                    "--glb", str(INDEX_DIR / "robot.glb"), "--out", str(INDEX_DIR / "robot"),
                    "--views", "", "--save-blend"], check=True, capture_output=True)
    subprocess.run([str(BLENDER), "-b", "-P", str(ROOT / "tools" / "render.py"), "--",
                    "--base", str(INDEX_DIR / "robot.blend"),
                    "--out", str(ROOT / "renders" / "robot"),
                    "--views", "iso,iso_back,front,side,top"], check=True, capture_output=True)
    print("wrote index/robot.blend and renders/robot_*.png")


if __name__ == "__main__":
    main(force="--force" in sys.argv)

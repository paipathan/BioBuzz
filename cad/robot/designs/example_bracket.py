"""
Template for a new design. Copy this file, rename, edit the MODEL section.

    cad/.venv/Scripts/python.exe cad/robot/designs/example_bracket.py

What it does:
  1. loads the robot (cached) and pulls reference geometry from it
  2. models a new part in robot coordinates, positioned off real parts
  3. checks it against every existing part for collisions
  4. exports designs/out/<NAME>.glb + .step (+ .stl for printing)
  5. renders it over the robot (robot faded) to renders/<NAME>_<view>.png

This example is a placeholder plate bolted to the outside of the left
(+Y) outer side plate, just to prove the pipeline. It is not a real part.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from robotcad import collisions, export_new, find, load_robot, render, world_bbox  # noqa: E402

from build123d import Box, Cylinder, Pos, Rot, Axis  # noqa: E402

NAME = "example_bracket"

robot = load_robot()

# ---- reference geometry from the existing CAD ------------------------------------
# Outer side plates are the large 3.18 mm (1/8") plates at |Y| ~ 168.8.
outer = [p for p in find(robot, r"^Part_1$")
         if abs(p.bounding_box().size.Y - 3.18) < 0.05 and p.bounding_box().size.X > 400]
left_outer = max(outer, key=lambda p: p.bounding_box().center().Y)
(mnx, mny, mnz), (mxx, mxy, mxz), _ = world_bbox(left_outer)
print(f"left outer plate: x {mnx:.1f}..{mxx:.1f}  y {mny:.1f}..{mxy:.1f}  z {mnz:.1f}..{mxz:.1f}")

# ---- MODEL ------------------------------------------------------------------------
T = 3.0
plate = Pos(0, mxy + T / 2, 60) * Box(80, T, 40)
for dx in (-30, 30):
    plate -= Pos(dx, mxy + T / 2, 60) * (Rot(90, 0, 0) * Cylinder(2.1, T * 2))  # M4 clearance

# ---- CHECK -----------------------------------------------------------------------
hits = collisions(robot, plate)
print("collisions:", hits or "none")

# ---- EXPORT + RENDER -------------------------------------------------------------
export_new(NAME, {"plate": (plate, "#ff7a00")}, stl=True)
render(NAME, views="iso,side", ghost=True)

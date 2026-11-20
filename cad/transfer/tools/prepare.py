"""Split the Onshape export (source/transfer.stl, inches) into the stock pieces the design uses.
    cad/.venv/Scripts/python.exe -I cad/transfer/tools/prepare.py
Component indices are from trimesh.split() on the 2026-11 export: 137 ramp, 159 servo body,
160 servo spline, 142 horn, 168 old stopper arm.
"""
from pathlib import Path
import trimesh
HERE = Path(__file__).resolve().parents[1]; OUT = HERE / "out"; OUT.mkdir(exist_ok=True)
m = trimesh.load(HERE / "source" / "transfer.stl"); m.apply_scale(25.4)
P = m.split(only_watertight=False)
ramp = max(P, key=lambda p: p.area)
assert ramp is P[137] and P[159].extents.round().tolist() == [54.0, 20.0, 40.0], "export changed: re-check component indices"
ramp.export(OUT / "stock_ramp.stl")
trimesh.util.concatenate([P[159], P[160]]).export(OUT / "servo_stock.stl")
P[142].export(OUT / "horn_stock.stl")
trimesh.util.concatenate([P[142], P[168]]).export(OUT / "_old_arm.stl")
trimesh.util.concatenate([p for i, p in enumerate(P) if i not in {137, 159, 160, 142, 168}]).export(OUT / "_rest.stl")
print("wrote stock_ramp / servo_stock / horn_stock / _rest / _old_arm")

# Path Editor

A local editor for the `*Paths.java` files in `TeamCode/.../paths`, drawn on the BioBuzz field.

```
node pathviz/server.js      # or double-click pathviz/start.bat
```

Then open http://localhost:4141. Needs Node 18+, nothing to install.

## How it works

The Java files are the source of truth. The editor reads each one, draws its poses and paths
in field inches (origin bottom-left, 144 in square, the Constants.Auto.fieldSize value), and rewrites
the file whenever you change something. Edits made in Android Studio show up in the editor too.

It understands exactly the shape `TwoTipPaths` uses:

- poses assigned in the constructor with `poseFactory.of(x, y, headingDegrees)`
- one `public Path name()` per path, `return Paths.line(...)` or `Paths.curve(...)`
  with an optional `.linear(a, b)`, `.constant(p)`, `.tangent()`, `.reverseTangent()` or `.facingPoint(p)`

A file containing anything else (extra members, inline `new Pose(...)`, other calls) opens
read-only with the reason, so it is never overwritten.

Coordinates are in the drawn alliance's frame (`Constants.Auto.drawnAlliance`); "Show blue side"
overlays the mirrored path that `Utilities.poseFactory` produces for the other alliance.

## Using it

| | |
|---|---|
| `P` / Add path | Click the field to chain new line paths; click an existing point to reuse it; `Esc` to finish |
| Drag | Move a point (`Shift` snaps to whole inches) |
| Double-click a path | Add a control point there. Pedro paths are Bezier curves through `[start, ...controls, end]`; a path with no controls is a line |
| Heading handle | Drag the ring on a selected point (`Shift` snaps to 15 degrees) |
| Inspector | Rename, add/remove control points, set heading mode, copy `follow(...)` |
| `Space` / Play | Plays the selected auto: the paths in the order its routine drives them, with the robot states shown |
| `Delete` | Remove the selected path or point |
| `Ctrl+Z` / `Ctrl+Shift+Z` | Undo / redo |
| New | Creates `<Name>Paths.java` with a `start` pose |

## Playback

The auto list comes from `auto/*.java`: any auto that does `new <Name>Paths(...)` is scanned for the
`.pathName()` calls and `State.X` values in the order they appear. Heading follows Pedro: `linear` blends
by arc length along the shortest turn, `tangent` follows the curve, `constant` holds a point's heading,
and a path with no heading call keeps whatever heading the robot arrived with. Speed is a flat 50 in/s
at 1x, so timing is approximate; the follower's real speed will differ.

## If the server stops

The page keeps your edits and shows a banner; they save automatically when the server is back.
Android Studio picks up changes to the Java file when you switch back to it.

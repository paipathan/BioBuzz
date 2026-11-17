'use strict';

(() => {
  const NS = 'http://www.w3.org/2000/svg';

  // ---- small helpers ------------------------------------------------------

  function h(tag, props = {}, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (v === true) e.setAttribute(k, '');
      else if (v !== false && v != null) e.setAttribute(k, v);
    }
    for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) e.append(kid);
    return e;
  }

  function s(tag, attrs = {}, ...kids) {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) e.setAttribute(k, v);
    for (const kid of kids.flat(Infinity)) if (kid) e.append(kid);
    return e;
  }

  const $ = (sel) => document.querySelector(sel);
  const setChildren = (parent, ...kids) => parent.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false));
  const fmt = (n) => String(Number(Number(n).toFixed(2)));
  const round1 = (v) => Math.round(v * 10) / 10;
  const rad = (d) => (d * Math.PI) / 180;
  const deg = (r) => (r * 180) / Math.PI;
  const normDeg = (d) => ((d % 360) + 360) % 360;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const JAVA_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
  const JAVA_WORDS = new Set((
    'abstract assert boolean break byte case catch char class const continue default do double else enum ' +
    'extends final finally float for goto if implements import instanceof int interface long native new ' +
    'package private protected public return short static strictfp super switch synchronized this throw ' +
    'throws transient try void volatile while true false null').split(' '));

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  };

  async function api(path, opts = {}) {
    const res = await fetch(`/api${path}`, {
      method: opts.method || 'GET',
      headers: { 'X-Pathviz': '1', 'Content-Type': 'application/json' },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  }

  // ---- state --------------------------------------------------------------

  const S = {
    config: null,
    files: [],
    file: null,
    model: null,
    selection: null, // { type: 'path' | 'point', name }
    hover: null,
    mode: 'select', // or 'add'
    undo: [],
    redo: [],
    robot: store.get('pathviz.robot', { w: 16, l: 16 }),
    showBar: store.get('pathviz.bar', true),
    cursor: null,
    drag: null,
    saving: false,
    saveTimer: null,
    status: { text: '', error: false },
    newFile: { open: false, error: '' },
    offline: false,
    rev: 0,
    selStep: null,
  };

  const readonly = () => !S.model || S.model.locked;
  const size = () => S.config.fieldSize;
  const flipY = (y) => size() - y;

  const point = (name, m = S.model) => m.points.find((p) => p.name === name);
  const pathNamed = (name, m = S.model) => m.paths.find((p) => p.name === name);

  function roles(name, m = S.model) {
    const out = [];
    for (const p of m.paths) {
      const idx = p.pts.indexOf(name);
      if (idx < 0 && !headingRefs(p).includes(name)) continue;
      out.push({ path: p, interior: idx > 0 && idx < p.pts.length - 1, endpoint: idx === 0 || idx === p.pts.length - 1, heading: headingRefs(p).includes(name) });
    }
    return out;
  }

  function headingRefs(p) {
    const hd = p.heading || {};
    return [hd.from, hd.to, hd.point].filter(Boolean);
  }

  const isControl = (name) => {
    const r = roles(name);
    return r.length > 0 && r.every((x) => x.interior && !x.heading);
  };

  // ---- status / saving ----------------------------------------------------

  function setStatus(text, error = false) {
    S.status = { text, error };
    const el = $('#status');
    el.textContent = text;
    el.classList.toggle('error', error);
  }

  let flashTimer = null;
  function flash(text, error = false) {
    setStatus(text, error);
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => setStatus(S.saving ? 'Saving…' : ''), 2200);
  }

  function scheduleSave() {
    if (readonly()) return;
    S.saving = true;
    S.rev++;
    setStatus(S.offline ? 'Not saved' : 'Saving…', S.offline);
    clearTimeout(S.saveTimer);
    S.saveTimer = setTimeout(save, 250);
  }

  async function save() {
    clearTimeout(S.saveTimer);
    if (!S.saving || !S.model) return;
    const rev = S.rev;
    const { points, paths, routine } = S.model;
    try {
      // A routine the editor can't read is left alone, so it is not sent back.
      await api(`/files/${S.file}`, { method: 'PUT', body: { points, paths, routine: routine && !routine.locked ? { steps: routine.steps, reset: !!routine.reset } : undefined } });
      setOffline(false);
      if (S.rev === rev) { S.saving = false; setStatus('Saved'); }
    } catch (e) {
      if (e instanceof TypeError) {
        // Server not reachable: keep the edits and keep trying.
        setOffline(true);
        S.saveTimer = setTimeout(save, 2000);
      } else {
        S.saving = false;
        setStatus(e.message, true);
      }
    }
  }

  function setOffline(flag) {
    if (S.offline === flag) return;
    S.offline = flag;
    setStatus(flag ? (S.saving ? 'Not saved' : 'Offline') : S.saving ? 'Saving…' : '', flag);
    renderChrome();
  }

  // ---- model edits --------------------------------------------------------

  const snapshot = () => JSON.stringify({ points: S.model.points, paths: S.model.paths, steps: S.model.routine ? S.model.routine.steps : undefined, reset: S.model.routine ? !!S.model.routine.reset : undefined });

  function pushUndo() {
    S.undo.push(snapshot());
    if (S.undo.length > 100) S.undo.shift();
    S.redo = [];
  }

  function restore(json) {
    const { points, paths, steps, reset } = JSON.parse(json);
    S.model.points = points;
    S.model.paths = paths;
    if (steps && S.model.routine) S.model.routine.steps = steps;
    if (reset !== undefined && S.model.routine) S.model.routine.reset = reset;
    if (S.selection) {
      const list = S.selection.type === 'path' ? paths : points;
      if (!list.some((x) => x.name === S.selection.name)) S.selection = null;
    }
  }

  function undo() {
    if (!S.undo.length || readonly()) return;
    S.redo.push(snapshot());
    restore(S.undo.pop());
    changed();
  }

  function redo() {
    if (!S.redo.length || readonly()) return;
    S.undo.push(snapshot());
    restore(S.redo.pop());
    changed();
  }

  function edit(fn) {
    if (readonly()) return;
    pushUndo();
    fn(S.model);
    changed();
  }

  function changed() {
    scheduleSave();
    renderAll();
  }

  function uniqueName(base, start) {
    const taken = new Set([...S.model.points, ...S.model.paths].map((x) => x.name));
    let i = Math.max(1, start);
    while (taken.has(`${base}${i}`)) i++;
    return `${base}${i}`;
  }

  // The point a new segment starts from: where the last path ended.
  function endpoint(m) {
    const last = m.paths[m.paths.length - 1];
    if (last) return point(last.pts[last.pts.length - 1], m);
    return point('start', m) || m.points[0];
  }

  function addSegment(existing, x, y) {
    edit((m) => {
      const from = endpoint(m);
      if (!from) {
        const name = 'start';
        m.points.push({ name, x, y, h: 90, vis: 'public' });
        fitPoint(point(name, m));
        S.selection = { type: 'point', name };
        return;
      }
      let to = existing;
      if (!to) {
        to = uniqueName('point', m.points.length);
        m.points.push({ name: to, x, y, h: from.h, vis: 'private' });
        fitPoint(point(to, m));
      }
      if (to === from.name) return;
      const name = uniqueName('path', m.paths.length + 1);
      m.paths.push({ name, kind: 'line', pts: [from.name, to], heading: { mode: 'linear', from: from.name, to } });
      if (m.routine && !m.routine.locked) m.routine.steps.push({ type: 'path', path: name, events: [] });
      S.selection = { type: 'path', name };
    });
  }

  function renamePoint(oldName, newName) {
    edit((m) => {
      point(oldName, m).name = newName;
      for (const p of m.paths) {
        p.pts = p.pts.map((n) => (n === oldName ? newName : n));
        for (const k of ['from', 'to', 'point']) if (p.heading && p.heading[k] === oldName) p.heading[k] = newName;
      }
      if (S.selection?.type === 'point') S.selection.name = newName;
    });
  }

  function renamePath(oldName, newName) {
    edit((m) => {
      pathNamed(oldName, m).name = newName;
      if (m.routine) for (const st of m.routine.steps) if (st.path === oldName) st.path = newName;
      if (S.selection?.type === 'path') S.selection.name = newName;
    });
  }

  // Control points belong to their curve; drop the ones nothing else uses.
  function dropOrphans(m, names) {
    for (const n of names) {
      if (!roles(n, m).length && n !== 'start') m.points = m.points.filter((p) => p.name !== n);
    }
  }

  function deletePath(name) {
    edit((m) => {
      const p = pathNamed(name, m);
      const controls = p.pts.slice(1, -1);
      m.paths = m.paths.filter((x) => x !== p);
      if (m.routine && !m.routine.locked) m.routine.steps = m.routine.steps.filter((st) => st.path !== name);
      dropOrphans(m, controls);
      S.selection = null;
      S.selStep = null;
    });
  }

  const syncKind = (p) => { p.kind = p.pts.length > 2 ? 'curve' : 'line'; };

  function deletePoint(name) {
    const r = roles(name);
    const removable = r.every((x) => x.interior && !x.heading);
    if (!removable) {
      flash(`${name} is used by ${r.map((x) => x.path.name).join(', ')}`, true);
      return;
    }
    edit((m) => {
      for (const x of r) {
        const path = pathNamed(x.path.name, m);
        path.pts = path.pts.filter((n) => n !== name);
        syncKind(path);
      }
      m.points = m.points.filter((p) => p.name !== name);
      S.selection = null;
    });
  }

  // Pedro curves are Bezier curves through [start, ...controls, end]: any path
  // can take control points, and one with none is a straight line.
  function insertControl(m, p, index, x, y) {
    const name = uniqueName(`${p.name}Control`, 1);
    m.points.push({ name, x: clamp(round1(x), 0, size()), y: clamp(round1(y), 0, size()), h: 0, vis: 'private' });
    p.pts.splice(index, 0, name);
    syncKind(p);
    return name;
  }

  // From the inspector: halfway along the last span, pushed sideways so the bend shows.
  function addControlToSelected() {
    edit((m) => {
      const p = pathNamed(S.selection.name, m);
      const a = point(p.pts[p.pts.length - 2], m), b = point(p.pts[p.pts.length - 1], m);
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const name = insertControl(m, p, p.pts.length - 1, (a.x + b.x) / 2 - (dy / len) * 8, (a.y + b.y) / 2 + (dx / len) * 8);
      S.selection = { type: 'point', name };
    });
  }

  // From the field (double-click a path): where you clicked, ordered along the path.
  function addControlAt(pathName, q) {
    edit((m) => {
      const p = pathNamed(pathName, m);
      const list = samples(m, p);
      let best = 0, bestD = Infinity;
      list.forEach((s2, i) => { const d = Math.hypot(s2.x - q.x, s2.y - q.y); if (d < bestD) { bestD = d; best = i; } });
      const controls = p.pts.length - 2;
      const index = 1 + Math.round((best / (list.length - 1)) * controls);
      const name = insertControl(m, p, clamp(index, 1, p.pts.length - 1), q.x, q.y);
      S.selection = { type: 'point', name };
    });
  }

  function setEndpoint(path, index, newName) {
    edit((m) => {
      const p = pathNamed(path, m);
      const pos = index === 0 ? 0 : p.pts.length - 1;
      const old = p.pts[pos];
      p.pts[pos] = newName;
      const hd = p.heading;
      for (const k of ['from', 'to', 'point']) if (hd[k] === old) hd[k] = newName;
    });
  }

  function setHeadingMode(path, mode) {
    edit((m) => {
      const p = pathNamed(path, m);
      const first = p.pts[0], last = p.pts[p.pts.length - 1];
      p.heading = { mode };
      if (mode === 'linear') Object.assign(p.heading, { from: first, to: last });
      if (mode === 'constant') p.heading.point = first;
      if (mode === 'facing') p.heading.point = last;
    });
  }

  // ---- geometry -----------------------------------------------------------

  function bezier(pts, n = 64) {
    const out = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      let a = pts.map((p) => [p.x, p.y]);
      while (a.length > 1) {
        const prev = a;
        a = prev.slice(1).map((q, j) => [prev[j][0] + (q[0] - prev[j][0]) * t, prev[j][1] + (q[1] - prev[j][1]) * t]);
      }
      out.push({ x: a[0][0], y: a[0][1] });
    }
    return out;
  }

  function samples(m, p, n = 64) {
    const pts = p.pts.map((name) => point(name, m));
    if (pts.some((q) => !q)) return null;
    return pts.length > 2 ? bezier(pts, n) : pts;
  }

  function clientToField(e) {
    const svg = $('#field');
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const q = pt.matrixTransform(svg.getScreenCTM().inverse());
    return { x: q.x, y: size() - q.y };
  }

  // The robot outline with its front marked: a heavy front edge and a chevron
  // pointing the way it faces (local +x, so rotate the group by the heading).
  // The flower bar sticks this far out of the back of the robot (inches).
  const FLOWER_BAR_DEPTH = 3.88;

  function robotShape(cls) {
    const { w, l } = S.robot;
    const tip = l / 2 - 1, back = Math.max(tip - Math.min(l, w) * 0.28, 0), half = Math.min(l, w) * 0.2;
    return [
      S.showBar && s('rect', { class: 'robot-bar', x: -l / 2 - FLOWER_BAR_DEPTH, y: -w / 2, width: FLOWER_BAR_DEPTH, height: w }),
      s('rect', { class: cls, x: -l / 2, y: -w / 2, width: l, height: w }),
      s('line', { class: 'robot-front', x1: l / 2, y1: -w / 2, x2: l / 2, y2: w / 2 }),
      s('polygon', { class: 'robot-nose', points: `${tip},0 ${back},${-half} ${back},${half}` }),
    ];
  }

  // ---- field rendering ----------------------------------------------------

  const layers = {};

  function buildField() {
    const svg = $('#field');
    const n = size();
    svg.setAttribute('viewBox', `0 0 ${n} ${n}`);
    layers.image = s('image', { x: 0, y: 0, width: n, height: n, preserveAspectRatio: 'none' });
    layers.paths = s('g');
    layers.points = s('g');
    layers.events = s('g');
    layers.robot = s('g', { 'pointer-events': 'none' });
    layers.overlay = s('g');
    svg.append(layers.image, layers.paths, layers.points, layers.events, layers.robot, layers.overlay);
    const dark = matchMedia('(prefers-color-scheme: dark)');
    const setImage = () => layers.image.setAttribute('href', `fields/biobuzz-${dark.matches ? 'dark' : 'light'}.webp`);
    setImage();
    dark.addEventListener('change', setImage);
  }

  function renderField() {
    const m = S.model;
    for (const k of ['paths', 'points', 'events']) layers[k].replaceChildren();
    if (!m) return;

    const sel = S.selection;
    const ordered = [...m.paths].sort((a, b) => (sel?.type === 'path' && sel.name === a.name ? 1 : 0) - (sel?.type === 'path' && sel.name === b.name ? 1 : 0));
    for (const p of ordered) {
      const list = samples(m, p);
      if (!list) continue;
      const isSel = sel?.type === 'path' && sel.name === p.name;
      const pts = list.map((q) => `${q.x},${flipY(q.y)}`).join(' ');
      const mid = list[Math.floor(list.length / 2)];
      const g = s('g', { class: `path${isSel ? ' sel' : ''}`, 'data-path': p.name },
        s('polyline', { class: 'hit', points: pts }),
        s('polyline', { class: 'line', points: pts }),
        // Only the selected path is named; the rest stay clean.
        isSel && s('text', { class: 'label path-label', x: mid.x + 1.8, y: flipY(mid.y) - 1.8, 'text-anchor': 'start', 'pointer-events': 'none' }, document.createTextNode(p.name)));
      layers.paths.append(g);
    }

    // The control polygon only appears while one of the path's control points is being edited.
    const hulls = new Set();
    if (sel?.type === 'point') roles(sel.name).filter((r) => r.interior).forEach((r) => hulls.add(r.path.name));
    for (const name of hulls) {
      const p = pathNamed(name);
      if (p && p.pts.length > 2) {
        layers.paths.append(s('polyline', { class: 'hull', points: p.pts.map((n) => point(n)).map((q) => `${q.x},${flipY(q.y)}`).join(' '), 'pointer-events': 'none' }));
      }
    }

    const evStep = stepForSelection();
    if (evStep && sel?.type === 'path') drawEvents(pathNamed(sel.name), evStep);
    if (sel?.type === 'path') drawHeadingTargets(pathNamed(sel.name));

    // Every pose keeps its dot, unlabeled (hover for the name). Control points stay hidden
    // until one is selected, which you do from the path's inspector.
    const shownPaths = new Set();
    if (sel?.type === 'point') roles(sel.name).filter((r) => r.interior).forEach((r) => shownPaths.add(r.path.name));
    const isShown = (p, ctrl) => {
      if (sel?.type === 'point' && sel.name === p.name) return true;
      if (ctrl) return roles(p.name).some((r) => shownPaths.has(r.path.name));
      return true;
    };

    for (const p of m.points) {
      const ctrl = isControl(p.name);
      if (!isShown(p, ctrl)) continue;
      const isSel = sel?.type === 'point' && sel.name === p.name;
      const g = s('g', { class: `pt${ctrl ? ' control' : ''}${isSel ? ' sel' : ''}`, 'data-point': p.name, transform: `translate(${p.x},${flipY(p.y)})` });
      g.append(s('circle', { class: 'grab', r: 3.2 }));
      g.append(ctrl
        ? s('rect', { class: 'dot', x: -1.2, y: -1.2, width: 2.4, height: 2.4 })
        : s('circle', { class: 'dot', r: 1.6 }));
      g.append(s('title', {}, document.createTextNode(p.name)));
      layers.points.append(g);
    }
    renderOverlay();
  }

  // Markers (diamonds) and speed zones (a heavier stretch with a cap at each end) for the
  // selected path's routine step. The cap and diamond handles drag along the path.
  function drawEvents(p, step) {
    const geo = p && geometry(p);
    if (!geo || !geo.len) return;
    const at = (q) => `translate(${q.x},${flipY(q.y)})`;
    step.events.forEach((e, i) => {
      if (e.type === 'zone') {
        const pts = slice(geo, e.from, e.to);
        const mid = posAt(geo, (e.from + e.to) / 2);
        layers.events.append(
          s('polyline', { class: 'zone', points: pts.map((q) => `${q.x},${flipY(q.y)}`).join(' '), 'pointer-events': 'none' }),
          s('text', { class: 'label zone-label', x: mid.x + 1.8, y: flipY(mid.y) + 4.2, 'pointer-events': 'none' }, document.createTextNode(`${Math.round(e.speed * 100)}%`)));
        for (const part of ['from', 'to']) {
          layers.events.append(s('g', { class: 'zone-end', 'data-event': i, 'data-part': part, transform: at(posAt(geo, e[part])) },
            s('circle', { class: 'grab', r: 3 }), s('rect', { class: 'cap', x: -1, y: -1, width: 2, height: 2 })));
        }
      } else {
        layers.events.append(s('g', { class: 'marker', 'data-event': i, 'data-part': 'at', transform: at(posAt(geo, e.at)) },
          s('circle', { class: 'grab', r: 3.2 }),
          s('rect', { class: 'diamond', x: -1.5, y: -1.5, width: 3, height: 3, transform: 'rotate(45)' }),
          s('text', { class: 'label', x: 2.6, y: 4 }, document.createTextNode(cmdLabel(e.command)))));
      }
    });
  }

  // Heading targets of the selected path: a ghost robot facing the target heading, set on the path
  // where it applies. Drag the ghost along the path to move it, and the round handle to turn it.
  function drawHeadingTargets(p) {
    const targets = p && p.headings;
    if (!targets || !targets.length || (p.heading || {}).mode === 'default') return;
    const geo = geometry(p);
    if (!geo || !geo.len) return;
    targets.forEach((t, i) => {
      const pos = posAt(geo, t.at);
      const y = flipY(pos.y);
      const hx = 9 * Math.cos(rad(t.deg)), hy = -9 * Math.sin(rad(t.deg));
      layers.events.append(s('g', { class: 'hint', transform: `translate(${pos.x},${y})` },
        s('g', { transform: `rotate(${-t.deg})`, 'pointer-events': 'none' }, robotShape('robot-box target')),
        s('line', { class: 'handle-line', x1: 0, y1: 0, x2: hx, y2: hy, 'pointer-events': 'none' }),
        s('circle', { class: 'htarget-grab', 'data-htarget': i, r: 3.4 }),
        s('circle', { class: 'htarget-dot', r: 1.5, 'pointer-events': 'none' }),
        s('circle', { class: 'handle', 'data-hhandle': i, cx: hx, cy: hy, r: 1.7 })));
    });
  }

  function renderOverlay() {
    layers.overlay.replaceChildren();
    const m = S.model;
    if (!m) return;
    const focus = S.selection?.type === 'point' ? S.selection.name : S.hover;
    const p = focus && point(focus);
    if (p && !isControl(p.name)) {
      const y = flipY(p.y);
      layers.overlay.append(s('g', { transform: `translate(${p.x},${y}) rotate(${-p.h})`, 'pointer-events': 'none' }, robotShape('robot-box')));
      if (S.selection?.type === 'point' && !readonly()) {
        const hx = p.x + 9 * Math.cos(rad(p.h)), hy = y - 9 * Math.sin(rad(p.h));
        layers.overlay.append(
          s('line', { class: 'handle-line', x1: p.x, y1: y, x2: hx, y2: hy, 'pointer-events': 'none' }),
          s('circle', { class: 'handle', 'data-handle': p.name, cx: hx, cy: hy, r: 1.7 }));
      }
    }
    for (const g of S.guides || []) {
      const n = size();
      layers.overlay.append(g.axis === 'x'
        ? s('line', { class: 'guide', x1: g.v, y1: 0, x2: g.v, y2: n })
        : s('line', { class: 'guide', x1: 0, y1: flipY(g.v), x2: n, y2: flipY(g.v) }));
    }
    if (S.mode === 'add' && S.cursor) {
      const from = endpoint(m);
      if (from) layers.overlay.append(s('line', { class: 'preview', x1: from.x, y1: flipY(from.y), x2: S.cursor.x, y2: flipY(S.cursor.y) }));
    }
  }

  // ---- pointer interaction ------------------------------------------------

  // Robot poses keep the whole rotated robot inside the field; control points
  // are not poses, so only their center is bounded.
  const extent = (h) => {
    const c = Math.abs(Math.cos(rad(h))), n = Math.abs(Math.sin(rad(h)));
    const { w, l } = S.robot;
    return { x: Math.ceil((c * l + n * w) * 5) / 10, y: Math.ceil((n * l + c * w) * 5) / 10 };
  };
  const fitPoint = (p) => {
    const e = isControl(p.name) ? { x: 0, y: 0 } : extent(p.h);
    p.x = clamp(p.x, Math.min(e.x, size() / 2), Math.max(size() - e.x, size() / 2));
    p.y = clamp(p.y, Math.min(e.y, size() / 2), Math.max(size() - e.y, size() / 2));
  };

  // Smart guides: while placing or dragging a point it pulls toward lines shared with the other
  // points (same x or y, so a path can go dead straight), the field's center lines, and the walls.
  // The pull is gentle (GUIDE_PULL inches) and holding Alt turns it off.
  const GUIDE_PULL = 1.5;
  const snapPoint = (q, e, skip) => {
    const f = e.shiftKey ? Math.round : round1;
    const out = { x: clamp(f(q.x), 0, size()), y: clamp(f(q.y), 0, size()) };
    S.guides = [];
    if (e.altKey) return out;

    const dragged = skip && point(skip);
    const ext = dragged && !isControl(skip) ? extent(dragged.h) : { x: 0, y: 0 };
    const cands = { x: [], y: [] };
    for (const p of S.model.points) {
      if (p.name === skip) continue;
      cands.x.push({ v: p.x, from: p });
      cands.y.push({ v: p.y, from: p });
    }
    cands.x.push({ v: size() / 2 }, { v: ext.x }, { v: size() - ext.x });
    cands.y.push({ v: size() / 2 }, { v: ext.y }, { v: size() - ext.y });

    for (const axis of ['x', 'y']) {
      let best = null;
      for (const c of cands[axis]) {
        const d = Math.abs(c.v - q[axis]);
        if (d <= GUIDE_PULL && (!best || d < best.d)) best = { ...c, d };
      }
      if (best) {
        out[axis] = best.v;
        S.guides.push({ axis, v: best.v, from: best.from });
      }
    }
    // The pull can have moved the point; guides must still reach the points they came from.
    return out;
  };

  function bindField() {
    const svg = $('#field');

    svg.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !S.model) return;
      const handle = e.target.closest('[data-handle]');
      const evEl = e.target.closest('[data-event]');
      const ptEl = e.target.closest('[data-point]');
      const pathEl = e.target.closest('[data-path]');

      if (S.mode === 'add' && !readonly()) {
        const q = snapPoint(clientToField(e), e);
        addSegment(ptEl ? ptEl.dataset.point : null, q.x, q.y);
        return;
      }
      const htEl = e.target.closest('[data-htarget]');
      const hhEl = e.target.closest('[data-hhandle]');
      if ((htEl || hhEl) && !readonly() && S.selection?.type === 'path') {
        S.drag = { type: hhEl ? 'hturn' : 'hmove', index: Number((hhEl || htEl).dataset[hhEl ? 'hhandle' : 'htarget']), moved: false };
        svg.setPointerCapture(e.pointerId);
      } else if (evEl && routineEditable()) {
        S.drag = { type: 'event', index: Number(evEl.dataset.event), part: evEl.dataset.part, moved: false };
        svg.setPointerCapture(e.pointerId);
      } else if (handle && !readonly()) {
        S.drag = { type: 'heading', name: handle.dataset.handle, moved: false };
        svg.setPointerCapture(e.pointerId);
      } else if (ptEl) {
        S.selection = { type: 'point', name: ptEl.dataset.point };
        S.drag = readonly() ? null : { type: 'move', name: ptEl.dataset.point, moved: false };
        if (S.drag) svg.setPointerCapture(e.pointerId);
        renderAll();
      } else if (pathEl) {
        S.selStep = null;
        S.selection = { type: 'path', name: pathEl.dataset.path };
        renderAll();
      } else {
        S.selection = null;
        renderAll();
      }
    });

    svg.addEventListener('pointermove', (e) => {
      if (!S.model) return;
      const raw = clientToField(e);
      S.cursor = raw;
      $('#readout').textContent = `x ${raw.x.toFixed(1)}   y ${raw.y.toFixed(1)}`;
      const d = S.drag;
      if (d) {
        if (!d.moved) { pushUndo(); d.moved = true; }
        if (d.type === 'hmove' || d.type === 'hturn') {
          const path = S.selection?.type === 'path' ? pathNamed(S.selection.name) : null;
          const t = path && path.headings && path.headings[d.index];
          const geo = t && geometry(path);
          if (geo) {
            if (d.type === 'hmove') {
              t.at = clamp(fractionNear(geo, raw), 0.01, 0.99);
            } else {
              const pos = posAt(geo, t.at);
              const a = deg(Math.atan2(raw.y - pos.y, raw.x - pos.x));
              t.deg = normDeg(e.shiftKey ? Math.round(a) : Math.round(a / 90) * 90);
            }
          }
          changed();
          return;
        }
        if (d.type === 'event') {
          const step = stepForSelection();
          const ev = step && step.events[d.index];
          const path = S.selection?.type === 'path' ? pathNamed(S.selection.name) : null;
          const geo = ev && path && geometry(path);
          if (geo) {
            const f = fractionNear(geo, raw);
            if (ev.type === 'marker') ev.at = f;
            else if (d.part === 'from') ev.from = Math.min(f, ev.to - 0.01);
            else ev.to = Math.max(f, ev.from + 0.01);
          }
          changed();
          return;
        }
        const p = point(d.name);
        if (d.type === 'move') {
          const q = snapPoint(raw, e, d.name);
          p.x = q.x;
          p.y = q.y;
        } else {
          const a = deg(Math.atan2(raw.y - p.y, raw.x - p.x));
          p.h = normDeg(e.shiftKey ? Math.round(a) : Math.round(a / 90) * 90);
        }
        fitPoint(p);
        changed();
      } else if (S.mode === 'add') {
        S.cursor = snapPoint(raw, e);
        renderOverlay();
      }
    });

    svg.addEventListener('dblclick', (e) => {
      const pathEl = e.target.closest('[data-path]');
      if (pathEl && !readonly() && S.mode !== 'add') addControlAt(pathEl.dataset.path, clientToField(e));
    });

    const endDrag = () => { S.drag = null; if (S.guides && S.guides.length) { S.guides = []; renderOverlay(); } };
    svg.addEventListener('pointerup', endDrag);
    svg.addEventListener('pointercancel', endDrag);
    svg.addEventListener('pointerleave', () => { $('#readout').textContent = ''; S.cursor = null; S.guides = []; if (S.mode === 'add') renderOverlay(); });

    svg.addEventListener('pointerover', (e) => {
      const el = e.target.closest('[data-point]');
      const name = el ? el.dataset.point : null;
      if (name !== S.hover) { S.hover = name; renderOverlay(); }
    });
  }

  function setMode(mode) {
    S.mode = mode;
    $('#field').classList.toggle('adding', mode === 'add');
    renderAll();
  }

  // ---- routine ------------------------------------------------------------
  // The auto's routine(): an ordered list of steps (follow a path, set a state, wait, move the
  // flower bar). A path step can also carry markers (a command at a point along the path) and
  // speed zones (a speed cap between two points). Positions are fractions of the path's length.

  const routineOf = (m = S.model) => (m && m.routine) || null;
  const routineEditable = () => !!routineOf() && !routineOf().locked && !readonly();

  const cmdKey = (c) => (c.type === 'wait' ? 'wait' : `${c.type}:${c.value}`);
  function cmdFromKey(key, prev) {
    if (key === 'wait') return { type: 'wait', seconds: prev && prev.type === 'wait' ? prev.seconds : 1 };
    const [type, value] = key.split(':');
    return { type, value };
  }
  const cmdLabel = (c) => (c.type === 'state' ? c.value : c.type === 'bar' ? `bar ${c.value}` : `wait ${fmt(c.seconds)}s`);

  function commandSelect(c, onChange, allowWait = true) {
    const cfg = S.config;
    const opt = (key, text) => h('option', { value: key, selected: cmdKey(c) === key, text });
    const groups = [
      h('optgroup', { label: 'Robot state' }, cfg.states.map((v) => opt(`state:${v}`, `State: ${v}`))),
      h('optgroup', { label: 'Flower bar' }, cfg.barStates.map((v) => opt(`bar:${v}`, `Flower bar: ${v}`))),
    ];
    if (allowWait) groups.push(opt('wait', 'Wait'));
    return h('select', { 'aria-label': 'Command', disabled: !routineEditable(), onchange: (e) => onChange(cmdFromKey(e.target.value, c)) }, groups);
  }

  const secondsInput = (c, onCommit) => h('input', {
    type: 'number', min: 0, max: 600, step: 0.1, value: fmt(c.seconds), disabled: !routineEditable(), 'aria-label': 'Seconds',
    onchange: (e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) onCommit(clamp(v, 0, 600)); else renderAll(); },
  });

  function editSteps(fn) {
    if (!routineEditable()) return;
    edit((m) => fn(m.routine.steps));
  }

  function addStep(key) {
    editSteps((steps) => {
      if (key.startsWith('path:')) steps.push({ type: 'path', path: key.slice(5), events: [] });
      else steps.push(cmdFromKey(key));
    });
  }

  // Move the step at index `from` so it ends up before index `to` (0..length) of the current list.
  function reorderStep(from, to) {
    editSteps((steps) => {
      const picked = steps[S.selStep];
      const [moved] = steps.splice(from, 1);
      steps.splice(to > from ? to - 1 : to, 0, moved);
      if (picked) S.selStep = steps.indexOf(picked);
    });
  }

  // Drag to reorder: the card lifts off the list and follows the pointer while the others slide
  // around an empty gap. The step order only changes when it is dropped.
  const drag = { suppressClick: false };

  function beginReorder(e, card, from) {
    if (e.button !== 0 || e.target.closest('select, input, .small')) return;
    const list = card.parentNode;
    const startX = e.clientX, startY = e.clientY;
    let st = null; // set once the pointer has moved far enough to count as a drag

    const move = (ev) => {
      if (!st) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5) return;
        st = lift(list, card, startY);
      }
      ev.preventDefault();
      carry(st, ev.clientY);
    };
    const end = (cancelled) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', key, true);
      if (st) drop(st, from, cancelled);
    };
    const up = () => end(false);
    const cancel = () => end(true);
    const key = (ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); end(true); } };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', key, true);
  }

  const cardsBefore = (list, gap, card) => [...list.children]
    .filter((r) => r !== card && r !== gap && gap.compareDocumentPosition(r) & Node.DOCUMENT_POSITION_PRECEDING).length;

  function lift(list, card, startY) {
    const rect = card.getBoundingClientRect();
    const gap = h('li', { class: 'step-gap', 'aria-hidden': 'true' });
    gap.style.height = `${rect.height}px`;
    list.insertBefore(gap, card);
    Object.assign(card.style, { position: 'fixed', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, zIndex: '50', pointerEvents: 'none' });
    card.classList.add('lifted');
    list.classList.add('reordering');
    document.body.style.cursor = 'grabbing';
    drag.suppressClick = true;
    return { list, card, gap, grab: startY - rect.top };
  }

  function carry(st, y) {
    const { list, card, gap } = st;
    const top = y - st.grab;
    card.style.top = `${top}px`;
    const side = $('#sidebar');
    const sr = side.getBoundingClientRect();
    if (y < sr.top + 28) side.scrollTop -= 10; else if (y > sr.bottom - 28) side.scrollTop += 10;

    const center = top + card.offsetHeight / 2;
    const others = [...list.children].filter((r) => r !== card && r !== gap);
    const want = others.filter((r) => { const b = r.getBoundingClientRect(); return b.top + b.height / 2 < center; }).length;
    if (want === cardsBefore(list, gap, card)) return;

    const tops = new Map(others.map((r) => [r, r.getBoundingClientRect().top]));
    list.insertBefore(gap, others[want] || null);
    for (const r of others) {
      const dy = tops.get(r) - r.getBoundingClientRect().top;
      if (!dy) continue;
      r.style.transition = 'none';
      r.style.transform = `translateY(${dy}px)`;
      void r.offsetHeight;
      r.style.transition = 'transform 140ms ease';
      r.style.transform = '';
    }
  }

  function drop(st, from, cancelled) {
    const { list, card, gap } = st;
    const to = cardsBefore(list, gap, card);
    let done = false;
    const settle = () => {
      if (done) return;
      done = true;
      document.body.style.cursor = '';
      if (cancelled || to === from) renderSidebar();
      else reorderStep(from, to > from ? to + 1 : to);
      setTimeout(() => { drag.suppressClick = false; }, 0);
    };
    if (cancelled) { settle(); return; }
    card.style.transition = 'top 120ms ease';
    card.style.top = `${gap.getBoundingClientRect().top}px`;
    setTimeout(settle, 130);
  }

  function removeStep(i) {
    editSteps((steps) => {
      steps.splice(i, 1);
      S.selStep = null;
    });
  }

  function selectStep(i) {
    const step = routineOf().steps[i];
    if (step.type !== 'path') return;
    S.selStep = i;
    S.selection = { type: 'path', name: step.path };
    renderAll();
  }

  // The step whose markers and zones show for the selected path: the one picked in the
  // routine list, else the first step that follows it.
  function stepForSelection() {
    const r = routineOf();
    if (!r || S.selection?.type !== 'path') return null;
    const picked = r.steps[S.selStep];
    if (picked && picked.type === 'path' && picked.path === S.selection.name) return picked;
    return r.steps.find((st) => st.type === 'path' && st.path === S.selection.name) || null;
  }

  function stepRow(step, i) {
    const r = routineOf();
    const ed = routineEditable();
    const active = step.type === 'path' && S.selection?.type === 'path' && S.selection.name === step.path && stepForSelection() === step;
    let body;
    if (step.type === 'path') {
      const marks = step.events.filter((e) => e.type === 'marker').length;
      const zones = step.events.filter((e) => e.type === 'zone').length;
      const meta = [marks && `${marks} marker${marks > 1 ? 's' : ''}`, zones && `${zones} zone${zones > 1 ? 's' : ''}`].filter(Boolean).join(' · ');
      body = h('button', { type: 'button', class: 'link step-main', title: 'Show on the field', onclick: () => selectStep(i) },
        h('span', { text: `Follow ${step.path}` }), meta && h('span', { class: 'meta', text: meta }));
    } else {
      body = h('div', { class: 'step-cmd' },
        commandSelect(step, (c) => editSteps((steps) => { steps[i] = c; })),
        step.type === 'wait' && h('span', { class: 'secs' }, secondsInput(step, (v) => editSteps((steps) => { steps[i].seconds = v; })), h('span', { class: 'muted', text: 's' })));
    }
    const row = h('li', {
      class: `step${active ? ' sel' : ''}${ed ? ' movable' : ''}`,
      // Drag from anywhere on the card except its own controls.
      onpointerdown: ed ? (e) => beginReorder(e, row, i) : null,
    },
    body,
    h('button', { type: 'button', class: 'small', disabled: !ed, 'aria-label': 'Remove step', onclick: () => removeStep(i), text: '×' }));
    return row;
  }

  function stepList(cards) {
    const list = h('ol', { class: 'list steps' }, cards);
    // A drag ends with a click on whatever is under the pointer; that is not a click on a step.
    list.addEventListener('click', (e) => { if (drag.suppressClick) { e.stopPropagation(); e.preventDefault(); } }, true);
    return list;
  }

  const addPathButton = () => h('button', {
    type: 'button', class: `small${S.mode === 'add' ? ' active' : ''}`, disabled: readonly(),
    title: 'Click on the field to draw new paths (P)', onclick: () => setMode(S.mode === 'add' ? 'select' : 'add'),
  }, S.mode === 'add' ? 'Done' : 'Add path');

  function routineSection() {
    const r = routineOf();
    if (!r) return null;
    const m = S.model;
    const add = h('select', {
      'aria-label': 'Add a step', disabled: !routineEditable(),
      onchange: (e) => { const v = e.target.value; e.target.value = ''; if (v) addStep(v); },
    },
      h('option', { value: '', selected: true, text: 'Add step…' }),
      h('optgroup', { label: 'Drive' }, m.paths.map((p) => h('option', { value: `path:${p.name}`, text: `Follow ${p.name}` }))),
      h('optgroup', { label: 'Robot state' }, S.config.states.map((v) => h('option', { value: `state:${v}`, text: `State: ${v}` }))),
      h('optgroup', { label: 'Flower bar' }, S.config.barStates.map((v) => h('option', { value: `bar:${v}`, text: `Flower bar: ${v}` }))),
      h('option', { value: 'wait', text: 'Wait' }));
    return h('div', { class: 'section' },
      h('div', { class: 'section-head' }, h('span', { text: 'Routine' }), addPathButton()),
      h('label', { class: 'check reset-toggle', title: 'Start the routine with the robot in IDLE and the flower bar UP. Written to the routine, but not listed as steps.' },
        h('input', { type: 'checkbox', checked: !!r.reset, disabled: !routineEditable(), onchange: (e) => edit((model) => { model.routine.reset = e.target.checked; }) }),
        h('span', { text: 'Reset robot' }),
        h('span', { class: 'muted', text: 'IDLE, flower bar UP' })),
      r.locked && h('div', { class: 'error-text' }, h('div', { text: 'The editor can\'t rewrite this routine, so it is read-only:' }), r.issues.slice(0, 3).map((i) => h('div', { text: i }))),
      r.steps.length ? stepList(r.steps.map(stepRow)) : h('div', { class: 'empty', text: 'No steps yet' }),
      h('div', { class: 'add-step' }, add));
  }

  // A straight path is just its two ends. Split it up so a position part-way along (a marker, a
  // zone edge, the robot at some moment) can be found; curves are already sampled finely.
  function dense(pts, n = 200) {
    if (pts.length > 2) return pts;
    const [a, b] = pts;
    return Array.from({ length: n + 1 }, (_, i) => ({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n }));
  }

  // Path geometry for placing markers: sampled points with cumulative arc length.
  function geometry(p) {
    const raw = samples(S.model, p, 200);
    const pts = raw && dense(raw);
    if (!pts) return null;
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    return { pts, cum, len: cum[cum.length - 1] };
  }

  function fractionNear(geo, q) {
    let best = 0, bestD = Infinity;
    geo.pts.forEach((a, i) => { const d = Math.hypot(a.x - q.x, a.y - q.y); if (d < bestD) { bestD = d; best = i; } });
    return geo.len ? Math.round((geo.cum[best] / geo.len) * 200) / 200 : 0;
  }

  // The part of the path between two fractions, for drawing a zone.
  function slice(geo, f0, f1) {
    const out = [];
    const at = (f) => posAt(geo, f);
    out.push(at(f0));
    geo.pts.forEach((a, i) => { if (geo.cum[i] > f0 * geo.len && geo.cum[i] < f1 * geo.len) out.push(a); });
    out.push(at(f1));
    return out;
  }

  // ---- sidebar ------------------------------------------------------------

  function renderSidebar() {
    const root = $('#sidebar');
    const m = S.model;
    const nf = S.newFile;

    const fileSection = h('div', { class: 'section' },
      h('div', { class: 'section-head' }, h('span', { text: 'File' })),
      h('div', { class: 'file-row' },
        h('select', { 'aria-label': 'Paths file', onchange: (e) => openFile(e.target.value) },
          S.files.map((f) => h('option', { value: f.file, selected: f.file === S.file, text: f.file.replace(/\.java$/, '') + (f.locked ? ' (read-only)' : '') }))),
        h('button', { type: 'button', title: 'Create a new auto (paths + red and blue opmodes)', onclick: () => { S.newFile = { open: !nf.open, error: '' }; renderSidebar(); if (S.newFile.open) $('#new-name')?.focus(); } }, 'New'),
        h('button', { type: 'button', class: 'danger', title: 'Delete this auto and its opmode files', disabled: !S.file, onclick: deleteFile }, 'Delete')),
      nf.open && h('form', { class: 'new-file', onsubmit: createFile },
        h('input', { id: 'new-name', type: 'text', placeholder: 'e.g. ParkAuto', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Auto name' }),
        h('button', { type: 'submit' }, 'Create')),
      nf.open && nf.error && h('div', { class: 'error-text', text: nf.error }));

    const pathItems = m ? m.paths.map((p) => h('li', {
      class: S.selection?.type === 'path' && S.selection.name === p.name ? 'sel' : '',
      onclick: () => { S.selection = { type: 'path', name: p.name }; renderAll(); },
    }, h('span', { class: 'name', text: p.name }), h('span', { class: 'meta', text: p.pts.length > 2 ? 'curve' : 'line' }))) : [];

    // Paths the routine doesn't follow stay reachable here; without a routine every path is listed.
    const r = routineOf();
    const managed = !!r && !r.locked;
    const used = new Set(managed ? r.steps.filter((st) => st.type === 'path').map((st) => st.path) : []);
    const listed = m ? m.paths.filter((p) => !used.has(p.name)) : [];
    const pathSection = managed && !listed.length ? null : h('div', { class: 'section' },
      h('div', { class: 'section-head' },
        h('span', { text: managed ? 'Not in routine' : 'Paths' }),
        !managed && addPathButton()),
      listed.length ? h('ul', { class: 'list' }, pathItems.filter((li, i) => !used.has(m.paths[i].name))) : h('div', { class: 'empty', text: 'No paths yet' }));

    setChildren(root, fileSection, routineSection(), pathSection);
  }

  async function createFile(e) {
    e.preventDefault();
    const name = $('#new-name').value.trim();
    try {
      const { file } = await api('/files', { method: 'POST', body: { name } });
      S.newFile = { open: false, error: '' };
      await refreshFiles();
      await openFile(file);
    } catch (err) {
      S.newFile.error = err.message;
      renderSidebar();
      $('#new-name').value = name;
    }
  }

  async function deleteFile() {
    const f = S.files.find((x) => x.file === S.file);
    if (!f) return;
    const name = f.file.replace(/\.java$/, '');
    if (!confirm(`Delete ${name}?\n\nThis permanently deletes:\n${f.family.map((x) => `  ${x}`).join('\n')}`)) return;
    clearTimeout(S.saveTimer);
    S.saving = false;
    try {
      await api(`/files/${f.file}`, { method: 'DELETE' });
    } catch (err) {
      flash(err.message, true);
      return;
    }
    S.file = null;
    S.model = null;
    await refreshFiles();
    if (S.files.length) await openFile(S.files[0].file); else renderAll();
    flash(`Deleted ${name}`);
  }

  // ---- inspector ----------------------------------------------------------

  const row = (label, control, cls = '') => h('div', { class: `row ${cls}` }, h('label', { text: label }), control);

  function numberInput(value, onCommit, step = 0.1) {
    return h('input', {
      type: 'number', step, value: fmt(value), disabled: readonly(),
      onchange: (e) => {
        const v = parseFloat(e.target.value);
        if (Number.isFinite(v)) onCommit(v); else renderInspector();
      },
    });
  }

  function nameInput(current, taken, onCommit) {
    const err = h('div', { class: 'error-text' });
    const input = h('input', {
      type: 'text', value: current, spellcheck: 'false', autocomplete: 'off', disabled: readonly(),
      onchange: (e) => {
        const v = e.target.value.trim();
        if (v === current) { err.textContent = ''; input.classList.remove('invalid'); return; }
        let problem = '';
        if (!JAVA_NAME.test(v) || JAVA_WORDS.has(v)) problem = 'Letters, digits and _ only; must start with a letter.';
        else if (taken(v)) problem = `"${v}" is already used.`;
        if (problem) { err.textContent = problem; input.classList.add('invalid'); return; }
        onCommit(v);
      },
    });
    return h('div', {}, input, err);
  }

  function pointSelect(current, onChange) {
    return h('select', { disabled: readonly(), onchange: (e) => onChange(e.target.value) },
      S.model.points.filter((p) => !isControl(p.name) || p.name === current)
        .map((p) => h('option', { value: p.name, selected: p.name === current, text: p.name })));
  }

  function seg(options, current, onPick) {
    return h('div', { class: 'seg' }, options.map(([value, label]) =>
      h('button', { type: 'button', class: value === current ? 'active' : '', disabled: readonly(), onclick: () => onPick(value), text: label })));
  }

  const HEADING_LABELS = [
    ['linear', 'Linear'],
    ['constant', 'Constant'],
    ['tangent', 'Tangent'],
    ['reverseTangent', 'Reverse tangent'],
    ['facing', 'Face a point'],
  ];

  function renderInspector() {
    const root = $('#inspector');
    const m = S.model;
    const sel = S.selection;
    if (!m || !sel) {
      setChildren(root, h('div', { class: 'help' },
        h('h3', { text: 'Nothing selected' }),
        h('p', { text: 'Select a path or point on the field or in the list. Changes are written to the Java file as you make them.' }),
        h('dl', {},
          [['P', 'Draw new paths'], ['Esc', 'Stop drawing / deselect'], ['Drag', 'Move a point'], ['Shift', 'Whole inches · free heading'],
            ['Dbl-click', 'Add a control point to a path'], ['Space', 'Play the auto'], ['Arrows', 'Nudge selected point'], ['Delete', 'Remove selection'], ['Ctrl+Z', 'Undo (Shift: redo)']]
            .flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })]))));
      return;
    }

    if (sel.type === 'point') {
      const p = point(sel.name);
      if (!p) return setChildren(root);
      const ctrl = isControl(p.name);
      const used = roles(p.name).map((r) => r.path.name);
      setChildren(root,
        h('div', { class: 'title' }, h('span', { text: ctrl ? 'Control point' : 'Point' })),
        row('Name', nameInput(p.name, (v) => m.points.some((x) => x.name === v) || m.paths.some((x) => x.name === v), (v) => renamePoint(p.name, v))),
        row('X', numberInput(p.x, (v) => edit(() => { p.x = round1(v); fitPoint(p); }))),
        row('Y', numberInput(p.y, (v) => edit(() => { p.y = round1(v); fitPoint(p); }))),
        !ctrl && row('Heading', numberInput(p.h, (v) => edit(() => { p.h = normDeg(Math.round(v * 10) / 10); fitPoint(p); }), 1)),
        row('Used by', used.length
          ? h('div', {}, used.map((n, i) => [i ? ', ' : '', h('button', { type: 'button', class: 'link', onclick: () => { S.selection = { type: 'path', name: n }; renderAll(); }, text: n })]))
          : h('span', { class: 'muted', text: 'nothing' })),
        !ctrl && row('Expose', h('label', { class: 'check' },
          h('input', { type: 'checkbox', checked: p.vis === 'public', disabled: readonly(), onchange: (e) => edit(() => { p.vis = e.target.checked ? 'public' : 'private'; }) }),
          h('span', { class: 'muted', text: `paths.${p.name}` }))),
        h('div', { class: 'actions' },
          h('button', { type: 'button', class: 'danger', disabled: readonly(), onclick: () => deletePoint(p.name), text: ctrl ? 'Remove control point' : 'Delete point' })));
      return;
    }

    const p = pathNamed(sel.name);
    if (!p) return setChildren(root);
    const first = p.pts[0], last = p.pts[p.pts.length - 1];
    const hd = p.heading || { mode: 'default' };
    const controls = p.pts.slice(1, -1);

    const headingParams = [];
    if (hd.mode === 'linear') {
      headingParams.push(
        row('From', pointSelect(hd.from, (v) => edit(() => { p.heading.from = v; }))),
        row('To', pointSelect(hd.to, (v) => edit(() => { p.heading.to = v; }))));
    } else if (hd.mode === 'constant' || hd.mode === 'facing') {
      headingParams.push(row('Point', pointSelect(hd.point, (v) => edit(() => { p.heading.point = v; }))));
    }

    setChildren(root,
      h('div', { class: 'title' }, h('span', { text: 'Path' })),
      row('Name', nameInput(p.name, (v) => m.paths.some((x) => x.name === v), (v) => renamePath(p.name, v))),
      row('Start', pointSelect(first, (v) => setEndpoint(p.name, 0, v))),
      row('End', pointSelect(last, (v) => setEndpoint(p.name, 1, v))),
      row('Controls', h('div', { class: 'controls-list' },
        controls.map((n) => h('div', { class: 'item' },
          h('button', { type: 'button', class: 'link', onclick: () => { S.selection = { type: 'point', name: n }; renderAll(); }, text: n }),
          h('button', { type: 'button', class: 'small', disabled: readonly(), onclick: () => deletePoint(n), 'aria-label': `Remove ${n}`, text: 'Remove' }))),
        h('div', {}, h('button', { type: 'button', class: 'small', disabled: readonly(), onclick: addControlToSelected, text: 'Add control point' })),
        !controls.length && h('div', { class: 'muted', text: 'None, so this is a straight line. Double-click the path to add one.' })), 'top'),
      h('hr', { class: 'rule' }),
      row('Heading', h('select', { disabled: readonly(), onchange: (e) => setHeadingMode(p.name, e.target.value) },
        hd.mode === 'default' && h('option', { value: 'default', selected: true, text: 'Not set (Pedro default)' }),
        HEADING_LABELS.map(([v, label]) => h('option', { value: v, selected: v === hd.mode, text: label }))), 'top'),
      headingParams,
      hd.mode !== 'default' && headingTargetsSection(p),
      eventsSection(p),
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'danger', disabled: readonly(), onclick: () => deletePath(p.name), text: 'Delete path' })));
  }

  // Heading targets: the robot is facing `deg` by `at` of the way along the path, then heads on
  // toward the next target (or the path's own end heading). Saved in the paths class.
  function headingTargetsSection(p) {
    const list = p.headings || [];
    const set = (fn) => edit(() => { if (!p.headings) p.headings = []; fn(p.headings); if (!p.headings.length) delete p.headings; });
    const add = () => {
      const geo = geometry(p);
      const guess = geo ? Math.round(deg(headingAt({ ...geo, path: p, entering: 0 }, 0.5))) : 0;
      set((hs) => hs.push({ at: 0.5, deg: normDeg(Math.round(guess / 90) * 90) }));
    };
    return [
      h('hr', { class: 'rule' }),
      h('div', { class: 'section-head' }, h('span', { text: 'Heading targets' }),
        h('button', { type: 'button', class: 'small', disabled: readonly(), onclick: add, text: 'Add' })),
      list.length ? list.map((t) => h('div', { class: 'event' },
        h('div', { class: 'event-head' },
          h('span', { class: 'muted', text: 'At' }),
          h('input', {
            type: 'number', min: 1, max: 99, step: 1, value: String(Math.round(t.at * 1000) / 10), disabled: readonly(), 'aria-label': 'Position, percent',
            onchange: (e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) set(() => { t.at = clamp(v, 1, 99) / 100; }); else renderAll(); },
          }),
          h('span', { class: 'muted', text: '%' }),
          h('button', { type: 'button', class: 'small', disabled: readonly(), 'aria-label': 'Remove', onclick: () => set((hs) => hs.splice(hs.indexOf(t), 1)), text: '×' })),
        h('div', { class: 'event-head' },
          h('span', { class: 'muted', text: 'Face' }),
          h('input', {
            type: 'number', step: 1, value: String(Math.round(t.deg * 10) / 10), disabled: readonly(), 'aria-label': 'Heading, degrees',
            onchange: (e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) set(() => { t.deg = normDeg(Math.round(v * 10) / 10); }); else renderAll(); },
          }),
          h('span', { class: 'muted', text: '°' }))))
        : h('div', { class: 'muted', text: 'Turn the robot to face a heading part-way along this path, then on to the path\'s end heading.' }),
    ];
  }

  const pctInput = (fraction, onCommit, label) => h('input', {
    type: 'number', min: 0, max: 100, step: 1, value: String(Math.round(fraction * 1000) / 10), disabled: !routineEditable(), 'aria-label': label,
    onchange: (e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) onCommit(clamp(v, 0, 100) / 100); else renderAll(); },
  });

  // Markers and speed zones of the routine step that follows the selected path.
  function eventsSection(p) {
    const r = routineOf();
    if (!r) return [];
    const step = stepForSelection();
    if (!step) {
      return [h('hr', { class: 'rule' }),
        h('div', { class: 'muted', text: 'This path is not in the routine.' }),
        h('div', { class: 'actions' }, h('button', { type: 'button', disabled: !routineEditable(), onclick: () => addStep(`path:${p.name}`), text: 'Add to routine' }))];
    }
    const ed = routineEditable();
    const remove = (e) => h('button', { type: 'button', class: 'small', disabled: !ed, 'aria-label': 'Remove', onclick: () => editSteps(() => { step.events.splice(step.events.indexOf(e), 1); }), text: '×' });
    const markers = step.events.filter((e) => e.type === 'marker');
    const zones = step.events.filter((e) => e.type === 'zone');

    return [
      h('hr', { class: 'rule' }),
      h('div', { class: 'section-head' }, h('span', { text: 'Markers' }),
        h('button', { type: 'button', class: 'small', disabled: !ed, onclick: () => editSteps(() => { step.events.push({ type: 'marker', at: 0.5, command: { type: 'state', value: S.config.states[0] } }); }), text: 'Add' })),
      markers.length ? markers.map((e) => h('div', { class: 'event' },
        h('div', { class: 'event-head' }, h('span', { class: 'muted', text: 'At' }), pctInput(e.at, (v) => editSteps(() => { e.at = v; }), 'Position, percent'), h('span', { class: 'muted', text: '%' }), remove(e)),
        commandSelect(e.command, (c) => editSteps(() => { e.command = c; }), false)))
        : h('div', { class: 'muted', text: 'Run a command when the robot passes a point on this path.' }),
      h('div', { class: 'section-head spaced' }, h('span', { text: 'Speed zones' }),
        h('button', { type: 'button', class: 'small', disabled: !ed, onclick: () => editSteps(() => { step.events.push({ type: 'zone', from: 0.3, to: 0.6, speed: 0.5 }); }), text: 'Add' })),
      zones.length ? zones.map((e) => h('div', { class: 'event' },
        h('div', { class: 'event-head' },
          h('span', { class: 'muted', text: 'From' }), pctInput(e.from, (v) => editSteps(() => { e.from = Math.min(v, e.to - 0.01); }), 'Zone start, percent'),
          h('span', { class: 'muted', text: 'to' }), pctInput(e.to, (v) => editSteps(() => { e.to = Math.max(v, e.from + 0.01); }), 'Zone end, percent'),
          h('span', { class: 'muted', text: '%' }), remove(e)),
        h('div', { class: 'event-head' }, h('span', { class: 'muted', text: 'Max' }),
          h('input', {
            type: 'number', min: 1, max: 100, step: 1, value: String(Math.round(e.speed * 100)), disabled: !ed, 'aria-label': 'Max speed, percent of full speed',
            onchange: (ev) => { const v = parseFloat(ev.target.value); if (v > 0) editSteps(() => { e.speed = clamp(v, 1, 100) / 100; }); else renderAll(); },
          }), h('span', { class: 'muted', text: '% speed' }))))
        : h('div', { class: 'muted', text: 'Cap the robot\'s speed (as a percent of full speed) between two points on this path.' }),
    ];
  }

  // ---- banner / chrome ----------------------------------------------------

  function renderChrome() {
    const banner = $('#banner');
    const m = S.model;
    banner.hidden = !S.offline && !(m && m.locked);
    if (S.offline) {
      setChildren(banner,
        h('strong', { text: 'Path server not reachable. ' }),
        document.createTextNode('Start it with pathviz/start.bat. Your edits stay in this page and save as soon as it is back.'));
    } else if (m && m.locked) {
      setChildren(banner,
        h('strong', { text: 'Read-only. ' }),
        document.createTextNode(`${S.file} has code the editor can't safely rewrite, so it is shown but not saved.`),
        h('ul', {}, m.issues.slice(0, 4).map((i) => h('li', { text: i }))));
    }
    $('#undo').disabled = readonly() || !S.undo.length;
    $('#redo').disabled = readonly() || !S.redo.length;
    $('#hint').textContent = S.mode === 'add'
      ? 'Click to place the next point · click an existing point to reuse it · Esc to finish'
      : '';
  }

  function renderAll() {
    renderSidebar();
    renderField();
    renderInspector();
    renderChrome();
    rebuildPlayer();
  }

  // ---- files / live updates -----------------------------------------------

  async function refreshFiles() {
    S.files = await api('/files');
    if (S.file && !S.files.some((f) => f.file === S.file)) { S.file = null; S.model = null; }
  }

  async function openFile(name) {
    await save();
    S.model = await api(`/files/${name}`);
    S.file = name;
    S.selection = null;
    S.undo = [];
    S.redo = [];
    S.mode = 'select';
    $('#field').classList.remove('adding');
    store.set('pathviz.file', name);
    setStatus(S.model.locked ? 'Read-only' : '');
    renderAll();
    loadSequences();
  }

  async function onDiskChange(files) {
    await refreshFiles();
    if (S.file && files.includes(S.file) && !S.saving) {
      const keep = S.selection;
      S.model = await api(`/files/${S.file}`);
      S.selection = keep && (keep.type === 'path' ? pathNamed(keep.name) : point(keep.name)) ? keep : null;
      S.undo = [];
      S.redo = [];
      flash('Updated from disk');
    }
    if (!S.file && S.files.length) return openFile(S.files[0].file);
    renderAll();
  }

  function connectEvents() {
    const es = new EventSource('/api/events');
    es.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'changed') onDiskChange(msg.files).catch((err) => flash(err.message, true));
    };
    es.onerror = () => setOffline(true);
    es.onopen = () => {
      if (!S.offline) return;
      setOffline(false);
      if (S.saving) save();
      else onDiskChange(S.file ? [S.file] : []).catch((err) => flash(err.message, true));
    };
  }

  // ---- playback -----------------------------------------------------------
  // Follows Pedro: a path is a Bezier curve through [start, ...controls, end]; heading is
  // interpolated against arc-length completion. Linear takes the shortest turn, tangent
  // follows the curve, and a path with no heading call leaves the robot's heading alone.

  const TAU = Math.PI * 2;
  const norm = (a) => ((a % TAU) + TAU) % TAU;
  const normSigned = (a) => { const n = norm(a); return n >= Math.PI ? n - TAU : n; };
  const PL = { sequences: [], seq: 'all', timeline: null, time: 0, playing: false, rate: 1, last: 0 };

  async function loadSequences() {
    if (routineOf()) PL.sequences = [{ auto: S.file.replace(/\.java$/, '') }];
    else try { PL.sequences = await api(`/files/${S.file}/sequence`); } catch { PL.sequences = []; }
    if (!PL.sequences.some((x) => x.auto === PL.seq)) PL.seq = PL.sequences.length ? PL.sequences[0].auto : 'all';
    renderSeqOptions();
    rebuildPlayer();
  }

  // The routine as playback steps: states and flower bar moves are labels, waits hold the robot.
  const playStep = (st) => (st.type === 'path' ? { type: 'path', name: st.path, events: st.events }
    : st.type === 'wait' ? { type: 'wait', seconds: st.seconds }
      : { type: 'state', name: st.type === 'bar' ? `bar ${st.value}` : st.value });

  function currentSteps() {
    if (routineOf() && PL.seq !== 'all') {
      const r = routineOf();
      // The hidden reset pair still happens first in the real routine, so playback shows it too.
      return [...(r.reset ? [{ type: 'state', name: 'IDLE' }, { type: 'state', name: 'bar UP' }] : []), ...r.steps.map(playStep)];
    }
    const found = PL.sequences.find((x) => x.auto === PL.seq);
    return found ? found.steps : S.model.paths.map((p) => ({ type: 'path', name: p.name }));
  }

  function posAt(seg, f) {
    const target = f * seg.len;
    const { cum, pts } = seg;
    let lo = 0, hi = cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= target) lo = mid; else hi = mid;
    }
    const u = clamp((target - cum[lo]) / (cum[hi] - cum[lo] || 1), 0, 1);
    return { x: pts[lo].x + (pts[hi].x - pts[lo].x) * u, y: pts[lo].y + (pts[hi].y - pts[lo].y) * u, i: lo };
  }

  // The heading along a path: its own mode's heading at the start and end, and between them the
  // heading targets (each reached at its position, turning the shorter way, then on to the next).
  function headingAt(seg, f) {
    const targets = seg.path.headings;
    if (!targets || !targets.length || (seg.path.heading || {}).mode === 'default') return baseHeadingAt(seg, f);
    const stops = [{ at: 0, h: baseHeadingAt(seg, 0) },
      ...[...targets].sort((a, b) => a.at - b.at).map((t) => ({ at: t.at, h: norm(rad(t.deg)) })),
      { at: 1, h: baseHeadingAt(seg, 1) }];
    let i = 0;
    while (i < stops.length - 2 && f > stops[i + 1].at) i++;
    const span = stops[i + 1].at - stops[i].at;
    const u = span > 0 ? clamp((f - stops[i].at) / span, 0, 1) : 1;
    return norm(stops[i].h + normSigned(stops[i + 1].h - stops[i].h) * u);
  }

  function baseHeadingAt(seg, f) {
    const hd = seg.path.heading || { mode: 'default' };
    const pos = posAt(seg, f);
    const tangent = () => {
      const a = seg.pts[Math.max(0, pos.i - 1)], b = seg.pts[Math.min(seg.pts.length - 1, pos.i + 2)];
      return Math.atan2(b.y - a.y, b.x - a.x);
    };
    switch (hd.mode) {
      case 'linear': {
        const a = norm(rad(point(hd.from).h));
        return norm(a + normSigned(norm(rad(point(hd.to).h)) - a) * f);
      }
      case 'constant': return rad(point(hd.point).h);
      case 'tangent': return tangent();
      case 'reverseTangent': return tangent() + Math.PI;
      case 'facing': { const q = point(hd.point); return Math.atan2(q.y - pos.y, q.x - pos.x); }
      default: return seg.entering;
    }
  }

  // The fraction of a segment covered after `time` seconds on it.
  function fractionAt(seg, time) {
    const target = clamp(time / seg.scale, 0, seg.tc[seg.tc.length - 1]);
    const { cum, tc } = seg;
    let lo = 0, hi = tc.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (tc[mid] <= target) lo = mid; else hi = mid;
    }
    const u = clamp((target - tc[lo]) / (tc[hi] - tc[lo] || 1), 0, 1);
    return seg.len ? clamp((cum[lo] + (cum[hi] - cum[lo]) * u) / seg.len, 0, 1) : 1;
  }

  // How fast the robot goes at each sample along a path, from the robot's own numbers
  // (Constants.java): it speeds up like a motor (fast at first, easing into top speed), takes zone
  // caps as a fraction of top speed, sheds speed at its natural deceleration (so it has to start
  // slowing before a zone does), and stops at the end of the path in the distance its brake
  // controller needs (c1*v + c2*v^2). Each path starts and ends at rest.
  function speedProfile(cum, zones) {
    const R = S.config.robot;
    const n = cum.length, len = cum[n - 1];
    const cap = cum.map((d) => R.maxVelocity * Math.min(1, ...zones.filter((z) => d / len >= z.from && d / len < z.to).map((z) => z.speed)));
    const stopSpeed = (room) => (R.brakeQuadratic > 0
      ? (-R.brakeLinear + Math.sqrt(R.brakeLinear ** 2 + 4 * R.brakeQuadratic * room)) / (2 * R.brakeQuadratic)
      : room / (R.brakeLinear || 1));

    const limit = cap.slice();
    limit[n - 1] = 0;
    for (let i = n - 2; i >= 0; i--) {
      const ds = cum[i + 1] - cum[i];
      limit[i] = Math.min(limit[i], Math.sqrt(limit[i + 1] ** 2 + 2 * R.naturalDecel * ds), stopSpeed(len - cum[i]));
    }

    const v = new Array(n).fill(0);
    for (let i = 0; i < n - 1; i++) {
      const ds = cum[i + 1] - cum[i];
      const accel = Math.max(0, (R.maxVelocity - v[i]) / R.accelTimeConstant);
      v[i + 1] = Math.min(limit[i + 1], Math.sqrt(v[i] ** 2 + 2 * accel * ds));
    }

    const tc = [0];
    for (let i = 1; i < n; i++) tc.push(tc[i - 1] + (2 * (cum[i] - cum[i - 1])) / Math.max(v[i - 1] + v[i], 1e-6));
    return { v, tc };
  }

  // When a marker fires: PathEvents runs it once progress + speed * lead reaches the marker, so it
  // goes off a little early, by the distance covered in Constants.Auto.eventLeadSeconds.
  function markerTime(seg, at) {
    const lead = S.config.robot.eventLeadSeconds;
    for (let i = 0; i < seg.cum.length; i++) {
      if (seg.cum[i] + seg.v[i] * lead >= at * seg.len) return seg.tc[i] * seg.scale;
    }
    return seg.dur;
  }

  function speedAt(seg, f) {
    const target = f * seg.len;
    const { cum, v } = seg;
    let lo = 0, hi = cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= target) lo = mid; else hi = mid;
    }
    const u = clamp((target - cum[lo]) / (cum[hi] - cum[lo] || 1), 0, 1);
    return v[lo] + (v[hi] - v[lo]) * u;
  }

  function rebuildPlayer() {
    const m = S.model;
    if (!m) { PL.timeline = null; renderRobot(); renderPlayerChrome(); return; }
    const segs = [], states = [], waits = [];
    let t = 0, heading = null;
    for (const step of currentSteps()) {
      if (step.type === 'state') { states.push({ t, name: step.name }); continue; }
      if (step.type === 'wait') { waits.push({ t0: t, dur: step.seconds }); t += step.seconds; continue; }
      const p = pathNamed(step.name);
      const raw = p && samples(m, p, 200);
      const pts = raw && dense(raw);
      if (!pts) continue;
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
      const len = cum[cum.length - 1];
      const events = step.events || [];
      const zones = events.filter((e) => e.type === 'zone');
      const { v, tc } = speedProfile(cum, zones);
      const dur = Math.max(tc[tc.length - 1], 0.2);
      const seg = { path: p, t0: t, dur, pts, cum, tc, v, len, zones, scale: dur / (tc[tc.length - 1] || 1), entering: heading ?? rad(point(p.pts[0]).h) };
      heading = headingAt(seg, 1);
      for (const e of events) if (e.type === 'marker') states.push({ t: t + markerTime(seg, e.at), name: cmdLabel(e.command) });
      segs.push(seg);
      t += dur;
    }
    states.sort((a, b) => a.t - b.t);
    PL.timeline = { segs, states, waits, total: t };
    PL.time = Math.min(PL.time, t);
    renderRobot();
    renderPlayerChrome();
  }

  function poseAt(time) {
    const tl = PL.timeline;
    if (!tl || !tl.segs.length) return null;
    let i = tl.segs.findIndex((x) => time < x.t0 + x.dur);
    if (i < 0) i = tl.segs.length - 1;
    let seg = tl.segs[i];
    let f = fractionAt(seg, time - seg.t0);
    // In a wait between two paths the robot stays where the previous one ended.
    if (time < seg.t0 && i > 0) { seg = tl.segs[i - 1]; f = 1; }
    const pos = posAt(seg, f);
    return { x: pos.x, y: pos.y, h: headingAt(seg, f), seg, f, speed: time < seg.t0 && i > 0 ? 0 : speedAt(seg, f) };
  }

  function renderRobot() {
    layers.robot.replaceChildren();
    const pose = poseAt(PL.time);
    if (!pose) { $('#pstate').textContent = ''; return; }
    layers.robot.append(s('g', { transform: `translate(${pose.x},${flipY(pose.y)}) rotate(${-deg(pose.h)})` }, robotShape('robot-box play')));
    const states = PL.timeline.states.filter((x) => x.t <= PL.time + 1e-6);
    const state = states.length ? states[states.length - 1].name : '';
    const zone = pose.seg.zones.find((z) => pose.f >= z.from && pose.f < z.to);
    const waiting = PL.timeline.waits.some((w) => PL.time >= w.t0 && PL.time < w.t0 + w.dur);
    $('#pstate').textContent = [pose.seg.path.name, state, `${Math.round(pose.speed)} in/s`, zone && `cap ${Math.round(zone.speed * 100)}%`, waiting && 'waiting'].filter(Boolean).join(' · ');
  }

  function renderSeqOptions() {
    const sel = $('#seq');
    setChildren(sel,
      PL.sequences.map((x) => h('option', { value: x.auto, selected: x.auto === PL.seq, text: x.auto })),
      h('option', { value: 'all', selected: PL.seq === 'all', text: 'All paths in order' }));
  }

  function renderPlayerChrome() {
    const tl = PL.timeline;
    const has = !!tl && tl.segs.length > 0;
    $('#play').textContent = PL.playing ? 'Pause' : 'Play';
    $('#play').disabled = !has;
    $('#scrub').disabled = !has;
    $('#scrub').value = has && tl.total ? Math.round((PL.time / tl.total) * 1000) : 0;
    $('#time').textContent = has ? `${PL.time.toFixed(1)} / ${tl.total.toFixed(1)} s` : '';
  }

  function tick(now) {
    if (!PL.playing) return;
    PL.time += Math.min((now - PL.last) / 1000, 0.1) * PL.rate;
    PL.last = now;
    if (PL.time >= PL.timeline.total) { PL.time = PL.timeline.total; PL.playing = false; }
    renderRobot();
    renderPlayerChrome();
    if (PL.playing) requestAnimationFrame(tick);
  }

  function togglePlay() {
    if (PL.playing) { PL.playing = false; renderPlayerChrome(); return; }
    if (!PL.timeline || !PL.timeline.segs.length) return;
    if (PL.time >= PL.timeline.total) PL.time = 0;
    PL.playing = true;
    PL.last = performance.now();
    requestAnimationFrame(tick);
    renderPlayerChrome();
  }

  function bindPlayer() {
    $('#play').addEventListener('click', togglePlay);
    $('#scrub').addEventListener('input', (e) => {
      PL.playing = false;
      PL.time = (e.target.value / 1000) * (PL.timeline ? PL.timeline.total : 0);
      renderRobot();
      renderPlayerChrome();
    });
    $('#rate').addEventListener('change', (e) => { PL.rate = parseFloat(e.target.value); });
    $('#seq').addEventListener('change', (e) => { PL.seq = e.target.value; PL.time = 0; PL.playing = false; rebuildPlayer(); });
  }

  // ---- keyboard -----------------------------------------------------------

  function bindKeys() {
    document.addEventListener('keydown', (e) => {
      const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName);
      if (e.key === 'Escape') {
        if (S.mode === 'add') setMode('select');
        else { S.selection = null; renderAll(); }
        return;
      }
      if (typing) return;
      if (e.key === ' ' && e.target.tagName !== 'BUTTON') { e.preventDefault(); togglePlay(); return; }
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
      if (mod || !S.model) return;
      if (e.key.toLowerCase() === 'p' && !readonly()) { setMode(S.mode === 'add' ? 'select' : 'add'); return; }
      if (e.key === 'Enter' && S.mode === 'add') { setMode('select'); return; }
      const sel = S.selection;
      if (!sel || readonly()) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        sel.type === 'path' ? deletePath(sel.name) : deletePoint(sel.name);
      } else if (sel.type === 'point' && e.key.startsWith('Arrow')) {
        e.preventDefault();
        const step = e.shiftKey ? 1 : 0.1;
        const dx = { ArrowLeft: -step, ArrowRight: step }[e.key] || 0;
        const dy = { ArrowDown: -step, ArrowUp: step }[e.key] || 0;
        const p = point(sel.name);
        pushUndo();
        p.x = round1(p.x + dx);
        p.y = round1(p.y + dy);
        fitPoint(p);
        changed();
      }
    });
  }

  // ---- startup ------------------------------------------------------------

  async function init() {
    S.config = await api('/config');
    $('#dir').textContent = S.config.pathsDir;
    buildField();
    bindField();
    bindKeys();
    bindPlayer();

    const panel = $('#panel');
    const showPanel = (visible) => {
      document.querySelector('main').classList.toggle('no-inspector', !visible);
      panel.setAttribute('aria-pressed', String(visible));
      panel.textContent = visible ? 'Hide details' : 'Show details';
    };
    showPanel(store.get('pathviz.panel', true));
    panel.addEventListener('click', () => {
      const visible = document.querySelector('main').classList.contains('no-inspector');
      store.set('pathviz.panel', visible);
      showPanel(visible);
    });

    const bar = $('#bar');
    const showBar = (visible) => {
      S.showBar = visible;
      bar.setAttribute('aria-pressed', String(visible));
      renderAll();
      renderRobot();
    };
    bar.setAttribute('aria-pressed', String(S.showBar));
    bar.addEventListener('click', () => { store.set('pathviz.bar', !S.showBar); showBar(!S.showBar); });

    for (const [id, key] of [['#robotW', 'w'], ['#robotL', 'l']]) {
      const input = $(id);
      input.value = S.robot[key];
      input.addEventListener('input', () => {
        const v = parseFloat(input.value);
        if (v > 0) { S.robot[key] = v; store.set('pathviz.robot', S.robot); renderOverlay(); }
      });
    }
    $('#undo').addEventListener('click', undo);
    $('#redo').addEventListener('click', redo);
    window.addEventListener('beforeunload', () => { if (S.saving) save(); });

    await refreshFiles();
    const last = store.get('pathviz.file', null);
    const start = S.files.find((f) => f.file === last) || S.files[0];
    if (start) await openFile(start.file); else renderAll();
    connectEvents();
  }

  init().catch((e) => {
    document.body.prepend(h('p', { class: 'error-text', style: 'padding:16px', text: `Could not reach the path server: ${e.message}` }));
  });
})();

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
    ghost: store.get('pathviz.ghost', false),
    robot: store.get('pathviz.robot', { w: 16, l: 16 }),
    cursor: null,
    drag: null,
    saving: false,
    saveTimer: null,
    status: { text: '', error: false },
    newFile: { open: false, error: '' },
    offline: false,
    rev: 0,
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
    const { points, paths } = S.model;
    try {
      await api(`/files/${S.file}`, { method: 'PUT', body: { points, paths } });
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

  const snapshot = () => JSON.stringify({ points: S.model.points, paths: S.model.paths });

  function pushUndo() {
    S.undo.push(snapshot());
    if (S.undo.length > 100) S.undo.shift();
    S.redo = [];
  }

  function restore(json) {
    const { points, paths } = JSON.parse(json);
    S.model.points = points;
    S.model.paths = paths;
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
      dropOrphans(m, controls);
      S.selection = null;
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

  const mirror = (q) => ({ x: size() - q.x, y: size() - q.y });

  function clientToField(e) {
    const svg = $('#field');
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const q = pt.matrixTransform(svg.getScreenCTM().inverse());
    return { x: q.x, y: size() - q.y };
  }

  function arrowFor(list, flip) {
    const b = list[list.length - 1];
    let a = list[list.length - 2];
    for (let i = list.length - 2; i >= 0; i--) {
      a = list[i];
      if (Math.hypot(b.x - a.x, b.y - a.y) > 0.5) break;
    }
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const c = Math.cos(ang), sn = Math.sin(ang);
    const tip = { x: b.x, y: b.y };
    const base = { x: b.x - 3.4 * c, y: b.y - 3.4 * sn };
    const l = { x: base.x - 1.6 * sn, y: base.y + 1.6 * c };
    const r = { x: base.x + 1.6 * sn, y: base.y - 1.6 * c };
    return [tip, l, r].map((q) => `${flip(q).x},${flipY(flip(q).y)}`).join(' ');
  }

  // ---- field rendering ----------------------------------------------------

  const layers = {};

  function buildField() {
    const svg = $('#field');
    const n = size();
    svg.setAttribute('viewBox', `0 0 ${n} ${n}`);
    layers.image = s('image', { x: 0, y: 0, width: n, height: n, preserveAspectRatio: 'none' });
    layers.ghost = s('g', { class: 'ghost', 'pointer-events': 'none' });
    layers.paths = s('g');
    layers.points = s('g');
    layers.robot = s('g', { 'pointer-events': 'none' });
    layers.overlay = s('g');
    svg.append(layers.image, layers.ghost, layers.paths, layers.points, layers.robot, layers.overlay);
    const dark = matchMedia('(prefers-color-scheme: dark)');
    const setImage = () => layers.image.setAttribute('href', `fields/biobuzz-${dark.matches ? 'dark' : 'light'}.webp`);
    setImage();
    dark.addEventListener('change', setImage);
  }

  function renderField() {
    const m = S.model;
    for (const k of ['ghost', 'paths', 'points']) layers[k].replaceChildren();
    if (!m) return;

    if (S.ghost) {
      for (const p of m.paths) {
        const list = samples(m, p);
        if (!list) continue;
        const m2 = list.map(mirror);
        layers.ghost.append(
          s('polyline', { class: 'line', points: m2.map((q) => `${q.x},${flipY(q.y)}`).join(' ') }),
          s('polygon', { class: 'arrow', points: arrowFor(list, mirror) }));
      }
      for (const p of m.points) {
        if (isControl(p.name)) continue;
        const q = mirror(p);
        layers.ghost.append(s('circle', { class: 'dot', cx: q.x, cy: flipY(q.y), r: 1.2 }));
      }
    }

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
        s('polygon', { class: 'arrow', points: arrowFor(list, (q) => q) }),
        s('text', { class: 'label path-label', x: mid.x + 1.8, y: flipY(mid.y) - 1.8, 'text-anchor': 'start' }, document.createTextNode(p.name)));
      layers.paths.append(g);
    }

    const hulls = new Set();
    if (sel?.type === 'path') hulls.add(sel.name);
    if (sel?.type === 'point') roles(sel.name).filter((r) => r.interior).forEach((r) => hulls.add(r.path.name));
    for (const name of hulls) {
      const p = pathNamed(name);
      if (p && p.pts.length > 2) {
        layers.paths.append(s('polyline', { class: 'hull', points: p.pts.map((n) => point(n)).map((q) => `${q.x},${flipY(q.y)}`).join(' '), 'pointer-events': 'none' }));
      }
    }

    for (const p of m.points) {
      const ctrl = isControl(p.name);
      const isSel = sel?.type === 'point' && sel.name === p.name;
      const g = s('g', { class: `pt${ctrl ? ' control' : ''}${isSel ? ' sel' : ''}`, 'data-point': p.name, transform: `translate(${p.x},${flipY(p.y)})` });
      g.append(s('circle', { class: 'grab', r: 3.2 }));
      if (!ctrl) g.append(s('line', { class: 'tick', x1: 0, y1: 0, x2: 5 * Math.cos(rad(p.h)), y2: -5 * Math.sin(rad(p.h)) }));
      g.append(ctrl
        ? s('rect', { class: 'dot', x: -1.2, y: -1.2, width: 2.4, height: 2.4 })
        : s('circle', { class: 'dot', r: 1.6 }));
      g.append(s('text', { class: 'label', x: 2.8, y: -2.6 }, document.createTextNode(p.name)));
      layers.points.append(g);
    }
    renderOverlay();
  }

  function renderOverlay() {
    layers.overlay.replaceChildren();
    const m = S.model;
    if (!m) return;
    const focus = S.selection?.type === 'point' ? S.selection.name : S.hover;
    const p = focus && point(focus);
    if (p && !isControl(p.name)) {
      const y = flipY(p.y);
      const { w, l } = S.robot;
      layers.overlay.append(s('g', { transform: `translate(${p.x},${y}) rotate(${-p.h})`, 'pointer-events': 'none' },
        s('rect', { class: 'robot-box', x: -l / 2, y: -w / 2, width: l, height: w }),
        s('line', { class: 'robot-front', x1: l / 2, y1: -w / 2, x2: l / 2, y2: w / 2 })));
      if (S.selection?.type === 'point' && !readonly()) {
        const hx = p.x + 9 * Math.cos(rad(p.h)), hy = y - 9 * Math.sin(rad(p.h));
        layers.overlay.append(
          s('line', { class: 'handle-line', x1: p.x, y1: y, x2: hx, y2: hy, 'pointer-events': 'none' }),
          s('circle', { class: 'handle', 'data-handle': p.name, cx: hx, cy: hy, r: 1.7 }));
      }
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

  const snapPoint = (q, e) => {
    const f = e.shiftKey ? Math.round : round1;
    return { x: clamp(f(q.x), 0, size()), y: clamp(f(q.y), 0, size()) };
  };

  function bindField() {
    const svg = $('#field');

    svg.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !S.model) return;
      const handle = e.target.closest('[data-handle]');
      const ptEl = e.target.closest('[data-point]');
      const pathEl = e.target.closest('[data-path]');

      if (S.mode === 'add' && !readonly()) {
        const q = snapPoint(clientToField(e), e);
        addSegment(ptEl ? ptEl.dataset.point : null, q.x, q.y);
        return;
      }
      if (handle && !readonly()) {
        S.drag = { type: 'heading', name: handle.dataset.handle, moved: false };
        svg.setPointerCapture(e.pointerId);
      } else if (ptEl) {
        S.selection = { type: 'point', name: ptEl.dataset.point };
        S.drag = readonly() ? null : { type: 'move', name: ptEl.dataset.point, moved: false };
        if (S.drag) svg.setPointerCapture(e.pointerId);
        renderAll();
      } else if (pathEl) {
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
        const p = point(d.name);
        if (d.type === 'move') {
          const q = snapPoint(raw, e);
          p.x = q.x;
          p.y = q.y;
        } else {
          const a = deg(Math.atan2(raw.y - p.y, raw.x - p.x));
          p.h = normDeg(e.shiftKey ? Math.round(a) : Math.round(a / 90) * 90);
        }
        fitPoint(p);
        changed();
      } else if (S.mode === 'add') {
        renderOverlay();
      }
    });

    svg.addEventListener('dblclick', (e) => {
      const pathEl = e.target.closest('[data-path]');
      if (pathEl && !readonly() && S.mode !== 'add') addControlAt(pathEl.dataset.path, clientToField(e));
    });

    svg.addEventListener('pointerup', () => { S.drag = null; });
    svg.addEventListener('pointercancel', () => { S.drag = null; });
    svg.addEventListener('pointerleave', () => { $('#readout').textContent = ''; S.cursor = null; if (S.mode === 'add') renderOverlay(); });

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
        h('button', { type: 'button', title: 'New paths file', onclick: () => { S.newFile = { open: !nf.open, error: '' }; renderSidebar(); if (S.newFile.open) $('#new-name')?.focus(); } }, 'New')),
      nf.open && h('form', { class: 'new-file', onsubmit: createFile },
        h('input', { id: 'new-name', type: 'text', placeholder: 'e.g. ParkAuto', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Auto name' }),
        h('button', { type: 'submit' }, 'Create')),
      nf.open && nf.error && h('div', { class: 'error-text', text: nf.error }));

    const pathItems = m ? m.paths.map((p) => h('li', {
      class: S.selection?.type === 'path' && S.selection.name === p.name ? 'sel' : '',
      onclick: () => { S.selection = { type: 'path', name: p.name }; renderAll(); },
    }, h('span', { class: 'name', text: p.name }), h('span', { class: 'meta', text: `${p.pts.length > 2 ? 'curve' : 'line'} · ${p.pts[0]} → ${p.pts[p.pts.length - 1]}` }))) : [];

    const pathSection = h('div', { class: 'section' },
      h('div', { class: 'section-head' },
        h('span', { text: 'Paths' }),
        h('button', { type: 'button', class: `small${S.mode === 'add' ? ' active' : ''}`, disabled: readonly(), title: 'Click on the field to draw new paths (P)', onclick: () => setMode(S.mode === 'add' ? 'select' : 'add') }, S.mode === 'add' ? 'Done' : 'Add path')),
      pathItems.length ? h('ul', { class: 'list' }, pathItems) : h('div', { class: 'empty', text: 'No paths yet' }));

    const pointItems = m ? m.points.map((p) => h('li', {
      class: S.selection?.type === 'point' && S.selection.name === p.name ? 'sel' : '',
      onclick: () => { S.selection = { type: 'point', name: p.name }; renderAll(); },
    }, h('span', { class: 'name', text: p.name }), h('span', { class: 'meta', text: `${fmt(p.x)}, ${fmt(p.y)}` }))) : [];

    const pointSection = h('div', { class: 'section' },
      h('div', { class: 'section-head' }, h('span', { text: 'Points' })),
      pointItems.length ? h('ul', { class: 'list' }, pointItems) : h('div', { class: 'empty', text: 'No points' }));

    setChildren(root, fileSection, pathSection, pointSection);
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
      h('div', { class: 'actions' },
        h('button', { type: 'button', onclick: () => copy(`robot.drivetrain.follow(paths.${p.name}())`), text: 'Copy follow()' }),
        h('button', { type: 'button', class: 'danger', disabled: readonly(), onclick: () => deletePath(p.name), text: 'Delete path' })));
  }

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); flash('Copied'); } catch { flash('Copy failed', true); }
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

  const BASE_SPEED = 50; // inches per second at 1x
  const TAU = Math.PI * 2;
  const norm = (a) => ((a % TAU) + TAU) % TAU;
  const normSigned = (a) => { const n = norm(a); return n >= Math.PI ? n - TAU : n; };
  const PL = { sequences: [], seq: 'all', timeline: null, time: 0, playing: false, rate: 1, last: 0 };

  async function loadSequences() {
    try { PL.sequences = await api(`/files/${S.file}/sequence`); } catch { PL.sequences = []; }
    if (!PL.sequences.some((x) => x.auto === PL.seq)) PL.seq = PL.sequences.length ? PL.sequences[0].auto : 'all';
    renderSeqOptions();
    rebuildPlayer();
  }

  function currentSteps() {
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

  function headingAt(seg, f) {
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

  function rebuildPlayer() {
    const m = S.model;
    if (!m) { PL.timeline = null; renderRobot(); renderPlayerChrome(); return; }
    const segs = [], states = [];
    let t = 0, heading = null;
    for (const step of currentSteps()) {
      if (step.type === 'state') { states.push({ t, name: step.name }); continue; }
      const p = pathNamed(step.name);
      const pts = p && samples(m, p, 200);
      if (!pts) continue;
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
      const len = cum[cum.length - 1];
      const seg = { path: p, t0: t, dur: Math.max(len / BASE_SPEED, 0.2), pts, cum, len, entering: heading ?? rad(point(p.pts[0]).h) };
      heading = headingAt(seg, 1);
      segs.push(seg);
      t += seg.dur;
    }
    PL.timeline = { segs, states, total: t };
    PL.time = Math.min(PL.time, t);
    renderRobot();
    renderPlayerChrome();
  }

  function poseAt(time) {
    const tl = PL.timeline;
    if (!tl || !tl.segs.length) return null;
    const seg = tl.segs.find((x) => time < x.t0 + x.dur) || tl.segs[tl.segs.length - 1];
    const f = clamp((time - seg.t0) / seg.dur, 0, 1);
    const pos = posAt(seg, f);
    return { x: pos.x, y: pos.y, h: headingAt(seg, f), seg };
  }

  function renderRobot() {
    layers.robot.replaceChildren();
    const pose = poseAt(PL.time);
    if (!pose) { $('#pstate').textContent = ''; return; }
    const { w, l } = S.robot;
    layers.robot.append(s('g', { transform: `translate(${pose.x},${flipY(pose.y)}) rotate(${-deg(pose.h)})` },
      s('rect', { class: 'robot-box play', x: -l / 2, y: -w / 2, width: l, height: w }),
      s('line', { class: 'robot-front', x1: l / 2, y1: -w / 2, x2: l / 2, y2: w / 2 })));
    const states = PL.timeline.states.filter((x) => x.t <= PL.time + 1e-6);
    const state = states.length ? states[states.length - 1].name : '';
    $('#pstate').textContent = `${pose.seg.path.name}${state ? ` · ${state}` : ''}`;
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

    $('#ghost').checked = S.ghost;
    $('#ghost').addEventListener('change', (e) => { S.ghost = e.target.checked; store.set('pathviz.ghost', S.ghost); renderField(); });
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

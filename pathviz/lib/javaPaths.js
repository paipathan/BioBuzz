'use strict';

// Reads and writes paths classes: either a whole *Paths.java file in
// TeamCode/.../paths, or a `static class XPaths` nested inside an auto's file
// (only that class is rewritten, the rest of the auto is left as it is).
//
// A paths file is a set of named poses (fields assigned in the constructor
// through poseFactory.of(x, y, headingDeg)) and one method per path:
//
//   public Path path1() { return Paths.line(start, a).linear(start, a); }
//
// Only that shape is understood. Anything else makes the file "locked" so the
// editor never rewrites code it cannot reproduce.

const NUM = '-?(?:\\d+\\.?\\d*|\\.\\d+)[dDfF]?';
const IDENT = '[A-Za-z_][A-Za-z0-9_]*';

const KEYWORDS = new Set((
  'abstract assert boolean break byte case catch char class const continue default do double else enum ' +
  'extends final finally float for goto if implements import instanceof int interface long native new ' +
  'package private protected public return short static strictfp super switch synchronized this throw ' +
  'throws transient try void volatile while true false null').split(' '));

const isIdent = (s) => typeof s === 'string' && new RegExp(`^${IDENT}$`).test(s) && !KEYWORDS.has(s);

const HEADING_CALLS = {
  linear: { args: 2, mode: 'linear' },
  constant: { args: 1, mode: 'constant' },
  tangent: { args: 0, mode: 'tangent' },
  reverseTangent: { args: 0, mode: 'reverseTangent' },
  facingPoint: { args: 1, mode: 'facing' },
};

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
}

function matchBrace(str, open) {
  let depth = 0;
  for (let i = open; i < str.length; i++) {
    if (str[i] === '{') depth++;
    else if (str[i] === '}' && --depth === 0) return i;
  }
  return -1;
}

function matchParen(str, open) {
  let depth = 0;
  for (let i = open; i < str.length; i++) {
    if (str[i] === '(') depth++;
    else if (str[i] === ')' && --depth === 0) return i;
  }
  return -1;
}

function splitArgs(s) {
  if (!s.trim()) return [];
  const out = [];
  let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

// "Paths.line(a, b).linear(a, b)" -> { kind, pts, heading } or an error string.
function parseExpression(expr, pointNames) {
  const head = new RegExp(`^\\s*Paths\\s*\\.\\s*(line|curve)\\s*\\(`).exec(expr);
  if (!head) return 'return value is not Paths.line(...) or Paths.curve(...)';
  let pos = head[0].length - 1;
  let end = matchParen(expr, pos);
  if (end < 0) return 'unbalanced parentheses';
  const pts = splitArgs(expr.slice(pos + 1, end));
  const kind = head[1];
  if (pts.some((p) => !pointNames.has(p))) return 'uses a point that is not declared in the constructor';
  if (kind === 'line' && pts.length !== 2) return 'Paths.line needs exactly two points';
  if (kind === 'curve' && pts.length < 3) return 'Paths.curve needs at least three points';

  let heading = { mode: 'default' };
  let calls = 0;
  let rest = expr.slice(end + 1);
  for (;;) {
    const m = new RegExp(`^\\s*\\.\\s*(${IDENT})\\s*\\(`).exec(rest);
    if (!m) break;
    const open = m[0].length - 1;
    const close = matchParen(rest, open);
    if (close < 0) return 'unbalanced parentheses';
    const spec = HEADING_CALLS[m[1]];
    const args = splitArgs(rest.slice(open + 1, close));
    if (!spec || ++calls > 1) return `unsupported call .${m[1]}(...)`;
    if (args.length !== spec.args || args.some((a) => !pointNames.has(a))) {
      return `.${m[1]}(...) must be called with declared points`;
    }
    heading = { mode: spec.mode };
    if (spec.mode === 'linear') { heading.from = args[0]; heading.to = args[1]; }
    if (spec.mode === 'constant' || spec.mode === 'facing') heading.point = args[0];
    rest = rest.slice(close + 1);
  }
  if (rest.trim()) return 'unexpected code after the path expression';
  return { kind, pts, heading };
}

// nested: look for `static class SomethingPaths` inside a bigger file.
function parse(source, { nested = false } = {}) {
  const issues = [];
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const src = stripComments(source);

  const cls = nested
    ? new RegExp(`(?:(?:public|private|protected)\\s+)?static\\s+(?:final\\s+)?class\\s+(${IDENT}Paths)\\s*\\{`).exec(src)
    : new RegExp(`public\\s+class\\s+(${IDENT})\\s*\\{`).exec(src);
  if (!cls) return { className: null, points: [], paths: [], issues: [nested ? 'no nested paths class found' : 'no public class found'], eol };
  const className = cls[1];
  const bodyEnd = matchBrace(src, cls.index + cls[0].length - 1);
  if (bodyEnd < 0) return { className, points: [], paths: [], issues: ['unbalanced braces'], eol };
  // Whole lines, so rewriting keeps the surrounding code untouched.
  const region = [src.lastIndexOf('\n', cls.index) + 1, bodyEnd + 1];
  let body = src.slice(cls.index + cls[0].length, bodyEnd);

  // Fields
  const points = [];
  const byName = new Map();
  body = body.replace(new RegExp(`(?:(public|private|protected)\\s+)?(?:final\\s+)?Pose\\s+(${IDENT})\\s*;`, 'g'), (_, vis, name) => {
    const p = { name, x: null, y: null, h: null, vis: vis === 'public' ? 'public' : 'private' };
    points.push(p);
    byName.set(name, p);
    return ' ';
  });

  // Constructor
  const ctor = new RegExp(`public\\s+${className}\\s*\\(\\s*Alliance\\s+(${IDENT})\\s*\\)\\s*\\{`).exec(body);
  if (!ctor) {
    issues.push(`no constructor ${className}(Alliance alliance)`);
  } else {
    const ctorEnd = matchBrace(body, ctor.index + ctor[0].length - 1);
    if (ctorEnd < 0) {
      issues.push('unbalanced braces in the constructor');
    } else {
      let ctorBody = body.slice(ctor.index + ctor[0].length, ctorEnd);
      body = body.slice(0, ctor.index) + ' ' + body.slice(ctorEnd + 1);
      let factory = null;
      ctorBody = ctorBody.replace(
        new RegExp(`PoseFactory\\s+(${IDENT})\\s*=\\s*Utilities\\s*\\.\\s*poseFactory\\s*\\(\\s*${ctor[1]}\\s*\\)\\s*;`),
        (_, v) => { factory = v; return ' '; });
      if (!factory) issues.push('constructor does not create the pose factory with Utilities.poseFactory(alliance)');
      else {
        ctorBody = ctorBody.replace(
          new RegExp(`(${IDENT})\\s*=\\s*${factory}\\s*\\.\\s*of\\s*\\(\\s*(${NUM})\\s*,\\s*(${NUM})\\s*,\\s*(${NUM})\\s*\\)\\s*;`, 'g'),
          (_, name, x, y, h) => {
            const p = byName.get(name);
            if (!p) issues.push(`${name} is assigned but not declared as a Pose field`);
            else { p.x = parseFloat(x); p.y = parseFloat(y); p.h = parseFloat(h); }
            return ' ';
          });
      }
      if (ctorBody.trim()) issues.push('constructor contains code other than pose assignments');
    }
  }
  for (const p of points) if (p.x === null) issues.push(`${p.name} is declared but never assigned with poseFactory.of(x, y, heading)`);

  // Path methods
  const paths = [];
  const names = new Set(points.map((p) => p.name));
  const methodRe = new RegExp(`public\\s+Path\\s+(${IDENT})\\s*\\(\\s*\\)\\s*\\{`, 'g');
  let m;
  const spans = [];
  while ((m = methodRe.exec(body))) {
    const open = m.index + m[0].length - 1;
    const close = matchBrace(body, open);
    if (close < 0) { issues.push(`unbalanced braces in ${m[1]}()`); break; }
    spans.push([m.index, close + 1]);
    const ret = /^\s*return\s+([\s\S]*?)\s*;\s*$/.exec(body.slice(open + 1, close));
    if (!ret) { issues.push(`${m[1]}() is more than a single return statement`); continue; }
    const parsed = parseExpression(ret[1], names);
    if (typeof parsed === 'string') { issues.push(`${m[1]}(): ${parsed}`); continue; }
    paths.push({ name: m[1], ...parsed });
    methodRe.lastIndex = close + 1;
  }
  for (const [a, b] of spans.reverse()) body = body.slice(0, a) + ' ' + body.slice(b);
  if (body.replace(/[\s;]/g, '')) issues.push('class contains members other than poses and path methods');

  return { className, points, paths, issues, eol, region };
}

const fmt = (n) => String(Number(Number(n).toFixed(2)));

function headingCall(path) {
  const h = path.heading || { mode: 'default' };
  switch (h.mode) {
    case 'linear': return `.linear(${h.from}, ${h.to})`;
    case 'constant': return `.constant(${h.point})`;
    case 'tangent': return '.tangent()';
    case 'reverseTangent': return '.reverseTangent()';
    case 'facing': return `.facingPoint(${h.point})`;
    default: return '';
  }
}

function classLines(model, indent, nested) {
  const L = [];
  const I = (n) => indent + '    '.repeat(n);
  L.push(`${indent}public ${nested ? 'static ' : ''}class ${model.className} {`, '');
  for (const p of model.points) L.push(`${I(1)}${p.vis === 'public' ? 'public' : 'private'} final Pose ${p.name};`);
  L.push('');
  L.push(`${I(1)}public ${model.className}(Alliance alliance) {`);
  L.push(`${I(2)}PoseFactory poseFactory = Utilities.poseFactory(alliance);`, '');
  for (const p of model.points) L.push(`${I(2)}${p.name} = poseFactory.of(${fmt(p.x)}, ${fmt(p.y)}, ${fmt(p.h)});`);
  L.push(`${I(1)}}`);
  for (const path of model.paths) {
    L.push('');
    L.push(`${I(1)}public Path ${path.name}() {`);
    const kind = path.pts.length > 2 ? 'curve' : 'line';
    L.push(`${I(2)}return Paths.${kind}(${path.pts.join(', ')})${headingCall(path)};`);
    L.push(`${I(1)}}`);
  }
  L.push(`${indent}}`);
  return L;
}

const IMPORTS = [
  'com.pedropathing.api.Paths',
  'com.pedropathing.api.PoseFactory',
  'com.pedropathing.math.Pose',
  'com.pedropathing.paths.Path',
  'org.firstinspires.ftc.teamcode.util.Alliance',
  'org.firstinspires.ftc.teamcode.util.Utilities',
];

function generate(model, pkg, eol = '\n') {
  const L = [`package ${pkg};`, ''];
  L.push(...IMPORTS.slice(0, 4).map((i) => `import ${i};`), '');
  L.push(...IMPORTS.slice(4).map((i) => `import ${i};`), '');
  L.push(...classLines(model, '', false));
  L.push('');
  return L.join(eol);
}

const esc = (t) => t.replace(/\./g, '\\.');

// Rewrites only the nested paths class in `source` (and adds any imports it needs).
function generateNested(model, source, region, eol) {
  const indent = /^[ \t]*/.exec(source.slice(region[0]))[0];
  let out = source.slice(0, region[0]) + classLines(model, indent, true).join(eol) + source.slice(region[1]);
  const missing = IMPORTS.filter((i) => !new RegExp(`^\\s*import\\s+${esc(i)}\\s*;`, 'm').test(out)
    && !new RegExp(`^\\s*import\\s+${esc(i.replace(/\.[^.]+$/, ''))}\\.\\*\\s*;`, 'm').test(out));
  if (missing.length) {
    const lines = missing.map((i) => `import ${i};`).join(eol);
    const imports = [...out.matchAll(/^import\s[^\n]*\n/gm)];
    if (imports.length) {
      const last = imports[imports.length - 1];
      const at = last.index + last[0].length;
      out = out.slice(0, at) + lines + eol + out.slice(at);
    } else {
      const pkg = /^package\s[^\n]*\n/m.exec(out);
      const at = pkg ? pkg.index + pkg[0].length : 0;
      out = out.slice(0, at) + (pkg ? eol : '') + lines + eol + out.slice(at);
    }
  }
  return out;
}

// Returns an error string, or null when the model can be written safely.
function validate(model) {
  if (!model || typeof model !== 'object') return 'missing model';
  if (!isIdent(model.className)) return 'invalid class name';
  const { points, paths } = model;
  if (!Array.isArray(points) || !Array.isArray(paths)) return 'points and paths must be lists';
  const pointNames = new Set();
  for (const p of points) {
    if (!isIdent(p.name)) return `"${p.name}" is not a valid Java name`;
    if (pointNames.has(p.name)) return `duplicate point ${p.name}`;
    pointNames.add(p.name);
    if (![p.x, p.y, p.h].every(Number.isFinite)) return `${p.name} has a non-numeric coordinate`;
    if (p.vis !== 'public' && p.vis !== 'private') return `${p.name} has invalid visibility`;
  }
  const pathNames = new Set();
  for (const path of paths) {
    if (!isIdent(path.name)) return `"${path.name}" is not a valid Java name`;
    if (pathNames.has(path.name)) return `duplicate path ${path.name}`;
    pathNames.add(path.name);
    if (!Array.isArray(path.pts) || path.pts.length < 2 || path.pts.some((n) => !pointNames.has(n))) return `${path.name} uses an unknown point`;
    const h = path.heading || { mode: 'default' };
    const need = { linear: ['from', 'to'], constant: ['point'], facing: ['point'] }[h.mode];
    if (!['default', 'linear', 'constant', 'tangent', 'reverseTangent', 'facing'].includes(h.mode)) return `${path.name}: invalid heading mode`;
    if (need && need.some((k) => !pointNames.has(h[k]))) return `${path.name}: heading references an unknown point`;
  }
  return null;
}

module.exports = { parse, generate, generateNested, validate, isIdent };

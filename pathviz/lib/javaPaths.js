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

const TARGET_CALL = new RegExp(String.raw`^headingTarget\s*\(\s*(${NUM})\s*,\s*(${NUM})\s*\)$`);

// "withHeadingTargets(alliance, <path expression>, headingTarget(0.5, 90), ...)" -> the inner
// expression and the targets, or null when `expr` is not wrapped that way.
function unwrapHeadings(expr, allianceVar) {
  const m = /^\s*withHeadingTargets\s*\(/.exec(expr);
  if (!m) return null;
  const open = m[0].length - 1;
  const close = matchParen(expr, open);
  if (close < 0 || expr.slice(close + 1).trim()) return 'unbalanced parentheses';
  const args = splitArgs(expr.slice(open + 1, close));
  if (args.length < 3 || args[0] !== allianceVar) return `withHeadingTargets(...) must start with ${allianceVar}`;
  const headings = [];
  for (const a of args.slice(2)) {
    const t = TARGET_CALL.exec(a);
    if (!t) return 'withHeadingTargets(...) only takes headingTarget(position, degrees) after the path';
    headings.push({ at: parseFloat(t[1]), deg: parseFloat(t[2]) });
  }
  return { inner: args[1], headings };
}

// "Paths.line(a, b).linear(a, b)" -> { kind, pts, heading } or an error string.
function parseExpression(expr, pointNames, allianceVar = 'alliance') {
  const wrapped = unwrapHeadings(expr, allianceVar);
  if (typeof wrapped === 'string') return wrapped;
  if (wrapped) {
    const inner = parseExpression(wrapped.inner, pointNames, allianceVar);
    return typeof inner === 'string' ? inner : { ...inner, headings: wrapped.headings };
  }
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

  // An Alliance field, kept only to hand the alliance to withHeadingTargets(...).
  let allianceField = null;
  body = body.replace(new RegExp(String.raw`(?:(?:public|private|protected)\s+)?(?:final\s+)?Alliance\s+(${IDENT})\s*;`),(_, name) => { allianceField = name; return ' '; });

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
      if (allianceField) {
        ctorBody = ctorBody.replace(new RegExp(String.raw`this\s*\.\s*${allianceField}\s*=\s*${ctor[1]}\s*;`), ' ');
        if (allianceField !== ctor[1]) issues.push('the Alliance field must be named like the constructor parameter');
      }
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
    const parsed = parseExpression(ret[1], names, allianceField || 'alliance');
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

const fmt3 = (n) => String(Number(Number(n).toFixed(3)));
const usesHeadings = (model) => model.paths.some((p) => p.headings && p.headings.length);

function pathExpression(path) {
  const kind = path.pts.length > 2 ? 'curve' : 'line';
  const base = `Paths.${kind}(${path.pts.join(', ')})${headingCall(path)}`;
  if (!path.headings || !path.headings.length) return base;
  const targets = [...path.headings].sort((a, b) => a.at - b.at).map((t) => `headingTarget(${fmt3(t.at)}, ${fmt(t.deg)})`);
  return `withHeadingTargets(alliance, ${base}, ${targets.join(', ')})`;
}

function classLines(model, indent, nested) {
  const L = [];
  const I = (n) => indent + '    '.repeat(n);
  L.push(`${indent}public ${nested ? 'static ' : ''}class ${model.className} {`, '');
  for (const p of model.points) L.push(`${I(1)}${p.vis === 'public' ? 'public' : 'private'} final Pose ${p.name};`);
  if (usesHeadings(model)) L.push(`${I(1)}private final Alliance alliance;`);
  L.push('');
  L.push(`${I(1)}public ${model.className}(Alliance alliance) {`);
  if (usesHeadings(model)) L.push(`${I(2)}this.alliance = alliance;`);
  L.push(`${I(2)}PoseFactory poseFactory = Utilities.poseFactory(alliance);`, '');
  for (const p of model.points) L.push(`${I(2)}${p.name} = poseFactory.of(${fmt(p.x)}, ${fmt(p.y)}, ${fmt(p.h)});`);
  L.push(`${I(1)}}`);
  for (const path of model.paths) {
    L.push('');
    L.push(`${I(1)}public Path ${path.name}() {`);
    L.push(`${I(2)}return ${pathExpression(path)};`);
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

const HEADING_IMPORTS = [
  'static org.firstinspires.ftc.teamcode.util.PathEvents.headingTarget',
  'static org.firstinspires.ftc.teamcode.util.PathEvents.withHeadingTargets',
];

function generate(model, pkg, eol = '\n') {
  const L = [`package ${pkg};`, ''];
  L.push(...IMPORTS.slice(0, 4).map((i) => `import ${i};`), '');
  L.push(...IMPORTS.slice(4).map((i) => `import ${i};`), '');
  if (usesHeadings(model)) L.push(...HEADING_IMPORTS.map((i) => `import ${i};`), '');
  L.push(...classLines(model, '', false));
  L.push('');
  return L.join(eol);
}

const esc = (t) => t.replace(/\./g, '\\.');

// Adds any of `wanted` ("a.b.C" or "static a.b.C.member") that the file doesn't import yet.
function ensureImports(source, wanted, eol) {
  const has = (src, i) => {
    const isStatic = i.startsWith('static ');
    const name = isStatic ? i.slice(7) : i;
    const owner = name.replace(/\.[^.]+$/, '');
    const kw = isStatic ? String.raw`import\s+static` : 'import';
    return new RegExp(String.raw`^\s*${kw}\s+${esc(name)}\s*;`, 'm').test(src)
      || new RegExp(String.raw`^\s*${kw}\s+${esc(owner)}\.\*\s*;`, 'm').test(src);
  };
  const missing = wanted.filter((i) => !has(source, i));
  if (!missing.length) return source;
  const lines = missing.map((i) => `import ${i};`).join(eol);
  const imports = [...source.matchAll(/^import\s[^\n]*\n/gm)];
  if (imports.length) {
    const last = imports[imports.length - 1];
    const at = last.index + last[0].length;
    return source.slice(0, at) + lines + eol + source.slice(at);
  }
  const pkg = /^package\s[^\n]*\n/m.exec(source);
  const at = pkg ? pkg.index + pkg[0].length : 0;
  return source.slice(0, at) + (pkg ? eol : '') + lines + eol + source.slice(at);
}

// Rewrites only the nested paths class in `source` (and adds any imports it needs).
function generateNested(model, source, region, eol) {
  const indent = /^[ \t]*/.exec(source.slice(region[0]))[0];
  let out = source.slice(0, region[0]) + classLines(model, indent, true).join(eol) + source.slice(region[1]);
  out = ensureImports(out, usesHeadings(model) ? [...IMPORTS, ...HEADING_IMPORTS] : IMPORTS, eol);
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
    if (path.headings !== undefined) {
      if (!Array.isArray(path.headings)) return `${path.name}: headings must be a list`;
      if (path.headings.length && h.mode === 'default') return `${path.name}: heading targets need a heading mode`;
      for (const t of path.headings) {
        if (!(Number.isFinite(t.at) && t.at > 0 && t.at < 1) || !Number.isFinite(t.deg)) return `${path.name}: invalid heading target`;
      }
    }
  }
  return null;
}

module.exports = { parse, generate, generateNested, classLines, validate, isIdent, ensureImports, stripComments, matchBrace, splitArgs, NUM, IDENT, fmt };

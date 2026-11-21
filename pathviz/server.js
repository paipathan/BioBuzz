'use strict';

// Local server for the path visualizer. No dependencies: `node pathviz/server.js`.
// Serves the UI, reads/writes the *Paths.java files, and pushes changes made
// elsewhere (IDE, git) to the open page.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parse, generate, generateNested, classLines, validate, isIdent } = require('./lib/javaPaths');
const { parseRoutine, generateRoutine, validateRoutine, splitReset, withReset } = require('./lib/routine');

const ROOT = path.resolve(__dirname, '..');
const JAVA_SRC = path.join(ROOT, 'TeamCode', 'src', 'main', 'java');
const PATHS_DIR = path.join(JAVA_SRC, 'org', 'firstinspires', 'ftc', 'teamcode', 'paths');
const AUTO_DIR = path.join(JAVA_SRC, 'org', 'firstinspires', 'ftc', 'teamcode', 'auto');
const TEAMCODE = path.join(JAVA_SRC, 'org', 'firstinspires', 'ftc', 'teamcode');
const CONSTANTS = path.join(TEAMCODE, 'util', 'Constants.java');
const PUBLIC = path.join(__dirname, 'public');
const PACKAGE = path.relative(JAVA_SRC, PATHS_DIR).split(path.sep).join('.');
const PORT = Number(process.env.PORT) || 4141;
const HOST = '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

const FILE_RE = /^[A-Za-z_][A-Za-z0-9_]*\.java$/;
const hash = (s) => crypto.createHash('sha1').update(s).digest('hex');
const known = new Map(); // file name -> hash of the content we last saw or wrote

function readConfig() {
  let fieldSize = 144, drawnAlliance = 'RED';
  try {
    const src = fs.readFileSync(CONSTANTS, 'utf8');
    fieldSize = parseFloat(/fieldSize\s*=\s*([\d.]+)/.exec(src)?.[1]) || fieldSize;
    drawnAlliance = /drawnAlliance\s*=\s*Alliance\.(\w+)/.exec(src)?.[1] || drawnAlliance;
  } catch { /* fall back to defaults */ }
  return {
    robot: readRobot(),
    fieldSize, drawnAlliance, package: PACKAGE, pathsDir: path.relative(ROOT, PATHS_DIR).split(path.sep).join('/'),
    states: readEnum('Robot.java', ['IDLE', 'INTAKE', 'SHOOT', 'UNJAM']),
    barStates: readEnum(path.join('subsystems', 'FlowerBar.java'), ['UP', 'DOWN']),
  };
}

// What the playback needs to move like the real robot: the numbers Foresight is tuned with in
// Constants.java, plus how fast it accelerates, which the tuner does not measure (robot.json).
function readRobot() {
  const robot = {
    maxVelocity: 76, naturalDecel: 41, brakeLinear: 0.057, brakeQuadratic: 0.0019,
    accelTimeConstant: 0.4, eventLeadSeconds: 0,
  };
  try {
    const src = fs.readFileSync(CONSTANTS, 'utf8');
    const num = (re) => { const m = re.exec(src); return m ? parseFloat(m[1]) : null; };
    const diag = (name) => num(new RegExp(String.raw`${name}\.set\(\s*Matrix\.diag\(\s*(-?[\d.]+(?:[eE]-?\d+)?)`));
    const set = (key, v) => { if (Number.isFinite(v)) robot[key] = v; };
    set('maxVelocity', num(/maxAchievableForwardVelocity\.set\(\s*(-?[\d.]+)/));
    set('naturalDecel', num(/naturalForwardDeceleration\.set\(\s*(-?[\d.]+)/));
    set('brakeLinear', diag('linearBrakeCoefficients'));
    set('brakeQuadratic', diag('quadraticBrakeCoefficients'));
    set('eventLeadSeconds', num(/eventLeadSeconds\s*=\s*(-?[\d.]+)/));
  } catch { /* keep the defaults */ }
  try {
    const own = JSON.parse(fs.readFileSync(path.join(__dirname, 'robot.json'), 'utf8'));
    if (Number.isFinite(own.accelTimeConstant) && own.accelTimeConstant > 0) robot.accelTimeConstant = own.accelTimeConstant;
  } catch { /* optional file */ }
  return robot;
}

// The constants of `enum State { ... }` in a teamcode source file, in declaration order.
function readEnum(file, fallback) {
  try {
    const src = fs.readFileSync(path.join(TEAMCODE, file), 'utf8').replace(/\/\/.*$/gm, '');
    // The constants run from the opening brace to the first ";" (or the closing brace); each may
    // carry constructor arguments, like UP(0.0).
    const start = /enum\s+State\s*\{/.exec(src);
    if (!start) return fallback;
    const names = [];
    let depth = 0, cur = '';
    const flush = () => { const m = /^\s*([A-Z_][A-Z0-9_]*)\s*(?:\(|$)/.exec(cur); if (m) names.push(m[1]); cur = ''; };
    for (let i = start.index + start[0].length; i < src.length; i++) {
      const ch = src[i];
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      if (depth === 0 && (ch === ',' || ch === ';' || ch === '}')) { flush(); if (ch !== ',') break; } else cur += ch;
    }
    return names.length ? names : fallback;
  } catch { return fallback; }
}

// A "file" is either a paths class of its own in paths/, or a static XPaths class
// nested in an auto's file in auto/ (the auto stays the owner of its source).
function locate(file) {
  if (!FILE_RE.test(file)) return null;
  const standalone = path.join(PATHS_DIR, file);
  if (fs.existsSync(standalone)) return { full: standalone, nested: false };
  const inAuto = path.join(AUTO_DIR, file);
  if (fs.existsSync(inAuto) && parse(fs.readFileSync(inAuto, 'utf8'), { nested: true }).className) return { full: inAuto, nested: true };
  return null;
}

function trackedFiles() {
  const out = [];
  const add = (dir, nested) => {
    let names = [];
    try { names = fs.readdirSync(dir).filter((f) => FILE_RE.test(f)); } catch { return; }
    for (const file of names) {
      const full = path.join(dir, file);
      let source;
      try { source = fs.readFileSync(full, 'utf8'); } catch { continue; }
      if (nested && !parse(source, { nested: true }).className) continue;
      out.push({ file, full, nested, source });
    }
  };
  add(PATHS_DIR, false);
  add(AUTO_DIR, true);
  return out;
}

// An auto is one file: Name, the alliance-neutral opmode, with the paths class and
// the NameRed / NameBlue opmodes nested inside. Autos from before the opmodes were
// nested have NameRed.java / NameBlue.java beside them, so those names count as taken
// and get deleted along with the auto. Paths relative to the teamcode package folder.
const autoFamilyNames = (name) => [name, `${name}Red`, `${name}Blue`].map((n) => `${n}.java`);

function familyOf(file, loc) {
  if (!loc.nested) return [`paths/${file}`];
  const name = file.replace(/\.java$/, '');
  const out = [`auto/${file}`];
  for (const side of ['Red', 'Blue']) {
    const f = `${name}${side}.java`;
    const full = path.join(AUTO_DIR, f);
    // Only the opmodes that wrap this auto, never an unrelated file with a similar name.
    if (fs.existsSync(full) && new RegExp(String.raw`\bextends\s+${name}\b`).test(fs.readFileSync(full, 'utf8'))) out.push(`auto/${f}`);
  }
  return out;
}

function listFiles() {
  fs.mkdirSync(PATHS_DIR, { recursive: true });
  return trackedFiles().sort((a, b) => a.file.localeCompare(b.file)).map(({ file, nested, source }) => {
    const m = parse(source, { nested });
    return { file, className: m.className, locked: m.issues.length > 0, paths: m.paths.length, inAuto: nested, family: familyOf(file, { nested }) };
  });
}

// The file of a new auto, with an empty paths class holding just the start pose.
function autoSources(name) {
  const display = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  const pkg = 'org.firstinspires.ftc.teamcode.auto';
  const paths = classLines({
    className: `${name}Paths`,
    points: [{ name: 'start', x: 71.25, y: 8, h: 90, vis: 'public' }],
    paths: [],
  }, '    ', true).join('\n');
  const side = (suffix, alliance) => `    @NextAutonomous(name = "${display} ${suffix}", preselectTeleop = Tele.${alliance})
    public static class ${name}${suffix} extends ${name} {
        public ${name}${suffix}(Robot robot) {
            super(robot, Alliance.${alliance});
        }
    }`;
  const main = `package ${pkg};

import com.pedropathing.api.Paths;
import com.pedropathing.api.PoseFactory;
import com.pedropathing.ivy.Command;
import com.pedropathing.ivy.groups.Groups;
import com.pedropathing.math.Pose;
import com.pedropathing.paths.Path;

import org.firstinspires.ftc.teamcode.Robot;
import org.firstinspires.ftc.teamcode.teleop.Tele;
import org.firstinspires.ftc.teamcode.util.Alliance;
import org.firstinspires.ftc.teamcode.util.Utilities;

import dev.nextftc.robot.opmode.BulkReadHook;
import dev.nextftc.robot.opmode.NextAutonomous;
import dev.nextftc.robot.opmode.NextOpMode;

public abstract class ${name} extends NextOpMode {
    private final Robot robot;
    private final ${name}Paths paths;

    protected ${name}(Robot robot, Alliance alliance) {
        super(robot, BulkReadHook.INSTANCE);
        this.robot = robot;
        this.paths = new ${name}Paths(alliance);

        robot.initializeAuto(paths.start, alliance);
    }

    private Command routine() {
        return Groups.sequential();
    }

    @Override
    public void disabledPeriodic() { robot.disabledPeriodic(); }

    @Override
    public void start() { routine().schedule(); }

${side('Red', 'RED')}

${side('Blue', 'BLUE')}

${paths}
}
`;
  return { [`${name}.java`]: main };
}

function readModel(file) {
  const loc = locate(file);
  if (!loc) return null;
  const source = fs.readFileSync(loc.full, 'utf8');
  known.set(file, hash(source));
  const { eol, region, ...model } = parse(source, { nested: loc.nested });
  return { file, ...model, inAuto: loc.nested, locked: model.issues.length > 0, routine: loc.nested ? routineModel(source, model) : null };
}

// The auto's routine() as { steps, issues, locked }, or null if it has none.
function routineModel(source, model) {
  const r = parseRoutine(source);
  if (!r) return null;
  const known = new Set(model.paths.map((p) => p.name));
  const issues = [...r.issues];
  for (const s of r.steps) if (s.type === 'path' && !known.has(s.path)) issues.push(`routine follows paths.${s.path}(), which does not exist`);
  const { reset, steps } = splitReset(r.steps);
  return { steps, reset, issues, locked: issues.length > 0 };
}

function writeFile(file, source) {
  known.set(file, hash(source));
  const loc = locate(file);
  fs.writeFileSync(loc ? loc.full : path.join(PATHS_DIR, file), source);
}

// The order a routine drives its paths in, read from the autos that build this
// paths class: [{ auto, steps: [{ type: 'path' | 'state', name }] }].
function readSequences(file) {
  const model = readModel(file);
  if (!model || !model.className) return [];
  const names = model.paths.map((p) => p.name);
  if (!names.length || !fs.existsSync(AUTO_DIR)) return [];
  const token = new RegExp(String.raw`\.\s*(${names.join('|')})\s*\(\s*\)|State\s*\.\s*([A-Z_][A-Z0-9_]*)`, 'g');
  const out = [];
  for (const f of fs.readdirSync(AUTO_DIR).filter((n) => n.endsWith('.java'))) {
    const src = fs.readFileSync(path.join(AUTO_DIR, f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    if (!new RegExp(String.raw`new\s+${model.className}\s*\(`).test(src)) continue;
    const steps = [];
    let m;
    while ((m = token.exec(src))) steps.push(m[1] ? { type: 'path', name: m[1] } : { type: 'state', name: m[2] });
    if (steps.some((x) => x.type === 'path')) out.push({ auto: f.replace(/\.java$/, ''), steps });
  }
  return out;
}

// ---- change notifications -------------------------------------------------

const clients = new Set();
const broadcast = (event) => {
  for (const res of clients) res.write(`data: ${JSON.stringify(event)}\n\n`);
};

let watchTimer = null;
function scanForChanges() {
  clearTimeout(watchTimer);
  watchTimer = setTimeout(() => {
    const tracked = trackedFiles();
    const files = tracked.map((t) => t.file);
    const changed = [];
    for (const t of tracked) {
      const h = hash(t.source);
      if (known.get(t.file) !== h) { known.set(t.file, h); changed.push(t.file); }
    }
    const removed = [...known.keys()].filter((f) => !files.includes(f));
    removed.forEach((f) => known.delete(f));
    if (changed.length || removed.length) broadcast({ type: 'changed', files: [...changed, ...removed] });
  }, 120);
}

// ---- http -----------------------------------------------------------------

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) { reject(new Error('body too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch (e) { reject(e); } });
  });
}

async function api(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean).slice(1); // after "api"

  if (req.method === 'GET' && parts[0] === 'config') return send(res, 200, readConfig());

  if (req.method === 'GET' && parts[0] === 'events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(': connected\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  if (parts[0] !== 'files') return send(res, 404, { error: 'not found' });

  if (req.method === 'GET' && parts.length === 1) return send(res, 200, listFiles());

  if (req.method === 'GET' && parts.length === 2) {
    const model = readModel(parts[1]);
    return model ? send(res, 200, model) : send(res, 404, { error: 'no such file' });
  }

  if (req.method === 'GET' && parts.length === 3 && parts[2] === 'sequence') {
    return send(res, 200, readSequences(parts[1]));
  }

  if (req.method === 'PUT' && parts.length === 2) {
    const file = parts[1];
    const loc = locate(file);
    if (!loc) return send(res, 404, { error: 'no such file' });
    const original = fs.readFileSync(loc.full, 'utf8');
    const current = parse(original, { nested: loc.nested });
    if (current.issues.length) return send(res, 409, { error: 'File contains code the visualizer cannot rewrite safely.' });
    const body = await readBody(req);
    const model = { className: current.className, points: body.points, paths: body.paths };
    const problem = validate(model);
    if (problem) return send(res, 400, { error: problem });
    let source = loc.nested
      ? generateNested(model, original, current.region, current.eol)
      : generate(model, PACKAGE, current.eol);
    if (loc.nested && body.routine) {
      const parsed = parseRoutine(source);
      const cfg = readConfig();
      const steps = Array.isArray(body.routine.steps) ? withReset(body.routine.steps, !!body.routine.reset) : body.routine.steps;
      const bad = parsed && !parsed.issues.length
        ? validateRoutine(steps, { paths: new Set(model.paths.map((p) => p.name)), states: cfg.states, barStates: cfg.barStates })
        : null;
      if (bad) return send(res, 400, { error: bad });
      // A routine the editor cannot read is left exactly as written.
      if (parsed && !parsed.issues.length) source = generateRoutine(source, parsed, steps, current.eol);
    }
    if (hash(source) !== known.get(file)) writeFile(file, source);
    return send(res, 200, { ok: true });
  }

  if (req.method === 'POST' && parts.length === 1) {
    const body = await readBody(req);
    let name = String(body.name || '').trim();
    if (!isIdent(name)) return send(res, 400, { error: 'Use letters, digits and underscores, starting with a letter.' });
    name = name[0].toUpperCase() + name.slice(1);
    const files = autoFamilyNames(name);
    const taken = files.filter((f) => fs.existsSync(path.join(AUTO_DIR, f)));
    if (taken.length) return send(res, 409, { error: `${taken[0]} already exists.` });
    fs.mkdirSync(AUTO_DIR, { recursive: true });
    for (const [f, src] of Object.entries(autoSources(name))) {
      const full = path.join(AUTO_DIR, f);
      fs.writeFileSync(full, src);
      known.set(f, hash(src));
    }
    const file = `${name}.java`;
    broadcast({ type: 'changed', files: [file] });
    return send(res, 200, { file });
  }

  if (req.method === 'DELETE' && parts.length === 2) {
    const loc = locate(parts[1]);
    if (!loc) return send(res, 404, { error: 'no such file' });
    const gone = familyOf(parts[1], loc);
    for (const f of gone) {
      fs.rmSync(path.join(JAVA_SRC, 'org', 'firstinspires', 'ftc', 'teamcode', f));
      known.delete(path.basename(f));
    }
    broadcast({ type: 'changed', files: [parts[1]] });
    return send(res, 200, { deleted: gone });
  }

  return send(res, 404, { error: 'not found' });
}

function serveStatic(res, url) {
  const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const full = path.join(PUBLIC, rel);
  if (!full.startsWith(PUBLIC + path.sep)) return send(res, 403, 'forbidden', 'text/plain');
  fs.readFile(full, (err, data) => {
    if (err) return send(res, 404, 'not found', 'text/plain');
    send(res, 200, data, MIME[path.extname(full)] || 'application/octet-stream');
  });
}

const server = http.createServer(async (req, res) => {
  // Local tool that writes source files: only answer requests addressed to localhost,
  // and require a custom header on writes so other web pages cannot trigger them.
  const hostName = (req.headers.host || '').replace(/:\d+$/, '');
  if (hostName !== 'localhost' && hostName !== '127.0.0.1') return send(res, 403, 'forbidden', 'text/plain');
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.headers['x-pathviz'] !== '1') return send(res, 403, { error: 'forbidden' });
      return await api(req, res, url);
    }
    serveStatic(res, url);
  } catch (e) {
    send(res, 500, { error: e.message });
  }
});

fs.mkdirSync(PATHS_DIR, { recursive: true });
for (const t of trackedFiles()) known.set(t.file, hash(t.source));
fs.watch(PATHS_DIR, scanForChanges);
if (fs.existsSync(AUTO_DIR)) fs.watch(AUTO_DIR, scanForChanges);

server.listen(PORT, HOST, () => {
  console.log(`Path visualizer: http://localhost:${PORT}`);
  console.log(`Editing ${path.relative(ROOT, PATHS_DIR)} and paths classes nested in ${path.relative(ROOT, AUTO_DIR)}`);
});

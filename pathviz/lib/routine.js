'use strict';

// Reads and writes an auto's routine():
//
//   private Command routine() {
//       return Groups.sequential(
//               robot.set(Robot.State.IDLE),
//               robot.drivetrain.follow(paths.path1()),
//               Commands.waitMs(500),
//               robot.flowerBar.set(FlowerBar.State.DOWN),
//               follow(robot, paths.path2(), at(0.4, robot.set(Robot.State.INTAKE)), limit(0.3, 0.6, 20))
//       );
//   }
//
// Only a flat Groups.sequential of those steps is understood. Anything else makes the
// routine "locked": the editor shows it but never rewrites it.

const { stripComments, matchBrace, splitArgs, ensureImports, isIdent, fmt, NUM, IDENT } = require('./javaPaths');

const HEADER = new RegExp(String.raw`(?:(?:private|protected|public)\s+)?Command\s+routine\s*\(\s*\)\s*\{`);
const NUM_RE = new RegExp(`^${NUM}$`);

const num = (s) => parseFloat(s);
const fmt3 = (n) => String(Number(Number(n).toFixed(3)));

const RE = {
  state: new RegExp(String.raw`^robot\s*\.\s*set\s*\(\s*Robot\s*\.\s*State\s*\.\s*(${IDENT})\s*\)$`),
  bar: new RegExp(String.raw`^robot\s*\.\s*flowerBar\s*\.\s*set\s*\(\s*FlowerBar\s*\.\s*State\s*\.\s*(${IDENT})\s*\)$`),
  wait: new RegExp(String.raw`^Commands\s*\.\s*waitMs\s*\(\s*(${NUM})\s*\)$`),
  plainFollow: new RegExp(String.raw`^robot\s*\.\s*drivetrain\s*\.\s*follow\s*\(\s*paths\s*\.\s*(${IDENT})\s*\(\s*\)\s*\)$`),
  eventFollow: /^follow\s*\(([\s\S]*)\)$/,
  at: /^at\s*\(([\s\S]*)\)$/,
  limit: /^limit\s*\(([\s\S]*)\)$/,
  pathArg: new RegExp(String.raw`^paths\s*\.\s*(${IDENT})\s*\(\s*\)$`),
};

// A command that can run on its own: a robot state, a flower bar state or a wait.
function parseCommand(expr) {
  let m;
  if ((m = RE.state.exec(expr))) return { type: 'state', value: m[1] };
  if ((m = RE.bar.exec(expr))) return { type: 'bar', value: m[1] };
  if ((m = RE.wait.exec(expr))) return { type: 'wait', seconds: num(m[1]) / 1000 };
  return null;
}

function parseStep(expr) {
  const cmd = parseCommand(expr);
  if (cmd) return cmd;
  let m;
  if ((m = RE.plainFollow.exec(expr))) return { type: 'path', path: m[1], events: [] };
  if ((m = RE.eventFollow.exec(expr))) {
    const args = splitArgs(m[1]);
    if (args.length < 2 || args[0] !== 'robot') return 'follow(...) must start with robot';
    const p = RE.pathArg.exec(args[1]);
    if (!p) return 'follow(...) needs paths.<name>() as its second argument';
    const events = [];
    for (const a of args.slice(2)) {
      let e;
      if ((e = RE.at.exec(a))) {
        const parts = splitArgs(e[1]);
        const command = parts.length === 2 && NUM_RE.test(parts[0]) ? parseCommand(parts[1]) : null;
        if (!command || command.type === 'wait') return `unsupported event ${a}`;
        events.push({ type: 'marker', at: num(parts[0]), command });
      } else if ((e = RE.limit.exec(a))) {
        const parts = splitArgs(e[1]);
        if (parts.length !== 3 || !parts.every((x) => NUM_RE.test(x))) return `unsupported event ${a}`;
        events.push({ type: 'zone', from: num(parts[0]), to: num(parts[1]), speed: num(parts[2]) });
      } else {
        return `unsupported event ${a}`;
      }
    }
    return { type: 'path', path: p[1], events };
  }
  return 'unsupported step';
}

// -> null when the file has no routine(), otherwise { steps, issues, region, header }.
function parseRoutine(source) {
  const src = stripComments(source);
  const h = HEADER.exec(src);
  if (!h) return null;
  const open = h.index + h[0].length - 1;
  const close = matchBrace(src, open);
  const region = [src.lastIndexOf('\n', h.index) + 1, close + 1];
  const header = source.slice(region[0], open + 1);
  if (close < 0) return { steps: [], issues: ['unbalanced braces in routine()'], region: [region[0], source.length], header };

  const issues = [];
  const steps = [];
  const body = src.slice(open + 1, close);
  const ret = /^\s*return\s+Groups\s*\.\s*sequential\s*\(([\s\S]*)\)\s*;\s*$/.exec(body);
  if (!ret) {
    issues.push('routine() is not a single return Groups.sequential(...)');
  } else {
    for (const arg of splitArgs(ret[1])) {
      if (!arg.trim()) {
        issues.push('empty step (stray or trailing comma in Groups.sequential(...))');
        continue;
      }
      const step = parseStep(arg.replace(/\s+/g, ' ').trim());
      if (typeof step === 'string') issues.push(`${step}: ${arg.replace(/\s+/g, ' ').trim().slice(0, 60)}`);
      else steps.push(step);
    }
  }
  return { steps, issues, region, header };
}

const waitMs = (seconds) => String(Math.round(seconds * 1000 * 1000) / 1000);

function commandText(c) {
  if (c.type === 'state') return `robot.set(Robot.State.${c.value})`;
  if (c.type === 'bar') return `robot.flowerBar.set(FlowerBar.State.${c.value})`;
  return `Commands.waitMs(${waitMs(c.seconds)})`;
}

function stepText(step) {
  if (step.type !== 'path') return commandText(step);
  if (!step.events.length) return `robot.drivetrain.follow(paths.${step.path}())`;
  const events = step.events.map((e) => (e.type === 'marker'
    ? `at(${fmt3(e.at)}, ${commandText(e.command)})`
    : `limit(${fmt3(e.from)}, ${fmt3(e.to)}, ${fmt3(e.speed)})`));
  return `follow(robot, paths.${step.path}(), ${events.join(', ')})`;
}

function importsFor(steps) {
  const out = [];
  const commands = [];
  for (const s of steps) {
    commands.push(s);
    if (s.type === 'path') for (const e of s.events) if (e.type === 'marker') commands.push(e.command);
  }
  if (commands.some((c) => c.type === 'bar')) out.push('org.firstinspires.ftc.teamcode.subsystems.FlowerBar');
  if (commands.some((c) => c.type === 'wait')) out.push('com.pedropathing.ivy.commands.Commands');
  const util = 'static org.firstinspires.ftc.teamcode.util.PathEvents';
  const events = steps.filter((s) => s.type === 'path').flatMap((s) => s.events);
  if (events.length) out.push(`${util}.follow`);
  if (events.some((e) => e.type === 'marker')) out.push(`${util}.at`);
  if (events.some((e) => e.type === 'zone')) out.push(`${util}.limit`);
  return out;
}

// Replaces just the routine() method of `source` (and adds the imports it needs).
function generateRoutine(source, parsed, steps, eol) {
  const indent = /^[ \t]*/.exec(source.slice(parsed.region[0]))[0];
  const L = [parsed.header.replace(/\r?\n/g, eol)];
  if (!steps.length) {
    L.push(`${indent}    return Groups.sequential();`);
  } else {
    L.push(`${indent}    return Groups.sequential(`);
    steps.forEach((s, i) => L.push(`${indent}            ${stepText(s)}${i < steps.length - 1 ? ',' : ''}`));
    L.push(`${indent}    );`);
  }
  L.push(`${indent}}`);
  const out = source.slice(0, parsed.region[0]) + L.join(eol) + source.slice(parsed.region[1]);
  return ensureImports(out, importsFor(steps), eol);
}

// "Reset robot": a routine that starts by putting the robot in IDLE and the flower bar UP. The
// editor shows it as a checkbox instead of two steps in the list.
const RESET_STEPS = [{ type: 'state', value: 'IDLE' }, { type: 'bar', value: 'UP' }];

// -> { reset, steps }: the routine's steps without the reset pair, and whether it had one.
function splitReset(steps) {
  const has = steps.length >= 2 && RESET_STEPS.every((r, i) => steps[i].type === r.type && steps[i].value === r.value);
  return has ? { reset: true, steps: steps.slice(2) } : { reset: false, steps };
}

const withReset = (steps, reset) => (reset ? [...RESET_STEPS.map((s) => ({ ...s })), ...steps] : steps);

// -> error string, or null when the steps can be written safely.
function validateRoutine(steps, ctx) {
  if (!Array.isArray(steps)) return 'routine must be a list of steps';
  const checkCommand = (c, where) => {
    if (!c || typeof c !== 'object') return `${where}: missing command`;
    if (c.type === 'state') return ctx.states.includes(c.value) ? null : `${where}: unknown state ${c.value}`;
    if (c.type === 'bar') return ctx.barStates.includes(c.value) ? null : `${where}: unknown flower bar state ${c.value}`;
    if (c.type === 'wait') return Number.isFinite(c.seconds) && c.seconds >= 0 && c.seconds <= 600 ? null : `${where}: wait must be 0 to 600 seconds`;
    return `${where}: unknown command ${c.type}`;
  };
  for (const [i, s] of steps.entries()) {
    const where = `step ${i + 1}`;
    if (s.type !== 'path') {
      const bad = checkCommand(s, where);
      if (bad) return bad;
      continue;
    }
    if (!isIdent(s.path) || !ctx.paths.has(s.path)) return `${where}: unknown path ${s.path}`;
    if (!Array.isArray(s.events)) return `${where}: events must be a list`;
    for (const e of s.events) {
      if (e.type === 'marker') {
        if (!Number.isFinite(e.at) || e.at < 0 || e.at > 1) return `${where}: marker position must be between 0 and 1`;
        if (e.command?.type === 'wait') return `${where}: a marker cannot wait`;
        const bad = checkCommand(e.command, `${where} marker`);
        if (bad) return bad;
      } else if (e.type === 'zone') {
        if (![e.from, e.to, e.speed].every(Number.isFinite) || e.from < 0 || e.to > 1 || e.from >= e.to) return `${where}: zone needs 0 <= from < to <= 1`;
        if (!(e.speed > 0 && e.speed <= 1)) return `${where}: zone speed is a fraction of full speed, 0 to 1`;
      } else {
        return `${where}: unknown event ${e.type}`;
      }
    }
  }
  return null;
}

module.exports = { parseRoutine, generateRoutine, validateRoutine, splitReset, withReset };

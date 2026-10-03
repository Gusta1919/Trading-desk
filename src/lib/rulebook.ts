/**
 * The rulebook: the one strategy this desk trades, as a single versioned document.
 *
 * It holds two kinds of thing. Values — the risk ladder, the windows, the limits, the
 * news rules, the grade factors — which the logic reads. And
 * text — every section of the written rulebook — which the Rulebook tab renders.
 *
 * The text never repeats a value. Wherever a number appears it is a token such as
 * {{risk.A}} or {{window.2.to}}, filled in from the values when it is shown. Change
 * the A risk once and every sentence that mentions it changes with it; a number typed
 * twice is a number that will one day disagree with itself.
 *
 * Every saved change becomes a new version with a one-line reason, and each trade
 * records the version it was graded under.
 */
import { definitionErrors } from "./grading";
import { categoryLabel } from "./newsRules";
import type { BaseRule, Factor, GradeCard, Limits, NumberFactor } from "./types";

/* ── The document ────────────────────────────────────────────────────── */

/** "HH:mm" to "HH:mm", New York. */
export interface TimeWindow {
  from: string;
  to: string;
}

export type Weekday = "Mon" | "Tue" | "Wed" | "Thu" | "Fri";
export const WEEKDAY_KEYS: Weekday[] = ["Mon", "Tue", "Wed", "Thu", "Fri"];

/** A release kind on one currency, e.g. CPI on USD. Kinds are the ids in `newsRules.ts`. */
export interface NewsPair {
  category: string;
  currency: string;
}

/**
 * When news stops a trade. Only red releases count; orange is information.
 *  - A skip day has no trading at all.
 *  - A release window pauses new entries around one release.
 */
export interface NewsRules {
  skip: NewsPair[];
  /** A bank holiday on any of these currencies makes a skip day. */
  holidayCurrencies: string[];
  /** A fixed stretch of the year with no trading, as "MM-DD", inclusive. May span the new year. */
  skipRange: { from: string; to: string } | null;
  /** Every other red release on these currencies opens a window … */
  windowCurrencies: string[];
  /** … and so do these, whatever their currency. */
  windowExtra: NewsPair[];
  /** The window: from this many minutes before the release to this many after. */
  beforeMin: number;
  afterMin: number;
}

/** A section of the written rulebook. `body` is the small text format below. */
export interface Section {
  id: string;
  title: string;
  body: string;
  /** Background, not a rule: shown in the Reference panel, closed by default. */
  reference?: boolean;
}

/** An idea being tested by logging, not yet a rule. */
export interface Hypothesis {
  id: string;
  text: string;
  loggedAs: string;
  /** May hold a token, e.g. {{aplus.trades}}. */
  decideAfter: string;
  /** What is counted: "trades", "cases", "limit trades". */
  unit: string;
  /** "about" the number rather than exactly. */
  approx: boolean;
}

export interface GlossaryEntry {
  term: string;
  meaning: string;
}

export interface Rulebook {
  /** Filled in by the server from the version row; not part of what is saved. */
  version: string;
  name: string;
  instrument: string;

  /* When */
  box: TimeWindow;
  entryWindows: TimeWindow[];
  timeStop: string;
  maxTradesPerDay: number;
  /** A limit order at the FVG stays valid this many closed 5m candles. */
  limitCandles: number;

  /* Prices */
  rr: { min: number; from: number; to: number };
  /** Liquidity this close beyond the stop or target (in R) changes the trade. */
  liquidityR: number;
  /** The stop stays put until price has covered this share of the way to the target. */
  trailAfter: number;
  /** Reference sweep depths ($ beyond the box edge): about 70%, 85% and 95% of sweeps stay within them. */
  sweep: { p70: number; p85: number; p95: number };

  /* Grading and risk */
  baseRules: BaseRule[];
  factors: Factor[];
  grades: GradeCard[];
  /** When A+ may go back to a bigger risk. */
  aPlus: { trades: number; edgeR: number; riskPct: number };
  limits: Limits;
  /** Any broken rule costs the rest of that day and this many trading days after it. */
  daysOff: number;
  news: NewsRules;

  /* Review */
  calibration: { reviewFrom: number; reviewTo: number; rr: number; evidence: number };
  /** The Exit lab reads only once this many taken trades carry an MFE. */
  exitLabMin: number;

  /* Text */
  flow: { gates: string[]; enter: string; manage: string; exit: string };
  sections: Section[];
  guidance: string[];
  hypotheses: Hypothesis[];
  glossary: GlossaryEntry[];
}

/** One saved version, as the server hands it over. */
export interface RulebookVersion {
  version: string;
  reason: string;
  createdAt: string;
  doc: Rulebook;
}

/* ── Versions ────────────────────────────────────────────────────────── */

export function parseVersion(v: string): [number, number] | null {
  const m = /^(\d+)\.(\d+)$/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/** 1.0 → 1.1 → 1.2: every saved change is the next version. */
export function nextVersion(current: string): string {
  const [major, minor] = parseVersion(current) ?? [1, 0];
  return `${major}.${minor + 1}`;
}

/** Newest first. */
export function compareVersions(a: string, b: string): number {
  const [am, an] = parseVersion(a) ?? [0, 0];
  const [bm, bn] = parseVersion(b) ?? [0, 0];
  return bm - am || bn - an;
}

/* ── Formatting values for the text ──────────────────────────────────── */

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const word = (n: number) => (Number.isInteger(n) && n >= 0 && n < WORDS.length ? WORDS[n] : String(n));
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const num = (x: number) => String(Number(x.toFixed(4)));
export const pct = (x: number) => `${num(x)}%`;
const money = (x: number, digits = 2) =>
  `${x < 0 ? "−" : ""}$${Math.abs(x).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
const thousands = (x: number) => `$${num(x / 1000)}K`;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "2026-10-02" → "2 October 2026"; "12-22" → "22 December". */
export function longDate(d: string): string {
  const m = /^(?:(\d{4})-)?(\d{2})-(\d{2})$/.exec(d);
  if (!m) return d;
  const day = `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}`;
  return m[1] ? `${day} ${m[1]}` : day;
}
const span = (w: TimeWindow | undefined) => (w ? `${w.from}–${w.to}` : null);
const and = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const hour12 = (t: string) => {
  const h = Number(t.slice(0, 2));
  return h === 0 ? 12 : h > 12 ? h - 12 : h;
};

/** The countries behind a holiday currency, as the text names them. */
const COUNTRY: Record<string, string> = { USD: "US", GBP: "UK", EUR: "euro-area", CAD: "Canadian", AUD: "Australian", JPY: "Japanese", CHF: "Swiss" };

/**
 * How a news pair reads in the text. The skip list and the window list are written from
 * the rules themselves, so removing CPI from the skip days removes it from the page too.
 */
const PAIR_TEXT: Record<string, { skip: string; window: string }> = {
  "nfp|USD": {
    skip: "US Non-Farm Payrolls day. Non-Farm Employment Change, Average Hourly Earnings and Unemployment Rate come out together.",
    window: "US Non-Farm Payrolls",
  },
  "cpi|USD": { skip: "US CPI day", window: "US CPI" },
  "rates|USD": { skip: "FOMC rate-decision day", window: "the FOMC rate decision" },
  "rates|EUR": { skip: "ECB rate decision (Main Refinancing Rate)", window: "the ECB rate decision" },
  "rates|GBP": { skip: "BoE rate decision (Official Bank Rate)", window: "the BoE Official Bank Rate" },
};
export const pairText = (p: NewsPair, as: "skip" | "window") =>
  PAIR_TEXT[`${p.category}|${p.currency}`]?.[as] ?? `${p.currency} ${categoryLabel(p.category).toLowerCase()}`;

/** The skip days in words, one per line — what [[skip-days]] lists. */
export function skipDayLines(n: NewsRules): string[] {
  const lines = n.skip.map((p) => pairText(p, "skip"));
  if (n.holidayCurrencies.length) {
    lines.push(`${and(n.holidayCurrencies.map((c) => COUNTRY[c] ?? c))} bank holidays`);
  }
  if (n.skipRange) lines.push(`${longDate(n.skipRange.from)} to ${longDate(n.skipRange.to)}`);
  return lines;
}

/** The displacement and Compass factors, found by their ids — the text quotes their cuts. */
const factorById = (doc: Pick<Rulebook, "factors">, id: string) => doc.factors.find((f) => f.id === id) ?? null;
const numberCut = (f: Factor | null, i: number) =>
  f && f.kind === "number" && f.cuts[i] ? (f as NumberFactor).cuts[i].value : null;

/**
 * The challenge in numbers, from a balance: the firm's floor (the start balance less its
 * max loss), the target, and how far the balance sits from each.
 */
export function accountMaths(l: Limits, balance = l.openingBalance) {
  const floor = l.startBalance * (1 - l.maxLossPct / 100);
  const goal = l.startBalance * (1 + l.targetPct / 100);
  const room = balance - floor;
  const need = goal - balance;
  const roomPct = (room / l.startBalance) * 100;
  const needPct = (need / l.startBalance) * 100;
  // With no edge, the chance of reaching +a before −b is b ÷ (a + b).
  const odds = roomPct > 0 && needPct > 0 ? roomPct / (roomPct + needPct) : needPct <= 0 ? 1 : 0;
  return { floor, goal, room, need, roomPct, needPct, odds };
}

/**
 * Every token the text may use, worked out from the document. A token whose value is
 * missing (a factor that was deleted, say) comes back null and is reported on save.
 */
export function tokenValues(doc: Rulebook): Record<string, string | null> {
  const l = doc.limits;
  const acc = accountMaths(l);
  const card = (g: string) => doc.grades.find((c) => c.grade === g);
  const risk = (g: string) => {
    const c = card(g);
    return c ? (c.traded ? pct(c.riskPct) : "Not tradable") : null;
  };
  const traded = doc.grades.filter((c) => c.traded);
  const risks = [...new Set(traded.map((c) => c.riskPct))].sort((a, b) => a - b);
  const disp = factorById(doc, "disp");
  const compass = factorById(doc, "compass");
  const values: Record<string, string | null> = {
    name: doc.name,
    instrument: doc.instrument,
    box: span(doc.box),
    "box.from": doc.box.from,
    "box.to": doc.box.to,
    "box.name": `CRT ${hour12(doc.box.from)}–${hour12(doc.box.to)}AM box`,
    windows: and(doc.entryWindows.map((w) => span(w)!)),
    timeStop: doc.timeStop,
    maxTrades: num(doc.maxTradesPerDay),
    "maxTrades.Word": capital(word(doc.maxTradesPerDay)),
    "limit.candles": num(doc.limitCandles),
    "rr.min": `${num(doc.rr.min)}:1`,
    "rr.range": `${num(doc.rr.from)}R to ${num(doc.rr.to)}R`,
    liquidityR: `${num(doc.liquidityR)}R`,
    trailAfter: pct(doc.trailAfter * 100),
    "trailAfter.word": doc.trailAfter === 0.5 ? "halfway" : `${pct(doc.trailAfter * 100)} of the way`,
    "sweep.p70": money(doc.sweep.p70, 0),
    "sweep.p85": money(doc.sweep.p85, 0),
    "sweep.p95": money(doc.sweep.p95, 0),
    "risk.entry": risks.length ? (risks.length === 1 ? pct(risks[0]) : `${num(risks[0])}–${pct(risks[risks.length - 1])}`) : null,
    "grades.tradable": traded.length ? and(traded.map((c) => c.grade)).replace(/,? and /, " or ") : null,
    "disp.weak": numberCut(disp, 0) != null ? `${numberCut(disp, 0)!.toFixed(2)}×` : null,
    "disp.strong": numberCut(disp, 1) != null ? `${numberCut(disp, 1)!.toFixed(1)}×` : null,
    "compass.cut": numberCut(compass, 0) != null ? pct(numberCut(compass, 0)!) : null,
    "aplus.trades": num(doc.aPlus.trades),
    "aplus.edge": `${num(doc.aPlus.edgeR)}R`,
    "aplus.risk": pct(doc.aPlus.riskPct),
    "limits.maxRisk": pct(l.maxRiskPct),
    "limits.dailyStop": pct(l.dailyStopPct),
    "limits.weeklyStop": pct(l.weeklyStopPct),
    "limits.firmDaily": pct(l.dailyLossPct),
    "limits.firmMax": pct(l.maxLossPct),
    "limits.target": pct(l.targetPct),
    "limits.start": thousands(l.startBalance),
    "limits.opening": money(l.openingBalance),
    "limits.floor": money(acc.floor, 0),
    "limits.goal": money(acc.goal, 0),
    "consequence.daysOff.word": word(doc.daysOff),
    "consequence.daysOff": num(doc.daysOff),
    "consequence.days": doc.daysOff === 1 ? "the next trading day" : `the next ${word(doc.daysOff)} trading days`,
    "news.before": `${num(doc.news.beforeMin)} minutes`,
    "news.after": `${num(doc.news.afterMin)} minutes`,
    "news.windowCurrencies": and(doc.news.windowCurrencies),
    "news.windowExtra": doc.news.windowExtra.length ? and(doc.news.windowExtra.map((p) => pairText(p, "window"))) : "nothing else",
    "calib.review": `${num(doc.calibration.reviewFrom)}–${num(doc.calibration.reviewTo)}`,
    "calib.rr": num(doc.calibration.rr),
    "evidence.trades": num(doc.calibration.evidence),
    exitLabMin: num(doc.exitLabMin),
  };
  doc.entryWindows.forEach((w, i) => {
    values[`window.${i + 1}`] = span(w);
    values[`window.${i + 1}.from`] = w.from;
    values[`window.${i + 1}.to`] = w.to;
  });
  for (const g of ["A+", "A", "B", "C"]) values[`risk.${g}`] = risk(g);
  return values;
}

const TOKEN = /\{\{\s*([^}]+?)\s*\}\}/g;

/** The text with every token filled in. An unknown token stays visible, braces and all. */
export function fill(text: string, values: Record<string, string | null>): string {
  return text.replace(TOKEN, (whole, key: string) => values[key] ?? whole);
}

/** Tokens in a text that have no value. */
export function unknownTokens(text: string, values: Record<string, string | null>): string[] {
  return [...text.matchAll(TOKEN)].map((m) => m[1]).filter((k) => values[k] == null);
}

/* ── The text format ─────────────────────────────────────────────────── */

/*
 * Sections are written in a deliberately small format, so they can be edited in a
 * plain text box and still render in the desk's own style:
 *
 *   ### A heading
 *   A paragraph. **Bold** works, and so do {{tokens}}.
 *   - a bullet            1. a numbered item
 *     - a sub-bullet         - a sub-bullet under it
 *   > An aside, for the "why" behind a rule.
 *   | A | table | row |   (the first row is the header; a | --- | row is skipped)
 *   [[factors]]           a table drawn from the values, not typed
 *
 * Blocks are separated by blank lines or by a change of kind.
 */
export type Block =
  | { kind: "p"; text: string }
  | { kind: "h"; text: string }
  | { kind: "list"; ordered: boolean; items: { text: string; children: string[] }[] }
  | { kind: "table"; head: string[]; rows: string[][] }
  | { kind: "note"; text: string }
  | { kind: "gen"; id: string };

/** The tables and lists the desk draws from values. */
export const GENERATED = [
  "flow",
  "day",
  "skip-days",
  "release-window",
  "consequences",
  "base-rules",
  "factors",
  "ladder",
  "guidance",
  "hypotheses",
  "glossary",
  "changelog",
] as const;

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());

export function parseBody(body: string): Block[] {
  const blocks: Block[] = [];
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();
    if (!t) {
      i++;
      continue;
    }
    const gen = /^\[\[([a-z-]+)\]\]$/.exec(t);
    if (gen) {
      blocks.push({ kind: "gen", id: gen[1] });
      i++;
    } else if (t.startsWith("### ")) {
      blocks.push({ kind: "h", text: t.slice(4).trim() });
      i++;
    } else if (t.startsWith(">")) {
      const text: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) text.push(lines[i++].trim().replace(/^>\s?/, ""));
      blocks.push({ kind: "note", text: text.join(" ") });
    } else if (t.startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        const r = cells(lines[i++]);
        if (!r.every((c) => /^:?-{3,}:?$/.test(c))) rows.push(r);
      }
      blocks.push({ kind: "table", head: rows[0] ?? [], rows: rows.slice(1) });
    } else if (/^(-|\d+\.)\s/.test(t) && !/^\s/.test(line)) {
      const ordered = /^\d+\./.test(t);
      const items: { text: string; children: string[] }[] = [];
      while (i < lines.length) {
        const l = lines[i];
        const top = /^(-|\d+\.)\s+(.*)$/.exec(l);
        const sub = /^\s+-\s+(.*)$/.exec(l);
        if (top && /^\d+\./.test(top[1]) === ordered) items.push({ text: top[2].trim(), children: [] });
        else if (sub && items.length) items[items.length - 1].children.push(sub[1].trim());
        else break;
        i++;
      }
      blocks.push({ kind: "list", ordered, items });
    } else {
      const text: string[] = [];
      while (i < lines.length && lines[i].trim() && !/^(###\s|>|\||\[\[|-\s|\d+\.\s)/.test(lines[i].trim())) {
        text.push(lines[i++].trim());
      }
      blocks.push({ kind: "p", text: text.join(" ") });
    }
  }
  return blocks;
}

/** Splits **bold** out of a line, so the renderer never needs innerHTML. */
export function inline(text: string): { text: string; bold: boolean }[] {
  return text
    .split(/(\*\*[^*]+\*\*)/)
    .filter(Boolean)
    .map((part) => (/^\*\*[^*]+\*\*$/.test(part) ? { text: part.slice(2, -2), bold: true } : { text: part, bold: false }));
}

/* ── Checking a document before it is saved ──────────────────────────── */

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const MMDD = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** Every piece of text a token may sit in, with a name for the error message. */
function texts(doc: Rulebook): [string, string][] {
  return [
    ...doc.sections.map((s) => [s.title || s.id, `${s.title}\n${s.body}`] as [string, string]),
    ...doc.baseRules.map((r, i) => [`Base rule ${i + 1}`, `${r.text} ${r.hint}`] as [string, string]),
    ...doc.factors.map((f) => [f.name, f.hint] as [string, string]),
    ...doc.flow.gates.map((g, i) => [`Decision gate ${i + 1}`, g] as [string, string]),
    ["Decision flow", `${doc.flow.enter} ${doc.flow.manage} ${doc.flow.exit}`],
    ...doc.guidance.map((g, i) => [`Guidance ${i + 1}`, g] as [string, string]),
    ...doc.hypotheses.map((h) => [h.text, `${h.text} ${h.loggedAs} ${h.decideAfter}`] as [string, string]),
  ];
}

/** Problems that must be fixed before a version can be saved. Empty = fine. */
export function rulebookErrors(doc: Rulebook): string[] {
  const errors = [...definitionErrors(doc)];
  const values = tokenValues(doc);

  for (const [where, text] of texts(doc)) {
    for (const k of new Set(unknownTokens(text, values))) errors.push(`${where}: {{${k}}} has no value`);
    for (const m of text.matchAll(/\[\[([a-z-]+)\]\]/g)) {
      if (!(GENERATED as readonly string[]).includes(m[1])) errors.push(`${where}: [[${m[1]}]] is not a table the desk can draw`);
    }
  }

  const times: [string, string][] = [
    ["Box start", doc.box.from],
    ["Box end", doc.box.to],
    ["Time stop", doc.timeStop],
    ...doc.entryWindows.flatMap((w, i): [string, string][] => [
      [`Entry window ${i + 1} start`, w.from],
      [`Entry window ${i + 1} end`, w.to],
    ]),
  ];
  for (const [what, t] of times) if (!TIME.test(t)) errors.push(`${what} must be a time like 04:00`);
  if (!doc.entryWindows.length) errors.push("There must be at least one entry window");
  doc.entryWindows.forEach((w, i) => {
    if (TIME.test(w.from) && TIME.test(w.to) && w.from >= w.to) errors.push(`Entry window ${i + 1} must end after it starts`);
    const prev = doc.entryWindows[i - 1];
    if (prev && w.from < prev.to) errors.push(`Entry window ${i + 1} must start after window ${i} ends`);
  });

  const l = doc.limits;
  const positive: [string, number][] = [
    ["Max risk per trade", l.maxRiskPct],
    ["Daily stop", l.dailyStopPct],
    ["Weekly stop", l.weeklyStopPct],
    ["Firm daily loss", l.dailyLossPct],
    ["Firm max loss", l.maxLossPct],
    ["Start balance", l.startBalance],
    ["Opening balance", l.openingBalance],
    ["Profit target", l.targetPct],
    ["Trades per day", doc.maxTradesPerDay],
  ];
  for (const [what, v] of positive) if (!(Number.isFinite(v) && v > 0)) errors.push(`${what} must be above 0`);
  if (!l.accountName?.trim()) errors.push("The main account needs a name");
  for (const a of l.linked ?? []) {
    if (!a.name.trim()) errors.push("Every linked account needs a name");
    if (!(Number.isFinite(a.opening) && a.opening > 0)) errors.push(`${a.name || "A linked account"}: its balance must be above 0`);
  }
  for (const c of doc.grades) {
    if (!(Number.isFinite(c.riskPct) && c.riskPct >= 0)) errors.push(`${c.grade} risk must be 0 or more`);
  }
  if (!(Number.isInteger(doc.daysOff) && doc.daysOff >= 0)) errors.push("Days off must be a whole number, 0 or more");

  const n = doc.news;
  if (!(n.beforeMin >= 0 && n.afterMin >= 0)) errors.push("Release window minutes must be 0 or more");
  if (n.skipRange && !(MMDD.test(n.skipRange.from) && MMDD.test(n.skipRange.to))) {
    errors.push("The skip range must be two dates like 12-22");
  }
  return errors;
}

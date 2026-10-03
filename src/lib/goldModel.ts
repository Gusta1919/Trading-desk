/**
 * The GOLD Model: the rulebook the desk starts with.
 *
 * A fresh database is seeded with this once, as its first version. From then on the
 * rulebook lives in the database: every edit in the Rulebook tab is saved as the next
 * version, with its date and reason, and this file is never read again for it.
 *
 * The text never types a number twice. Every value is a {{token}} filled in from the
 * fields above it, and every table is a [[block]] drawn from them, so changing a value
 * changes every sentence that mentions it.
 */
import type { Rulebook } from "./rulebook";

/** The bias factor's answers, by id — the trade form reads your bias back from them. */
export const BIAS_OPTION = { matches: "bias-matches", unclear: "bias-unclear", against: "bias-against" } as const;

const SECTIONS: Rulebook["sections"] = [
  {
    id: "glance",
    title: "At a glance",
    body: `Price sweeps one side of the {{box}} NY box. Enter on a 5m MSS back toward it and target the other side. {{instrument}} only, {{maxTrades}} trade a day.

[[day]]

- **Every rule is binding.** Fail one and there's no trade.
- **A break is a break,** even when the trade wins.
- **All times are New York.**`,
  },
  {
    id: "flow",
    title: "Decision flow",
    body: `[[flow]]`,
  },
  {
    id: "prep",
    title: "Before you trade",
    body: `1. **Check-in:** answer it honestly. Anything but "Cleared to trade" ends the day before it starts.
2. **Calendar:** a skip day? Which red releases fall in the entry window? The Today dock shows both.
3. **Levels:** PDH/PDL, PWH/PWL, the higher-timeframe highs and lows, obvious EQH/EQL, and the 1H–Weekly POIs near price.
4. **Bias:** Bullish, Bearish or Unclear, from the Daily chart and the next draw on liquidity. Decide it before the first entry. The Daily Bias briefing can veto a trade, never create one.`,
  },
  {
    id: "news",
    title: "News",
    body: `Only red Forex Factory events count.

### Skip days: no trading

[[skip-days]]

### Release windows

Every other red {{news.windowCurrencies}} release, plus {{news.windowExtra}}.

[[release-window]]

- No new entries from {{news.before}} before to {{news.after}} after the release.
- Hold through it only with the stop at breakeven or better. Otherwise close {{news.before}} before.`,
  },
  {
    id: "trade",
    title: "The trade",
    body: `### Setup

High swept: look for shorts. Low swept: look for longs. A wick is enough.

[[base-rules]]

### Entry

- **Market order** at the close of the MSS candle: a 5m close beyond the last external swing. Wicks, internal swings and BOS don't count.
- R:R under {{rr.min}}? One **limit order** at the near edge of the displacement FVG, valid for {{limit.candles}} candles. Unfilled means no trade.

### Stop and target

- **Stop:** exactly at the external swing the MSS came from.
- **Target:** the opposite box edge, or obvious liquidity within {{liquidityR}} beyond it.
- One position. No runners, no partials.

### Manage and exit

- Hands off until price covers {{trailAfter}} of the way to the target. Then trail behind the second-last 5m swing. The stop only moves toward profit.
- Exit only by target, stop, breakeven, trail, the {{timeStop}} time stop or the release rule. Never on a feeling.`,
  },
  {
    id: "grading",
    title: "Grade and size",
    body: `All base rules hold, or it's a C. Each factor caps the best grade, and the lowest cap wins.

[[factors]]

- **Compass below {{compass.cut}}:** a B at best. Read it off the Compass when you take the setup.

### Risk per grade

[[ladder]]

- Risk is a % of the current balance.
- **A+ goes to {{aplus.risk}}** once {{aplus.trades}} graded trades show A+ beating A by {{aplus.edge}} or more.`,
  },
  {
    id: "limits",
    title: "Limits and consequences",
    body: `- **{{maxTrades.Word}} trade a day.** Win, lose or breakeven, you're done.
- **Daily stop {{limits.dailyStop}}, weekly stop {{limits.weeklyStop}}.** Hit one and stop for the rest of the day or week.
- **Never hold overnight.** Flat by {{timeStop}}.
- **The check-in comes first.** "Stand down" means no trade today.

### When a rule breaks

[[consequences]]`,
  },
  {
    id: "changes",
    title: "Changing a rule",
    reference: true,
    body: `Every change is saved with its date and a one-line reason, in the changelog. A trade is always judged by the rules it was graded under.

[[guidance]]

### Hypotheses: logged, not rules yet

[[hypotheses]]`,
  },
  { id: "glossary", title: "Glossary", reference: true, body: `[[glossary]]` },
  { id: "changelog", title: "Changelog", reference: true, body: `[[changelog]]` },
];

export const GOLD_MODEL: Omit<Rulebook, "version"> = {
  name: "GOLD Model",
  instrument: "XAUUSD",

  box: { from: "03:00", to: "04:00" },
  entryWindows: [
    { from: "04:00", to: "08:25" },
    { from: "09:30", to: "11:00" },
  ],
  timeStop: "12:00",
  maxTradesPerDay: 1,
  limitCandles: 3,

  rr: { min: 1, from: 1, to: 4 },
  liquidityR: 0.3,
  trailAfter: 0.5,
  sweep: { p70: 11, p85: 18, p95: 30 },

  baseRules: [
    { id: "htf", text: "HTF reason present", hint: "a 1H, 4H, Daily or Weekly FVG, OB or VIMB" },
    { id: "mss", text: "5m MSS on external structure after the sweep, by candle close", hint: "a wick doesn't count" },
    { id: "rr", text: "R:R above {{rr.min}} net of fees at the entry price", hint: "including fees" },
    { id: "news", text: "Not a skip day, and not inside a release window", hint: "", auto: "news" },
    { id: "window", text: "Inside the entry window", hint: "{{windows}}" },
    { id: "opposite", text: "Opposite box side still untaken", hint: "" },
    { id: "liquidity", text: "No obvious liquidity within {{liquidityR}} beyond the stop", hint: "EQH/EQL or a key level" },
    { id: "budget", text: "Daily loss budget available, and no trade taken yet today", hint: "", auto: "daily-budget" },
    { id: "bias-decided", text: "Daily bias decided", hint: "Bullish, Bearish or Unclear, before the entry" },
  ],
  factors: [
    {
      id: "htf-tf",
      name: "HTF reason timeframe",
      hint: "",
      kind: "choice",
      options: [
        { id: "htf-4h-plus", label: "4H, Daily or Weekly", cap: "A+" },
        { id: "htf-1h", label: "1H", cap: "A" },
      ],
    },
    {
      id: "disp",
      name: "Displacement multiple",
      hint: "MSS close beyond the swing ÷ 5m ATR(14)",
      kind: "number",
      unit: "×",
      cuts: [
        { value: 0.25, lowerGetsIt: false },
        { value: 1, lowerGetsIt: false },
      ],
      caps: ["B", "A", "A+"],
    },
    {
      id: "bias",
      name: "Daily bias",
      hint: "your daily bias against the trade's direction",
      kind: "choice",
      options: [
        { id: BIAS_OPTION.matches, label: "Matches", cap: "A+" },
        { id: BIAS_OPTION.unclear, label: "Unclear", cap: "B" },
        { id: BIAS_OPTION.against, label: "Against", cap: "C" },
      ],
    },
    {
      id: "compass",
      name: "Compass",
      hint: "the Compass reading for this weekday and direction",
      kind: "number",
      unit: "%",
      cuts: [{ value: 60, lowerGetsIt: false }],
      caps: ["B", "A+"],
    },
    {
      id: "conviction",
      name: "Conviction",
      hint: "",
      kind: "choice",
      options: [
        { id: "conv-none", label: "No doubts", cap: "A+" },
        { id: "conv-lacking", label: "Lacking something for A+", cap: "A" },
        { id: "conv-unsure", label: "Possible to take but unsure", cap: "B" },
        { id: "conv-not-sure", label: "I see it but I'm not sure", cap: "C" },
      ],
    },
  ],
  grades: [
    { grade: "A+", riskPct: 0.5, traded: true, description: "Every base rule holds and every factor is at its best." },
    { grade: "A", riskPct: 0.5, traded: true, description: "Every base rule holds; one or more factors fall short of A+." },
    { grade: "B", riskPct: 0, traded: false, description: "Not tradable. Log it as not taken, so the journal shows whether it would pay." },
    { grade: "C", riskPct: 0, traded: false, description: "A base rule is missing, the bias is against you, or you're not sure. No trade." },
  ],
  aPlus: { trades: 50, edgeR: 0.3, riskPct: 1 },
  limits: {
    startBalance: 200_000,
    openingBalance: 193_933.27,
    maxRiskPct: 0.5,
    dailyStopPct: 1,
    weeklyStopPct: 2,
    dailyLossPct: 5,
    maxLossPct: 10,
    targetPct: 10,
  },
  daysOff: 1,
  news: {
    skip: [
      { category: "nfp", currency: "USD" },
      { category: "cpi", currency: "USD" },
      { category: "rates", currency: "USD" },
      { category: "rates", currency: "EUR" },
    ],
    holidayCurrencies: ["USD", "GBP"],
    skipRange: { from: "12-22", to: "01-02" },
    windowCurrencies: ["USD"],
    windowExtra: [{ category: "rates", currency: "GBP" }],
    beforeMin: 5,
    afterMin: 60,
  },

  calibration: { reviewFrom: 60, reviewTo: 100, rr: 100, evidence: 50 },
  exitLabMin: 30,

  flow: {
    gates: [
      "Check-in: cleared to trade?",
      "Daily bias decided?",
      "An allowed day, not a skip day?",
      "One box side swept inside the entry window?",
      "An HTF reason: a 1H–Weekly FVG, OB or VIMB?",
      "A 5m candle closes beyond the external swing?",
      "R:R above {{rr.min}} at the MSS close, or one FVG limit filled within {{limit.candles}} candles?",
      "Grade {{grades.tradable}}?",
    ],
    enter: "at {{risk.entry}} risk. Stop at the external swing, target the opposite box edge.",
    manage: "hands off until {{trailAfter.word}}, then trail behind the second-last 5m swing.",
    exit: "by target, stop, breakeven, trail, the {{timeStop}} time stop or the release rule. Then you're done for the day.",
  },
  sections: SECTIONS,
  guidance: [
    "Changes that reduce risk need no evidence.",
    "Changes that add risk or loosen a filter need {{evidence.trades}}+ trades of evidence from data that did not create the idea.",
    "Provisional numbers (the displacement multiples, the {{liquidityR}} liquidity distance, the {{rr.min}} minimum R:R) are reviewed after {{calib.review}} logged trades.",
  ],
  hypotheses: [
    { id: "deep-sweep", text: "Deep sweeps (beyond about {{sweep.p85}}) are breakouts, not sweeps", loggedAs: "Sweep depth ($)", decideAfter: "60", unit: "trades", approx: true },
    { id: "swing-15m", text: "Sweeping a 15m swing improves results", loggedAs: "15m swing yes/no", decideAfter: "60", unit: "trades", approx: true },
    { id: "fresh-poi", text: "Fresh POIs beat retested ones", loggedAs: "POI tests", decideAfter: "60", unit: "trades", approx: true },
    { id: "release-hold", text: "Holding through releases at breakeven pays", loggedAs: "Release + exit reason", decideAfter: "20", unit: "cases", approx: true },
    { id: "min-rr", text: "A higher minimum R:R improves expectancy", loggedAs: "Planned R:R", decideAfter: "{{calib.rr}}", unit: "trades", approx: false },
    { id: "runners", text: "Runners or a different target pay", loggedAs: "MFE", decideAfter: "100", unit: "trades", approx: false },
    { id: "shorts", text: "Shorts underperform longs (pilot: 1 win in 8 shorts)", loggedAs: "Direction", decideAfter: "100", unit: "trades", approx: false },
    { id: "desk", text: "Trades where your bias matches the briefing do better", loggedAs: "Bias matches the briefing", decideAfter: "50", unit: "trades", approx: true },
    { id: "a-plus", text: "A+ beats A by {{aplus.edge}} or more", loggedAs: "Grade", decideAfter: "{{aplus.trades}}", unit: "graded trades", approx: false },
    { id: "b-setups", text: "B setups would pay", loggedAs: "B setups logged as not taken", decideAfter: "30", unit: "B setups", approx: true },
  ],
  glossary: [
    { term: "CRT box", meaning: "High and low of the {{box}} NY hour" },
    { term: "Sweep / Judas move", meaning: "Price trades beyond one side of the box, taking resting stops, before reversing" },
    { term: "External structure", meaning: "The major swings that define the leg into the sweep; internal swings are the minor pullbacks inside it" },
    { term: "MSS", meaning: "Market structure shift: a candle closes beyond the last external swing in the new direction" },
    { term: "BOS", meaning: "Break of structure in the existing direction; not used in this model" },
    { term: "Displacement", meaning: "How far the MSS candle closes beyond the broken swing, measured in 5m ATRs" },
    { term: "FVG", meaning: "Fair value gap: three candles where the first and third candles' wicks don't overlap" },
    { term: "OB", meaning: "Order block: the last opposite-coloured candle before a displacement" },
    { term: "VIMB", meaning: "Volume imbalance: a gap between two consecutive candle bodies whose wicks overlap" },
    { term: "POI", meaning: "Point of interest: an HTF FVG, OB or VIMB" },
    { term: "EQH / EQL", meaning: "Equal highs / lows: obvious resting liquidity" },
    { term: "PDH/PDL, PWH/PWL", meaning: "Previous day's and previous week's high and low" },
    { term: "ATR(14)", meaning: "Average True Range: the size of a normal candle right now (average of the last 14, gaps included)" },
    { term: "Bid / ask / spread", meaning: "Sell price / buy price / the difference; charts show the bid" },
    { term: "R", meaning: "Planned risk on a trade: entry to stop, in $" },
    { term: "R:R net", meaning: "(Reward − fees) ÷ (risk + fees)" },
    { term: "Expectancy", meaning: "Average result per trade, in R" },
    { term: "MFE / MAE", meaning: "How far a trade went in your favour / against you before the exit, in R" },
  ],
};

/** The seed version and the reason its changelog line gives. */
export const FIRST_VERSION = "1.0";
export const FIRST_REASON = "The GOLD Model rulebook";

/** A fresh copy of the GOLD Model — never the shared object, so nothing can mutate the seed. */
export function defaultRulebook(): Rulebook {
  return { ...structuredClone(GOLD_MODEL), version: FIRST_VERSION };
}

/**
 * Rulebook v1.2 — the GOLD Model as it moved into the desk.
 *
 * This is the document the migration writes once. After that the rulebook lives in
 * the database and is edited in the Rulebook tab; this file is never read again for
 * an existing desk, only for a brand-new one and for the tests.
 *
 * Ids are fixed strings rather than random ones: the setup check, the auto rules and
 * the trades' frozen snapshots all refer to them, and so do the tests.
 */
import type { Rulebook, Section } from "./rulebook";
import { DEFAULT_LIMITS } from "./types";

export const FIRST_VERSION = "1.2";
export const FIRST_REASON =
  "Rulebook moved into the desk: single strategy, edits anytime with versioning, enforcement by flags and consequences";

/** Option ids the desk fills in for you — the daily bias against the trade's direction. */
export const BIAS_OPTION = { matches: "bias-matches", unclear: "bias-unclear", against: "bias-against" } as const;

export function defaultRulebook(): Rulebook {
  return {
    version: FIRST_VERSION,
    name: "GOLD Model",
    instrument: "XAUUSD",
    ozPerLot: 100,

    box: { from: "03:00", to: "04:00" },
    planBy: "04:00",
    entryWindows: [
      { from: "04:00", to: "08:25" },
      { from: "09:30", to: "11:00" },
    ],
    timeStop: "12:00",
    compassBy: "17:00",
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
      { id: "window", text: "Inside the entry window", hint: "{{windows}}", auto: "entry-window" },
      { id: "opposite", text: "Opposite box side still untaken", hint: "" },
      { id: "liquidity", text: "No obvious liquidity within {{liquidityR}} beyond the stop", hint: "EQH/EQL or a key level" },
      {
        id: "budget",
        text: "Daily loss budget available, and no trade taken yet today",
        hint: "",
        auto: "daily-budget",
      },
      { id: "plan", text: "Written daily plan exists", hint: "by {{planBy}}", auto: "plan" },
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
        auto: "displacement",
        // <0.25 B · 0.25 to <1.0 A · ≥1.0 A+ — an exact boundary belongs to the upper range.
        cuts: [
          { value: 0.25, lowerGetsIt: false },
          { value: 1, lowerGetsIt: false },
        ],
        caps: ["B", "A", "A+"],
      },
      {
        id: "fvg",
        name: "Displacement left an FVG",
        hint: "",
        kind: "choice",
        options: [
          { id: "fvg-yes", label: "Yes", cap: "A+" },
          { id: "fvg-no", label: "No", cap: "A" },
        ],
      },
      {
        id: "bias",
        name: "Daily bias",
        hint: "from today's plan",
        kind: "choice",
        auto: "bias",
        options: [
          { id: BIAS_OPTION.matches, label: "Matches", cap: "A+" },
          { id: BIAS_OPTION.unclear, label: "Unclear", cap: "B" },
          { id: BIAS_OPTION.against, label: "Against", cap: "C" },
        ],
      },
      {
        id: "compass",
        name: "Compass (weekday, direction)",
        hint: "from the frozen snapshot",
        kind: "number",
        unit: "%",
        auto: "compass",
        // <60 B · ≥60 no cap — exactly 60 is no cap.
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
      {
        grade: "A+",
        riskPct: 0.5,
        traded: true,
        backtestRiskPct: 0.5,
        description: "Every base rule holds and every factor is at its best.",
      },
      {
        grade: "A",
        riskPct: 0.5,
        traded: true,
        backtestRiskPct: 0.5,
        description: "Every base rule holds; one or more factors fall short of A+.",
      },
      {
        grade: "B",
        riskPct: 0,
        traded: false,
        backtestRiskPct: 0.25,
        description: "Not tradable in the desk. The Forex Tester backtest still takes it, to see whether it pays.",
      },
      {
        grade: "C",
        riskPct: 0,
        traded: false,
        backtestRiskPct: null,
        description: "A base rule is missing, the bias is against you, or you're not sure. No trade.",
      },
    ],

    compass: {
      frozenOn: "2026-10-02",
      source: "XPREAY Compass Max, 03:00–04:00 box",
      sessions: 990,
      days: {
        Mon: { short: 53.8, long: 56.2 },
        Tue: { short: 60.6, long: 62.4 },
        Wed: { short: 68.1, long: 77.9 },
        Thu: { short: 60.0, long: 69.7 },
        Fri: { short: 64.7, long: 67.0 },
      },
      all: { short: { hit: 283, of: 461 }, long: { hit: 352, of: 528 } },
      midpointPct: 80,
      refreshDays: 90,
    },

    aPlus: { trades: 50, edgeR: 0.3, riskPct: 1 },
    limits: { ...DEFAULT_LIMITS },
    consequences: { factor: 0.5, breaks: 2, daysOff: 2 },
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

    calibration: { displacement: 60, reviewFrom: 60, reviewTo: 100, rr: 100, evidence: 50 },
    goLiveTrades: 100,
    exitLabMin: 30,

    flow: {
      gates: [
        "Plan written by {{planBy}} NY?",
        "An allowed day (not a skip day)?",
        "One box side swept inside the entry window?",
        "An HTF reason: a 1H to Weekly FVG, OB or VIMB?",
        "A 5m candle closes beyond the external swing?",
        "R:R above {{rr.min}} net at the MSS close? If not, one FVG limit is allowed, filled within {{limit.candles}} candles.",
        "Grade {{grades.tradable}}? All base rules hold, and the lowest factor cap decides.",
      ],
      enter: "at {{risk.entry}} risk, stop at the external swing, target at the opposite box edge.",
      manage: "hands off until {{trailAfter.word}}, then trail behind the second-last 5m swing.",
      exit: "by target, stop, trailing stop, the {{timeStop}} time stop or the release rule. Then you're done for the day.",
    },

    // A copy: the list is shared, and a caller editing its own document must not edit it.
    sections: SECTIONS.map((s) => ({ ...s })),

    guidance: [
      "Changes that reduce risk need no evidence.",
      "Changes that add risk or loosen a filter need {{evidence.trades}}+ trades of evidence from data that did not create the idea.",
      "The Compass snapshot is refreshed quarterly.",
      "Provisional numbers (the displacement multiples, the {{liquidityR}} liquidity distance, the {{rr.min}} minimum R:R) are reviewed after {{calib.review}} logged trades.",
    ],

    hypotheses: [
      { id: "deep-sweep", text: "Deep sweeps (beyond about {{sweep.p85}}) are breakouts, not sweeps", loggedAs: "Sweep depth ($)", decideAfter: "60", unit: "trades", approx: true },
      { id: "swing-15m", text: "Sweeping a 15m swing improves results", loggedAs: "15m swing yes/no", decideAfter: "60", unit: "trades", approx: true },
      { id: "fresh-poi", text: "Fresh POIs beat retested ones", loggedAs: "POI tests", decideAfter: "60", unit: "trades", approx: true },
      { id: "release-hold", text: "Holding through releases at breakeven pays", loggedAs: "Release + exit reason", decideAfter: "20", unit: "cases", approx: true },
      { id: "min-rr", text: "A higher minimum R:R improves expectancy", loggedAs: "Planned R:R", decideAfter: "{{calib.rr}}", unit: "trades", approx: false },
      { id: "limit-entry", text: "Limit entries beat market entries", loggedAs: "Entry type", decideAfter: "30", unit: "limit trades", approx: true },
      { id: "runners", text: "Runners or a different target pay", loggedAs: "MFE", decideAfter: "100", unit: "trades", approx: false },
      { id: "shorts", text: "Shorts underperform longs (pilot: 1 win in 8 shorts)", loggedAs: "Direction", decideAfter: "100", unit: "trades", approx: false },
      { id: "desk", text: "The desk improves live results", loggedAs: "Desk agreed", decideAfter: "50", unit: "live trades", approx: true },
      { id: "a-plus", text: "A+ beats A by {{aplus.edge}} or more", loggedAs: "Grade", decideAfter: "{{aplus.trades}}", unit: "graded trades", approx: false },
      { id: "b-setups", text: "B setups have positive expectancy", loggedAs: "Forex Tester backtest (outside the desk)", decideAfter: "50", unit: "B trades", approx: false, outside: true },
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
      { term: "Look-ahead bias", meaning: "Using information in a backtest that didn't exist at the time" },
      { term: "Hindsight bias", meaning: "Letting bars you've already seen influence a backtest decision" },
    ],

    history: [
      {
        version: "1.1",
        date: "2026-10-03",
        change: "Removed the DST-mismatch tag; displacement measured as the MSS close beyond the broken swing, in 5m ATRs",
      },
      {
        version: "1.0",
        date: "2026-10-02",
        change: "First rulebook, built from the pilot backtest (January–March 2023) and the strategy review",
      },
    ],
  };
}

/** The five open items the migration seeds once; after that they live in their own table. */
export const OPEN_ITEMS = [
  "Compass Judas range: confirm it's measured from the box edge. Measure 10–15 past days by hand, from the box edge to the furthest point beyond it before 23:00. If about 7 in 10 are under $11, the reading holds.",
  "Both firms: is there a time limit or an inactivity rule?",
  "Both firms: news-trading rules on funded accounts.",
  "The firm's real commission and the typical XAUUSD spread between 04:00 and 12:00 NY, for the Forex Tester settings.",
  "Decide the go-live gate (see Risk limits and challenge plan).",
];

const SECTIONS: Rulebook["sections"] = [
  {
    id: "how",
    title: "How to use this rulebook",
    body: `- Every rule is binding: a trade that fails any rule is not taken.
- All times are New York (NY) time.
- Where a rule needs judgment, it gets a measurable definition. Provisional numbers are marked as such and calibrated only with logged data.
- A rule break is a violation even when the trade made money.
- Rules can be edited anytime in the desk; every edit is versioned with a reason ({{ref:changes}}).`,
  },
  {
    id: "overview",
    title: "Strategy overview",
    body: `The {{name}} trades {{instrument}}. After price sweeps one side of the {{box}} NY box, you enter on a 5m external MSS and target the opposite side.

| Item | Rule |
| --- | --- |
| Instrument | {{instrument}} spot gold (1 lot = {{lot.oz}} oz) |
| Box | {{box.name}}: high and low of {{box}} NY, wicks included |
| Idea | One side gets swept (the Judas move), then price runs to the other side |
| Trigger | 5m MSS on external structure, back toward the box |
| Target | The opposite side of the box |
| Sessions | London and New York |
| Entry window | {{windows}} |
| Positions closed by | {{timeStop}}, never overnight |
| Max trades | {{maxTrades.Word}} per day |
| Planned R:R range | {{rr.range}} |
| Invalidation | Price trades through the stop at the external swing |

### Decision flow

[[flow]]`,
  },
  {
    id: "prep",
    title: "Daily preparation",
    body: `No written plan by {{planBy}} NY means no trading that day.

1. **Calendar:** is today a skip day, and which red releases fall inside the entry window?
2. **Level map:** PDH/PDL, PWH/PWL, the monthly, quarterly and yearly highs and lows, the ATH, and obvious EQH/EQL.
3. **HTF points of interest:** 1H, 4H, Daily and Weekly FVGs, OBs and VIMBs near current price.
4. **Daily bias:** Bullish, Bearish or Unclear. It comes from the Daily chart and the level map, i.e. where the next draw on liquidity sits. You form most of it yourself.
5. **Desk check:** the Daily Bias briefing may support or question the bias. It can veto a trade, but it can never create one or flip the bias.
6. **Compass:** today's weekday value for both directions, from the frozen snapshot ({{ref:grading}}).
7. **Write the plan:** bias, key levels, release windows, Compass values, and anything that makes today a no-trade day.`,
  },
  {
    id: "news",
    title: "Calendar and news rules",
    body: `**Source:** Forex Factory, in NY time. Only red events trigger rules; orange is information only.

### Skip days (no trading at all)

[[skip-days]]

### Release window

This covers every other red {{news.windowCurrencies}} release (for example ADP Non-Farm Employment Change, Unemployment Claims, GDP including Final GDP, PPI, Retail Sales, PCE), plus {{news.windowExtra}}.

- No new entries from {{news.before}} before to {{news.after}} after the release.
- An open trade may be held through the release only if its stop is already at breakeven or better. Otherwise, close it {{news.before}} before.

> **Why the breakeven condition:** in the pilot backtest, 6 trades were open at 08:30 and 5 of them won (+$4,006). At least 4 had already moved their stops to breakeven or better, so the spike could only help them. Protection isn't perfect, though: on 9 March 2023 a breakeven stop filled $0.41 worse during the 08:30 spike.

**Not skipped:** German, French and Spanish holidays, and EUR or GBP data other than the ECB and BoE decisions. Gold's liquidity comes from London and New York, and it reacts mainly to USD data and US yields.

**Firm news rules:** check both firms' funded-account rules on trading around high-impact news (open item, {{ref:open}}).`,
  },
  {
    id: "setup",
    title: "Setup definition",
    body: `A valid setup has five parts:

1. **Box:** the high and low of the {{box}} NY hour, wicks included. Box size is logged, not filtered.
2. **Sweep:** after {{box.to}}, price trades beyond the box high or low; a wick is enough. High swept: look for shorts. Low swept: look for longs.
3. **HTF reason:** the sweep trades into, or reacts from, a 1H, 4H, Daily or Weekly FVG, OB or VIMB, preferably reacting inside it. Its timeframe affects the grade.
4. **Opposite side untaken:** if both box sides were taken before entry, there is no target left, so no trade.
5. **Entry window:** {{windows}}.
  - No entries from {{window.1.to}} to {{window.2.from}} on any day. In the pilot, entries in that window went 0 for 8 (5 decisions).
  - No entries after {{window.2.to}}. Volatility fades, and Compass shows about 73% of moves finished by 08:00 and 95% by 12:00.

### Removed from the rules, now logged as tags

- **"Min 15M high or low sweep":** it wasn't used in the pilot or live. Log "sweep also took a 15m swing: yes/no".
- **"HTF reason tested no more than 2 times":** too hard to count consistently, and higher-timeframe levels can hold after several tests. Log "POI: fresh / tested once / tested 2+".
- **Sweep depth:** log the $ distance from the box edge to the sweep extreme. The Compass reference, still to verify: about 70% of sweeps stay within {{sweep.p70}} of the edge, 85% within {{sweep.p85}}, 95% within {{sweep.p95}}.
- **Sweep of an important level as the HTF reason:** left out of v1 because it's unproven. Log it when it happens.`,
  },
  {
    id: "entry",
    title: "Entry rules",
    body: `**MSS (market structure shift):** a 5m candle closes beyond the last external swing in the new direction: above the swing high for longs, below the swing low for shorts. A wick doesn't count, internal swings don't count, and BOS entries are not part of the model.

### Order type

1. Default: a market order at the close of the MSS candle.
2. If R:R at that price is below the minimum, you may place one limit order at the near edge of the displacement FVG. It stays valid for {{limit.candles}} closed 5m candles. Unfilled means no trade, no chasing. A long limit gets the spread added ({{ref:stop}}).
3. Log the entry type (market or limit) on every trade.

**Minimum R:R:** above {{rr.min}} net of fees, measured at the entry price. After {{calib.rr}} trades, compare the 1–1.5, 1.5–2 and 2+ buckets and set the minimum from the data.

R:R net = (reward $ − fees $) ÷ (risk $ + fees $). Example: reward $1,200, risk $600 and fees $24 give (1,200 − 24) ÷ (600 + 24) = 1.88.

**Liquidity filter (provisional):** no trade if obvious EQH/EQL or a key level sits within {{liquidityR}} beyond the stop, because it is likely to get swept.`,
  },
  {
    id: "stop",
    title: "Stop and target",
    body: `**Stop:** exactly at the external swing the MSS came from. Longs: at the external swing low. Shorts: at the external swing high plus the spread. No other buffer.

**Spread rule.** Charts show the bid. Buy orders fill at the ask (bid + spread); sell orders fill at the bid. So every buy order needs the spread added:

| Order | Type | Set it at |
| --- | --- | --- |
| Long entry (limit) | Buy | Chart level + spread |
| Long stop | Sell | Chart level |
| Long target | Sell | Chart level |
| Short entry (limit) | Sell | Chart level |
| Short stop | Buy | Chart level + spread |
| Short target | Buy | Chart level + spread |

Example: with a $0.20 spread and a swing high at 2,650.00, a short stop at 2,650.00 triggers when the bid reaches 2,649.80, before the chart ever touches the swing. Set it at 2,650.20 instead.

### Target

- Default: the opposite box edge.
- Exception (provisional): if obvious EQH/EQL or a key level sits within {{liquidityR}} beyond the box edge, target it instead.

**No runners and no split positions.** Both were rare and discretionary. MFE data will show later whether runners would pay.`,
  },
  {
    id: "grading",
    title: "Grading and position size",
    body: `Every base rule must hold, or the setup is a C. Then each grade factor caps the best grade possible, and the lowest cap wins.

### Base rules

[[base-rules]]

### Grade factors

[[factors]]

**How the two displacement factors work.** The rulebook defines three grades of displacement:

- **Strong:** {{disp.strong}} or more, and an FVG left.
- **Normal:** {{disp.weak}}–{{disp.strong}}, or {{disp.strong}} and more without an FVG.
- **Weak:** below {{disp.weak}}.

The two factors above reproduce this exactly under the lowest-cap rule. Boundaries: exactly {{disp.weak.x}} counts as Normal, exactly {{disp.strong.x}} as Strong-eligible, and exactly {{compass.cut}} as no cap.

### Measuring displacement (provisional, calibrate after {{calib.displacement}} trades)

- Measure how far the MSS candle closes beyond the broken external swing, in $ (the price difference, not pips).
- Divide it by the 5m ATR(14) shown on the MSS candle. ATR is the size of a normal 5m candle right now; always read it at that candle.
- Example: swing high 2,000.00 and ATR $1.20. A close at 2,001.20 is 1.0×, so Strong if an FVG was left. A close at 2,000.20 is 0.17×, so Weak.
- Trade-off: a huge candle that only just closes beyond the swing counts as Weak. That matches the "barely broke the swing" idea; the {{calib.displacement}}-trade review will show whether it holds.

### Compass snapshot (frozen {{compass.frozenOn}}, refreshed quarterly)

The chance the opposite box side is reached by {{compassBy}} NY, by weekday. Source: {{compass.source}}, about {{compass.sessions}} sessions.

[[compass]]

- All days: short {{compass.all.short}}, long {{compass.all.long}}. The box midpoint gets reached about {{compass.midpoint}} of the time.
- One coarse threshold is used because each weekday cell holds only about 90–105 sessions, so its true value is uncertain by roughly ±10 points.
- These values include data after 2023, so grading 2023 backtest trades with them is look-ahead bias. It is accepted only because the rule is coarse.

### Grade ladder

Risk is a percent of the current balance:

[[ladder]]

- **A+ returns to {{aplus.risk}}** only after {{aplus.trades}}+ graded trades show A+ beats A by at least {{aplus.edge}} per trade. In the pilot, 1% trades averaged −0.48R and 0.5% trades −0.22R.
- **B stays not tradable in the desk.** The Forex Tester backtest still takes B at {{backtest.B}}, so its results can show whether that should ever change.
- Risk on the current balance shrinks your size automatically during a drawdown.`,
  },
  {
    id: "manage",
    title: "Trade management",
    body: `1. No stop moves before price reaches {{trailAfter}} of the distance from entry to target.
2. After that, each new 5m swing in your favour moves the stop behind the second-most-recent swing. This is the 2-swing buffer: the nearest swing may get swept, but the second holds unless the trend breaks.
3. The stop only ever moves toward profit, never back.
4. Exits are allowed only by the stop, the target, the trailing stop, the {{timeStop}} time stop, or the release rule.
5. Not allowed: closing on a "strong reversal", on intuition, or out of impatience before {{timeStop}}.

> **Why:** discretionary exits can't be tested. In the pilot, 10 manual exits netted −$271 and made the results impossible to reproduce.`,
  },
  {
    id: "limits",
    title: "Risk limits and challenge plan",
    body: `### Limits

- **{{maxTrades.Word}} trade per day.** Win, lose or breakeven, you're done. One box means one thesis per day; in the pilot, re-entries after a loss went 0 for 3 (−$2,486). Several positions opened at once count as one trade, and v1 uses one position.
- **Daily loss stop: {{limits.dailyStop}}.** With one trade at {{risk.entry}}, this is a backstop against slippage.
- **Weekly stop: −{{limits.weeklyStop}}** ({{limits.weeklyStop.losses}} losses at {{risk.entry}}). Stop trading for the rest of the week and review the journal.
- **Never hold overnight.**

### Firm rules (both accounts)

- Two-step challenge: Phase 1 target {{limits.phase1}}, Phase 2 target {{limits.phase2}}. Max daily loss {{limits.firmDaily}}, max loss {{limits.firmMax}}.
- Accounts: FTMO {{limits.start}} and a {{limits.second}} account, with the same rules and the same risk.
- The {{limits.start}} account's opening balance for the journal is {{limits.opening}}: {{limits.openingLoss}}, or {{limits.openingLossPct}}. That leaves {{limits.room}} ({{limits.roomPct}}) above the {{limits.floor}} max-loss floor, and Phase 1 needs {{limits.phase1Need}} ({{limits.phase1NeedPct}}) to reach {{limits.phase1Goal}}.

**Go-live gate (recommended; decision pending, see open items).** Resume live challenge trading only after the Forex Tester backtest shows positive net expectancy over {{goLiveTrades}}+ trades.

> **Why:** with zero edge, the chance of reaching +{{limits.phase1NeedPct.abs}} before −{{limits.roomPct}} is {{odds.phase1}}, at any risk size. Phase 2 is {{odds.phase2}}, so a zero-edge strategy passes both phases only about {{odds.both}} of the time. Only a real edge raises that.`,
  },
  {
    id: "backtest",
    title: "Backtesting protocol",
    body: `Done in Forex Tester; the desk holds the text only.

### Setup

- **Data:** months not used before, e.g. April–December 2023, then 2024. The pilot (9 January–27 March 2023) is exploratory only: it generated the ideas, so it can't confirm them.
- **Frozen rules:** new ideas go on the hypothesis list, never into a running test.
- **Bar by bar, future hidden,** to avoid hindsight bias.
- **Settings:** spread modelled, commission as the firm charges it (the pilot used $12 per lot round turn), all times in NY.
- **Inputs:** bias from the chart only, Compass from the frozen snapshot, B trades at {{backtest.B}}.

### Evaluate

- Net expectancy per trade in R, after costs. It must be clearly above zero.
- Win rate against the breakeven win rate for the average R:R.
- Longest losing streak and maximum drawdown.
- Rule adherence (target 100%).
- Results split by grade, R:R bucket, weekday, direction, entry type and every tag.

Expectancy E = (win% × average win in R) − (loss% × average loss in R).

Pilot reference: 33 positions (28 decisions), 33% win rate, net −$896 (−0.9%), profit factor 0.92, $665 in commission.`,
  },
  {
    id: "fields",
    title: "Journal fields",
    body: `| Group | Fields |
| --- | --- |
| When | Date, weekday, NY entry and exit time, red release that day |
| Setup | Direction, box high, low and size, sweep depth ($ beyond the box edge), took a 15m swing (yes/no), HTF reason type and timeframe, POI fresh / tested once / tested 2+, important-level sweep (yes/no) |
| Grade | Answer to every grade factor, Compass value, final grade, desk agreed (yes/no) |
| Entry | Entry type (market/limit), entry price, initial stop, target, planned R:R, lots, risk $, ATR(14), MSS close beyond the swing ($) and the displacement multiple |
| Exit | Exit reason (target, stop, trail, time stop, release rule), exit price, result in $ (already includes spread and commission) and R |
| Excursions | MFE (R), MAE (R); for early exits, whether the target would have been hit before the stop by {{timeStop}} |
| Discipline | Rule violations (which), screenshots before and after |

Always log the initial stop. The pilot export kept only the final stop, so 8 of 28 decisions couldn't be measured.

**MFE and MAE.** MFE (maximum favourable excursion) is how far price went in your favour between entry and exit, in R. MAE (maximum adverse excursion) is how far it went against you.

Example (long): entry 2,000 and stop 1,996, so 1R = $4. Price reaches 2,006 before the stop is hit, so MFE = 1.5R.

They let you test exit rules on trades already taken:

- If many stopped-out trades reached +1R first, a 1R target or breakeven at 1R would have saved them.
- If winners regularly reached 3R, a bigger target pays.
- If winners often came within 0.1R of the stop (MAE), the stop is too tight.`,
  },
  {
    id: "discipline",
    title: "Discipline and enforcement",
    body: `- **Graded before saved.** The setup check must be completed before a trade can be saved, and the desk calculates the lot size.
- **Done for today.** After the day's trade closes, the desk shows "done for today".
- **No plan, no trade.** No written plan by {{planBy}} NY means no trading that day.
- **Consequences:**
  - Any rule break: the rest of the day off, logged as a violation even if the trade made money.
  - {{consequence.breaks.Word}} breaks in one week: the next week at {{consequence.factor.word}} risk.
  - Breaking the one-trade rule or a loss limit: {{consequence.daysOff.word}} trading days off.
- **Adherence KPI:** rule adherence %, reviewed weekly next to P&L. Target 100%.`,
  },
  {
    id: "changes",
    title: "Rule changes and hypotheses",
    body: `Rules can change anytime in the desk. Every change gets a version, a date and a one-line reason, shown in the changelog.

Guidance (shown while editing, never blocking):

[[guidance]]

### Hypotheses (logged, not rules yet)

[[hypotheses]]`,
  },
  { id: "open", title: "Open items", body: "[[open-items]]" },
  { id: "glossary", title: "Glossary", body: "[[glossary]]" },
  { id: "changelog", title: "Changelog", body: "[[changelog]]" },
];

/* ── v1.3: the written plan retired ──────────────────────────────────── */

export const PLAN_RETIRED_VERSION = "1.3";
export const PLAN_RETIRED_REASON =
  "Written daily plan retired: the first gate is now a decided daily bias, ticked in the setup check; the desk shows today's status itself";

/** The base rule that replaces "Written daily plan exists". */
export const BIAS_RULE = { id: "bias-decided", text: "Daily bias decided", hint: "Bullish, Bearish or Unclear, before the entry" };

const PREP_V13 = `Nothing has to be written down: the desk shows today's status (skip day, entry windows, release windows) on every tab. Decide the daily bias before the first entry.

1. **Calendar:** is today a skip day, and which red releases fall inside the entry window?
2. **Level map:** PDH/PDL, PWH/PWL, the monthly, quarterly and yearly highs and lows, the ATH, and obvious EQH/EQL.
3. **HTF points of interest:** 1H, 4H, Daily and Weekly FVGs, OBs and VIMBs near current price.
4. **Daily bias:** Bullish, Bearish or Unclear. It comes from the Daily chart and the level map, i.e. where the next draw on liquidity sits. You form most of it yourself.
5. **Desk check:** the Daily Bias briefing may support or question the bias. It can veto a trade, but it can never create one or flip the bias.
6. **Compass:** today's weekday value for both directions, from the frozen snapshot ({{ref:grading}}).`;

const NO_PLAN_LINE = "- **No plan, no trade.** No written plan by {{planBy}} NY means no trading that day.";
const NO_BIAS_LINE = "- **No bias, no trade.** The daily bias (Bullish, Bearish or Unclear) is decided before the first entry.";

/**
 * The v1.3 change applied to whatever version is in force: the plan base rule becomes
 * "Daily bias decided", the bias factor is answered by hand, the plan deadline goes,
 * and the text that spoke of the plan is rewritten. Text you edited yourself is kept;
 * only a leftover {{planBy}} in it is written out as the time it stood for.
 */
export function retirePlan(doc: Rulebook): Rulebook {
  const was = doc.planBy ?? "04:00";
  const { planBy: _gone, ...rest } = doc;
  const outPlan = (text: string) => text.split("{{planBy}}").join(was);
  return {
    ...rest,
    baseRules: doc.baseRules.map((r) => (r.id === "plan" ? { ...BIAS_RULE } : r)),
    factors: doc.factors.map((f) => {
      if (f.auto !== "bias") return f;
      const { auto: _auto, ...plain } = f;
      return { ...plain, hint: "your daily bias against the trade's direction" };
    }),
    flow: {
      ...doc.flow,
      gates: doc.flow.gates.map((g) => (g === "Plan written by {{planBy}} NY?" ? "Daily bias decided?" : outPlan(g))),
    },
    sections: doc.sections.map((s) => {
      if (s.id === "prep" && s.body.startsWith("No written plan by {{planBy}} NY means no trading that day.")) {
        return { ...s, body: PREP_V13 };
      }
      return { ...s, body: outPlan(s.body.replace(NO_PLAN_LINE, NO_BIAS_LINE)) };
    }),
  };
}

/* ── v1.4: the rulebook condensed ────────────────────────────────────── */

export const CONDENSED_VERSION = "1.4";
export const CONDENSED_REASON =
  "Rulebook condensed to the strategy's rules: explanations, examples, journal fields and the challenge plan removed; backtesting moved to the reference";

const FLOW_V14: Rulebook["flow"] = {
  gates: [
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
  exit: "by target, stop, trail, the {{timeStop}} time stop or the release rule. Then you're done for the day.",
};

/** The rules, in the order you need them. */
const MAIN_V14: Section[] = [
  {
    id: "glance",
    title: "At a glance",
    body: `Price sweeps one side of the {{box}} NY box. Enter on a 5m MSS back toward it and target the other side. {{instrument}} only, {{maxTrades}} trade a day.

[[day]]

- **Every rule is binding.** Fail one and there's no trade.
- **A break is a break,** even when the trade wins.
- **All times are New York.**`,
  },
  { id: "flow", title: "Decision flow", body: "[[flow]]" },
  {
    id: "prep",
    title: "Before you trade",
    body: `1. **Calendar:** a skip day? Which red releases fall in the entry window? The Today dock shows both.
2. **Levels:** PDH/PDL, PWH/PWL, the higher-timeframe highs and lows, obvious EQH/EQL, and the 1H–Weekly POIs near price.
3. **Bias:** Bullish, Bearish or Unclear, from the Daily chart and the next draw on liquidity. Decide it before the first entry. The Daily Bias briefing can veto a trade, never create one.`,
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
- Exit only by target, stop, trail, the {{timeStop}} time stop or the release rule. Never on a feeling.`,
  },
  {
    id: "grading",
    title: "Grade and size",
    body: `All base rules hold, or it's a C. Each factor caps the best grade, and the lowest cap wins.

[[factors]]

### Compass: far side reached by {{compassBy}}

[[compass]]

### Risk per grade

[[ladder]]

- Risk is a % of the current balance.
- **A+ goes to {{aplus.risk}}** once {{aplus.trades}} graded trades show A+ beating A by {{aplus.edge}} or more.`,
  },
  {
    id: "limits",
    title: "Limits and consequences",
    body: `- **{{maxTrades}} trade a day.** Win, lose or breakeven, you're done.
- **Daily stop {{limits.dailyStop}}, weekly stop {{limits.weeklyStop}}.** Hit one and stop for the rest of the day or week.
- **Never hold overnight.** Flat by {{timeStop}}.

### When a rule breaks

[[consequences]]`,
  },
];

/** Background kept for reference, in this order; the ones v1.4 rewrites are here. */
const REFERENCE_IDS = ["changes", "backtest", "open", "glossary", "changelog"];
const REFERENCE_V14: Record<string, Section> = {
  changes: {
    id: "changes",
    title: "Changing a rule",
    body: `Every change gets a new version and a one-line reason.

[[guidance]]

### Hypotheses: logged, not rules yet

[[hypotheses]]`,
  },
};

/**
 * The v1.4 change applied to whatever version is in force: the text shrinks to the
 * strategy's rules, and the background moves to the Reference panel. Values are not
 * touched, so the logic reads exactly what it read before. Any section whose text you
 * wrote or edited yourself is kept as you left it — in its new place if v1.4 still has
 * that section, after the rules if it doesn't — and so is a decision flow you edited.
 */
export function condenseRulebook(doc: Rulebook): Rulebook {
  const stock = retirePlan(defaultRulebook());
  const before = new Map(stock.sections.map((s) => [s.id, s]));
  const yours = new Map(
    doc.sections
      .filter((s) => {
        const o = before.get(s.id);
        return !o || o.title !== s.title || o.body !== s.body;
      })
      .map((s) => [s.id, s]),
  );
  const mainIds = new Set(MAIN_V14.map((s) => s.id));
  const main = MAIN_V14.map((s) => yours.get(s.id) ?? s);
  const kept = [...yours.values()].filter((s) => !mainIds.has(s.id) && !REFERENCE_IDS.includes(s.id));
  const reference = REFERENCE_IDS.map((id) => yours.get(id) ?? REFERENCE_V14[id] ?? doc.sections.find((s) => s.id === id))
    .filter((s): s is Section => s != null)
    .map((s) => ({ ...s, reference: true }));
  const flowUntouched = JSON.stringify(doc.flow) === JSON.stringify(stock.flow);
  return { ...doc, flow: flowUntouched ? FLOW_V14 : doc.flow, sections: [...main, ...kept, ...reference] };
}

/* ── 2.0: a fresh start ──────────────────────────────────────────────── */

export const FRESH_START_REASON =
  "Fresh start: Compass read by hand (below 60% is a B), no FVG factor, one consequence (any break, two days off), backtesting and open items removed";

const SECTIONS_V2: Record<string, string> = {
  grading: `All base rules hold, or it's a C. Each factor caps the best grade, and the lowest cap wins.

[[factors]]

- **Compass below {{compass.cut}}:** a B at best. Read it off the Compass when you take the setup.

### Risk per grade

[[ladder]]

- Risk is a % of the current balance.
- **A+ goes to {{aplus.risk}}** once {{aplus.trades}} graded trades show A+ beating A by {{aplus.edge}} or more.`,
  limits: `- **{{maxTrades}} trade a day.** Win, lose or breakeven, you're done.
- **Daily stop {{limits.dailyStop}}, weekly stop {{limits.weeklyStop}}.** Hit one and stop for the rest of the day or week.
- **Never hold overnight.** Flat by {{timeStop}}.

### When a rule breaks

[[consequences]]`,
};

/** Sections 2.0 leaves out: the backtest lives outside the desk, and the open items are done with. */
const DROPPED_V2 = new Set(["backtest", "open"]);
/** Backtest-only background that goes with it. */
const BACKTEST_TERMS = new Set(["Look-ahead bias", "Hindsight bias"]);

/**
 * Rulebook 2.0, from whatever version is in force:
 *  - the Compass is read by hand when you take the setup, and below the cut it caps at B;
 *    the frozen snapshot is no longer looked up, so it can't go stale;
 *  - displacement is picked as a range, not worked out from two prices;
 *  - "Displacement left an FVG" is gone;
 *  - one consequence: any rule break costs the next two trading days;
 *  - the backtesting protocol, the open items and the backtest-only hypothesis and terms go;
 *  - the changelog starts again at this version.
 * Text you edited yourself is kept, as in v1.4.
 */
export function freshStart(doc: Rulebook, version: string): Rulebook {
  const v14 = new Map(condenseRulebook(retirePlan(defaultRulebook())).sections.map((s) => [s.id, s]));
  const untouched = (s: Section) => {
    const o = v14.get(s.id);
    return o != null && o.title === s.title && o.body === s.body;
  };
  const byHand = (f: Rulebook["factors"][number], hint: string): Rulebook["factors"][number] => {
    const { auto: _auto, ...rest } = f;
    return { ...rest, hint } as Rulebook["factors"][number];
  };
  return {
    ...doc,
    factors: doc.factors
      .filter((f) => f.id !== "fvg")
      .map((f) =>
        f.auto === "compass"
          ? { ...byHand(f, "the Compass reading for this weekday and direction"), name: "Compass" }
          : f.auto === "displacement"
            ? byHand(f, "MSS close beyond the swing ÷ 5m ATR(14)")
            : f,
      ),
    grades: doc.grades.map((g) =>
      g.grade === "B" && g.description.includes("Forex Tester")
        ? { ...g, description: "Not tradable. Log it anyway, so the journal shows whether it would pay." }
        : g,
    ),
    consequences: { ...doc.consequences, daysOff: 2, anyBreak: true },
    guidance: doc.guidance.filter((g) => !/Compass snapshot is refreshed/i.test(g)),
    hypotheses: doc.hypotheses.filter((h) => !h.outside),
    glossary: doc.glossary.filter((g) => !BACKTEST_TERMS.has(g.term)),
    history: [],
    changelogFrom: version,
    sections: doc.sections
      .filter((s) => !DROPPED_V2.has(s.id))
      .map((s) => (SECTIONS_V2[s.id] && untouched(s) ? { ...s, body: SECTIONS_V2[s.id] } : s)),
  };
}

/* ── The entry window, ticked by hand ────────────────────────────────── */

export const WINDOW_BY_HAND_REASON = "“Inside the entry window” is ticked by hand, like the other rules you judge yourself";

/** The entry-window base rule stops being checked from the trade's time; you tick it. */
export function windowByHand(doc: Rulebook): Rulebook {
  return {
    ...doc,
    baseRules: doc.baseRules.map((r) => {
      if (r.auto !== "entry-window") return r;
      const { auto: _auto, ...byHand } = r;
      return byHand;
    }),
  };
}

/* ── 2.2: a restricted check-in closes the day ───────────────────────── */

export const CHECKIN_CLOSES_REASON = "A “Trade restricted” check-in means no trade at all, not A+ only";

const CHECKIN_LINE = "- **The check-in comes first.** “Trade restricted” or “Stand down” means no trade today.";

/** Caution stops leaving A+ open: the check-in either clears the day or closes it. */
export function checkinCloses(doc: Rulebook): Rulebook {
  return {
    ...doc,
    checkinCaution: "nothing",
    sections: doc.sections.map((s) =>
      s.id === "limits" && !s.body.includes(CHECKIN_LINE) && s.body.includes("\n\n### When a rule breaks")
        ? { ...s, body: s.body.replace("\n\n### When a rule breaks", `\n${CHECKIN_LINE}\n\n### When a rule breaks`) }
        : s,
    ),
  };
}

/* ── 2.3: what a trade logs ──────────────────────────────────────────── */

export const JOURNAL_V23_REASON =
  "Breakeven is an exit of its own, the HTF reason is logged with its timeframe, the desk check becomes “my bias matches the briefing”, and the entry type is no longer logged";

/** "target, stop, trail, the 12:00 time stop…" gains breakeven, wherever the exits are listed. */
const withBreakeven = (text: string) =>
  text.replace(/target, stop, (trail|trailing stop), the \{\{timeStop\}\} time stop/g, "target, stop, breakeven, $1, the {{timeStop}} time stop");

export function journalV23(doc: Rulebook): Rulebook {
  return {
    ...doc,
    flow: { ...doc.flow, exit: withBreakeven(doc.flow.exit) },
    sections: doc.sections.map((s) => ({ ...s, body: withBreakeven(s.body) })),
    hypotheses: doc.hypotheses
      .filter((h) => h.id !== "limit-entry")
      .map((h) =>
        h.id === "desk" ? { ...h, text: "Trades where your bias matches the briefing do better", loggedAs: "Bias matches the briefing" } : h,
      ),
  };
}

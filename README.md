# Gucci Trade Journal

A local, percentage-based trading journal built around one strategy — the GOLD Model —
with its rulebook inside: every rule the desk can check is checked, every broken one is
flagged and has consequences, and every change to a rule is versioned with a reason.
A morning check-in and plan, and a coach that turns your own history into a briefing.

Everything runs on your machine: an Express API (port 3848) over a SQLite file, and a
React page (port 3847). No account and no API keys. The only outside calls are read-only:
the economic calendar and headlines, the gold price (Dukascopy's public feed) and, while
today's briefing is missing, your own Gmail drafts folder.

## Run

```bash
npm install
npm start          # starts API + web
open http://localhost:3847
```

## The screen

- **Morning** — the check-in (readiness → Ready / Caution / Sit out), then today's plan
  (bias, level map, POIs, Compass, desk check). No plan by 04:00 NY, no trade today.
- **Banner** — on every tab when a rule speaks: done for today, day off, days off until …,
  half-risk week, weekly stop hit, skip day, no plan.
- **KPI strip** — net return, win rate, expectancy, profit factor, drawdown, streak, and
  this week's rule adherence.
- **Journal** — every trade in R and % of account, its exit reason, flags and rulebook
  version; click a row to edit.
- **New trade** — the setup check first (auto rules, Compass, displacement, the grade and
  what it may risk today), then the trade: prices, lot size, exit, MFE/MAE.
- **Daily Bias** — today's gold briefing drawn over live price, and the desk's own
  "stand aside today" list worked out from the rulebook.
- **Calendar** — results, plan status, flags, days off and skip days, the weekly note.
- **Rulebook** — the whole GOLD Model rulebook with live values, the decision flow, an
  edit mode per section, versions and changelog, hypotheses, open items, glossary.
- **Stats** — full stats, Compare, what drives your results, habits, well-being, and
  "By the rulebook": every grade, factor answer and journal field against results.
- **News** — the economic calendar with skip days and release windows marked, and the wire.
- **Risk lab** — your days replayed under today's rules into thousands of futures, and the
  Exit lab: which target would have paid best.
- **Coach** — today's briefing: the rules' state, streak maths, drawdown simulation,
  your leaks and edges, A+ → 1% eligibility, hypotheses ready to decide.

## Data

- `data/trade-assistant.db` — SQLite; written the moment you save a trade, check-in or plan.
- `rulebook_versions` holds every version of the rulebook; the newest is in force, and each
  trade records the version it was graded under.
- **Backup** button exports everything as JSON; copying `data/` is a full backup.
- `legacy_*` tables hold the old (v1, USD-based) schema; `strategies`, `limits` and
  `news_rules` hold what the desk used before the rulebook. All are kept, untouched.
- `npm run demo:add` / `demo:fill` / `demo:remove` — demo history, tagged `[demo]`.

## Code map

| File | What it holds |
|---|---|
| `server/db.ts` | opens the database |
| `server/schema.ts`, `server/migrate.ts` | schema + migrations (the rulebook's is `migrateRulebook`) |
| `server/rulebookStore.ts` | rulebook versions: the one in force, the list, saving a new one |
| `server/index.ts` | REST API; re-derives % and R and re-judges every flag after each write |
| `src/lib/types.ts` | trade shape and its journal fields, flags, grades, the definition |
| `src/lib/rulebook.ts` | the rulebook's shape, `{{tokens}}`, the text format, versions, validation |
| `src/lib/rulebookText.ts` | rulebook v1.2 as it moved into the desk |
| `src/lib/rules.ts` | entry window, Compass, displacement, R:R, lots, MFE/MAE |
| `src/lib/discipline.ts` | every flag, the consequence ladder, today's status, adherence |
| `src/lib/newsRules.ts` | release kinds, skip days and release windows |
| `src/lib/plans.ts` | the morning plan and "written on time" |
| `src/lib/hypotheses.ts` | the rulebook's hypotheses, measured |
| `src/lib/exitLab.ts` | the Exit lab |
| `src/lib/checkin.ts` | check-in questions, scoring, verdicts |
| `src/lib/stats.ts` | outcomes, summary, equity, grouping |
| `src/lib/insights.ts` | factor analysis (edges/leaks) and behaviour patterns |
| `src/lib/coach.ts` | the briefing: rules, probabilities, wording |
| `src/lib/dailyBias.ts` | Daily Bias: file shape, parsing, is-it-today's |
| `src/lib/chart.ts` | chart maths: sessions, CRT box, price range, level roles, label stacking |
| `src/lib/useCandles.ts` | polls today's candles for the chart |
| `src/lib/layout.ts` | even card rows for the Coach |
| `server/bias.ts` | reads and writes `data/daily-bias.json` |
| `server/gmailBias.ts` | collects the briefing from its Gmail draft (setup: JAK-URUCHOMIC.txt) |
| `server/candles.ts` | XAU/USD candles from Dukascopy's public feed, cached for a minute |
| `src/components/BiasChart.tsx` | the Daily Bias chart card: title bar, scenario pills, layers, legend |
| `src/components/PriceChart.tsx` | the SVG candle chart itself |
| `src/components/RulebookView.tsx` | the Rulebook tab; `RuleEditors.tsx` holds its grading editors |
| `src/components/TradeForm.tsx`, `SetupCheck.tsx` | the setup check and the trade |
| `src/components/` | board panels, forms, charts |

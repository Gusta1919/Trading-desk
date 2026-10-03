# Gucci Trade Journal

A local, percentage-based trading journal built around one strategy — the GOLD Model —
with its rulebook inside: every rule the desk can check is checked, every broken one is
flagged and costs the rest of the day plus the next trading day, and every change to a
rule is saved with a reason. A morning check-in, and a coach that reads your own history.

Everything runs on your Mac: an Express API (port 3848) over a SQLite file, and a React
page (port 3847). No account and no API keys. The only outside calls are read-only: the
economic calendar and headlines, the gold price (Dukascopy's public feed) and, while
today's briefing is missing, your own Gmail drafts folder.

## Run

```bash
npm install
npm start          # starts API + web
open http://localhost:3847
```

## Start clean

- **First start of this version:** an older database is moved whole into `data/archive/`
  (nothing is deleted). The desk opens empty, with the GOLD Model rulebook as version 1.0.
  Your own check-ins come along; demo data and a demo briefing stay behind.
- `npm run reset` (with the desk closed) does the same at any time: the database goes to
  `data/archive/` and the next start is an empty desk.
- `npm run demo` fills every tab with about 13 weeks of example trades, check-ins and a
  Daily Bias briefing; `npm run demo:remove` takes all of it away again. Everything demo is
  tagged `[demo]`, so nothing of yours is ever touched.

## The screen

Every tab opens the same way: its name, one line on what it is for, and its controls on the
right. The Today dock sits bottom-right on every tab.

- **Check-in** — nine questions each weekday morning: *Cleared to trade* or *Stand down*
  (which closes the day). Then today's status and the Coach's briefing.
- **Today dock** — where the day stands right now: entries open, release window, skip day,
  day off, done for today. Rest the mouse on it for the whole day, the budgets and the account.
- **Journal** — every trade, and every setup logged as not taken, with why it got its grade,
  its session (from the entry time), exit, rules held, risk and result.
- **New trade** — step 1 grades the setup (base rules, then the five factors) and says what
  it may risk today. Step 2 logs it: taken, or not taken with what it would have made.
- **Daily Bias** — the morning's gold briefing drawn over live price, with the rulebook's CRT
  box and time stop, the scenarios, what to watch and when, and the desk's own stand-aside list.
- **News** — the economic calendar with skip days and release windows marked, and the wire.
- **Calendar** — each day's result, skip days and days off; pick a day for its trades.
- **Stats** — the headline numbers, the equity curve and the account against the firm's
  lines, what drives your results, habits, and Compare: every grade, factor answer and
  journal field against results (setups not taken shown as paper results).
- **Risk lab** — your days replayed into 5,000 futures to answer one question at a time, and
  the Exit lab: which target would have paid best.
- **Coach** — today's read: the rules' state, your edges and leaks, hypotheses ready to decide.
- **Rulebook** — the GOLD Model on one page, every number live. Each section edits in place;
  the limits are edited here and nowhere else. Every save is a line in the changelog.

## Data

- `data/trade-assistant.db` — SQLite: `trades`, `checkins`, `rulebook_versions`, and a
  `meta` row with the schema version. Written the moment you save.
- Each trade keeps the rules it was graded under (`setup_snapshot`, `rulebook_version`), so
  editing the rulebook never rewrites history. The server re-derives R, risk $ and every
  flag after each write.
- The download button in the header saves everything as one JSON file; copying `data/`
  (with the desk closed) is a full backup.
- `npm run preview:build` (with the desk running) builds `dist-preview/`: the app with a
  snapshot of the desk baked in, for viewing without the server.

## Code map

| File | What it holds |
|---|---|
| `server/db.ts` | opens the database; moves an older one into `data/archive/` |
| `server/schema.ts` | the tables, and the GOLD Model seeded as 1.0 |
| `server/rulebookStore.ts` | rulebook versions: the one in force, the list, saving the next one |
| `server/index.ts` | REST API; re-derives R and risk and re-judges every flag after each write |
| `src/lib/goldModel.ts` | the GOLD Model rulebook as it ships |
| `src/lib/types.ts` | the trade and its journal fields, flags, grades, the grading definition |
| `src/lib/rulebook.ts` | the rulebook's shape, `{{tokens}}`, the text format, versions, validation |
| `src/lib/grading.ts` | grades from base rules and factors |
| `src/lib/discipline.ts` | every flag, the consequence, today's status, the auto base rules |
| `src/lib/risk.ts`, `limits.ts` | allowed risk, daily and weekly budgets, the account's lines |
| `src/lib/rules.ts` | entry window, time stop, session, weekday |
| `src/lib/newsRules.ts` | release kinds, skip days and release windows |
| `src/lib/checkin.ts` | check-in questions, scoring, verdicts |
| `src/lib/stats.ts`, `insights.ts` | outcomes, summary, equity; edges, leaks and habits |
| `src/lib/hypotheses.ts`, `exitLab.ts`, `montecarlo.ts` | hypotheses measured, the Exit lab, the Risk lab's futures |
| `src/lib/coach.ts` | the Coach's briefing |
| `src/lib/dailyBias.ts`, `chart.ts` | the Daily Bias file and the chart maths |
| `server/bias.ts`, `gmailBias.ts`, `candles.ts`, `news.ts` | the briefing file, its Gmail pickup, gold candles, the calendar feed |
| `src/components/ui.tsx` | the shared pieces: PageHeader, Panel, Stat, Empty, Segmented, … |
| `src/index.css` | the theme: colours, the type scale, surfaces and animations |
| `scripts/demo-data.ts`, `reset.ts` | demo data in and out; a clean start |
| `scripts/preview/` | the online preview build |

# Gucci Trade Journal

A local, percentage-based trading journal with a daily psychological check-in and a
coach that turns your own history into a pre-session briefing.

Everything runs on your machine: an Express API (port 3848) over a SQLite file, and a
React page (port 3847). No account, no cloud, no network calls.

## Run

```bash
npm install
npm start          # starts API + web
open http://localhost:3847
```

## The screen

- **KPI strip** — net return, win rate, expectancy, profit factor, drawdown, streak.
- **Journal** — every trade in R and % of account; click a row to edit.
- **Coach** — today's briefing: streak maths, drawdown simulation, your leaks and edges,
  if-then plans, a principle and a reflection question.
- **Calendar** — daily and weekly results; a day with more than one trade is flagged.
- **Below the board** — full stats, what drives your results, habits, a Monte Carlo
  simulation of the next 20–250 trades, and your past reflections.

## Data

- `data/trade-assistant.db` — SQLite; written the moment you save a trade or check-in.
- **Backup** button exports everything as JSON; copying `data/` is a full backup.
- `legacy_*` tables hold the old (v1, USD-based) schema, untouched.

## Code map

| File | What it holds |
|---|---|
| `server/db.ts` | schema + migrations |
| `server/index.ts` | REST API for trades and check-ins |
| `src/lib/types.ts` | trade shape, sessions, entry models, checklist |
| `src/lib/checkin.ts` | check-in questions, scoring, verdicts |
| `src/lib/stats.ts` | outcomes, summary, equity, grouping |
| `src/lib/insights.ts` | factor analysis (edges/leaks) and behaviour patterns |
| `src/lib/coach.ts` | the briefing: rules, probabilities, wording |
| `src/lib/dailyBias.ts` | Daily Bias: file shape, parsing, is-it-today's |
| `server/bias.ts` | reads and writes `data/daily-bias.json` |
| `server/gmailBias.ts` | collects the briefing from its Gmail draft (setup: JAK-URUCHOMIC.txt) |
| `src/components/` | board panels, forms, charts |

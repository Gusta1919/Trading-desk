# Plan: one strategy, the rulebook built in

The plan the brief (§0.2) asks for. Nothing is deleted until you say **go**.

Starting point: 108 tests and the build both pass. The database holds one strategy
(GOLD Model), 68 `[demo]` trades, 45 `[demo]` check-ins and your 3 real check-ins
(30 Sep, 1 Oct, 2 Oct). There are no real trades yet.

---

## The idea in one paragraph

The GOLD Model stops being a row in a list of strategies and becomes **the rulebook**:
one versioned document holding the setup definition, the limits, the news rules, the
Compass snapshot, the text of §3, the hypotheses and the glossary. Every number in the
text is a *token* that reads from those values, so a number is never typed twice.
Saving a change asks for a one-line reason and writes a new version (1.2 → 1.3). Each
trade records the version it was graded under. A pure function (`evaluateDay` /
`evaluateHistory` in `src/lib/discipline.ts`) works out every flag and every
consequence from the trades, plans and check-ins. The server runs it after every write,
the same way it already re-derives % and R, so editing or deleting a trade fixes the
flags of the trades after it.

---

## Storage

**New tables** (all `CREATE TABLE IF NOT EXISTS`, guarded by meta keys):

| Table | Columns | Why |
|---|---|---|
| `rulebook_versions` | `version` PK ("1.2"), `major`, `minor`, `reason`, `doc` (JSON), `created_at` | One row per version; the newest is current. Old versions stay readable. |
| `plans` | `date` PK, `bias`, `levels` (JSON), `pois`, `desk_check`, `notes`, `created_at`, `updated_at` | The morning plan. `created_at` is never changed by later edits, so "on time" holds. |
| `open_items` | `id` PK, `text`, `done`, `done_at`, `sort`, `created_at` | The §3.15 checklist. Ticking is not a rule change, so it isn't versioned. |

**New `trades` columns** (additive; nothing renamed or dropped):
`rulebook_version`, `box_high`, `box_low`, `sweep_extreme`, `sweep_depth`,
`took_15m_swing`, `htf_reason_type`, `poi_tests`, `level_sweep`, `desk_agreed`,
`entry_type`, `entry_price`, `stop_price` (initial), `target_price`, `lots`, `risk_usd`,
`atr`, `mss_beyond`, `exit_time`, `exit_price`, `exit_reason`, `early_stop_move`,
`release_at_be`, `mfe_price`, `mae_price`, `target_before_stop`, `max_fav_price`,
`screenshot_after`.
MFE R and MAE R are derived from the prices, not stored (one source of truth).

**Left exactly where they are, no longer written:** `strategies`, `limits`,
`news_rules`, and the columns `strategy_id`, `htf`, `entry_model`, `setup` and
`expected_minutes`. `legacy_*` is not touched.

The server reads limits and news rules from the current rulebook. `GET /api/limits`
still answers, so nothing breaks in between. Writes go through `PUT /api/rulebook` with
a reason.

---

## Phases

Each phase ends with `npm test` and `npm run build` passing, and its own commit.

### Phase 1: Rulebook data and migration
- Snapshot first: `data/snapshot-before-rulebook-<HHMMSS>.db`.
- `src/lib/rulebook.ts` (new): the `Rulebook` type, the v1.2 document (every §3 value and
  text), version maths (minor or major bump), token rendering (`{{risk.A}}`, `{{window.1}}`,
  `{{news.before}}`…), and a check that rejects unknown tokens on save.
- `server/migrate.ts`, `migrateRulebook()`, in the brief's order:
  1. delete `[demo]` trades and `[demo]` check-ins (the existing `demo:remove` logic, in SQL);
  2. write v1.2 with changelog rows 1.0, 1.1 and 1.2;
  3. add the trade columns;
  4. create `plans`, `rulebook_versions` and `open_items`, and seed the 5 open items;
  5. limits: the old row's values go into v1.2, and a value still at its old default takes
     the new one (max risk 1 → 0.5; weekly stop 2 and opening balance 193,933.27 are new).
- `server/index.ts`: routes for rulebook (current, list, one version, save), plans, open
  items and weeks (already there); trade fields; `recomputeResults` compounds from the
  **opening** balance.
- `src/lib/types.ts`: new trade fields and `rulebookVersion`. `Strategy` stays internal
  until phase 5, so the UI keeps compiling.
- Tests: migration idempotent (run twice, same result), demo rows gone, real check-ins
  kept, limits only changed where still at their default, a trade keeps its version after
  an edit.

### Phase 2: Rules engine (pure, tested, no UI)
- `src/lib/rules.ts` (new): entry window, Compass lookup (weekday × direction, weekend →
  none), displacement multiple (rounded to 4 dp, so 0.30 ÷ 1.20 lands on 0.25 and not on
  0.2499…), planned R:R from prices, lot size, MFE/MAE in R, time stop.
- `src/lib/newsRules.ts`: `cpi` split into `cpi` and `ppi-pce`; the new stance is
  `skip | window | info` from the rulebook's news rules (pairs, holiday currencies, the
  date range, window currencies, window minutes), plus the same stance for a trade's own
  saved news, used when the feed doesn't cover the day.
- `src/lib/risk.ts`: `weekBudget` mirrors `dayBudget`; allowed risk = min(grade, day
  left, week left, max per trade) × consequence multiplier, 0 on a day off or for a grade
  not tradable today.
- `src/lib/plans.ts` (new): the plan type, and on-time = created before 04:00 NY that day.
- `src/lib/discipline.ts` (new): every flag in §4.5, and the consequence ladder (day off,
  half-risk week, two trading days off) worked out in date order over the history; also
  "today's status" for the banners.
- The server re-runs the flags after each write, for trades graded under v1.2 or later.
- Tests: every case in brief §6, including the 08:25 / 09:30 / 11:00 edges, 0.25 / 1.0 / 60
  boundaries, the two-factor displacement equivalence, ADP → window, BoE → window,
  ECB → skip, German holiday → none, 22 Dec–2 Jan, weekly budget, the full ladder.

### Phase 3: Trade form and setup check
- "New trade" opens straight at the setup check; the strategy step is gone.
- Base rules: 4, 5, 8 and 9 answered automatically (with a manual fallback when the data
  isn't there); 1, 2, 3, 6 and 7 ticked by hand; rule 3 shows gross R:R as a guide.
- Factors: Compass filled in and read-only; displacement worked out from "MSS close beyond
  the swing ($)" and "ATR(14) 5m ($)"; daily bias pre-picked from the plan.
- Grade panel: B and C show "Not tradable — don't take it"; check-in limits; consequences;
  week budget.
- New fields in the existing cards (The trade / Setup / Entry / Exit / Review); lot size
  helper with the $100K line; the spread line on shorts; session from the time. The
  expected-minutes field and the legacy strategy, HTF and entry-model fields are removed
  from the form.
- Glossary hover tips on the terms in the setup check and the form.

### Phase 4: Check-in plan, weekly note, banners, RiskChip
- Check-in: after the readiness questions comes a **Plan** step (today's status, bias,
  level map, HTF POIs, Compass today, desk check, notes). The first check-in of the week
  also asks for the weekly note.
- Week note editor in three places: the check-in, the Calendar week row, the trade form's
  "This week" panel.
- One status banner on every tab: Done for today / Day off — rule break today / Half-risk
  week / Days off until … / Weekly stop hit / No plan, no trade today.
- RiskChip shows the day, the week and any consequence; changing a value asks for a reason
  and creates a version.
- Check-in verdict copy: Caution = A+ only, Sit out = nothing.

### Phase 5: Rulebook tab (and removal of Strategies)
- `RulebookView.tsx` (new): section navigation; the decision flow drawn at the top; every
  §3 section rendered from the document; tables in the existing styles.
- Edit mode per section. Rules, factors and ladder **reuse the editors from
  `StrategyForm.tsx`**, moved into `RuleEditors.tsx`. New editors for windows, news rules,
  limits and settings, Compass and text, with the §3.14 guidance shown while editing.
- Saving asks for a reason and a minor or major bump; the changelog lists newest first;
  any old version opens read-only.
- Hypotheses panel (live n, progress to "decide after", expectancy per side faded when
  small, collecting or ready); open items (tickable); glossary.
- **Deleted:** `StrategiesView.tsx`, `StrategyForm.tsx` (its editors kept),
  `strategyTemplate.ts`, `tests/template.test.ts` and the `/api/strategies` routes (the
  table stays). `Strategy` leaves the public types.

### Phase 6: Analysis surfaces
- Stats strip: rule adherence % this week.
- `StrategyCompare.tsx` becomes `Compare.tsx`: grade, every factor answer, every new
  field, weekday/direction/session, sweep-depth, R:R and displacement buckets.
- Insights: the new fields as factors; Strategy and the legacy Entry × HTF crosses dropped.
- Coach: single-strategy wording; new cards (consequence, weekly stop, plan, done for
  today, open trade near 12:00, release coming without breakeven, adherence trend, Compass
  older than 90 days, A+ → 1% eligibility, hypotheses ready); B cards removed.
- Risk lab: replay with the new caps and the day and week stops; "Stop trading B?" removed;
  new **Exit lab** (1R / 1.5R / 2R / 3R targets, breakeven at 1R, needs 30+ trades with
  MFE, labelled approximate).
- Calendar tab: result, plan status, flags, day-off and skip-day markers, check-in;
  2+ taken trades on a day shown as a violation.
- Journal list: exit reason, flags, rulebook version.
- News calendar: skip days and release windows marked. Alerts: window events at T−5 and
  at the release, a morning notice on a skip day, the time stop at 11:55 and 12:00,
  quiet notices at 08:25 and 11:00.
- Daily Bias: the desk's own "Stand aside today" panel next to the briefing's list.

### Phase 7: Backup, demo data, importer, docs, walkthrough
- Backup exports trades, check-ins, plans, weeks, every rulebook version, open items.
- `scripts/demo-data.ts` rewritten for the new rulebook (A+ and A only, new fields, plans,
  a few flagged violations); `demo:remove` still only touches tagged rows (and the demo
  plans, tagged the same way).
- `scripts/import-trades.py` is **deleted** (your call: trades are logged by hand). The
  cost features stay exactly as they are.
- README, JAK-URUCHOMIC.txt and the code map are updated.
- Walkthrough in the running app (brief §6, steps 1–6) with screenshots.

---

## Assumptions (the conservative reading where the brief is silent)

1. **Entry window:** 04:00 ≤ entry < 08:25, or 09:30 ≤ entry ≤ 11:00.
2. **Release window:** inclusive on both ends, T−5 min to T+60 min.
3. **Caution and Sit out:** taking a grade the check-in rules out today (an A on Caution,
   anything on Sit out) is flagged `non_traded_grade`, the same as a B or C, and triggers
   the consequences.
4. **Flags that need the day's context** (`no_plan`, `second_trade_today`,
   `during_day_off`…) apply only to trades graded under v1.2 or later, so editing an old
   trade never gives it a `no_plan` from a time before plans existed.
5. **The $100K line** is lots on a flat $100,000 × risk %; the desk doesn't track that
   account's balance.
6. **Weekly stop:** this ISO week's net loss (wins offset losses) plus open risk, like the
   daily one.
7. **Exit lab:** a smaller target counts as reached when MFE ≥ X. A bigger target than the
   trade's own counts only when "furthest favourable price until 12:00" was logged;
   otherwise that trade is left out as unknown, and n shows it. Breakeven at 1R: a losing
   trade whose MFE reached 1R scores 0R.
8. **MAE** is stored as a positive distance against you, in R.
9. **Desk check pre-fill:** the briefing leans toward whichever of bullish / range /
   bearish has the highest odds (range = Unclear); "agree" when that matches your bias.
10. **Held through a release:** a window-type red release with entry before it and exit
    later than 5 minutes before it.
11. **"Still open at 12:00"** is flagged when the trade is saved after 12:00 that day with no
    exit; live, the Coach and the 11:55 / 12:00 alerts cover it.
12. **US/UK holidays** are known only for the week the feed covers; further out, rule 4
    falls back to a manual tick.
13. **Rulebook versions 1.0 and 1.1** exist only as changelog rows; the desk never stored
    those documents, so 1.2 is the oldest version you can open.
14. **Box size** stays logged in `box_size` (high − low); the old "Units 0–300" range is gone.

---

## Decided

- **Initial stop blocks saving** on a taken trade graded under v1.2 or later ("Add the
  initial stop"). Older trades are exempt.
- **The OANDA importer is deleted**, not updated.
- Plan approved on 3 October 2026.

# Trading Desk refactor: one strategy, the rulebook built in

You are working on Gustaw's local trading journal, the "Trading Desk" (repo folder `trade-assistant`). Read this whole brief before touching any code. It covers:

0. How to work
1. Non-negotiables
2. Decisions already made
3. The complete rulebook the desk must contain and enforce (authoritative)
4. The implementation spec, area by area
5. Migration
6. Tests and verification
7. What "done" means

---

## 0. How to work

1. **Read the codebase first:** `README.md`, `JAK-URUCHOMIC.txt`, `src/lib/types.ts`, `server/schema.ts`, `server/migrate.ts`, `server/index.ts`, `src/App.tsx`, `src/components/TradeForm.tsx`, `SetupCheck.tsx`, `StrategiesView.tsx`, `StrategyForm.tsx`, `StrategyCompare.tsx`, `src/lib/grading.ts`, `risk.ts`, `limits.ts`, `newsRules.ts`, `coach.ts`, `insights.ts`, `checkin.ts`, `scripts/demo-data.ts`, and the `tests/` folder.
2. **Write a plan and wait for approval.** The plan lists the phases, the files to change, the files to delete, and new tables and columns. Show it to Gustaw and wait for "go" before deleting anything.
3. **Work phase by phase.** Commit after each phase with a clear message. `npm test` and `npm run build` must pass at the end of every phase.
4. **Snapshot the database first.** Before the first migration, copy it to `data/snapshot-before-rulebook-<HHMMSS>.db`, following the pattern of the existing snapshots.
5. **Never invent a trading rule.** If a rule below is ambiguous, ask Gustaw. If something is simply not specified, take the most conservative reading and list it in your final summary.
6. **No new dependencies** unless unavoidable. If you add one, say why.

---

## 1. Non-negotiables

- **Keep the visual identity exactly.** That means:
  - the design tokens in `src/index.css`
  - the components in `src/components/ui.tsx` (Card, Side, Segmented, Button, Modal, Tip and the rest)
  - Inter and JetBrains Mono, the glass header, the time-based CSS animations
  - the colour-blind-safe polarity marks
  - the copy tone: short, plain, second person

  Reuse existing components before writing new ones. New screens must look as if they were always there.
- **New York time everywhere.** The desk runs on NY time (`src/lib/tz.ts`). Every time in this brief is NY.
- **The journal is a record: saving is never blocked.** A broken rule is recorded as a flag, with an optional note, and triggers the consequences in §3.13. The one exception: the setup check must be fully answered before a trade can be saved, so every trade is graded.
- **Data safety.** Migrations are idempotent and additive. Data is moved aside, never deleted. The `legacy_*` tables stay untouched. Trades keep a frozen snapshot of the rules they were graded under.
- **Keep the code style.** Doc comments that explain why; pure functions in `src/lib`, each with tests; a thin server.
- **UI language is English.** The user name stays "Gustaw".

---

## 2. Decisions already made

1. **One strategy only.** The desk is built around the GOLD Model. There is no strategy picker, no list of strategies, and no "new" or "duplicate" strategy. Everything that assumed several strategies is simplified or removed (§4.11).
2. **One journal in %, exactly as today.** Gustaw types the result in USD from the $200K account. The server derives % and R against the compounding balance (`recomputeResults` in `server/index.ts`); keep that unchanged. He trades a $100K account with the same % risk, and the desk does not journal it separately.
3. **Live trades only.** Backtests stay in Forex Tester. There is no backtest mode; the backtesting protocol (§3.11) appears as rulebook text only.
4. **The rulebook lives inside the desk, editable anytime, versioned.** Every change needs a one-line reason and creates a new version. Each trade records the version it was graded under. There is no weekend lock.
5. **B and C setups are not tradable in the desk at all.** Only A+ and A can be traded. There is no paper-trade mode. The existing "skipped setup" log stays exactly as it is and never switches on automatically.
6. **Check-in verdicts:**
   - **Ready:** normal rules.
   - **Caution:** A+ only today; A is not tradable that day.
   - **Sit out:** nothing is tradable today.
7. **Spread and commission are already inside the $ result Gustaw types.** The desk never calculates fees, commission or spread, and has no settings for them.

---

## 3. The rulebook (authoritative content)

This is what the Rulebook tab shows and what the logic implements. Store it as structured data plus text, so it renders in the app's style.

**One source of truth.** Every number in the text must come from the definition the logic uses: risk %, windows, thresholds, the Compass table. Never type a number into the text twice.

### 3.1 How to use this rulebook

- Every rule is binding: a trade that fails any rule is not taken.
- All times are New York (NY) time.
- Where a rule needs judgment, it gets a measurable definition. Provisional numbers are marked as such and calibrated only with logged data.
- A rule break is a violation even when the trade made money.
- Rules can be edited anytime in the desk; every edit is versioned with a reason (§3.14).

### 3.2 Strategy overview

The GOLD Model trades XAUUSD. After price sweeps one side of the 03:00–04:00 NY box, you enter on a 5m external MSS and target the opposite side.

| Item | Rule |
| --- | --- |
| Instrument | XAUUSD spot gold (1 lot = 100 oz) |
| Box | CRT 3–4AM box: high and low of 03:00–04:00 NY, wicks included |
| Idea | One side gets swept (the Judas move), then price runs to the other side |
| Trigger | 5m MSS on external structure, back toward the box |
| Target | The opposite side of the box |
| Sessions | London and New York |
| Entry window | 04:00–08:25 and 09:30–11:00 |
| Positions closed by | 12:00, never overnight |
| Max trades | One per day |
| Planned R:R range | 1R to 4R |
| Invalidation | Price trades through the stop at the external swing |

**Decision flow.** Draw this as a visual at the top of the Rulebook tab, in the app's style.

Seven gates come first. Any "no" means no trade today.

1. Plan written by 04:00 NY?
2. An allowed day (not a skip day)?
3. One box side swept inside the entry window?
4. An HTF reason: a 1H to Weekly FVG, OB or VIMB?
5. A 5m candle closes beyond the external swing?
6. R:R above 1:1 net at the MSS close? If not, one FVG limit is allowed, filled within 3 candles.
7. Grade A or A+? All base rules hold, and the lowest factor cap decides.

If all seven pass:

- **Enter** at 0.5% risk, stop at the external swing, target at the opposite box edge.
- **Manage:** hands off until halfway, then trail behind the second-last 5m swing.
- **Exit** by target, stop, trailing stop, the 12:00 time stop or the release rule. Then you're done for the day.

### 3.3 Daily preparation (before 04:00 NY)

No written plan by 04:00 NY means no trading that day.

1. **Calendar:** is today a skip day, and which red releases fall inside the entry window?
2. **Level map:** PDH/PDL, PWH/PWL, the monthly, quarterly and yearly highs and lows, the ATH, and obvious EQH/EQL.
3. **HTF points of interest:** 1H, 4H, Daily and Weekly FVGs, OBs and VIMBs near current price.
4. **Daily bias:** Bullish, Bearish or Unclear. It comes from the Daily chart and the level map, i.e. where the next draw on liquidity sits. Gustaw forms most of it himself.
5. **Desk check:** the Daily Bias briefing may support or question the bias. It can veto a trade, but it can never create one or flip the bias.
6. **Compass:** today's weekday value for both directions, from the frozen snapshot (§3.8).
7. **Write the plan:** bias, key levels, release windows, Compass values, and anything that makes today a no-trade day.

### 3.4 Calendar and news rules

**Source:** Forex Factory, in NY time. Only red events trigger rules; orange is information only.

**Skip days (no trading at all):**

- US Non-Farm Payrolls day. Non-Farm Employment Change, Average Hourly Earnings and Unemployment Rate come out together.
- US CPI day
- FOMC rate-decision day
- ECB rate decision (Main Refinancing Rate)
- US and UK bank holidays
- 22 December to 2 January

**Release window.** This covers every other red USD release (for example ADP Non-Farm Employment Change, Unemployment Claims, GDP including Final GDP, PPI, Retail Sales, PCE), plus the BoE Official Bank Rate.

- No new entries from 5 minutes before to 60 minutes after the release.
- An open trade may be held through the release only if its stop is already at breakeven or better. Otherwise, close it 5 minutes before.

**Why the breakeven condition:** in the pilot backtest, 6 trades were open at 08:30 and 5 of them won (+$4,006). At least 4 had already moved their stops to breakeven or better, so the spike could only help them. Protection isn't perfect, though: on 9 March 2023 a breakeven stop filled $0.41 worse during the 08:30 spike.

**Not skipped:** German, French and Spanish holidays, and EUR or GBP data other than the ECB and BoE decisions. Gold's liquidity comes from London and New York, and it reacts mainly to USD data and US yields.

**Firm news rules:** check both firms' funded-account rules on trading around high-impact news (open item, §3.15).

### 3.5 Setup definition

A valid setup has five parts:

1. **Box:** the high and low of the 03:00–04:00 NY hour, wicks included. Box size is logged, not filtered.
2. **Sweep:** after 04:00, price trades beyond the box high or low; a wick is enough. High swept: look for shorts. Low swept: look for longs.
3. **HTF reason:** the sweep trades into, or reacts from, a 1H, 4H, Daily or Weekly FVG, OB or VIMB, preferably reacting inside it. Its timeframe affects the grade.
4. **Opposite side untaken:** if both box sides were taken before entry, there is no target left, so no trade.
5. **Entry window:** 04:00–08:25 and 09:30–11:00.
   - No entries from 08:25 to 09:30 on any day. In the pilot, entries in that window went 0 for 8 (5 decisions).
   - No entries after 11:00. Volatility fades, and Compass shows about 73% of moves finished by 08:00 and 95% by 12:00.

**Removed from the rules, now logged as tags:**

- **"Min 15M high or low sweep":** it wasn't used in the pilot or live. Log "sweep also took a 15m swing: yes/no".
- **"HTF reason tested no more than 2 times":** too hard to count consistently, and higher-timeframe levels can hold after several tests. Log "POI: fresh / tested once / tested 2+".
- **Sweep depth:** log the $ distance from the box edge to the sweep extreme. The Compass reference, still to verify: about 70% of sweeps stay within $11 of the edge, 85% within $18, 95% within $30.
- **Sweep of an important level as the HTF reason:** left out of v1 because it's unproven. Log it when it happens.

### 3.6 Entry rules

**MSS (market structure shift):** a 5m candle closes beyond the last external swing in the new direction: above the swing high for longs, below the swing low for shorts. A wick doesn't count, internal swings don't count, and BOS entries are not part of the model.

**Order type:**

1. Default: a market order at the close of the MSS candle.
2. If R:R at that price is below the minimum, you may place one limit order at the near edge of the displacement FVG. It stays valid for 3 closed 5m candles. Unfilled means no trade, no chasing. A long limit gets the spread added (§3.7).
3. Log the entry type (market or limit) on every trade.

**Minimum R:R:** above 1:1 net of fees, measured at the entry price. After 100 trades, compare the 1–1.5, 1.5–2 and 2+ buckets and set the minimum from the data.

R:R net = (reward $ − fees $) ÷ (risk $ + fees $). Example: reward $1,200, risk $600 and fees $24 give (1,200 − 24) ÷ (600 + 24) = 1.88.

**Liquidity filter (provisional):** no trade if obvious EQH/EQL or a key level sits within 0.3R beyond the stop, because it is likely to get swept.

### 3.7 Stop and target

**Stop:** exactly at the external swing the MSS came from. Longs: at the external swing low. Shorts: at the external swing high plus the spread. No other buffer.

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

**Target:**

- Default: the opposite box edge.
- Exception (provisional): if obvious EQH/EQL or a key level sits within 0.3R beyond the box edge, target it instead.

**No runners and no split positions.** Both were rare and discretionary. MFE data will show later whether runners would pay.

### 3.8 Grading and position size

Every base rule must hold, or the setup is a C. Then each grade factor caps the best grade possible, and the lowest cap wins.

**Base rules:**

1. HTF reason present.
2. 5m MSS on external structure after the sweep, by candle close.
3. R:R above 1:1 net of fees at the entry price.
4. Not a skip day, and not inside a release window.
5. Inside the entry window.
6. Opposite box side still untaken.
7. No obvious liquidity within 0.3R beyond the stop.
8. Daily loss budget available, and no trade taken yet today.
9. Written daily plan exists.

**Grade factors:**

| Factor | A+ | A | B | C (no trade) |
| --- | --- | --- | --- | --- |
| HTF reason timeframe | 4H, Daily or Weekly | 1H | | |
| Displacement multiple | 1.0× or more | 0.25–1.0× | Below 0.25× | |
| Displacement left an FVG | Yes | No | | |
| Daily bias | Matches | | Unclear | Against |
| Compass (weekday, direction) | 60% or more | | Below 60% | |
| Conviction | No doubts | Lacking something for A+ | Possible to take but unsure | I see it but I'm not sure |

**How the two displacement factors work.** The rulebook defines three grades of displacement:

- **Strong:** 1.0× or more, and an FVG left.
- **Normal:** 0.25–1.0×, or 1.0× and more without an FVG.
- **Weak:** below 0.25×.

The two factors above reproduce this exactly under the lowest-cap rule. Boundaries: exactly 0.25 counts as Normal, exactly 1.0 as Strong-eligible, and exactly 60% as no cap.

**Measuring displacement (provisional, calibrate after 60 trades):**

- Measure how far the MSS candle closes beyond the broken external swing, in $ (the price difference, not pips).
- Divide it by the 5m ATR(14) shown on the MSS candle. ATR is the size of a normal 5m candle right now; always read it at that candle.
- Example: swing high 2,000.00 and ATR $1.20. A close at 2,001.20 is 1.0×, so Strong if an FVG was left. A close at 2,000.20 is 0.17×, so Weak.
- Trade-off: a huge candle that only just closes beyond the swing counts as Weak. That matches the "barely broke the swing" idea; the 60-trade review will show whether it holds.

**Compass snapshot (frozen 2 October 2026, refreshed quarterly).** The chance the opposite box side is reached by 17:00 NY, by weekday. Source: XPREAY Compass Max, 03:00–04:00 box, about 990 sessions.

| Weekday | Short (high swept first) | Long (low swept first) |
| --- | --- | --- |
| Monday | 53.8%: max B | 56.2%: max B |
| Tuesday | 60.6% | 62.4% |
| Wednesday | 68.1% | 77.9% |
| Thursday | 60.0% | 69.7% |
| Friday | 64.7% | 67.0% |

- All days: short 61.4% (283 of 461), long 66.7% (352 of 528). The box midpoint gets reached about 80% of the time.
- One coarse threshold is used because each weekday cell holds only about 90–105 sessions, so its true value is uncertain by roughly ±10 points.
- These values include data after 2023, so grading 2023 backtest trades with them is look-ahead bias. It is accepted only because the rule is coarse.

**Grade ladder.** Risk is a percent of the current balance:

| Grade | Live | Backtest (Forex Tester) |
| --- | --- | --- |
| A+ | 0.5% | 0.5% |
| A | 0.5% | 0.5% |
| B | Not tradable | 0.25% |
| C | Not tradable | No trade |

- **A+ returns to 1%** only after 50+ graded trades show A+ beats A by at least 0.3R per trade. In the pilot, 1% trades averaged −0.48R and 0.5% trades −0.22R.
- **B stays not tradable in the desk.** The Forex Tester backtest still takes B at 0.25%, so its results can show whether that should ever change.
- Risk on the current balance shrinks your size automatically during a drawdown.

### 3.9 Trade management

1. No stop moves before price reaches 50% of the distance from entry to target.
2. After that, each new 5m swing in your favour moves the stop behind the second-most-recent swing. This is the 2-swing buffer: the nearest swing may get swept, but the second holds unless the trend breaks.
3. The stop only ever moves toward profit, never back.
4. Exits are allowed only by the stop, the target, the trailing stop, the 12:00 time stop, or the release rule.
5. Not allowed: closing on a "strong reversal", on intuition, or out of impatience before 12:00.

Why: discretionary exits can't be tested. In the pilot, 10 manual exits netted −$271 and made the results impossible to reproduce.

### 3.10 Risk limits and challenge plan

**Limits:**

- **One trade per day.** Win, lose or breakeven, you're done. One box means one thesis per day; in the pilot, re-entries after a loss went 0 for 3 (−$2,486). Several positions opened at once count as one trade, and v1 uses one position.
- **Daily loss stop: 1%.** With one trade at 0.5%, this is a backstop against slippage.
- **Weekly stop: −2%** (four losses at 0.5%). Stop trading for the rest of the week and review the journal.
- **Never hold overnight.**

**Firm rules (both accounts):**

- Two-step challenge: Phase 1 target 10%, Phase 2 target 5%. Max daily loss 5%, max loss 10%.
- Accounts: FTMO $200K and a $100K account, with the same rules and the same risk.
- The $200K account's opening balance for the journal is $193,933.27: −$6,066.73, or −3.03%. That leaves $13,933.27 (6.97%) above the $180,000 max-loss floor, and Phase 1 needs +$26,066.73 (+13.03%) to reach $220,000.

**Go-live gate (recommended; decision pending, see open items).** Resume live challenge trading only after the Forex Tester backtest shows positive net expectancy over 100+ trades.

Why: with zero edge, the chance of reaching +13.03% before −6.97% is 6.97 ÷ (13.03 + 6.97) ≈ 35%, at any risk size. Phase 2 is 10 ÷ (5 + 10) ≈ 67%, so a zero-edge strategy passes both phases only about 23% of the time. Only a real edge raises that.

### 3.11 Backtesting protocol (done in Forex Tester; text only in the desk)

**Setup:**

- **Data:** months not used before, e.g. April–December 2023, then 2024. The pilot (9 January–27 March 2023) is exploratory only: it generated the ideas, so it can't confirm them.
- **Frozen rules:** new ideas go on the hypothesis list, never into a running test.
- **Bar by bar, future hidden,** to avoid hindsight bias.
- **Settings:** spread modelled, commission as the firm charges it (the pilot used $12 per lot round turn), all times in NY.
- **Inputs:** bias from the chart only, Compass from the frozen snapshot, B trades at 0.25%.

**Evaluate:**

- Net expectancy per trade in R, after costs. It must be clearly above zero.
- Win rate against the breakeven win rate for the average R:R.
- Longest losing streak and maximum drawdown.
- Rule adherence (target 100%).
- Results split by grade, R:R bucket, weekday, direction, entry type and every tag.

Expectancy E = (win% × average win in R) − (loss% × average loss in R).

Pilot reference: 33 positions (28 decisions), 33% win rate, net −$896 (−0.9%), profit factor 0.92, $665 in commission.

### 3.12 Journal fields

| Group | Fields |
| --- | --- |
| When | Date, weekday, NY entry and exit time, red release that day |
| Setup | Direction, box high, low and size, sweep depth ($ beyond the box edge), took a 15m swing (yes/no), HTF reason type and timeframe, POI fresh / tested once / tested 2+, important-level sweep (yes/no) |
| Grade | Answer to every grade factor, Compass value, final grade, desk agreed (yes/no) |
| Entry | Entry type (market/limit), entry price, initial stop, target, planned R:R, lots, risk $, ATR(14), MSS close beyond the swing ($) and the displacement multiple |
| Exit | Exit reason (target, stop, trail, time stop, release rule), exit price, result in $ (already includes spread and commission) and R |
| Excursions | MFE (R), MAE (R); for early exits, whether the target would have been hit before the stop by 12:00 |
| Discipline | Rule violations (which), screenshots before and after |

Always log the initial stop. The pilot export kept only the final stop, so 8 of 28 decisions couldn't be measured.

**MFE and MAE.** MFE (maximum favourable excursion) is how far price went in your favour between entry and exit, in R. MAE (maximum adverse excursion) is how far it went against you.

Example (long): entry 2,000 and stop 1,996, so 1R = $4. Price reaches 2,006 before the stop is hit, so MFE = 1.5R.

They let you test exit rules on trades already taken:

- If many stopped-out trades reached +1R first, a 1R target or breakeven at 1R would have saved them.
- If winners regularly reached 3R, a bigger target pays.
- If winners often came within 0.1R of the stop (MAE), the stop is too tight.

### 3.13 Discipline and enforcement (as the desk implements it)

- **Graded before saved.** The setup check must be completed before a trade can be saved, and the desk calculates the lot size.
- **Done for today.** After the day's trade closes, the desk shows "done for today".
- **No plan, no trade.** No written plan by 04:00 NY means no trading that day.
- **Consequences:**
  - Any rule break: the rest of the day off, logged as a violation even if the trade made money.
  - Two breaks in one week: the next week at half risk.
  - Breaking the one-trade rule or a loss limit: two trading days off.
- **Adherence KPI:** rule adherence %, reviewed weekly next to P&L. Target 100%.

### 3.14 Rule changes and hypotheses

Rules can change anytime in the desk. Every change gets a version, a date and a one-line reason, shown in the changelog.

Guidance (shown while editing, never blocking):

- Changes that reduce risk need no evidence.
- Changes that add risk or loosen a filter need 50+ trades of evidence from data that did not create the idea.
- The Compass snapshot is refreshed quarterly.
- Provisional numbers (the displacement multiples, the 0.3R liquidity distance, the 1:1 minimum R:R) are reviewed after 60–100 logged trades.

**Hypotheses (logged, not rules yet):**

| Hypothesis | Logged as | Decide after |
| --- | --- | --- |
| Deep sweeps (beyond about $18) are breakouts, not sweeps | Sweep depth ($) | ~60 trades |
| Sweeping a 15m swing improves results | 15m swing yes/no | ~60 trades |
| Fresh POIs beat retested ones | POI tests | ~60 trades |
| Holding through releases at breakeven pays | Release + exit reason | ~20 cases |
| A higher minimum R:R improves expectancy | Planned R:R | 100 trades |
| Limit entries beat market entries | Entry type | ~30 limit trades |
| Runners or a different target pay | MFE | 100 trades |
| Shorts underperform longs (pilot: 1 win in 8 shorts) | Direction | 100 trades |
| The desk improves live results | Desk agreed | ~50 live trades |
| A+ beats A by 0.3R or more | Grade | 50 graded trades |
| B setups have positive expectancy | Forex Tester backtest (outside the desk) | 50 B trades |

### 3.15 Open items (a tickable checklist in the desk)

- [ ] Compass Judas range: confirm it's measured from the box edge. Measure 10–15 past days by hand, from the box edge to the furthest point beyond it before 23:00. If about 7 in 10 are under $11, the reading holds.
- [ ] Both firms: is there a time limit or an inactivity rule?
- [ ] Both firms: news-trading rules on funded accounts.
- [ ] The firm's real commission and the typical XAUUSD spread between 04:00 and 12:00 NY, for the Forex Tester settings.
- [ ] Decide the go-live gate (§3.10).

### 3.16 Glossary

Show this as a table, and also use it for hover tips (the existing Tip pattern) wherever the terms appear in the setup check and the trade form.

| Term | Meaning |
| --- | --- |
| CRT box | High and low of the 03:00–04:00 NY hour |
| Sweep / Judas move | Price trades beyond one side of the box, taking resting stops, before reversing |
| External structure | The major swings that define the leg into the sweep; internal swings are the minor pullbacks inside it |
| MSS | Market structure shift: a candle closes beyond the last external swing in the new direction |
| BOS | Break of structure in the existing direction; not used in this model |
| Displacement | How far the MSS candle closes beyond the broken swing, measured in 5m ATRs |
| FVG | Fair value gap: three candles where the first and third candles' wicks don't overlap |
| OB | Order block: the last opposite-coloured candle before a displacement |
| VIMB | Volume imbalance: a gap between two consecutive candle bodies whose wicks overlap |
| POI | Point of interest: an HTF FVG, OB or VIMB |
| EQH / EQL | Equal highs / lows: obvious resting liquidity |
| PDH/PDL, PWH/PWL | Previous day's and previous week's high and low |
| ATR(14) | Average True Range: the size of a normal candle right now (average of the last 14, gaps included) |
| Bid / ask / spread | Sell price / buy price / the difference; charts show the bid |
| R | Planned risk on a trade: entry to stop, in $ |
| R:R net | (Reward − fees) ÷ (risk + fees) |
| Expectancy | Average result per trade, in R |
| MFE / MAE | How far a trade went in your favour / against you before the exit, in R |
| Look-ahead bias | Using information in a backtest that didn't exist at the time |
| Hindsight bias | Letting bars you've already seen influence a backtest decision |

### 3.17 Changelog (newest first)

| Version | Date | Change |
| --- | --- | --- |
| 1.2 | (migration date) | Rulebook moved into the desk: single strategy, edits anytime with versioning, enforcement by flags and consequences |
| 1.1 | 3 October 2026 | Removed the DST-mismatch tag; displacement measured as the MSS close beyond the broken swing, in 5m ATRs |
| 1.0 | 2 October 2026 | First rulebook, built from the pilot backtest (January–March 2023) and the strategy review |

---

## 4. Implementation spec

### 4.1 One strategy

- Remove step 1 of the trade form (the strategy picker). "New trade" opens straight at the setup check.
- Replace the Strategies tab with a **Rulebook** tab (§4.2). Tab order: Journal, Daily Bias, Calendar, Rulebook, Stats, News, Risk lab, Coach.
- Storage is your choice: keep the single strategies row as the definition, or add a dedicated rulebook table. Either way, nothing in the UI or the public types may expose "strategies", and a trade never asks for a strategy.
- Remove the strategy dimension from filters, Compare, Insights, the Risk lab and the Coach. Wording like "In GOLD Model, …" becomes plain.

### 4.2 Rulebook tab

- **Rendering.** It renders all of §3 in the app's style: section navigation, the decision-flow visual at the top, tables in the existing styles, and values read live from the definition.
- **Editing.** Each section has an edit mode: rules, factors, ladder, windows, news rules, limits and settings, the Compass snapshot, and the text. Reuse the editors in `StrategyForm.tsx` (base rules, choice and number factors with cuts, the grade ladder) rather than rebuilding them.
- **Versioning.**
  - Saving asks for a one-line reason, creates a new version (1.2 → 1.3; Gustaw may choose a major bump for big changes) and adds a changelog row, newest first.
  - The §3.14 guidance shows while editing.
  - Any change to a rule value anywhere in the app (the RiskChip, the News rules editor) goes through the same versioning.
  - Trades store `rulebookVersion` next to the existing frozen `setupSnapshot`. Old versions can be viewed read-only.
- **Hypotheses panel.** One row per §3.14 hypothesis, showing:
  - the live sample size and progress toward "decide after"
  - the result split: expectancy in R and n per side, faded when small (reuse the shrinkage and minimum-group rules in `insights.ts`)
  - a status: collecting, or ready to decide
- **Open items:** the §3.15 checklist, stored in the database and tickable.
- **Glossary:** the §3.16 table, which also feeds the hover tips.

### 4.3 Setup check (grading)

**Base rules.** Automatic where the desk can know, manual otherwise. An automatic rule shows its computed state; when the data to compute it is missing, it falls back to a manual tick.

| # | Rule | How it is answered |
| --- | --- | --- |
| 1 | HTF reason present | Manual |
| 2 | 5m external MSS, by candle close | Manual |
| 3 | R:R above 1:1 net | Manual tick ("including fees"); the desk shows the gross R:R from entry, stop and target as a guide |
| 4 | Not a skip day, not in a release window | Auto from the calendar and news rules at the entry time; manual when the day is outside the feed (use the trade's stored news if present) |
| 5 | Inside the entry window | Auto from the entry time |
| 6 | Opposite side untaken | Manual |
| 7 | No liquidity within 0.3R beyond the stop | Manual |
| 8 | Daily budget available, no trade taken today | Auto (extend the existing `daily-budget` auto rule) |
| 9 | Written daily plan exists (by 04:00) | Auto from the plans (§4.6) |

**Factors (§3.8):**

- **HTF timeframe:** choice.
- **Displacement multiple:** a number factor whose answer is computed from two inputs in the setup check, "MSS close beyond the swing ($)" and "ATR(14) 5m ($)". Show the multiple and store both raw inputs on the trade. Cuts at 0.25 and 1.0 (an exact value goes to the upper range); caps B, A, A+.
- **Displacement left an FVG:** choice; Yes caps at A+, No at A.
- **Daily bias:** choice, pre-selected from today's plan against the trade direction and still editable:
  - Bullish + long, or Bearish + short = Matches
  - Unclear = Unclear
  - the opposite = Against
- **Compass:** a number factor in %, one cut at 60 (exactly 60 = no cap), caps B and A+.
  - Auto-filled from the frozen snapshot using the trade's weekday and direction.
  - Read-only in the form; changing it means editing the snapshot, which creates a new version.
  - Weekend dates fall back to manual.
- **Conviction:** choice, with the four options from §3.8.

**Grade panel.** It stays: caps, what the next grade needs, allowed risk. Allowed risk = min(grade risk, remaining daily budget, remaining weekly budget, max per trade) × the consequence multiplier (§4.5). It is 0 on a day off.

**B and C are not tradable.**

- A B or C grade shows "Not tradable — don't take it" in the grade panel, with allowed risk 0 and one line naming the caps.
- The journal is still a record: if a B or C was taken anyway, it can be saved, flagged `non_traded_grade`, and it triggers the consequences.

**Check-in limits.** The verdict also limits what is tradable, and the grade panel shows it:

- **Caution:** only A+ is tradable today; an A shows as not tradable.
- **Sit out:** nothing is tradable today.

### 4.4 Trade form: fields and calculations

**Keep:**

- date and time (NY) and direction
- session, auto-filled from the time (`sessionOf` in `src/lib/chart.ts`) and still editable
- the result in $ (P&L → % and R exactly as today)
- followed plan, state of mind, mistakes, notes, screenshot links
- the day's news (auto)
- the side panels: Coach, News, This week, a Rulebook summary, Notes

**Add**, grouped into the existing Card layout (The trade / Setup / Entry / Exit / Review):

- **Setup:**
  - box high and box low (size derived, keep `box_size`)
  - sweep depth in $ (derived from the box edge and a sweep-extreme price, or typed)
  - took a 15m swing (yes/no)
  - HTF reason type (FVG/OB/VIMB); its timeframe comes from the factor
  - POI fresh / tested once / tested 2+
  - important-level sweep (yes/no)
  - desk agreed (yes / no / no briefing), pre-filled from the plan
- **Entry:**
  - entry type (market/limit), entry price, initial stop (required on a taken trade), target, lots
  - planned R:R: auto from entry, stop and target, replacing the typed planned R:R when prices exist
  - risk in $: balance × risk %
  - **Lot size helper:** lots = risk $ ÷ (|entry − stop| × 100) for the $200K journal account, with the $100K equivalent on a muted line.
- **Spread reminder:** on shorts, one quiet line under the stop and target: "Add the spread on the platform (§3.7)". No spread setting, no calculation.
- **Exit:**
  - exit time, exit price
  - exit reason: target, stop, trailing stop, time stop (12:00), release rule, or other
  - "stop moved before 50%?" (yes/no)
  - when a red release fell between entry and exit: "stop at breakeven or better through it?" (yes/no)
  - MFE price and MAE price, converted to MFE R and MAE R from the initial stop
  - for early exits (time stop, release rule, trailing stop): "target hit before the stop by 12:00?" (yes / no / unknown)
  - optional, for target exits: "furthest favourable price until 12:00", which lets the exit lab test bigger targets

**Remove:** the expected-minutes field; the release rule replaces it.

**No cost settings.** Spread and commission are already inside the $ result, so the desk has no fee, commission or spread fields or settings. Keep the existing cost features exactly as they are.

### 4.5 Risk engine and consequences (`src/lib/risk.ts`, `src/lib/limits.ts`)

**Limits and defaults:**

| Setting | Default |
| --- | --- |
| Max risk per trade | 0.5% |
| Daily stop | 1% |
| Weekly stop (new) | 2%, per ISO week Mon–Fri on NY days |
| Firm daily loss | 5% |
| Firm max loss | 10% |
| Start balance | 200,000 |
| Opening balance (new) | 193,933.27: the $200K account's balance when the journal starts |

Compounding starts at the opening balance. The firm lines are measured against the start balance, as FTMO states them. The week budget mirrors `dayBudget`: this week's loss plus open risk.

**Flags.** Extend `TradeFlag` and `FLAG_LABEL`. All are recorded and none block saving.

- Existing: `over_risk`, `non_traded_grade`, `after_daily_stop`.
- New:

| Flag | Raised when |
| --- | --- |
| `after_weekly_stop` | Taken after the weekly stop was hit |
| `second_trade_today` | A second taken trade on the same NY day |
| `outside_entry_window` | Entered outside 04:00–08:25 and 09:30–11:00 |
| `skip_day` | Taken on a skip day |
| `in_release_window` | Entered inside a release window |
| `held_risk_through_release` | Held through a red release without the stop at breakeven or better |
| `past_time_stop` | Exited after 12:00, or still open at 12:00 |
| `discretionary_exit` | Exit reason "other" |
| `early_stop_move` | Stop moved before price covered 50% of the distance to target |
| `no_plan` | No daily plan written by 04:00 that day |
| `during_day_off` | Taken while a consequence said day off, or above the halved risk |

**Consequence ladder.** Derived from history and recomputed on every change, so editing a trade updates it:

- Any flagged taken trade → the rest of that NY day off.
- Two or more flagged taken trades in an ISO week → the next ISO week at half risk (allowed risk × 0.5).
- `second_trade_today`, `after_daily_stop` or `after_weekly_stop` → the next two NY trading days off. Weekdays only; skip days count as days.

Show the current state in the RiskChip and as a banner on every tab: "Done for today", "Day off — rule break today", "Half-risk week", "Days off until …", "Weekly stop hit".

Skipped setups (the existing log) never count toward the budgets, the one-trade rule or the consequences.

### 4.6 Morning check-in and daily plan

Extend the full-screen check-in. After the readiness questions comes a **Plan** step, in the same visual language:

- **Today's status (auto):** skip day or not, with the reason; the red releases and their windows; the entry window; any active consequences.
- **Bias:** Bullish / Bearish / Unclear.
- **Level map:** short fields or chips for PDH/PDL, PWH/PWL, monthly, quarterly, yearly, ATH, EQH/EQL.
- **HTF POIs:** text.
- **Compass today:** both directions, from the snapshot (auto).
- **Desk check:** the Daily Bias briefing's lean against his bias (agree / disagree / no briefing yet); editable later.
- **Notes.**

Store plans in a new `plans` table (date as primary key, `created_at`, `updated_at`).

- "Written on time" means created before 04:00 NY that day; later edits keep the original time.
- A missing or late plan shows the banner "No plan, no trade today", and any trade that day gets `no_plan`.

**Weekly note.** The first check-in of an ISO week also asks for the weekly note: bias, reasoning, levels. The weeks API already exists but has no editor; add one here, in the Calendar week row, and in the trade form's "This week" panel.

### 4.7 News rules and alerts

Replace the "forbidden categories × block currencies" model with the §3.4 model, still editable and versioned:

- **Skip-day rules:**
  - (category, currency) pairs: (nfp, USD), (cpi, USD), (rates, USD), (rates, EUR)
  - holiday currencies: USD and GBP
  - fixed date range: 22 December to 2 January
- **Window rules:** every other red USD event, plus (rates, GBP). The window runs from 5 minutes before to 60 minutes after.
- **Everything else** is information only.

**Categories.** Split today's `cpi` into `cpi` (CPI only) and `ppi-pce` (PPI, PCE, HICP). Keep the first-match ordering so ADP stays `adp` (not `nfp`) and Unemployment Claims stays `claims`.

**Calendar view.** Mark skip days and release windows clearly; keep the volatility windows and the session strip.

**Alerts.** Keep the existing cooldown and the visual ring.

- Window events chime at T−5 minutes ("close unless the stop is at breakeven") and at the release.
- Skip-day events get a morning notice instead.
- Time-stop alerts at 11:55 and 12:00 if a taken trade is still open.
- Quiet notices at 08:25 (entries paused until 09:30) and at 11:00 (last entry).

**Coverage.** The Forex Factory feed only covers this week. Trades already keep their own copy of that day's news, and base rule 4 falls back to manual when there is no data.

### 4.8 Daily Bias tab

Keep everything. Add the desk's own rule-based "Stand aside today" panel next to the briefing's list: skip day, release windows, entry window, consequences. This way the rules don't depend on the routine's wording.

In your final summary, write a short paragraph Gustaw can paste into the cloud routine prompt on claude.ai, so its stand-aside list matches: a 5m MSS (not M15), entries 04:00–08:25 and 09:30–11:00, and the skip days and release windows from §3.4.

### 4.9 Stats, Compare, Insights, Coach, Risk lab, Calendar, Journal

- **Stats strip:** add rule adherence % for this week.
- **Stats → Compare** (single strategy). Group results by:
  - grade
  - each factor answer or range
  - each new field: entry type, exit reason, 15m swing, POI tests, important-level sweep, desk agreed, release day, held through release
  - weekday, direction, session
  - sweep depth buckets: under $11, $11–18, $18–30, over $30
  - planned R:R net buckets: 1–1.5, 1.5–2, 2+
  - displacement multiple buckets: under 0.25, 0.25–1, 1 or more
- **Insights:** add the new fields as factors; drop Strategy and the legacy Entry × HTF crosses.
- **Coach:** single-strategy wording. New cards:
  - an active consequence, the weekly stop status, a missing or late plan, done for today
  - an open trade near 12:00, a red release coming with an open trade not at breakeven
  - the rule adherence trend
  - a Compass snapshot older than 90 days
  - A+ → 1% eligibility (§3.8)
  - hypotheses ready to decide

  Remove cards that no longer apply, including any card about B results (B is not tradable).
- **Risk lab:**
  - Replay by rules uses the new caps and the daily and weekly stops.
  - Remove "What if I stopped taking B?" (B is never tradable).
  - Keep: only A+ (A+ vs A), recent vs whole history, the cost of rule breaks, London vs NY.
  - New "Exit lab" question, "Which target would have paid best?":
    - Replay 1R, 1.5R, 2R and 3R targets, and breakeven at 1R, over taken trades with MFE logged.
    - A trade reaches X R if its MFE ≥ X (MFE is recorded before the exit).
    - Show n, label it approximate, and require at least 30 trades with MFE.
- **Calendar:** each day shows the result, the plan status (on time / late / missing), flags, day-off and skip-day markers, and the check-in. More than one taken trade on a day shows as a violation.
- **Journal list:** shows the exit reason, flags and the rulebook version; skipped setups keep their existing styling.

### 4.10 Backup, demo data, importer

- **Backup** exports everything: trades, check-ins, plans, weeks, rulebook versions, limits and settings, news rules, open items.
- **Demo data:**
  - Before migrating, remove the existing demo rows (trade notes starting with "[demo]", check-ins whose note is "[demo]") using the existing logic. Keep the 3 real check-ins.
  - Rewrite `scripts/demo-data.ts` for the new rulebook (new fields, A+ and A trades only, a few flagged violations) so the Coach and the Risk lab can still be tried. `demo:remove` must still remove only tagged rows.
- **Importer:** keep `scripts/import-trades.py` working, and map what the OANDA export provides into the new fields: entry price, initial stop from the order history, lots, commission/fees, close reason.

### 4.11 Removals

After the plan is approved, delete or simplify:

- the strategy picker step, the strategy list and cards, new/duplicate strategy, the `strategyTemplate.ts` helpers that only served several strategies, and strategy filters and dimensions
- the old GOLD Model definition:
  - the base rules "HTF tested ≤2 times", "5M BOS or MSS", "Min 15M sweep", "No red news during the expected trade duration" and "≤2 positions today"
  - the "Entry model" factor (with its BOS option), the four-tier Compass and the "Displacement" choice factor
  - A+ at 1%, B traded live, the box "Units 0–300" range, and the invalidation "5m MSS in the opposite direction"
- the expected-minutes field, and the old news-rules model with its UI
- the legacy `htf`, `entryModel` and `setup` fields from the forms (the database columns stay)
- any copy that refers to "strategies" in the plural

---

## 5. Migration

- Snapshot the database first (§0).
- Use idempotent steps guarded by a meta key, like the existing `seed:gold-model:v1`. In order:
  1. Remove the demo rows.
  2. Write rulebook v1.2: definition, text, news rules, limits and settings, the Compass snapshot, and the changelog entries 1.0, 1.1 and 1.2.
  3. Add the new trade columns.
  4. Create the plans, rulebook-versions and open-items tables.
  5. Set the §4.5 limit defaults, including the opening balance of 193,933.27, but only where a value is still at its old default. Never overwrite a value Gustaw changed.
- Update the migration tests.

---

## 6. Tests and verification

- Keep all existing tests passing; update the ones tied to multiple strategies.
- Add unit tests for:
  - grading with the new definition, including the two-factor displacement equivalence and the 0.25 / 1.0 / 60 boundaries
  - the Compass lookup by weekday and direction
  - planned R:R from prices, and the lot size
  - the entry window, including the 08:25, 09:30 and 11:00 edges
  - news stance: skip, window, holiday, the date range; ADP → window, BoE → window, ECB → skip, a German holiday → none
  - the weekly budget and the consequence ladder
  - plan on-time detection
  - versioning: a trade keeps its version after the rulebook is edited
  - migration idempotency
- `npm test` and `npm run build` finish clean.
- Run the app and walk through it:
  1. Check-in, then the plan.
  2. A new A trade: auto rules, planned R:R, lot size.
  3. A B setup shows as not tradable; saving it anyway flags `non_traded_grade`.
  4. A second trade on the same day gets flagged, and the consequences show.
  5. Edit a rule with a reason: the version bumps and the changelog updates.
  6. Backup contains everything.

---

## 7. Done means

- No "strategy" concept is left in the UI.
- The Rulebook tab contains the whole rulebook (§3) with live values, versioning, the changelog, hypotheses, open items and the glossary.
- Every §3 rule the desk can check is checked automatically, flagged when broken, and feeds the consequences. Everything else is asked in the setup check.
- The visual identity is unchanged, and all tests and the build pass.
- Your final summary covers what changed, what was removed, any assumptions you made, and the Daily Bias routine paragraph (§4.8).

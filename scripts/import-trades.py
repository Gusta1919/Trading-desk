"""
Adds trades to the journal from an OANDA export. One account, one file, one command.

    python3 scripts/import-trades.py              # look in ~/Downloads, add what's new
    python3 scripts/import-trades.py --dry        # show what it would add, change nothing
    python3 scripts/import-trades.py --dir ~/x    # look somewhere else

Export from OANDA with "export all" — it writes several CSVs at once. Two of them matter:

    oanda-historia-zlecen-wszystko-*.csv   every order, with the stop-loss and commission
    oanda-close-trades-*.csv               realised profit, swap and why each trade closed

Both accounts export at the same time, so the files arrive in batches a few seconds
apart. This picks the batch belonging to the 100k account by its balance.

Trades already in the journal are skipped, so running it after every export only adds
the new ones and never disturbs tags you added by hand.
"""

import argparse
import csv
import glob
import os
import re
import sqlite3
import sys
import uuid
from datetime import datetime, timezone

DB = os.path.join(os.path.dirname(__file__), "..", "data", "trade-assistant.db")

# Contract size per lot, each verified against the realised profit in the close file.
MULTIPLIER = {"XAUUSD": 100, "XAGUSD": 5000, "BTCUSD": 1}

BUY = "Kupno"
FILLED = "Zamknięte"
STAMP = re.compile(r"(\d{4}-\d{2}-\d{2})T(\d{2})_(\d{2})_(\d{2})\.(\d+)Z")


# ── Reading the export ──────────────────────────────────────────────────


def num(s):
    s = (s or "").strip()
    return float(s) if s else None


def batches(folder):
    """OANDA writes one file per report; a single 'export all' lands within a second or two."""
    stamped = []
    for path in glob.glob(os.path.join(folder, "oanda-*.csv")):
        m = STAMP.search(os.path.basename(path))
        if m:
            when = datetime.strptime(
                f"{m[1]} {m[2]}:{m[3]}:{m[4]}.{m[5]}", "%Y-%m-%d %H:%M:%S.%f"
            )
            stamped.append((when, path))
    stamped.sort()

    out = []
    for when, path in stamped:
        if out and (when - out[-1][-1][0]).total_seconds() <= 2.0:
            out[-1].append((when, path))
        else:
            out.append([(when, path)])
    return out


def pick(folder, target):
    """The most recent export batch whose account balance is nearest the account we journal."""
    best = None
    for group in batches(folder):
        files = {}
        for when, path in group:
            name = os.path.basename(path)
            for kind in ("account-summary", "historia-zlecen-wszystko", "close-trades"):
                if kind in name:
                    files[kind] = path
        if len(files) < 3:
            continue

        with open(files["account-summary"], encoding="utf-8-sig") as fh:
            balance = float(next(csv.DictReader(fh))["Balance"])

        when = max(w for w, _ in group)
        key = (abs(balance - target), when)
        if best is None or key < best[0]:
            best = (key, files, balance, when)

    if best is None:
        sys.exit(
            f"No complete OANDA export found in {folder}.\n"
            "Expected an account-summary, a historia-zlecen-wszystko and a close-trades CSV."
        )
    _, files, balance, when = best
    return files, balance, when


def read_orders(path):
    """Filled orders, oldest first. Times are local (Europe/Warsaw); cancelled orders are dropped."""
    out = []
    with open(path, encoding="utf-8-sig") as fh:
        for r in csv.DictReader(fh):
            if r["Status"] != FILLED:
                continue
            out.append(
                {
                    "symbol": r["Symbol"],
                    "side": r["Strona"],
                    "qty": float(r["Liczba zrealizowanych"]),
                    "price": float(r["Średnia cena otwarcia transakcji"]),
                    "sl": num(r["Stop Loss Price"]),
                    "tp": num(r["Take Profit Price"]),
                    "commission": num(r["Commission"]) or 0.0,
                    "time": datetime.strptime(r["Aktualizuj datę/czas"], "%Y-%m-%d %H:%M:%S"),
                }
            )
    out.sort(key=lambda o: o["time"])
    return out


def read_closes(path):
    with open(path, encoding="utf-8-sig") as fh:
        return [
            {
                "symbol": r["Symbol"],
                "dir": "long" if r["Side"] == "buy" else "short",
                "qty": float(r["Quantity"]),
                "price": float(r["Price"]),
                "profit": float(r["Profit"]),
                "financing": float(r["Financing"]) if r["Financing"].strip() else 0.0,
                "reason": r["Reason"],
            }
            for r in csv.DictReader(fh)
        ]


# ── Turning orders into trades ──────────────────────────────────────────


def round_trips(orders):
    """
    An order carrying a stop or a target opens a position; one carrying neither closes
    it. Each close is matched to the open of the same symbol, same size, opposite side.
    OANDA closes a named ticket, so matching on size is right where FIFO would wrongly
    split one lot across two entries.
    """
    opens = [o for o in orders if o["sl"] is not None or o["tp"] is not None]
    closes = [o for o in orders if o["sl"] is None and o["tp"] is None]

    used, trips, orphans = set(), [], []
    for c in closes:
        found = next(
            (
                i
                for i, o in enumerate(opens)
                if i not in used
                and o["symbol"] == c["symbol"]
                and o["side"] != c["side"]
                and abs(o["qty"] - c["qty"]) < 1e-9
                and o["time"] <= c["time"]
            ),
            None,
        )
        if found is None:
            orphans.append(c)
            continue
        used.add(found)
        o = opens[found]
        trips.append({**o, "exit": c["price"], "closed": c["time"],
                      "commission": o["commission"] + c["commission"]})

    return trips, orphans, [o for i, o in enumerate(opens) if i not in used]


def collapse_to_days(rows, start_balance, risk_pct):
    """
    One row per trading day, carrying that day's net result.

    Days are grouped by CLOSE date, because that is the day the prop firm books the
    money — so the journal's daily figures line up with the firm's calculator. The
    day's return is expressed against one intended risk, so R reads as "how many
    times my normal risk did this day make or lose".
    """
    days = {}
    for r in rows:
        days.setdefault(r["_closed"].date(), []).append(r)

    out = []
    for day, group in sorted(days.items()):
        net = sum(r["_net"] for r in group)
        pct = net / start_balance * 100
        cost = sum(r["cost_pct"] for r in group)

        # Time of day comes from the first entry made ON this day. A position carried
        # over from the day before would otherwise stamp it with yesterday's clock.
        same_day = [r["date"] for r in group if r["date"][:10] == f"{day:%Y-%m-%d}"]
        opened = min(same_day) if same_day else f"{day:%Y-%m-%d}T09:00"

        symbols = sorted({r["_symbol"] for r in group})
        main = max(symbols, key=lambda sym: sum(1 for r in group if r["_symbol"] == sym))
        longs = sum(1 for r in group if r["direction"] == "long")

        out.append(
            {
                # Dated at the day's first entry, so session and time-of-day stay meaningful.
                "date": f"{day:%Y-%m-%d}T{opened[11:16]}",
                "symbol": main,
                "direction": "long" if longs * 2 >= len(group) else "short",
                "session": session_of(int(opened[11:13])),
                "risk_pct": risk_pct,
                "planned_rr": None,
                "result_r": round(pct / risk_pct, 4),
                "cost_pct": round(cost, 5),
                "notes": f"Day total · {len(group)} position{'s' if len(group) > 1 else ''} "
                f"({', '.join(symbols)}) · net {net:+,.2f} = {pct:+.3f}%",
                "_net": net,
            }
        )
    return out


def session_of(hour):
    if hour < 9:
        return "Asia"
    return "London" if hour < 15 else "New York"


def build(orders, closes, start_balance):
    trips, orphans, still_open = round_trips(orders)
    rows, problems = [], []

    for t in trips:
        mult = MULTIPLIER.get(t["symbol"])
        if mult is None:
            problems.append(f"{t['symbol']}: contract size unknown — add it to MULTIPLIER")
            continue
        risk_pts = abs(t["price"] - t["sl"]) if t["sl"] else 0.0
        if risk_pts < 1e-9:
            problems.append(f"{t['symbol']} {t['time']}: no usable stop, cannot measure R")
            continue

        direction = "long" if t["side"] == BUY else "short"
        sign = 1 if direction == "long" else -1
        gross = (t["exit"] - t["price"]) * sign * t["qty"] * mult
        risk_usd = risk_pts * t["qty"] * mult

        broker = next(
            (
                c
                for c in closes
                if c["symbol"] == t["symbol"]
                and c["dir"] == direction
                and abs(c["qty"] - t["qty"]) < 1e-6
                and abs(c["price"] - t["exit"]) < 1e-6
            ),
            None,
        )
        if broker and abs(broker["profit"] - gross) > max(1.0, abs(gross) * 0.02):
            problems.append(
                f"{t['symbol']} {t['time']}: reconstructed {gross:.2f}, broker paid "
                f"{broker['profit']:.2f} — the open/close pairing may be wrong"
            )

        # Commission and swap are part of the result, not an afterthought: on a small
        # edge they can be half the gross. R is what actually reached the account.
        net = (broker["profit"] if broker else gross) + t["commission"] + (
            broker["financing"] if broker else 0.0
        )

        rows.append(
            {
                "date": t["time"].strftime("%Y-%m-%dT%H:%M"),
                "symbol": t["symbol"],
                "direction": direction,
                "session": session_of(t["time"].hour),
                "risk_pct": round(risk_usd / start_balance * 100, 4),
                "planned_rr": round(abs(t["tp"] - t["price"]) / risk_pts, 2) if t["tp"] else None,
                "result_r": round(net / risk_usd, 4),
                "notes": "OANDA" + (f" · {broker['reason']}" if broker else ""),
                # What the broker took, as a % of the account — a positive drag.
                "cost_pct": round(
                    -(t["commission"] + (broker["financing"] if broker else 0.0))
                    / start_balance
                    * 100,
                    5,
                ),
                "_net": net,
                "_closed": t["closed"],
                "_symbol": t["symbol"],
            }
        )

    return rows, problems, orphans, still_open


# ── Writing ─────────────────────────────────────────────────────────────


def main():
    ap = argparse.ArgumentParser(description="Add OANDA trades to the journal.")
    ap.add_argument("--dir", default=os.path.expanduser("~/Downloads"))
    ap.add_argument("--balance", type=float, default=100_000, help="which account to pick")
    ap.add_argument("--dry", action="store_true", help="show what would be added")
    ap.add_argument("--db", default=DB, help="journal to write to (for testing)")
    ap.add_argument(
        "--daily",
        action="store_true",
        help="one trade per day holding that day's total, matching how the prop firm books it",
    )
    ap.add_argument("--risk", type=float, default=0.5, help="risk %% a day represents, with --daily")
    a = ap.parse_args()

    files, balance, when = pick(a.dir, a.balance)
    print(f"export from {when:%d %b %Y %H:%M} · account balance ${balance:,.2f}")

    orders = read_orders(files["historia-zlecen-wszystko"])
    closes = read_closes(files["close-trades"])

    net_total = sum(c["profit"] + c["financing"] for c in closes) + sum(
        o["commission"] for o in orders
    )
    start = balance - net_total
    print(f"net since the account opened ${net_total:+,.2f} · implied start ${start:,.2f}")
    # An account is opened with a round number. If this is not one, the export is
    # missing history and every percentage derived from it would be wrong.
    if abs(start - round(start / 1000) * 1000) > 1.0:
        print("  ⚠ that is not a round starting balance — the export may not cover everything")

    rows, problems, orphans, still_open = build(orders, closes, start)
    if a.daily:
        rows = collapse_to_days(rows, start, a.risk)
    for p in problems:
        print(f"  ⚠ {p}")
    for c in orphans:
        print(f"  ⚠ close with no matching entry: {c['symbol']} {c['qty']}")
    for o in still_open:
        print(f"  · still open, not imported: {o['symbol']} {o['qty']} from {o['time']:%d %b %H:%M}")

    db = sqlite3.connect(os.path.abspath(a.db))
    seen = {k for k in db.execute("select date, symbol, direction from trades")}
    fresh = [r for r in rows if (r["date"], r["symbol"], r["direction"]) not in seen]

    label = "trading days" if a.daily else "closed trades"
    print(f"\n{len(rows)} {label} in the export · {len(fresh)} new")
    for r in fresh:
        print(f"  + {r['date']}  {r['symbol']:<7}{r['direction']:<6}"
              f"{r['risk_pct']:>6.2f}% risk  {r['result_r']:+.2f}R  (${r['_net']:+.2f})")

    if a.dry:
        print("\ndry run — nothing written")
        db.close()
        return
    if not fresh:
        print("nothing to add")
        db.close()
        return

    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    db.executemany(
        """insert into trades
           (id, date, symbol, direction, session, setup, timeframe, risk_pct, planned_rr,
            result_r, followed_plan, grade, emotion, mistakes, notes, screenshot,
            created_at, updated_at, htf, entry_model, checklist, strategy_id, checklist_total,
            cost_pct)
           values (?,?,?,?,?,'','',?,?,?,NULL,'',NULL,'[]',?,'',?,?,'','','[]',NULL,0,?)""",
        [
            (
                str(uuid.uuid4()), r["date"], r["symbol"], r["direction"], r["session"],
                r["risk_pct"], r["planned_rr"], r["result_r"], r["notes"], now, now,
                r.get("cost_pct"),
            )
            for r in fresh
        ],
    )
    db.commit()
    print(f"\njournal now holds {db.execute('select count(*) from trades').fetchone()[0]} trades")
    db.close()


if __name__ == "__main__":
    main()

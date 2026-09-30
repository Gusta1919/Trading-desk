import { ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import type { DailyBias, Lean, LevelKind, Scenario } from "@/lib/dailyBias";
import { deskDateLabel, deskTime } from "@/lib/tz";
import type { DailyBiasState } from "@/lib/useDailyBias";
import { Pill, cx, stagger } from "./ui";

/** Daily Bias tab: the morning's gold read, laid out like the rest of the desk. */
export function DailyBiasView({ state }: { state: DailyBiasState }) {
  if (state.loading) return null;

  if (state.error && !state.date) {
    return (
      <Notice tone="down" title="Can't reach the local server">
        {state.error}. The briefing file is safe on disk; it shows up once the server is running.
      </Notice>
    );
  }

  if (state.freshness !== "today") return <NotYet state={state} />;

  if (!state.bias) {
    return (
      <div className="space-y-4">
        <Notice tone="warn" title="Today's briefing arrived, but not in the expected shape">
          Showing the plain text instead. Nothing is lost — tomorrow's run starts from scratch.
        </Notice>
        {state.fallback && (
          <pre className="card whitespace-pre-wrap px-6 py-5 font-sans text-[13px] leading-relaxed text-soft">
            {state.fallback}
          </pre>
        )}
      </div>
    );
  }

  return <Briefing b={state.bias} />;
}

/* ── The briefing ────────────────────────────────────────────────────── */

function Briefing({ b }: { b: DailyBias }) {
  const lead = leading(b);
  let i = 0;
  const rise = () => ({ className: "anim-rise", style: stagger(i++, 70) });

  return (
    <div className="space-y-6">
      <header {...rise()} className="anim-rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">
            Daily bias · XAU/USD · {deskDateLabel(`${b.date}T12:00:00Z`)}
            {b.generatedAt && <> · written {deskTime(b.generatedAt)} NY</>}
          </div>
          <h2 className={cx("mt-1.5 text-[24px] font-semibold leading-tight tracking-tight", lead.cls)}>
            {lead.label} day · {lead.pct}%
          </h2>
        </div>
        {b.spot != null && (
          <div className="text-right">
            <div className="label !mb-0.5">Spot{b.spotAt && ` · ${deskTime(b.spotAt)} NY`}</div>
            <div className="num text-[22px] font-semibold">{px(b.spot)}</div>
          </div>
        )}
      </header>

      <section {...rise()} className="anim-rise card px-6 py-5">
        <SplitBar
          parts={[
            { label: "Bullish", value: b.bias.bullish, bar: "bg-up", text: "text-up" },
            { label: "Range", value: b.bias.range, bar: "bg-faint", text: "text-soft" },
            { label: "Bearish", value: b.bias.bearish, bar: "bg-down", text: "text-down" },
          ]}
        />
        {b.bias.why && <p className="mt-3 text-[12px] text-soft">{b.bias.why}</p>}
        {b.tldr && (
          <blockquote className="mt-4 border-l-2 border-accent/60 pl-4 text-[14px] leading-relaxed">
            {b.tldr}
          </blockquote>
        )}
      </section>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <Tile {...rise()} tone="accent" label="Key level">
          {b.keyLevel ? (
            <>
              <div className="num text-[20px] font-semibold">
                {b.keyLevel.price != null ? px(b.keyLevel.price) : "—"}
              </div>
              <div className="text-[13px]">{b.keyLevel.label}</div>
              <Why>{b.keyLevel.why}</Why>
            </>
          ) : (
            <Why>None named today.</Why>
          )}
        </Tile>
        <Tile {...rise()} tone="warn" label="Main event">
          {b.mainEvent ? (
            <>
              <div className="num text-[20px] font-semibold">
                {b.mainEvent.at ? `${deskTime(b.mainEvent.at)} NY` : "Time TBC"}
              </div>
              <div className="text-[13px]">{b.mainEvent.title}</div>
              <Why>{b.mainEvent.why}</Why>
            </>
          ) : (
            <Why>No major release today.</Why>
          )}
        </Tile>
        <Tile {...rise()} tone="info" label="Structure">
          <p className="text-[13px]">
            <span className="text-faint">D1 </span>
            {b.structure.d1 || "—"}
          </p>
          <p className="text-[13px]">
            <span className="text-faint">H4 </span>
            {b.structure.h4 || "—"}
          </p>
          {b.structure.zone && <ZoneStrip zone={b.structure.zone} />}
          <Why>{b.structure.why}</Why>
        </Tile>
      </div>

      {b.scenarios.length > 0 && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {b.scenarios.map((s) => (
            <ScenarioCard key={s.kind + s.title} s={s} {...rise()} />
          ))}
        </div>
      )}

      {b.levels.length > 0 && <Levels b={b} {...rise()} />}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {b.sessions.length > 0 && (
          <Panel {...rise()} title="Sessions">
            <ul className="space-y-3 px-5 py-4">
              {b.sessions.map((s) => (
                <li key={s.label}>
                  <div className="flex items-baseline justify-between gap-3 text-[13px]">
                    <span>{s.label}</span>
                    <span className="num text-soft">{s.prob}%</span>
                  </div>
                  <Meter value={s.prob} />
                  <Why>{s.why}</Why>
                </li>
              ))}
            </ul>
          </Panel>
        )}
        <Panel {...rise()} title="Macro & intermarket">
          <dl className="space-y-2.5 px-5 py-4 text-[13px]">
            <Fact term="DXY">{b.macro.dxy}</Fact>
            <Fact term="Yields">{b.macro.yields}</Fact>
            <Fact term="Flow">{b.macro.flow}</Fact>
          </dl>
          {b.macro.surprise && (
            <div className="border-t px-5 py-4">
              <div className="label">Surprise risk · {b.macro.surprise.event}</div>
              <SplitBar
                compact
                parts={[
                  { label: "Gold-bullish", value: b.macro.surprise.bullish, bar: "bg-up", text: "text-up" },
                  { label: "Gold-bearish", value: b.macro.surprise.bearish, bar: "bg-down", text: "text-down" },
                ]}
              />
              <Why>{b.macro.surprise.why}</Why>
            </div>
          )}
        </Panel>
      </div>

      {b.analysts.length > 0 && <Analysts b={b} {...rise()} />}

      <Panel {...rise()} title="Risk">
        <div className="grid grid-cols-1 gap-6 px-5 py-4 md:grid-cols-3">
          <div>
            <div className="label">Events · NY time</div>
            <ul className="space-y-1.5 text-[13px]">
              {b.risk.events.map((e) => (
                <li key={e.title + e.at} className="flex items-baseline gap-2.5">
                  <span className="num w-12 shrink-0 text-soft">{e.at ? deskTime(e.at) : "—"}</span>
                  <span
                    className={cx(
                      "size-1.5 shrink-0 translate-y-[-1px] rounded-full",
                      e.impact === "High" ? "bg-down" : e.impact === "Medium" ? "bg-warn" : "bg-low",
                    )}
                  />
                  <span>{e.title}</span>
                </li>
              ))}
              {!b.risk.events.length && <li className="text-faint">Nothing scheduled.</li>}
            </ul>
          </div>
          <div>
            <div className="label">Volatility</div>
            <p className="num text-[20px] font-semibold">{b.risk.atr != null ? `ATR ${b.risk.atr}` : "—"}</p>
            <Why>{b.risk.expectedRange && `Expected range ${b.risk.expectedRange}`}</Why>
          </div>
          <div>
            <div className="label">Stand aside if</div>
            <ul className="list-disc space-y-1 pl-4 text-[13px] text-soft marker:text-faint">
              {b.risk.standAside.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </div>
        </div>
      </Panel>

      <footer {...rise()} className="anim-rise space-y-3">
        {b.markdown && (
          <details className="group">
            <summary className="cursor-pointer list-none text-[12px] text-faint hover:text-soft">
              <span className="group-open:hidden">Full briefing as text →</span>
              <span className="hidden group-open:inline">Full briefing as text ↓</span>
            </summary>
            <pre className="card mt-3 whitespace-pre-wrap px-6 py-5 font-sans text-[13px] leading-relaxed text-soft">
              {b.markdown}
            </pre>
          </details>
        )}
        <p className="text-[11px] text-faint">
          Probabilities are Claude's subjective estimates from public analysis, not a fitted model. Analysis,
          not financial advice.
        </p>
      </footer>
    </div>
  );
}

/* ── Sections ────────────────────────────────────────────────────────── */

const KIND_LABEL: Record<LevelKind, string> = {
  resistance: "Resistance",
  support: "Support",
  liquidity: "Liquidity",
  fvg: "FVG",
  orderblock: "Order block",
  round: "Round",
  open: "Open",
};

/** The level ladder, highest first, with spot slotted in where it trades. */
function Levels({ b, className, style }: { b: DailyBias } & Anim) {
  const levels = [...b.levels].sort((x, y) => y.price - x.price);
  const spotAt = b.spot == null ? -1 : levels.findIndex((l) => l.price < b.spot!);
  const rows: ReactNode[] = levels.map((l) => (
    <tr key={l.label + l.price} className="border-t">
      <td className="num py-2.5 pl-5 pr-3 font-medium">{px(l.price)}</td>
      <td className="num px-3 text-right text-[12px] text-faint">
        {b.spot != null ? signedPts(l.price - b.spot) : ""}
      </td>
      <td className="px-3">{l.label}</td>
      <td className="px-3">
        <Pill tone={l.kind === "liquidity" ? "accent" : "neutral"}>{KIND_LABEL[l.kind]}</Pill>
      </td>
      <td className="w-40 px-3">
        {l.sweepProb != null && (
          <div className="flex items-center gap-2.5">
            <Meter value={l.sweepProb} className="flex-1" />
            <span className="num w-9 text-right text-[12px] text-soft">{l.sweepProb}%</span>
          </div>
        )}
      </td>
      <td
        className={cx(
          "px-3 text-[12px]",
          l.verdict === "hold" ? "text-up" : l.verdict === "break" ? "text-down" : "text-faint",
        )}
      >
        {l.verdict === "unclear" ? "—" : l.verdict}
      </td>
      <td className="py-2.5 pl-3 pr-5 text-[12px] text-soft">{l.note}</td>
    </tr>
  ));
  if (b.spot != null) {
    rows.splice(
      spotAt === -1 ? rows.length : spotAt,
      0,
      <tr key="spot" className="border-t bg-accent/5">
        <td className="num py-2 pl-5 pr-3 font-semibold text-accent-2">{px(b.spot)}</td>
        <td />
        <td colSpan={5} className="px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-accent-2">
          Spot
        </td>
      </tr>,
    );
  }

  return (
    <Panel title="Key levels" note="chance of a tag or sweep today" className={className} style={style}>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-[13px]">
          <thead className="text-[11px] uppercase tracking-[0.08em] text-faint">
            <tr>
              <th className="py-2 pl-5 pr-3 font-medium">Price</th>
              <th className="px-3 text-right font-medium">Δ pts</th>
              <th className="px-3 font-medium">Level</th>
              <th className="px-3 font-medium">Type</th>
              <th className="px-3 font-medium">Sweep</th>
              <th className="px-3 font-medium">Likely</th>
              <th className="pl-3 pr-5 font-medium">Note</th>
            </tr>
          </thead>
          <tbody>{rows}</tbody>
        </table>
      </div>
    </Panel>
  );
}

function ScenarioCard({ s, className, style }: { s: Scenario } & Anim) {
  const bar = s.direction === "long" ? "bg-up" : s.direction === "short" ? "bg-down" : "bg-faint";
  const text = s.direction === "long" ? "text-up" : s.direction === "short" ? "text-down" : "text-soft";
  return (
    <article
      className={cx("card relative flex h-full flex-col overflow-hidden py-5 pl-6 pr-5", className)}
      style={style}
    >
      <span className={cx("absolute inset-y-0 left-0 w-[3px]", bar)} />
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">
          {s.kind === "chop" ? "Other / chop" : s.kind} · {s.direction}
        </div>
        <div className={cx("num text-[22px] font-semibold", text)}>{s.prob}%</div>
      </div>
      <h3 className="mt-1 text-[14px] font-semibold">{s.title}</h3>
      {s.trigger && (
        <p className="mt-2 text-[13px] text-soft">
          <span className="text-faint">Trigger </span>
          {s.trigger}
        </p>
      )}
      {s.targets.length > 0 && (
        <ul className="mt-3 space-y-2">
          {s.targets.map((t, n) => (
            <li key={t.price} className="flex items-center gap-2.5 text-[12px]">
              <span className="w-8 text-faint">TP{n + 1}</span>
              <span className="num w-16">{px(t.price)}</span>
              {t.prob != null && (
                <>
                  <Meter value={t.prob} className="flex-1" bar={bar} />
                  <span className="num w-9 text-right text-soft">{t.prob}%</span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {s.invalidation != null && (
        <p className="num mt-3 rounded-md bg-subtle px-3 py-2 text-[12px] text-soft">
          Invalid beyond {px(s.invalidation)}
        </p>
      )}
      <Why>{s.why}</Why>
    </article>
  );
}

const LEAN_TONE: Record<Lean, "up" | "down" | "neutral"> = {
  bullish: "up",
  bearish: "down",
  neutral: "neutral",
};

function Analysts({ b, className, style }: { b: DailyBias } & Anim) {
  const ref = b.generatedAt ? new Date(b.generatedAt) : new Date();
  return (
    <Panel title="Pro-trader consensus" note={`${b.analysts.length} views`} className={className} style={style}>
      {b.consensus && (
        <div className="border-b px-5 py-4">
          <SplitBar
            compact
            parts={[
              { label: "Bullish", value: b.consensus.bullish, bar: "bg-up", text: "text-up" },
              { label: "Neutral", value: b.consensus.neutral, bar: "bg-faint", text: "text-soft" },
              { label: "Bearish", value: b.consensus.bearish, bar: "bg-down", text: "text-down" },
            ]}
          />
          <Why>{b.consensus.take}</Why>
        </div>
      )}
      <ul>
        {b.analysts.map((a) => {
          const hours = a.publishedAt
            ? Math.max(0, Math.round((ref.getTime() - Date.parse(a.publishedAt)) / 3_600_000))
            : null;
          return (
            <li key={a.name + a.source} className="grid grid-cols-[180px_90px_1fr] gap-4 border-t px-5 py-3 first:border-t-0">
              <div>
                <div className="text-[13px] font-medium">
                  {a.url ? (
                    <a href={a.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-accent-2">
                      {a.name} <ExternalLink size={11} className="text-faint" />
                    </a>
                  ) : (
                    a.name
                  )}
                </div>
                <div className="text-[11px] text-faint">
                  {a.source}
                  {hours != null && (
                    <span className={hours > 24 ? "text-warn" : undefined}> · {hours}h old</span>
                  )}
                </div>
              </div>
              <div>
                <Pill tone={LEAN_TONE[a.lean]}>{a.lean}</Pill>
              </div>
              <div className="text-[13px]">
                {a.levels && <div className="num text-[12px] text-soft">{a.levels}</div>}
                <div className="text-soft">{a.why}</div>
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

/** Before today's briefing has landed — or on a day none is due. */
function NotYet({ state }: { state: DailyBiasState }) {
  const last = state.date ? ` The last one on file is from ${deskDateLabel(`${state.date}T12:00:00Z`)}.` : "";
  if (state.freshness === "late") {
    return (
      <Notice tone="warn" title="Today's briefing hasn't arrived">
        The task runs at 9:46 Amsterdam time while the Claude app is open. If the app was closed, it runs as
        soon as you open it, and the briefing shows up here within a minute of finishing.{last}
      </Notice>
    );
  }
  if (state.freshness === "offday") {
    return (
      <Notice tone="info" title="No briefing today">
        Briefings are written on weekdays. The next one lands Monday around 10:00 Amsterdam time.
      </Notice>
    );
  }
  return (
    <Notice tone="info" title="Today's briefing is on its way">
      It's written at 9:46 Amsterdam time and takes a few minutes. The desk checks every minute, so it
      appears here by itself.{last}
    </Notice>
  );
}

/* ── Pieces ──────────────────────────────────────────────────────────── */

type Anim = { className?: string; style?: React.CSSProperties };

/** Mutually exclusive outcomes as one bar, so they visibly add up to 100%. */
function SplitBar({
  parts,
  compact = false,
}: {
  parts: { label: string; value: number; bar: string; text: string }[];
  compact?: boolean;
}) {
  return (
    <div>
      <div className={cx("flex overflow-hidden rounded-full bg-subtle", compact ? "h-1.5" : "h-2.5")}>
        {parts.map((p) =>
          p.value > 0 ? (
            <div key={p.label} className={cx("anim-grow h-full", p.bar)} style={{ width: `${p.value}%` }} />
          ) : null,
        )}
      </div>
      <div className={cx("mt-2 flex flex-wrap gap-x-6 gap-y-1", compact ? "text-[12px]" : "text-[13px]")}>
        {parts.map((p) => (
          <span key={p.label} className="flex items-baseline gap-1.5">
            <span className={cx("num font-semibold", p.text, !compact && "text-[18px]")}>{p.value}%</span>
            <span className="text-faint">{p.label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function Meter({ value, className, bar = "bg-accent" }: { value: number; className?: string; bar?: string }) {
  return (
    <div className={cx("mt-1 h-1 overflow-hidden rounded-full bg-subtle", className)}>
      <div className={cx("anim-grow h-full rounded-full", bar)} style={{ width: `${value}%` }} />
    </div>
  );
}

/** Where price sits in the dealing range: discount, equilibrium or premium. */
function ZoneStrip({ zone }: { zone: "premium" | "discount" | "equilibrium" }) {
  const zones = ["discount", "equilibrium", "premium"] as const;
  return (
    <div className="mt-2.5 grid grid-cols-3 gap-1 text-center text-[10px] uppercase tracking-[0.08em]">
      {zones.map((z) => (
        <div
          key={z}
          className={cx(
            "rounded-md py-1",
            z === zone
              ? z === "discount"
                ? "bg-up/15 text-up"
                : z === "premium"
                  ? "bg-down/15 text-down"
                  : "bg-subtle text-ink"
              : "bg-subtle/50 text-faint",
          )}
        >
          {z}
        </div>
      ))}
    </div>
  );
}

const TILE_BAR = { accent: "bg-accent", warn: "bg-warn", info: "bg-faint" } as const;

function Tile({
  label,
  tone,
  children,
  className,
  style,
}: { label: string; tone: keyof typeof TILE_BAR; children: ReactNode } & Anim) {
  return (
    <article className={cx("card relative flex h-full flex-col gap-1 overflow-hidden py-5 pl-6 pr-5", className)} style={style}>
      <span className={cx("absolute inset-y-0 left-0 w-[3px]", TILE_BAR[tone])} />
      <div className="label">{label}</div>
      {children}
    </article>
  );
}

function Panel({
  title,
  note,
  children,
  className,
  style,
}: { title: string; note?: string; children: ReactNode } & Anim) {
  return (
    <section className={cx("card overflow-hidden", className)} style={style}>
      <header className="flex items-baseline justify-between border-b px-5 py-3.5">
        <h3 className="text-[14px] font-semibold">{title}</h3>
        {note && <span className="text-[11px] text-faint">{note}</span>}
      </header>
      {children}
    </section>
  );
}

function Fact({ term, children }: { term: string; children: ReactNode }) {
  if (!children) return null;
  return (
    <div className="grid grid-cols-[64px_1fr] gap-3">
      <dt className="text-faint">{term}</dt>
      <dd className="text-soft">{children}</dd>
    </div>
  );
}

function Why({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <p className="mt-1.5 text-[12px] leading-relaxed text-faint">{children}</p>;
}

function Notice({ tone, title, children }: { tone: "info" | "warn" | "down"; title: string; children: ReactNode }) {
  return (
    <section className="card anim-rise relative overflow-hidden py-5 pl-6 pr-5">
      <span
        className={cx(
          "absolute inset-y-0 left-0 w-[3px]",
          tone === "warn" ? "bg-warn" : tone === "down" ? "bg-down" : "bg-accent",
        )}
      />
      <h3 className="text-[14px] font-semibold">{title}</h3>
      <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-soft">{children}</p>
    </section>
  );
}

/* ── Formatting ──────────────────────────────────────────────────────── */

const px = (v: number) =>
  v.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 2 });

const signedPts = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${px(Math.abs(Math.round(v * 10) / 10))}`;

/** The outcome with the biggest share, which is what the headline announces. */
function leading(b: DailyBias) {
  const { bullish, range, bearish } = b.bias;
  if (bullish >= range && bullish >= bearish) return { label: "Bullish", pct: bullish, cls: "text-up" };
  if (bearish >= range) return { label: "Bearish", pct: bearish, cls: "text-down" };
  return { label: "Range", pct: range, cls: "text-ink" };
}

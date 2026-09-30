import type { ReactNode } from "react";
import type { Briefing as BriefingData, CoachCard, Tone } from "@/lib/coach";
import { cx } from "./ui";

export const toneBar: Record<Tone, string> = {
  good: "bg-up",
  info: "bg-faint",
  warn: "bg-warn",
  alert: "bg-down",
};

export const toneText: Record<Tone, string> = {
  good: "text-up",
  info: "text-ink",
  warn: "text-warn",
  alert: "text-down",
};

/** The coach's pre-session briefing: headline, cards, principle, reflection. */
export function Briefing({
  briefing,
  animate = false,
  maxCards,
  onShowAll,
  footer,
}: {
  briefing: BriefingData;
  animate?: boolean;
  /** Board mode: show only the top few cards. */
  maxCards?: number;
  /** Called by the "show more" link when cards are hidden. */
  onShowAll?: () => void;
  footer?: ReactNode;
}) {
  const cards = maxCards ? briefing.cards.slice(0, maxCards) : briefing.cards;
  const hidden = briefing.cards.length - cards.length;
  const delay = (i: number) => (animate ? { animationDelay: `${200 + i * 180}ms` } : undefined);
  const rise = animate ? "anim-rise" : "";

  return (
    <div className="space-y-6">
      <header className={rise}>
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">
          Coach · {briefing.sample ? `based on ${briefing.sample} closed trade${briefing.sample === 1 ? "" : "s"}` : "getting to know you"}
        </div>
        <h2 className={cx("mt-1.5 text-[24px] font-semibold leading-tight tracking-tight", toneText[briefing.tone])}>
          {briefing.headline}
        </h2>
      </header>

      {/* A strict grid, not masonry: fixed tracks keep every row aligned. */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {cards.map((c, i) => (
          <Card key={c.id} card={c} className={cx(rise, i === 0 && leadSpan(cards.length))} style={delay(i)} />
        ))}
      </div>

      {hidden > 0 && onShowAll && (
        <button onClick={onShowAll} className="text-[12px] text-faint hover:text-ink">
          Show {hidden} more card{hidden === 1 ? "" : "s"} ↓
        </button>
      )}

      <blockquote
        className={cx("border-l-2 border-accent/60 pl-4 text-[14px] italic text-soft", rise)}
        style={delay(cards.length)}
      >
        {briefing.principle}
      </blockquote>

      {footer && (
        <div className={rise} style={delay(cards.length + 2)}>
          {footer}
        </div>
      )}
    </div>
  );
}

/**
 * How wide the first card runs so no row is left with a gap: across two columns it
 * spans both when the count is odd; across three it spans two or all three as needed.
 */
function leadSpan(n: number) {
  const md = n % 2 === 1 && n > 1 ? "md:col-span-2" : "";
  const lg = n % 3 === 2 ? "lg:col-span-2" : n % 3 === 1 && n > 1 ? "lg:col-span-3" : "lg:col-span-1";
  return cx(md, lg);
}

function Card({
  card,
  className,
  style,
}: {
  card: CoachCard;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <article
      className={cx(
        // h-full so every card fills its grid track and the rows line up.
        "card relative flex h-full flex-col overflow-hidden border-white/5 py-5 pl-6 pr-5 text-left",
        className,
      )}
      style={style}
    >
      <span className={cx("absolute inset-y-0 left-0 w-[3px]", toneBar[card.tone])} />
      <h3 className="text-[14px] font-semibold">{card.title}</h3>
      <p className="mt-1 text-[13px] leading-relaxed text-soft">{card.body}</p>
      {card.stat && (
        <p className="num mt-2.5 rounded-md bg-subtle px-3 py-2 text-[12px] text-soft">{card.stat}</p>
      )}
      {card.why && (
        <details className="group mt-2">
          <summary className="cursor-pointer list-none text-[12px] text-faint hover:text-soft">
            <span className="group-open:hidden">Why this matters →</span>
            <span className="hidden group-open:inline">Why this matters ↓</span>
          </summary>
          <p className="mt-1.5 text-[12px] leading-relaxed text-soft">{card.why}</p>
        </details>
      )}
    </article>
  );
}

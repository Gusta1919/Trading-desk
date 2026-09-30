import { CircleCheck, Info, OctagonAlert, Quote, TriangleAlert, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { Briefing as BriefingData, CoachCard, Tone } from "@/lib/coach";
import { balancedSpans } from "@/lib/layout";
import { Tip, cx } from "./ui";

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

/* Each tone gets a mark and a word, so a card's weight never rests on colour alone. */
const TONE: Record<Tone, { icon: LucideIcon; word: string; tint: string; mark: string }> = {
  good: { icon: CircleCheck, word: "On track", tint: "bg-up/10", mark: "text-up" },
  info: { icon: Info, word: "Context", tint: "bg-subtle", mark: "text-soft" },
  warn: { icon: TriangleAlert, word: "Careful", tint: "bg-warn/10", mark: "text-warn" },
  alert: { icon: OctagonAlert, word: "Stop", tint: "bg-down/10", mark: "text-down" },
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
  const spans = balancedSpans(cards.length);
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

      {/* Balanced rows on a six-track grid: two cards share a row evenly, five sit 3 + 2. */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-6">
        {cards.map((c, i) => (
          <Card key={c.id} card={c} className={cx(rise, spans[i])} style={delay(i)} />
        ))}
      </div>

      {hidden > 0 && onShowAll && (
        <button onClick={onShowAll} className="text-[12px] text-faint hover:text-ink">
          Show {hidden} more card{hidden === 1 ? "" : "s"} ↓
        </button>
      )}

      <div className={cx("grid grid-cols-1 gap-6", briefing.reflection && "md:grid-cols-2", rise)} style={delay(cards.length)}>
        <Note label="Principle" icon={<Quote size={13} />}>
          <span className="italic">{briefing.principle}</span>
        </Note>
        {briefing.reflection && (
          <Note label="Reflect before you trade" icon={<span className="text-[13px] leading-none">?</span>}>
            {briefing.reflection}
          </Note>
        )}
      </div>

      {footer && (
        <div className={rise} style={delay(cards.length + 2)}>
          {footer}
        </div>
      )}
    </div>
  );
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
  const t = TONE[card.tone];
  const Icon = t.icon;
  return (
    <article
      className={cx(
        // h-full so every card fills its grid track and the rows line up.
        "card relative flex h-full flex-col overflow-hidden py-5 pl-6 pr-5 text-left",
        className,
      )}
      style={style}
    >
      <span className={cx("absolute inset-y-0 left-0 w-[3px]", toneBar[card.tone])} />
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2">
          <span className={cx("grid size-6 place-items-center rounded-full", t.tint)}>
            <Icon size={13} strokeWidth={2.25} className={t.mark} />
          </span>
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">{t.word}</span>
        </span>
        {card.why && (
          <Tip text={card.why} className="flex items-center gap-1 text-[11px] text-faint hover:text-soft">
            <Info size={11} /> Why
          </Tip>
        )}
      </div>
      <h3 className="mt-3 text-[15px] font-semibold leading-snug">{card.title}</h3>
      <p className="mt-1.5 text-[13px] leading-relaxed text-soft">{card.body}</p>
      {/* Pinned to the bottom so the numbers line up across a row of cards. */}
      {card.stat && (
        <div className="mt-auto pt-3.5">
          <p className="num rounded-lg bg-subtle px-3 py-2 text-[12px] text-soft">{card.stat}</p>
        </div>
      )}
    </article>
  );
}

/** A quiet panel for the words that frame the day: the principle and the question. */
function Note({ label, icon, children }: { label: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="card relative flex h-full gap-3.5 overflow-hidden py-4 pl-6 pr-5">
      <span className="absolute inset-y-0 left-0 w-[3px] bg-accent/60" />
      <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-accent/10 text-accent-2">
        {icon}
      </span>
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">{label}</div>
        <p className="mt-1 text-[14px] leading-relaxed text-soft">{children}</p>
      </div>
    </section>
  );
}

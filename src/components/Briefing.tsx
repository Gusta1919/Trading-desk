import { CircleCheck, Info, OctagonAlert, Quote, TriangleAlert, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { Briefing as BriefingData, CoachCard, Tone } from "@/lib/coach";
import { balancedSpans } from "@/lib/layout";
import { PageHeader, Tip, cx } from "./ui";

const toneText: Record<Tone, string> = {
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
  footer,
  page = false,
}: {
  briefing: BriefingData;
  animate?: boolean;
  footer?: ReactNode;
  /** On its own tab: with the page header. */
  page?: boolean;
}) {
  const cards = briefing.cards;
  const spans = balancedSpans(cards.length);
  const delay = (i: number) => (animate ? { animationDelay: `${200 + i * 180}ms` } : undefined);
  const rise = animate ? "anim-rise" : "";

  const lead = TONE[briefing.tone];
  const LeadIcon = lead.icon;
  const counts = (["alert", "warn", "good", "info"] as Tone[])
    .map((tone) => ({ tone, n: briefing.cards.filter((c) => c.tone === tone).length }))
    .filter((x) => x.n > 0);

  return (
    <div className="space-y-6">
      {page && (
        <PageHeader
          title="Coach"
          sub={`Your journal, read against the rulebook before the session${briefing.sample ? ` — from ${briefing.sample} closed trade${briefing.sample === 1 ? "" : "s"}` : ""}.`}
        />
      )}

      {/* The one line the day comes down to, with how the cards below add up. */}
      <section className={cx("card flex flex-wrap items-center gap-x-4 gap-y-3 px-6 py-4", rise)}>
        <span className={cx("anim-stamp grid size-9 shrink-0 place-items-center rounded-full", lead.tint)}>
          <LeadIcon size={17} strokeWidth={2.25} className={lead.mark} />
        </span>
        <h2 className={cx("min-w-0 flex-1 text-title font-semibold leading-snug", toneText[briefing.tone])}>{briefing.headline}</h2>
        <span className="flex items-center gap-2">
          {counts.map(({ tone, n }) => (
            <span key={tone} className={cx("pill", TONE[tone].tint, TONE[tone].mark)}>
              {n} {TONE[tone].word.toLowerCase()}
            </span>
          ))}
        </span>
      </section>

      {/* Balanced rows on a six-track grid: two cards share a row evenly, five sit 3 + 2. */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-6">
        {cards.map((c, i) => (
          <Card key={c.id} card={c} className={cx(rise, spans[i])} style={delay(i)} />
        ))}
      </div>

      <div className={cx("grid grid-cols-1 gap-6", briefing.reflection && "md:grid-cols-2", rise)} style={delay(cards.length)}>
        <Note label="Principle" icon={<Quote size={13} />}>
          <span className="italic">{briefing.principle}</span>
        </Note>
        {briefing.reflection && (
          <Note label="Reflect before you trade" icon={<span className="text-body leading-none">?</span>}>
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
        "card flex h-full flex-col px-6 py-5 text-left",
        className,
      )}
      style={style}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2">
          <span className={cx("grid size-6 place-items-center rounded-full", t.tint)}>
            <Icon size={13} strokeWidth={2.25} className={t.mark} />
          </span>
          <span className="eyebrow">{t.word}</span>
        </span>
        {card.why && (
          <Tip text={card.why} className="flex items-center gap-1 text-caption text-faint hover:text-soft">
            <Info size={11} /> Why
          </Tip>
        )}
      </div>
      <h3 className="mt-3 text-title font-semibold leading-snug">{card.title}</h3>
      <p className="mt-1.5 text-body leading-relaxed text-soft">{card.body}</p>
      {/* Pinned to the bottom so the numbers line up across a row of cards. */}
      {card.stat && (
        <div className="mt-auto pt-3.5">
          <p className="num rounded-lg bg-subtle px-3 py-2 text-small text-soft">{card.stat}</p>
        </div>
      )}
    </article>
  );
}

/** A quiet panel for the words that frame the day: the principle and the question. */
function Note({ label, icon, children }: { label: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="card flex h-full gap-3.5 px-6 py-4">
      <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-accent/10 text-accent-2">
        {icon}
      </span>
      <div>
        <div className="eyebrow">{label}</div>
        <p className="mt-1 text-title leading-relaxed text-soft">{children}</p>
      </div>
    </section>
  );
}

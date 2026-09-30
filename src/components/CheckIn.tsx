import { ArrowLeft } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { buildBriefing } from "@/lib/coach";
import {
  QUESTIONS,
  USER_NAME,
  VERDICTS,
  evaluate,
  greeting,
  type CheckIn as CheckInData,
  type Verdict,
} from "@/lib/checkin";
import { dayKey } from "@/lib/format";
import type { Trade } from "@/lib/types";
import { Briefing } from "./Briefing";
import { Button, cx } from "./ui";

type Stage = "hello" | number | "note" | "result" | "briefing";

export const verdictColor: Record<Verdict, string> = {
  ready: "text-up",
  caution: "text-warn",
  "sit-out": "text-down",
};

const verdictBg: Record<Verdict, string> = {
  ready: "bg-up",
  caution: "bg-warn",
  "sit-out": "bg-down",
};

/** Full-screen daily check-in: greeting → questions → note → verdict. */
export function CheckIn({
  trades,
  checkins,
  onDone,
  onKeep,
}: {
  trades: Trade[];
  checkins: CheckInData[];
  onDone: (c: CheckInData) => void;
  /** Only when redoing: go back and keep the check-in already saved today. */
  onKeep?: () => void;
}) {
  const [stage, setStage] = useState<Stage>("hello");
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [note, setNote] = useState("");
  const [picked, setPicked] = useState<number | null>(null);
  const saved = useRef<CheckInData | null>(null);

  const total = QUESTIONS.length + 1; // + note
  const step = typeof stage === "number" ? stage : stage === "note" ? QUESTIONS.length : null;
  const result = useMemo(() => evaluate(answers), [answers]);

  // Save once the result screen is reached.
  useEffect(() => {
    if (stage !== "result") return;
    api
      .saveCheckIn({
        date: dayKey(new Date()),
        answers,
        note,
        score: result.score,
        verdict: result.verdict,
      })
      .then((c) => (saved.current = c))
      .catch(() => {});
  }, [stage]); // eslint-disable-line react-hooks/exhaustive-deps

  const pending = useRef<{ timer: number; advance: () => void } | null>(null);

  function choose(qIndex: number, option: number) {
    if (pending.current) return; // this question is already answered, moving on
    setPicked(option);
    setAnswers((a) => ({ ...a, [QUESTIONS[qIndex].id]: option }));
    const advance = () => {
      clearTimeout(pending.current?.timer);
      pending.current = null;
      setPicked(null);
      setStage(qIndex + 1 < QUESTIONS.length ? qIndex + 1 : "note");
    };
    // Short pause so you see your choice highlighted before moving on.
    pending.current = { timer: window.setTimeout(advance, 260), advance };
  }

  function back() {
    if (stage === "note") setStage(QUESTIONS.length - 1);
    else if (typeof stage === "number") setStage(stage > 0 ? stage - 1 : "hello");
  }

  const current: CheckInData = {
    date: dayKey(new Date()),
    answers,
    note,
    score: result.score,
    verdict: result.verdict,
    createdAt: new Date().toISOString(),
  };

  // The briefing sees today's fresh answers instead of any older check-in from today.
  const briefing = useMemo(
    () =>
      stage === "briefing"
        ? buildBriefing(trades, [current, ...checkins.filter((c) => c.date !== current.date)])
        : null,
    [stage], // eslint-disable-line react-hooks/exhaustive-deps
  );

  async function finish() {
    const { createdAt: _, ...toSave } = current;
    const c = await api.saveCheckIn(toSave).catch(() => saved.current ?? current);
    onDone(c);
  }

  // Keyboard: number keys pick an option, Enter continues.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("textarea")) {
        if (stage === "note" && e.key === "Enter" && (e.metaKey || e.ctrlKey)) setStage("result");
        return;
      }
      if (stage === "hello" && e.key === "Enter") setStage(0);
      if (typeof stage === "number" && /^[1-9]$/.test(e.key)) {
        const n = Number(e.key) - 1;
        let q = stage;
        // Typing faster than the highlight pause: finish that step, answer the next one.
        if (pending.current) {
          pending.current.advance();
          q = stage + 1;
          if (q >= QUESTIONS.length) return;
        }
        if (n < QUESTIONS[q].options.length) choose(q, n);
      }
      if (e.key === "Backspace" || e.key === "ArrowLeft") back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-bg">
      {/* Progress */}
      <div className="h-[3px] w-full bg-subtle">
        {step != null && (
          <div
            className="h-full bg-ink transition-[width] duration-500 ease-out"
            style={{ width: `${((step + 1) / total) * 100}%` }}
          />
        )}
      </div>

      <div className="flex items-center justify-between px-6 py-4 text-[12px] text-faint">
        {step != null ? (
          <button onClick={back} className="flex items-center gap-1.5 hover:text-ink">
            <ArrowLeft size={14} /> Back
          </button>
        ) : (
          <span />
        )}
        {step != null && (
          <span className="num">
            {step + 1} / {total}
          </span>
        )}
      </div>

      <main className="flex flex-1 flex-col overflow-y-auto px-6 pb-16">
        <div
          key={String(stage)}
          className={cx("mx-auto my-auto w-full py-6", stage === "briefing" ? "max-w-xl" : "max-w-lg")}
        >
          {stage === "hello" && <Hello onStart={() => setStage(0)} onKeep={onKeep} />}

          {typeof stage === "number" && (
            <QuestionScreen
              index={stage}
              value={answers[QUESTIONS[stage].id]}
              picked={picked}
              onChoose={(o) => choose(stage, o)}
            />
          )}

          {stage === "note" && (
            <div>
              <h2 className="anim-rise text-[26px] font-semibold tracking-tight">
                Session notes
              </h2>
              <p className="anim-rise mt-1 text-soft" style={{ animationDelay: "80ms" }}>
                Optional. Anything that could affect your judgement in the next few hours.
              </p>
              <textarea
                autoFocus
                className="field anim-rise mt-6 min-h-[120px] resize-none text-[15px]"
                style={{ animationDelay: "160ms" }}
                placeholder="e.g. Exam tomorrow — intend to close the desk by 12:00."
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <div className="anim-rise mt-5 flex justify-end" style={{ animationDelay: "240ms" }}>
                <Button variant="accent" onClick={() => setStage("result")}>
                  See readiness
                </Button>
              </div>
            </div>
          )}

          {stage === "result" && (
            <Result
              score={result.score}
              verdict={result.verdict}
              flags={result.flags}
              onEnter={() => setStage("briefing")}
            />
          )}

          {stage === "briefing" && briefing && (
            <Briefing
              animate
              briefing={briefing}
              footer={
                <div className="flex justify-end">
                  <Button variant="accent" onClick={finish} className="px-7 py-3 text-[14px]">
                    Open the desk
                  </Button>
                </div>
              }
            />
          )}
        </div>
      </main>
    </div>
  );
}

function Hello({ onStart, onKeep }: { onStart: () => void; onKeep?: () => void }) {
  const words = "Pre-Session Calibration".split(" ");
  return (
    <div className="text-center">
      <div
        className="anim-rise mb-7 flex items-center justify-center gap-2.5 text-[11px] font-medium uppercase tracking-[0.22em] text-faint"
      >
        <span className="size-1.5 rounded-full bg-accent shadow-[0_0_12px_var(--glow-accent)]" />
        {greeting()} · {USER_NAME}
      </div>
      <h1 className="text-[34px] font-semibold tracking-tight sm:text-[44px]">
        {words.map((w, i) => (
          <span
            key={i}
            className="anim-rise inline-block"
            style={{ animationDelay: `${250 + i * 140}ms` }}
          >
            {w}&nbsp;
          </span>
        ))}
      </h1>
      <div
        className="anim-grow mx-auto mt-5 h-px w-24 bg-line"
        style={{ animationDelay: `${400 + words.length * 140}ms` }}
      />
      <p
        className="anim-rise mt-5 text-[15px] text-soft"
        style={{ animationDelay: `${600 + words.length * 140}ms` }}
      >
        Nine questions. They decide how much size you are allowed today.
      </p>
      <div
        className="anim-rise mt-8 flex flex-col items-center gap-3"
        style={{ animationDelay: `${900 + words.length * 140}ms` }}
      >
        <Button variant="accent" onClick={onStart} className="px-7 py-3 text-[14px]">
          Start check-in
        </Button>
        {onKeep && (
          <button onClick={onKeep} className="text-[12px] text-faint hover:text-soft">
            Keep today's answers
          </button>
        )}
      </div>
    </div>
  );
}

function QuestionScreen({
  index,
  value,
  picked,
  onChoose,
}: {
  index: number;
  value: number | undefined;
  picked: number | null;
  onChoose: (o: number) => void;
}) {
  const q = QUESTIONS[index];
  return (
    <div>
      <h2 className="anim-rise text-[26px] font-semibold leading-tight tracking-tight">{q.title}</h2>
      {q.hint && (
        <p className="anim-rise mt-1.5 text-soft" style={{ animationDelay: "60ms" }}>
          {q.hint}
        </p>
      )}
      <div className="mt-7 space-y-2">
        {q.options.map((o, i) => {
          const active = picked === i || (picked == null && value === i);
          return (
            <button
              key={o.label}
              onClick={() => onChoose(i)}
              className={cx(
                "anim-rise flex w-full items-center gap-4 rounded-xl border px-4 py-3.5 text-left text-[15px] transition-all",
                active
                  ? "border-ink bg-ink text-bg"
                  : "bg-surface hover:-translate-y-px hover:border-soft",
              )}
              style={{ animationDelay: `${120 + i * 60}ms` }}
            >
              <span
                className={cx(
                  "num flex size-6 items-center justify-center rounded-md border text-[11px]",
                  active ? "border-bg/30 text-bg" : "text-faint",
                )}
              >
                {i + 1}
              </span>
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Result({
  score,
  verdict,
  flags,
  onEnter,
}: {
  score: number;
  verdict: Verdict;
  flags: { text: string; risk: 1 | 2 }[];
  onEnter: () => void;
}) {
  const shown = useCountUp(score);
  const R = 54;
  const C = 2 * Math.PI * R;
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const v = VERDICTS[verdict];
  return (
    <div className="text-center">
      <div className="anim-rise relative mx-auto size-[140px]">
        <svg viewBox="0 0 128 128" className="size-full -rotate-90">
          <circle cx="64" cy="64" r={R} fill="none" strokeWidth="6" className="stroke-subtle" />
          <circle
            cx="64"
            cy="64"
            r={R}
            fill="none"
            strokeWidth="6"
            strokeLinecap="round"
            className={cx("transition-[stroke-dashoffset] duration-[1400ms] ease-out", verdictColor[verdict])}
            stroke="currentColor"
            strokeDasharray={C}
            strokeDashoffset={drawn ? C * (1 - score / 100) : C}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="num text-[34px] font-semibold tracking-tight">{shown}</span>
          <span className="text-[10px] uppercase tracking-[0.16em] text-faint">readiness</span>
        </div>
      </div>

      <h2
        className={cx("anim-rise mt-6 flex items-center justify-center gap-2 text-[24px] font-semibold", verdictColor[verdict])}
        style={{ animationDelay: "500ms" }}
      >
        <span className={cx("size-2.5 rounded-full", verdictBg[verdict])} />
        {v.label}
      </h2>
      <p className="anim-rise mx-auto mt-2 max-w-sm text-soft" style={{ animationDelay: "600ms" }}>
        {v.advice}
      </p>

      {flags.length > 0 && (
        <ul className="mx-auto mt-7 max-w-md space-y-2 text-left">
          {flags.map((f, i) => (
            <li
              key={f.text}
              className="anim-rise flex gap-3 rounded-lg bg-surface px-4 py-3 text-[13px]"
              style={{ animationDelay: `${750 + i * 90}ms` }}
            >
              <span
                className={cx("mt-1.5 size-1.5 shrink-0 rounded-full", f.risk === 2 ? "bg-down" : "bg-warn")}
              />
              {f.text}
            </li>
          ))}
        </ul>
      )}

      <div className="anim-rise mt-8" style={{ animationDelay: `${850 + flags.length * 90}ms` }}>
        <Button onClick={onEnter} className="px-6 py-2.5 text-[14px]">
          {verdict === "sit-out" ? "Understood — continue" : "See my briefing"}
        </Button>
      </div>
    </div>
  );
}

/** Animates a number from 0 up to `target`. */
function useCountUp(target: number, ms = 1200) {
  const [v, setV] = useState(0);
  useEffect(() => {
    const start = performance.now();
    let id = 0;
    const tick = (now: number) => {
      const t = Math.min((now - start) / ms, 1);
      setV(Math.round(target * (1 - (1 - t) ** 3)));
      if (t < 1) id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [target, ms]);
  return v;
}

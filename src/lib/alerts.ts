/**
 * The desk's ears.
 *
 * Two things are worth interrupting you for: a red release about to print, and a
 * headline that changes the picture. Everything else is noise, and an alert engine
 * that cries wolf gets muted within a day — so the keyword lists are deliberately
 * short and there is a hard cooldown between sounds.
 */

/** Words that mean stop what you are doing. */
const CRITICAL =
  /\b(missile|war|invasion|attack|emergency|nuclear|airstrike|explosion|evacuat\w*|ceasefire|sanctions)\b/i;

/**
 * Words that move the instruments this desk trades. Deliberately narrow: bare
 * "cut" or "hike" also matches a broker changing a price target, which is not news.
 */
const HOT =
  /\b(powell|fed|fomc|ecb|lagarde|boe|bailey|boj|snb|rate (hike|hikes|cut|cuts|decision)|interest rates?|tariffs?|trump|white house|cpi|inflation|payrolls|nfp|jobless|intervention|opec|stimulus|shutdown|default|gaza|ukraine|russia|israel|iran|china|xi|putin|zelensk\w*|nato|middle east|summit|election|embargo|export ban)\b/i;

/**
 * Routine prints that arrive constantly and say nothing you can trade. Auction
 * results, survey numbers and broker target changes all follow fixed shapes.
 */
const NOISE =
  /\bactual\b.*\(forecast|bid-to-cover|\bauction\b|\byield actual\b|year-end .*target|price target|to (underweight|overweight|neutral) from|\bmba\b|interest rate probabilities|- fjelite$/i;

/** Whether a flash earns a place on a wire you actually read. */
export function isImportant(title: string) {
  if (NOISE.test(title)) return false;
  return urgencyOf(title) !== null;
}

export type Urgency = "critical" | "hot" | null;

export function urgencyOf(text: string): Urgency {
  if (CRITICAL.test(text)) return "critical";
  if (HOT.test(text)) return "hot";
  return null;
}

/** Splits a headline so the urgent words can be lit up without touching the rest. */
export function highlight(text: string): { text: string; tone: Urgency }[] {
  const out: { text: string; tone: Urgency }[] = [];
  const pattern = new RegExp(`(${CRITICAL.source})|(${HOT.source})`, "gi");
  let last = 0;
  for (const m of text.matchAll(pattern)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ text: text.slice(last, i), tone: null });
    out.push({ text: m[0], tone: CRITICAL.test(m[0]) ? "critical" : "hot" });
    last = i + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), tone: null });
  return out;
}

/* ── The chime ───────────────────────────────────────────────────────── */

let ctx: AudioContext | null = null;
let lastPlayed = 0;

/**
 * Browsers refuse audio until a trusted gesture; the alerts button is that gesture.
 *
 * resume() is raced against a timeout on purpose: without a real click it can stay
 * pending forever, and awaiting it directly would hang the click handler and make
 * the whole button look dead.
 */
export async function unlockAudio(timeoutMs = 600): Promise<boolean> {
  try {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state !== "running") {
      await Promise.race([
        ctx.resume(),
        new Promise((resolve) => setTimeout(resolve, timeoutMs)),
      ]);
    }
    return ctx.state === "running";
  } catch {
    return false;
  }
}

/**
 * A two-tone terminal chime, synthesised rather than loaded — no asset to ship and
 * no delay the first time it fires. Critical alerts get a lower, harder pair.
 */
export function chime(kind: "event" | "critical" = "event", cooldownMs = 10_000) {
  if (!ctx || ctx.state !== "running") return false;
  const now = Date.now();
  if (now - lastPlayed < cooldownMs) return false; // no spamming during a cluster
  lastPlayed = now;

  const [a, b] = kind === "critical" ? [740, 494] : [880, 1319];
  const t0 = ctx.currentTime;

  for (const [i, freq] of [a, b].entries()) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;

    const start = t0 + i * 0.13;
    // A quick swell and a soft tail: audible across a room, not startling.
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(kind === "critical" ? 0.3 : 0.2, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.42);

    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.45);
  }
  return true;
}

/** Plays the chime ignoring the cooldown, so the toggle can prove it works. */
export const testChime = () => chime("event", 0);

/* ── The visible half of an alert ────────────────────────────────────── */

const BASE_TITLE = "Gucci Trade Journal";
let titleTimer: number | undefined;

/** Flashes the tab title so an alert survives you being in another window. */
export function flashTitle(text: string, ms = 20_000) {
  clearTimeout(titleTimer);
  document.title = text;
  titleTimer = window.setTimeout(() => {
    document.title = BASE_TITLE;
  }, ms);
}

export const clearTitle = () => {
  clearTimeout(titleTimer);
  document.title = BASE_TITLE;
};

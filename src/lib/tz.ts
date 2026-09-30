/**
 * The desk runs on New York time.
 *
 * Gustaw sits in Amsterdam but thinks in New York hours — the strategy is written
 * around the 3–4am NY box, and every level and session he talks about is NY. Rather
 * than translate in his head twice a day, the whole app speaks one clock.
 *
 * Trade times are stored as naive wall-clock strings ("2026-09-21T04:23") and are
 * always desk time. Anything with a real instant — a news release, a headline — is
 * stored as UTC and rendered here. Offsets come from the runtime, so the two
 * timezones changing clocks on different weekends is handled for free.
 */
export const DESK_TZ = "America/New_York";
export const DESK_LABEL = "New York";

/** Wall-clock pieces of an instant, as the desk's clock shows them. */
function parts(d: Date) {
  const f = new Intl.DateTimeFormat("en-GB", {
    timeZone: DESK_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const got: Record<string, string> = {};
  for (const p of f.formatToParts(d)) if (p.type !== "literal") got[p.type] = p.value;
  // Intl can return "24" for midnight in some runtimes.
  if (got.hour === "24") got.hour = "00";
  return got;
}

/** "YYYY-MM-DDTHH:mm" now, ready for a datetime-local input. */
export function deskNow(d = new Date()) {
  const p = parts(d);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** "YYYY-MM-DD" for an instant, on the desk's calendar. */
export function deskDay(d: Date = new Date()) {
  const p = parts(d);
  return `${p.year}-${p.month}-${p.day}`;
}

/** "HH:mm" for an instant, on the desk's clock. */
export function deskTime(iso: string | Date) {
  const p = parts(typeof iso === "string" ? new Date(iso) : iso);
  return `${p.hour}:${p.minute}`;
}

/** "HH:mm:ss" — the wire needs seconds. */
export function deskStamp(iso: string | Date) {
  const p = parts(typeof iso === "string" ? new Date(iso) : iso);
  return `${p.hour}:${p.minute}:${p.second}`;
}

/** A date on the desk's calendar, e.g. "Thu 24 Sep". */
export function deskDateLabel(iso: string | Date) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: DESK_TZ,
    weekday: "long",
    day: "numeric",
    month: "short",
  }).format(typeof iso === "string" ? new Date(iso) : iso);
}


import type { CheckIn } from "./checkin";
import type { Candle, Timeframe } from "./chart";
import type { BiasFile } from "./dailyBias";
import type { Plan, PlanInput } from "./plans";
import type { Rulebook, RulebookVersion, VersionRow } from "./rulebook";
import type { Limits, Strategy, StrategyInput, Trade, TradeInput, WeekNote } from "./types";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

export const api = {
  list: () => request<Trade[]>("/api/trades"),
  create: (t: TradeInput) =>
    request<Trade>("/api/trades", { method: "POST", body: JSON.stringify(t) }),
  update: (id: string, t: TradeInput) =>
    request<Trade>(`/api/trades/${id}`, { method: "PUT", body: JSON.stringify(t) }),
  remove: (id: string) => request<void>(`/api/trades/${id}`, { method: "DELETE" }),
  strategies: () => request<Strategy[]>("/api/strategies"),
  createStrategy: (s: StrategyInput) =>
    request<Strategy>("/api/strategies", { method: "POST", body: JSON.stringify(s) }),
  updateStrategy: (id: string, s: StrategyInput) =>
    request<Strategy>(`/api/strategies/${id}`, { method: "PUT", body: JSON.stringify(s) }),
  removeStrategy: (id: string) =>
    request<void>(`/api/strategies/${id}`, { method: "DELETE" }),
  weeks: () => request<WeekNote[]>("/api/weeks"),
  saveWeek: (w: Pick<WeekNote, "week" | "bias" | "reasoning" | "levels">) =>
    request<WeekNote>(`/api/weeks/${w.week}`, { method: "PUT", body: JSON.stringify(w) }),
  limits: () => request<Limits>("/api/limits"),
  /** A limit is a rule: changing one writes a new rulebook version, so it needs a reason. */
  saveLimits: (l: Limits, reason: string) =>
    request<Limits>("/api/limits", { method: "PUT", body: JSON.stringify({ ...l, reason }) }),
  rulebook: () => request<RulebookVersion>("/api/rulebook"),
  versions: () => request<VersionRow[]>("/api/rulebook/versions"),
  version: (v: string) => request<RulebookVersion>(`/api/rulebook/versions/${encodeURIComponent(v)}`),
  saveRulebook: (doc: Rulebook, reason: string, bump: "minor" | "major") =>
    request<RulebookVersion>("/api/rulebook", { method: "PUT", body: JSON.stringify({ doc, reason, bump }) }),
  plans: () => request<Plan[]>("/api/plans"),
  savePlan: (p: PlanInput) =>
    request<Plan>(`/api/plans/${p.date}`, { method: "PUT", body: JSON.stringify(p) }),
  openItems: () => request<OpenItem[]>("/api/open-items"),
  setOpenItem: (id: string, done: boolean) =>
    request<OpenItem>(`/api/open-items/${id}`, { method: "PUT", body: JSON.stringify({ done }) }),
  bias: () => request<BiasFile>("/api/bias"),
  candles: (tf: Timeframe) =>
    request<{ tf: string; source: string; candles: Candle[]; fetchedAt: number; stale: boolean }>(
      `/api/candles?tf=${tf}`,
    ),
  checkins: () => request<CheckIn[]>("/api/checkins"),
  saveCheckIn: (c: Omit<CheckIn, "createdAt">) =>
    request<CheckIn>(`/api/checkins/${c.date}`, { method: "PUT", body: JSON.stringify(c) }),
};

/** One tickable open item from the rulebook. */
export interface OpenItem {
  id: string;
  text: string;
  done: boolean;
  doneAt: string | null;
}

import type { CheckIn } from "./checkin";
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
  saveLimits: (l: Limits) =>
    request<Limits>("/api/limits", { method: "PUT", body: JSON.stringify(l) }),
  checkins: () => request<CheckIn[]>("/api/checkins"),
  saveCheckIn: (c: Omit<CheckIn, "createdAt">) =>
    request<CheckIn>(`/api/checkins/${c.date}`, { method: "PUT", body: JSON.stringify(c) }),
};

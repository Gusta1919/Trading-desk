/** The desk's local API, as the page calls it. */
import type { CheckIn } from "./checkin";
import type { Candle, Timeframe } from "./chart";
import type { BiasFile } from "./dailyBias";
import type { Rulebook, RulebookVersion } from "./rulebook";
import type { Trade, TradeInput } from "./types";

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
  create: (t: TradeInput) => request<Trade>("/api/trades", { method: "POST", body: JSON.stringify(t) }),
  update: (id: string, t: TradeInput) => request<Trade>(`/api/trades/${id}`, { method: "PUT", body: JSON.stringify(t) }),
  remove: (id: string) => request<void>(`/api/trades/${id}`, { method: "DELETE" }),

  /** The version in force and every version, with their documents. */
  rulebook: () => request<{ current: RulebookVersion; versions: RulebookVersion[] }>("/api/rulebook"),
  /** A change is saved as the next version; it needs a one-line reason for the changelog. */
  saveRulebook: (doc: Rulebook, reason: string) =>
    request<RulebookVersion>("/api/rulebook", { method: "PUT", body: JSON.stringify({ doc, reason }) }),

  checkins: () => request<CheckIn[]>("/api/checkins"),
  saveCheckIn: (c: Omit<CheckIn, "createdAt">) =>
    request<CheckIn>(`/api/checkins/${c.date}`, { method: "PUT", body: JSON.stringify(c) }),

  bias: () => request<BiasFile>("/api/bias"),
  candles: (tf: Timeframe) =>
    request<{ tf: string; source: string; candles: Candle[]; fetchedAt: number; stale: boolean }>(`/api/candles?tf=${tf}`),
};

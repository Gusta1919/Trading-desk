import type { JournalEntry, JournalInput, Trade, TradeInput } from "@/types";

const API = "/api";

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export async function initDatabase(): Promise<void> {
  await request(`${API}/health`);
}

export async function getAllTrades(): Promise<Trade[]> {
  return request(`${API}/trades`);
}

export async function getTrade(id: string): Promise<Trade | null> {
  try {
    return await request(`${API}/trades/${id}`);
  } catch {
    return null;
  }
}

export async function createTrade(input: TradeInput): Promise<Trade> {
  return request(`${API}/trades`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateTrade(
  id: string,
  input: Partial<TradeInput>,
): Promise<Trade | null> {
  return request(`${API}/trades/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function deleteTrade(id: string): Promise<void> {
  await request(`${API}/trades/${id}`, { method: "DELETE" });
}

export async function getAllJournalEntries(): Promise<JournalEntry[]> {
  return request(`${API}/journal`);
}

export async function getJournalForTrade(
  tradeId: string,
): Promise<JournalEntry[]> {
  const all = await getAllJournalEntries();
  return all.filter((j) => j.tradeId === tradeId);
}

export async function createJournalEntry(
  input: JournalInput,
): Promise<JournalEntry> {
  return request(`${API}/journal`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateJournalEntry(): Promise<JournalEntry | null> {
  return null;
}

export async function deleteJournalEntry(): Promise<void> {}

export async function seedDemoData(): Promise<void> {
  // seed happens on server startup
}

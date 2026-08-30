import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number, currency = "USD"): string {
  return new Intl.NumberFormat("pl-PL", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatPercent(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("pl-PL", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));
}

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("pl-PL", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function generateId(): string {
  return crypto.randomUUID();
}

export function pnlColor(value: number | null | undefined): string {
  if (value == null || value === 0) return "text-muted-foreground";
  return value > 0 ? "text-emerald-400" : "text-rose-400";
}

export function entryTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    pre_trade: "Przed tradem",
    during: "W trakcie",
    post_trade: "Po tradzie",
    reflection: "Refleksja",
    general: "Ogólne",
  };
  return labels[type] ?? type;
}

export function sessionLabel(session: string): string {
  const labels: Record<string, string> = {
    premarket: "Premarket",
    regular: "Sesja główna",
    afterhours: "After hours",
  };
  return labels[session] ?? session;
}

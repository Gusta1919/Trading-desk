import { cn, formatCurrency, pnlColor } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: string;
  subtext?: string;
  trend?: "positive" | "negative" | "neutral";
  className?: string;
}

export function StatCard({
  label,
  value,
  subtext,
  trend = "neutral",
  className,
}: StatCardProps) {
  return (
    <div
      className={cn(
        "glass rounded-xl p-5 transition-all duration-300 hover:border-border/80",
        trend === "positive" && "stat-glow-positive",
        trend === "negative" && "stat-glow-negative",
        className,
      )}
    >
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "mt-2 font-mono text-2xl font-medium tracking-tight",
          trend === "positive" && "text-emerald-400",
          trend === "negative" && "text-rose-400",
          trend === "neutral" && "text-foreground",
        )}
      >
        {value}
      </p>
      {subtext && (
        <p className="mt-1 text-xs text-muted-foreground">{subtext}</p>
      )}
    </div>
  );
}

export function PnlDisplay({
  value,
  className,
}: {
  value: number | null | undefined;
  className?: string;
}) {
  if (value == null) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={cn("font-mono", pnlColor(value), className)}>
      {formatCurrency(value)}
    </span>
  );
}

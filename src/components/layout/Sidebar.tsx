import {
  BarChart3,
  BookOpen,
  LayoutDashboard,
  Lightbulb,
  Plus,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ViewId } from "@/types";
import { Button } from "@/components/ui/button";

const navItems: { id: ViewId; label: string; icon: typeof LayoutDashboard }[] =
  [
    { id: "dashboard", label: "Pulpit", icon: LayoutDashboard },
    { id: "trades", label: "Trady", icon: TrendingUp },
    { id: "journal", label: "Dziennik", icon: BookOpen },
    { id: "stats", label: "Statystyki", icon: BarChart3 },
    { id: "insights", label: "Wnioski", icon: Lightbulb },
  ];

interface SidebarProps {
  activeView: ViewId;
  onNavigate: (view: ViewId) => void;
  onNewTrade: () => void;
}

export function Sidebar({ activeView, onNavigate, onNewTrade }: SidebarProps) {
  return (
    <aside className="flex h-full w-[220px] shrink-0 flex-col border-r border-border bg-sidebar px-4 py-6">
      <div className="mb-8 px-2">
        <p className="font-serif text-2xl tracking-tight text-foreground">
          Toidora
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Dziennik tradingowy
        </p>
      </div>

      <Button
        onClick={onNewTrade}
        className="mb-6 w-full justify-start gap-2"
        size="sm"
      >
        <Plus className="h-4 w-4" />
        Nowy trade
      </Button>

      <nav className="flex flex-1 flex-col gap-1">
        {navItems.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => onNavigate(id)}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all duration-200 cursor-pointer",
              activeView === id
                ? "bg-accent/10 text-accent font-medium"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </nav>

      <div className="mt-auto border-t border-border pt-4 px-2">
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground/60">
          Lokalnie · SQLite
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Twoje dane nigdy nie opuszczają Maca
        </p>
      </div>
    </aside>
  );
}

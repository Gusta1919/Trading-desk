import { useState } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { TradeFormDialog } from "@/components/trades/TradeFormDialog";
import { TradeDetailPanel } from "@/components/trades/TradeDetailPanel";
import { AppDataProvider, useAppData } from "@/context/AppDataProvider";
import { Dashboard } from "@/pages/Dashboard";
import { InsightsPage } from "@/pages/InsightsPage";
import { JournalPage } from "@/pages/JournalPage";
import { StatsPage } from "@/pages/StatsPage";
import { TradesPage } from "@/pages/TradesPage";
import type { Trade, ViewId } from "@/types";

function AppShell() {
  const [view, setView] = useState<ViewId>("dashboard");
  const [selectedTrade, setSelectedTrade] = useState<Trade | null>(null);
  const [tradeFormOpen, setTradeFormOpen] = useState(false);
  const [editingTrade, setEditingTrade] = useState<Trade | null>(null);
  const { refresh } = useAppData();

  const handleSelectTrade = (trade: Trade) => {
    setSelectedTrade(trade);
    if (view !== "trades") setView("trades");
  };

  const handleNewTrade = () => {
    setEditingTrade(null);
    setTradeFormOpen(true);
  };

  const handleEditTrade = (trade: Trade) => {
    setEditingTrade(trade);
    setTradeFormOpen(true);
  };

  const handleSaved = async () => {
    await refresh();
    setEditingTrade(null);
  };

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        activeView={view}
        onNavigate={setView}
        onNewTrade={handleNewTrade}
      />

      <main className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-y-auto">
          {view === "dashboard" && (
            <Dashboard
              onNavigate={setView}
              onSelectTrade={handleSelectTrade}
            />
          )}
          {view === "trades" && (
            <TradesPage
              onSelectTrade={handleSelectTrade}
              selectedTradeId={selectedTrade?.id}
            />
          )}
          {view === "journal" && <JournalPage />}
          {view === "stats" && <StatsPage />}
          {view === "insights" && <InsightsPage />}
        </div>

        {selectedTrade && (view === "trades" || view === "dashboard") && (
          <TradeDetailPanel
            trade={selectedTrade}
            onClose={() => setSelectedTrade(null)}
            onEdit={handleEditTrade}
            onDeleted={refresh}
          />
        )}
      </main>

      <TradeFormDialog
        open={tradeFormOpen}
        onOpenChange={setTradeFormOpen}
        trade={editingTrade}
        onSaved={handleSaved}
      />
    </div>
  );
}

export default function App() {
  return (
    <AppDataProvider>
      <AppShell />
    </AppDataProvider>
  );
}

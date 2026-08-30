# Toidora

**Dziennik tradingowy** — lokalna aplikacja na MacBooka do dokumentowania tradów, analizy statystyk i zapisywania przemyśleń.

Wszystkie dane trzymane są lokalnie w SQLite. Nic nie opuszcza Twojego komputera.

## Funkcje (v0.1)

- **Pulpit** — podsumowanie P&L, win rate, profit factor, krzywa equity
- **Trady** — pełny dziennik z filtrowaniem, tagami, oceną wykonania i stanem emocjonalnym
- **Dziennik** — wpisy przed/w trakcie/po tradzie, refleksje
- **Statystyki** — expectancy, średnie R, wyniki per strategia i setup
- **Wnioski** — automatyczna analiza wzorców (FOMO, dyscyplina, serie strat)

## Stack

- [Tauri 2](https://tauri.app/) — natywna aplikacja macOS (szybki start z docka)
- React + TypeScript + Tailwind CSS
- SQLite (tauri-plugin-sql)

## Wymagania (Mac)

1. [Node.js](https://nodejs.org/) 20+
2. [Rust](https://rustup.rs/)
3. Xcode Command Line Tools: `xcode-select --install`

Pełne wymagania Tauri: https://tauri.app/start/prerequisites/

## Uruchomienie

```bash
# Instalacja zależności
npm install

# Development (natywna aplikacja)
npm run tauri:dev

# Tylko frontend (przeglądarka, dane w localStorage)
npm run dev
```

## Build produkcyjny (`.app` na Maca)

```bash
npm run tauri:build
```

Gotowa aplikacja pojawi się w `src-tauri/target/release/bundle/macos/`. Przeciągnij ją do Docka — startuje w ~1 sekundę.

## Gdzie są dane?

Baza SQLite: `toidora.db` w katalogu danych aplikacji Tauri na Twoim Macu.

## Roadmap (kolejne feature'y)

- Import z brokera (CSV)
- Checklisty przed wejściem
- Kalendarz sesji
- Zaawansowane wykresy (heatmapa godzin, dni tygodnia)
- Eksport PDF raportów
- Sync opcjonalny (iCloud / własny serwer)
- Screenshots wykresów przy tradzie

---

*Toidora* — Twój dziennik. Twoje dane. Twoje wnioski.

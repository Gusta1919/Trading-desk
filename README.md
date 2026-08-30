# Trade Assistant

**Lokalny dziennik tradingowy** na MacBooka — trady, statystyki, notatki i wnioski. Wszystko na Twoim komputerze.

## Uruchomienie na Macu

```bash
cd ~/Documents/Trading/trading-journal
npm install
npm run tauri:dev
```

Build `.app` do docka:

```bash
npm run tauri:build
```

Gotowa aplikacja: `src-tauri/target/release/bundle/macos/`

## Wymagania

- Node.js 20+
- Rust ([rustup.rs](https://rustup.rs))
- Xcode Command Line Tools: `xcode-select --install`

## Funkcje (v0.1)

- Pulpit z KPI i krzywą equity
- Dziennik tradów z tagami, oceną wykonania, psychologią
- Notatki i refleksje
- Statystyki per strategia i setup
- Automatyczne wnioski z analizy wzorców

## Dane

SQLite lokalnie — nic nie opuszcza Twojego Maca.

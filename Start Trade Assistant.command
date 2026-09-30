#!/bin/bash
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

URL="http://localhost:3847"

clear
echo ""
echo "  Trade Assistant"
echo "  ─────────────────────────────────"
echo ""

if ! command -v node &>/dev/null; then
  echo "  ✗ Nie widzę Node.js."
  echo "    Zainstaluj z https://nodejs.org (LTS)"
  echo ""
  read -r -p "  Naciśnij Enter, żeby zamknąć…"
  exit 1
fi

if curl -sf "$URL" >/dev/null 2>&1; then
  echo "  ✓ Serwer już działa — otwieram dziennik…"
  open "$URL"
  echo ""
  read -r -p "  Naciśnij Enter, żeby zamknąć…"
  exit 0
fi

echo "  ▶ Startuję serwer (pierwsze uruchomienie ~10 s)…"
echo ""

npm start &
SERVER_PID=$!

for _ in $(seq 1 45); do
  if curl -sf "$URL" >/dev/null 2>&1; then
    echo ""
    echo "  ✓ Gotowe — otwieram http://localhost:3847"
    open "$URL"
    echo ""
    echo "  Zostaw to okno otwarte, dopóki korzystasz z dziennika."
    echo "  Zamknięcie okna = wyłączenie serwera."
    echo ""
    wait "$SERVER_PID"
    exit 0
  fi
  sleep 1
done

echo ""
echo "  ✗ Serwer się nie uruchomił."
echo "    Spróbuj w tym folderze: npm install && npm start"
echo ""
kill "$SERVER_PID" 2>/dev/null || true
read -r -p "  Naciśnij Enter, żeby zamknąć…"
exit 1

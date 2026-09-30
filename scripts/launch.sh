#!/bin/bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP="$APP_DIR/Trade Assistant.app"
URL="http://localhost:3847"

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

if [ -s "$HOME/.fnm/env" ]; then
  # shellcheck source=/dev/null
  source "$HOME/.fnm/env"
fi

if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck source=/dev/null
  source "$HOME/.nvm/nvm.sh"
fi

mkdir -p "$APP_DIR/data"
LOG_FILE="$APP_DIR/data/launcher.log"

log() {
  printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" | tee -a "$LOG_FILE"
}

notify() {
  osascript -e "display notification \"$2\" with title \"Trade Assistant\"" 2>/dev/null || true
}

alert() {
  osascript -e "display alert \"Trade Assistant\" message \"$1\"" 2>/dev/null || true
}

is_running() {
  curl -sf "$URL" >/dev/null 2>&1
}

wait_for_server() {
  for _ in $(seq 1 45); do
    if is_running; then
      return 0
    fi
    sleep 1
  done
  return 1
}

open_app() {
  open "$URL"
}

log "Launch start"

if ! command -v node &>/dev/null; then
  log "ERROR: node not found"
  alert "Nie widzę Node.js. Zainstaluj z nodejs.org albo: brew install node"
  exit 1
fi

cd "$APP_DIR"

if is_running; then
  log "Server already running"
  open_app
  exit 0
fi

notify "Uruchamianie" "Startuję serwer Trade Assistant…"

npm start >>"$LOG_FILE" 2>&1 &
SERVER_PID=$!
log "npm start pid=$SERVER_PID"

if wait_for_server; then
  log "Server ready"
  open_app
  notify "Gotowe" "Dziennik otwarty w przeglądarce."
  exit 0
fi

log "ERROR: timeout"
kill "$SERVER_PID" 2>/dev/null || true
alert "Serwer się nie uruchomił. Sprawdź data/launcher.log albo uruchom npm start w Terminalu."
exit 1

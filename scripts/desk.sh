# Shared by the launchers (scripts/launch.sh and "Start Trade Assistant.command").
# Source it after `cd` into the desk's folder.

WEB_URL="http://localhost:3847"
API_ABOUT="http://127.0.0.1:3848/api/about"
DESK_DIR="$(pwd -P)"

# This folder's desk is the one answering: its API names this folder.
desk_is_ours() {
  curl -sf "$API_ABOUT" 2>/dev/null | grep -q "\"dir\":\"$DESK_DIR\""
}

# Something answers on the desk's ports.
desk_is_up() {
  curl -sf "$WEB_URL" >/dev/null 2>&1 || curl -sf "$API_ABOUT" >/dev/null 2>&1
}

# Stops whatever holds the desk's ports — an older copy left running, most often.
desk_stop_stale() {
  local pids
  pids="$(lsof -ti tcp:3847 -ti tcp:3848 2>/dev/null | sort -u)"
  [ -z "$pids" ] && return 0
  kill $pids 2>/dev/null || true
  for _ in 1 2 3 4 5; do
    sleep 1
    pids="$(lsof -ti tcp:3847 -ti tcp:3848 2>/dev/null | sort -u)"
    [ -z "$pids" ] && return 0
  done
  kill -9 $pids 2>/dev/null || true
}

# Installs packages when they're missing or older than the lockfile, and rebuilds the
# database driver when Node was upgraded since it was built.
desk_prepare() {
  if [ ! -d node_modules ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
    npm install || return 1
  fi
  if ! node -e "new (require('better-sqlite3'))(':memory:').close()" >/dev/null 2>&1; then
    npm rebuild better-sqlite3 || return 1
  fi
}

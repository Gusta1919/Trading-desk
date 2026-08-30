#!/bin/bash
cd "$(dirname "$0")"

if ! command -v node &>/dev/null; then
  osascript -e 'display alert "Zainstaluj Node.js" message "Pobierz z nodejs.org (LTS)"'
  exit 1
fi

npm start &
sleep 2
open http://localhost:3847

# Trade Assistant

Lokalna strona w przeglądarce + baza SQLite na dysku. Bez aplikacji natywnych, bez chmury.

## Szybki start (Mac)

```bash
cd ~/Documents/Trading/trading-journal
npm install
npm start
```

Otwórz: **http://localhost:3847**

## Dodaj do Docka

1. Uruchom `npm install` raz
2. Kliknij dwukrotnie **`Start Trade Assistant.command`**
3. Przeciągnij ten plik do Docka

Przy każdym kliknięciu: start serwera + otwarcie strony w przeglądarce.

## Gdzie są dane?

```
data/trade-assistant.db
```

Plik SQLite w folderze projektu. Możesz go backupować kopiując ten plik.

## Co potrzebujesz

- Node.js 20+ → https://nodejs.org

To wszystko. Bez Rusta, bez Xcode, bez Tauri.

## Pobranie projektu (jednorazowo)

```bash
curl -fsSL https://downloads.cursor.com/origin/install.sh | sh
origin auth login
mkdir -p ~/Documents/Trading && cd ~/Documents/Trading
origin repo clone gusta1919/trading-journal
```

Jeśli `origin` nie działa:

```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

**Repozytorium:** https://cursor.com/codebase/gusta1919/trading-journal

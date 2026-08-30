# Trade Assistant

Lokalna strona + baza SQLite. Wszystko siedzi w **~/Documents/Trading/**.

Bez GitHuba. Bez chmury. Bez aplikacji natywnej.

---

## Gdzie to leży

```
~/Documents/Trading/
├── Start Trade Assistant.command   ← kliknij, żeby odpalić
├── package.json
├── src/                            ← strona
├── server/                         ← API + baza
├── data/trade-assistant.db         ← TWOJE trady (tworzy się sam)
└── Trading Graphs/                 ← Twój istniejący folder (zostaje)
```

---

## Pierwsze uruchomienie (raz)

### 1. Node.js

https://nodejs.org → LTS → instaluj.

### 2. Skopiuj pliki projektu do `~/Documents/Trading/`

W Cursorze: **Codebase → Download ZIP** → rozpakuj zawartość do folderu `Trading` w Dokumentach.

Albo skopiuj pliki z tego agenta ręcznie — ważne, żeby `package.json` był w `~/Documents/Trading/`.

### 3. Terminal

```bash
cd ~/Documents/Trading
npm install
```

---

## Każde kolejne uruchomienie

**Opcja A — Dock:**  
Kliknij dwukrotnie `Start Trade Assistant.command` (przeciągnij go do Docka).

**Opcja B — Terminal:**

```bash
cd ~/Documents/Trading
npm start
```

Potem otwórz: **http://localhost:3847**

---

## Backup tradów

Skopiuj plik:

```
~/Documents/Trading/data/trade-assistant.db
```

To wszystko. Jeden plik = cała historia.

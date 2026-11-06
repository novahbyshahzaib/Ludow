# Ludow 🎲

Professional, fully offline Ludo — play with friends on one device (Pass & Play) or against a hard CPU. Installable as an app (PWA) on phone and desktop.

**Live / install target:** `ludow-snoah.vercel.app` (deploy this folder as a static site on Vercel — no build step).

## Features

- **Pass & Play (2–4 humans):** each player picks a colour and an editable name. 2-player defaults to Red vs Yellow, but any 2 colours work.
- **Vs CPU:** any mix per colour — Human / CPU / Off. CPU difficulty Easy / Medium / Hard (default Hard). Hard CPU scores every legal move: capture +100, finish +90, leave base +60, land safe +55, enter home column +45, form a block +40, progress bonus, landing in danger −70, escaping danger +50 — and picks the best (random tie-break). It thinks 600–900 ms and animates its roll/move so you can follow it.
- **Fair dice, verifiable:** default **Fair Random** uses `crypto.getRandomValues` with rejection sampling (no modulo bias, no rigging — see the comment at the top of `app.js`). Settings also offer Classic Random, Lucky, Super Lucky, Unlucky/Challenge, and a Custom Luck slider (−100…+100). The dice panel shows live counts for faces 1–6 so fairness can be checked, with a Reset stats button.
- **Full rules:** need a 6 to leave base, extra turn on 6 / capture / finishing a piece, three consecutive 6s forfeits the turn, exact roll to finish, capture on non-safe cells, blocks (2+ same colour can't be captured and can't be landed on), safe ★ cells and coloured start cells, no-move auto-pass.
- **Professional board:** classic 15×15 board, coloured 6×6 home bases with white yards, coloured home columns, centre home triangles, ★ safe cells, glossy tokens with numbers, stacked pieces offset so all are visible, pulsing gold ring on movable pieces.
- **All controls:** Roll (button / tap dice / Space), tap a glowing piece to move, Pass, New Game, Restart, Pause/Resume (pauses CPU timers), Quit to Menu, Rules, Sound toggle, Settings, Install App, move log, scoreboard (home / in play / in base), turn indicator, winner modal with confetti, Play Again / Main Menu.
- **Settings (saved in localStorage):** dice mode + luck slider, sound (WebAudio, no files), animation speed, CPU difficulty, toggles for need-6 / extra-on-6 / extra-on-capture / three-6s forfeit / block protection / move hints, board theme (Classic / Dark / Neon), player names.
- **Fully offline PWA:** no CDN, no webfonts, no external images or requests at all. `sw.js` caches every local asset cache-first. Install from the ⬇ Install button (or browser menu → Add to Home Screen) — it opens standalone, full-screen, without a browser header.

## How to play

1. On the menu, pick a preset (2/3/4 players, or vs CPU) or set each colour to Human / CPU / Off, edit names, pick difficulty and dice mode, then **Start game**.
2. Tap **Roll dice** (or the dice, or Space). Need a 6 to leave base.
3. Tap a **glowing piece** to move it. Land on an opponent to capture them (not on ★ safe cells). Get all 4 pieces home first to win.

## Run locally

```bash
cd ludow
python3 -m http.server 8000
# open http://localhost:8000/
```

## Deploy (Vercel)

Import the repo / folder in Vercel as a static project (no build command, no framework). `vercel.json` is included. Suggested domain: `ludow-snoah.vercel.app`.

## Files

| File | What it is |
| --- | --- |
| `index.html` | Menu, game screen, Settings / Rules / Winner / Install modals |
| `styles.css` | All styling — board, pieces, dice, themes, responsive layout |
| `app.js` | Board data, rules, dice RNG, CPU AI, game flow, PWA registration |
| `manifest.webmanifest` | PWA manifest (standalone, icons, theme colour) |
| `sw.js` | Cache-first service worker for offline play |
| `icons/icon-192.png`, `icons/icon-512.png`, `icons/icon-maskable-512.png` | App icons (dark dice, red/green/yellow/blue) |
| `vercel.json` | Static hosting config |

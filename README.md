## examTimer

# A fully offline, per-question timer for UPSC Mains practice. Set up your paper
(total time + each question's marks and minutes), then run a timed session with
a large current-question timer, a total-remaining timer, a saved-time buffer,
color/sound alerts, and a live question list.
## Features
- **Fully manual setup** — total exam time + marks & minutes per question, with a
"GS: 10×10m + 10×15m" preset and adjustable per-mark minute defaults.
- **Large timer** for the current question; **medium timer** for total time
remaining (real-time countdown); **buffer pool** that grows when you finish
early and shrinks (turns red) when you go overtime.
- **Color states** per question, proportional to its budget:
green (0–80%) → orange (80–100%) → red (overtime).
- **Sound alerts** at the orange and red thresholds, with a mute toggle.
- **Auto-saves** setup and in-progress session to `localStorage` — refresh-safe,
with a "Resume last session" option.
- **Works 100% offline** (PWA) — installable on mobile and desktop.
- Keyboard shortcuts: **Space** = pause/resume, **N** = mark done / next.
## Run locally
Because of the service worker, open it via a local server (not `file://`):
bash
cd examTimer
python3 -m http.server 8000
# then open http://localhost:8000
You can still open `index.html` directly for a quick look, but offline install
needs to be served over http/https.
## Deploy to GitHub Pages
1. Push this folder to a GitHub repo.
2. Repo → **Settings → Pages** → Source: **Deploy from a branch** →
Branch: `main` (root) → Save.
3. Your site goes live at `https://<username>.github.io/<repo>/`.
Because the paths are relative, it works whether served at the domain root or a
`/<repo>/` subpath.
## Install on your devices (offline app)
- **Android / Chrome:** open the Pages URL → menu → **Add to Home screen**.
- **iOS / Safari:** open the URL → Share → **Add to Home Screen**.
- **Desktop / Chrome or Edge:** open the URL → **Install** icon in the address bar.
After the first load the app is cached and runs with no network connection.
## Customize
- **Color thresholds:** edit `ORANGE_AT` / `RED_AT` at the top of `app.js`.
- **App files changed?** bump `CACHE_VERSION` in `service-worker.js` so devices
pull the update.
- **Icon:** replace `icons/icon.svg` (add PNG sizes to `manifest.json` if you
want store-grade icons).

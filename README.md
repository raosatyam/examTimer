# Exam Timer

A fully offline, per-question timer for exam practice. Pick a paper preset
(or build a custom one), then run a timed session with a large current-question
timer, a total-remaining timer, a saved-time buffer, color/sound alerts, and a
live question list you can navigate freely.

## Features

### Setup
- **Paper presets** from a config file (`presets.js`) — pick from a dropdown.
  Built-ins: GS Mains, Essay, Prelims GS, Prelims CSAT (plus any you add).
- **Custom paper builder** — choose "Custom…" and define question groups
  (`marks × count`). You don't enter times: each question's minutes are
  **auto-filled from the total exam time, proportional to marks**.
- **Live "time per question type" editor** — one row per mark-type in the paper
  (e.g. `10 marks × 10 → 7.5 min`); changing a value **instantly applies to every
  question of that type**.
- **Manual fine-tuning** — edit marks/minutes per question, add or remove rows.

### During the exam
- **Large timer** for the current question; **medium timer** for total time
  remaining (real-time countdown); **buffer pool** that grows when you finish
  early and shrinks (turns red) when you go overtime.
- **Color states** per question, proportional to its budget:
  green (0–80%) → orange (80–100%) → red (overtime).
- **Sound alerts** at the orange and red thresholds, with a mute toggle.
- **Free navigation** — **Prev / Next** buttons and **click any question** in the
  side list to jump straight to it. Time is tracked per question, so jumping
  around preserves each question's clock.
- **Keep screen on** toggle (default on) — uses the Screen Wake Lock API so the
  display won't sleep mid-exam (Chrome/Edge and Safari iOS 16.4+; shows
  "Not supported" elsewhere).

### Platform
- **Auto-saves** setup and in-progress session to `localStorage` — refresh-safe,
  with a "Resume last session" option.
- **Works 100% offline** (PWA) — installable on mobile and desktop.
- **Private visit analytics** via [GoatCounter](https://www.goatcounter.com/)
  (dashboard at `roronosy.goatcounter.com`).
- **Keyboard shortcuts:** **Space** = pause/resume, **N** = mark done,
  **← / →** = previous / next question.

## Run locally

Because of the service worker, open it via a local server (not `file://`):

```bash
cd examTimer
python3 -m http.server 8000
# then open http://localhost:8000
```

You can still open `index.html` directly for a quick look, but offline install
needs to be served over http/https.

## Deploy to GitHub Pages

1. Push this folder to a GitHub repo.
2. Repo → **Settings → Pages** → Source: **Deploy from a branch** →
   Branch: `main` (root) → Save.
3. Your site goes live at `https://<username>.github.io/<repo>/`.

Because the paths are relative, it works whether served at the domain root or a
`/<repo>/` subpath.

> **Before every deploy:** run `node --check app.js` (and `presets.js`) — a single
> syntax slip stops the whole app from loading. Bump `CACHE_VERSION` in
> `service-worker.js` so returning visitors' browsers fetch the new version
> instead of the cached old one.

## Install on your devices (offline app)

- **Android / Chrome:** open the Pages URL → menu → **Add to Home screen**.
- **iOS / Safari:** open the URL → Share → **Add to Home Screen**.
- **Desktop / Chrome or Edge:** open the URL → **Install** icon in the address bar.

After the first load the app is cached and runs with no network connection.

## Customize

- **Add / edit presets:** edit `presets.js`. Each preset has `id`, `name`,
  `totalMinutes`, and `groups` (`{ marks, count, minutes? }`). Omit `minutes` to
  auto-compute it proportional to marks.
- **Color thresholds:** edit `ORANGE_AT` / `RED_AT` at the top of `app.js`.
- **Visit analytics:** change the `data-goatcounter` URL in `index.html` (or
  remove that `<script>` to disable). In your GoatCounter settings you can exclude
  your own visits and add your Pages domain as an allowed site.
- **App files changed?** bump `CACHE_VERSION` in `service-worker.js` so devices
  pull the update.
- **Icon:** replace `icons/icon.svg` (add PNG sizes to `manifest.json` if you
  want store-grade icons).

## Project files

| File | Purpose |
|------|---------|
| `index.html` | Setup + timer screens |
| `styles.css` | Styling / layout |
| `app.js` | Timer engine, navigation, buffer, presets, wake lock |
| `presets.js` | Paper preset definitions (edit to add more) |
| `manifest.json`, `service-worker.js`, `icons/` | PWA / offline |
| `plan.md` | Feature backlog + shipped log |
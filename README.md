# STATLINE Sports Analytics — Mobile

**▶ Open the app: https://paranoia1x.github.io/Statline-Mobile-App/**

*Track • Analyze • Win — Your stats. Your insights. Your edge.*

This is the phone and tablet version of the STATLINE desktop app. It has the same statistics engine, AI predictions, Top Plays, Pick Analyzer, Parlay Analyzer, Matchup Center, Research Vault and Performance Tracker, with a layout made for touch screens. You can add it to your home screen, and after the first visit it works offline.

> STATLINE provides sports statistics and analysis only — it does not accept, place or settle bets. Forecasts are probabilities, never guarantees. If you choose to bet, do so legally and responsibly (21+). Gambling problem? Call 1-800-GAMBLER.

## Install it on your phone

Open **https://paranoia1x.github.io/Statline-Mobile-App/** on your phone. Then:

- **iPhone / iPad (Safari):** tap **Share → Add to Home Screen**.
- **Android (Chrome):** tap **⋮ → Install app** (or **Add to Home screen**).

It opens full-screen with the STATLINE icon, like a regular app.

## What's different from the desktop version

- **Fantasy** (Predict tab, Home and More): projected fantasy points for every starter on the upcoming slate — an NFL week or a day of NBA/NHL/soccer games — ranked by position with Start / Flex / Bench tiers, a floor–ceiling range and the projected stat line. Scoring formats: NFL PPR, Half PPR and Standard (QB, RB, WR, TE, K, D/ST); NBA DraftKings, FanDuel and ESPN points; NHL DraftKings and FanDuel; MLB and soccer DraftKings. Each projection shows what moved it: **defense vs position** (fantasy points the opponent allows to that position, with a Great → Very tough grade), **team offense and opponent defense ranks**, the **betting-market implied team total**, **game-time weather** at outdoor NFL stadiums (wind, rain/snow, cold), injuries and key teammates out.
- **How accurate the fantasy numbers are:** the app shows a walk-forward backtest for each format — past games projected only from earlier data, scored on the most recent games. Average miss vs simply using season averages (Nov 2026, held-out games): NFL PPR 4.66 vs 4.88 pts, NBA DK 7.38 vs 7.47, NHL DK 4.85 vs 4.92, soccer 2.89 vs 3.17; NFL start/sit (picking the higher scorer of two players at a position) 64% vs 63%.
- **Bottom tab bar** — Home, Live, Predict, Analyze, More — with bigger tap targets. Inner screens get a back button.
- **Home** puts live games, today's Top Plays and the main tools first.
- **Matchups** open on a *Players* tab with both rosters and their stats; Preview, Compare and History are one tap away.
- **Pick Analyzer and Parlay Analyzer** share the Analyze tab. Slips from sportsbooks, pick'em apps (PrizePicks, Underdog, Pick6…) and prediction markets (**Kalshi, Polymarket**) are read: "22+ passing completions", Yes/No sides, prices like 58% or 58¢ (shown as fair odds next to the model's chance), and a combo's cost / max payout. Screenshots are read on the phone (nothing is uploaded), and bet slips are read row by row so each leg keeps its odds.
- **No account needed.** Your Research Vault, tracked forecasts and imported PrizePicks lines are saved on the phone. **Settings → Export backup** opens your phone's share sheet so you can save the backup to Files or Drive, or send it to yourself; **Import backup** merges it back.
- **Appearance:** all the desktop themes (Midnight, Carbon, Navy, OLED Black, Dim, Light, Paper, Auto), accent colours, any team's colours, and text size. The phone's status bar follows the theme.
- **Explanations** use the engine's built-in summaries (an AI key can't be stored safely inside a public web app). Every number still comes from the same statistical engine.
- **Sports News** (Home and More): the latest ESPN headlines with photos and links to the full stories, plus an **Injuries** tab with the newest injury-report notes. Headlines load straight from ESPN; offline, the last saved copy is shown.
- **Injuries:** badges show *Out for season* and expected return dates. A player who's ruled out gets a clear "not expected to play" notice, and NBA projections account for key teammates who are out.
- **Touchdowns and combos:** rushing TDs (QB, RB), receiving TDs, anytime TDs (including QBs), pass+rush yards, rush+rec yards, longest rush/reception, NBA pts+reb / pts+ast / reb+ast / steals+blocks, MLB hits+runs+RBIs.
- **Forecast lines:** without a PrizePicks line, forecasts use the player's typical line (median of his last 10 games), so the percentages show real leans instead of sitting near 50%.
- **Works offline:** stats you've opened are saved on the phone. When you're offline, the app says so and shows the saved stats.

## Where the data comes from

- **Box scores, schedules, rosters and injuries:** a GitHub Action (`.github/workflows/deploy.yml`) syncs ESPN's public API **every 2 hours**, packs each sport into a small file (about 0.2 MB compressed per sport), and publishes the app. Box scores are cached between runs, so each run only downloads new games.
- **The heavy work is done ahead of time:** the same Action runs the model's walk-forward backtest (calibration and track record) and computes Top Plays, including the graded results for the last 7 days.
- **Betting lines and weather:** spreads, totals and moneylines come from ESPN's scoreboards (closing lines for finished games, so they can be backtested). Game-time wind, precipitation and temperature for outdoor NFL stadiums come from [Open-Meteo](https://open-meteo.com) (free, no key, open data) during the data job; ESPN's own forecast is the fallback.
- **Live scores** come straight from ESPN's scoreboard on your phone, refreshing every 20 seconds while games are on. If ESPN can't be reached, the Live tab says so and shows the schedule and final scores from the last update.
- ESPN's API is public but unofficial — fine for personal research; a licensed feed is needed for commercial use.

## For developers

- Vite + React + TypeScript + Tailwind, built into a Progressive Web App (service worker via `vite-plugin-pwa`). Hash URLs (`#/players/…`) so it works on GitHub Pages and offline.
- `src/lib` is shared with the desktop app (engine, parsers, sports definitions). `src/lib/data/snapshot.ts` is the phone's data provider; `src/api` holds the desktop's API route handlers, which run inside the app through `src/lib/api.ts`.
- `server/` holds the Node-only ESPN provider used by the data job.

```bash
npm ci
npm run data      # build public/data from ESPN (first run takes a few minutes)
npm run dev       # http://localhost:5173
npm test          # parsers, verdicts, appearance, and snapshot-vs-source engine checks
npm run build     # production build in dist/
```

- `npx tsx scripts/tune-fantasy.ts [sport]` and `npx tsx scripts/tune-props.ts [sport]` re-check the fantasy and player-stat model settings on the real snapshots in `public/data` (run `npm run data` first). Behind an HTTPS proxy, run Node with `NODE_USE_ENV_PROXY=1`.
- `npm test` includes a check that the engine gives **identical forecasts** on the phone snapshot and on the source data.
- Themes are generated from `scripts/gen-themes.py`.
- Publishing: **Settings → Pages → Deploy from a branch → gh-pages / (root)**. The Action pushes the built app to `gh-pages` as a single commit each time (no history growth), and GitHub republishes the site automatically.

## Credits

- Statistics: ESPN public API. Team logos and player headshots are ESPN's and are shown only when published for the player's current team.
- Screenshot reading: Tesseract.js (self-hosted, runs on the device).

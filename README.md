Cozy Clicker

A cozy idle clicker game on Reddit! Manage your sim's **hunger**, **energy**, **fun**, and **money** through actions (eat/sleep/play/work) and auto-upgrades (fridge/bed/TV/job). Stats decay over time—keep mood high or game over! Offline progress via server.

![Gameplay mock](https://via.placeholder.com/800x600?text=Cozy+Clicker) *(Assets coming)*

Play in Reddit post expanded view (iframe). Serverless backend syncs per-post state via Redis.

## Tech Stack

- **Frontend**: [Phaser](https://phaser.io/) + [Vite](https://vite.dev/) (scenes: Preloader/MainMenu/Game/GameOver)
- **Backend**: [Hono](https://hono.dev/) API (serverless Node 22), Redis state, Devvit web
- **Communication**: Fetch to `/api/message` (tRPC v11 planned)
- **Types**: TypeScript end-to-end (shared/api.ts contract)
- **Dev**: ESLint/Prettier/TS strict

See [AGENTS.md](AGENTS.md) for rules, [todo.md](todo.md) for roadmap.

## Quick Start

1. **Setup**:
   ```
   git clone <repo>
   cd cozy-clicker
   npm install
   npm run login  # Auth Devvit CLI with Reddit app
   ```

2. **Local Dev** (frontend hot reload):
   ```
   npm run dev
   ```
   - Game local sim works (bars/actions/upgrades/decay/popups).
   - Hono server at localhost:5173/api/message (test with curl).

3. **Type/Lint/Test**:
   ```
   npm run type-check
   npm run lint
   npm run test  # Isolated files: npm run test -- Game.ts
   ```

4. **Deploy to Reddit**:
   ```
   npm run deploy  # Builds/uploads
   npm run launch  # Submit for review
   ```
   - Post appears in subreddit. Inline splash → expanded game.
   - Vote post for money bonus (triggers.ts).

## Architecture

```
Reddit Post (Expanded View)
   |
iframe (game.html)
  - Phaser scenes (Boot/Preloader/MainMenu/Game/GameOver)
  - Local sim (offline playable)
  |
fetch('/api/message') --> Hono (index.ts routes/api.ts)
  |
server/core/post.ts (Redis per-post state: decay/actions/upgrades/offline)
  |
Redis (Devvit serverless)
```

## Gameplay
- **Bars**: Hunger/Energy/Fun (decay/sec). Mood = average.
- **Actions**: Eat (+hunger -energy -money), Sleep (+energy -hunger), Play (+fun -energy -money), Work (+money -energy -fun).
- **Upgrades**: Buy once, passive ticks (fridge hunger, job money).
- **GameOver**: Mood <20.
- **Sync**: Optimistic local + server roundtrip.

## Roadmap (todo.md)
- ✅ Core API/state/API/Game local
- ⏳ Client-server wire (fetch)
- ⏳ Assets (sprites)
- ⏳ Vote bonuses, responsive, tRPC
- 📦 Deploy live

## Deploy Notes
- [Devvit Docs](https://developers.reddit.com/docs/llms.txt)
- devvit.json: Entrypoints/menus registered.
- Custom post type in index.ts.

## Troubleshooting
- TS errors? `npm run type-check`
- No postId? Check context.webView in index.ts.
- Local test API: `curl -X POST http://localhost:5173/api/message -H 'Content-Type: application/json' -d '{"type":"LOAD_STATE"}'`
# karma-crush

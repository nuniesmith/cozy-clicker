The first thing worth flagging before anything else: **your notes are written for a standard Phaser + itch.io deployment, but your actual codebase is a Devvit Reddit app.** That's a fundamentally different runtime — Devvit has a sandboxed client/server split, a message-passing API between the Phaser webview and the Reddit backend, and no direct localStorage or DOM access in the way the notes describe. A lot of the optimization advice (Canvas vs WebGL renderer choice, `document.createElement` for FPS counters, `touchmove` event listeners) either doesn't apply or needs to be adapted.

Here's the actual picture based on your codebase:

---

## What Exists (Scaffolding Only)

The 655 lines of TypeScript across 15 files tells you this is almost entirely the Devvit template, not your game yet. You have:

**Client (Phaser side)**
- `Boot.ts`, `Preloader.ts`, `MainMenu.ts`, `Game.ts`, `GameOver.ts` — scene stubs from the Devvit Phaser template
- `game.ts` — Phaser game config entry point
- `splash.ts` / `splash.html` — the Reddit post embed preview (not the game itself)

**Server (Hono side)**
- `server/index.ts` — Hono server entry
- `server/routes/api.ts`, `forms.ts`, `menu.ts`, `triggers.ts` — route stubs
- `server/core/post.ts` — post creation logic
- `shared/api.ts` — the message contract between client and server (critical)

You have 3 PNG assets (`bg.png`, `logo.png`, `snoo.png`) — no Sim character sprite, no action button art, no UI bar assets yet.

---

## What Actually Needs to Be Built (Priority Order)

### 1. Define the shared API contract first (`shared/api.ts`)
This is the most important file in a Devvit app and should be done before any game logic. Devvit's client ↔ server communication is message-based (not fetch/REST like your notes imply). You need to define your message types:

```typescript
// Example shape for shared/api.ts
export type ToServerMessage =
  | { type: 'ACTION'; action: 'eat' | 'sleep' | 'play' | 'work' }
  | { type: 'BUY_UPGRADE'; upgradeId: string }
  | { type: 'LOAD_STATE' };

export type ToClientMessage =
  | { type: 'STATE_UPDATE'; state: SimState }
  | { type: 'UPGRADE_PURCHASED'; upgradeId: string };

export type SimState = {
  hunger: number;
  energy: number;
  fun: number;
  money: number;
  upgrades: string[];
  lastSeen: number; // unix timestamp for offline progress
};
```

Get this agreed upon before you write a line of Phaser or server logic — it's your single source of truth.

---

### 2. Server-side state (`server/core/post.ts` + `server/routes/api.ts`)
Your sim state needs to live server-side in Devvit's Redis KV store, not localStorage. The notes mention localStorage for offline progress — **throw that out entirely** for this platform. Instead:

- On `LOAD_STATE`: read from `context.redis`, calculate offline decay based on `lastSeen` delta, return the updated state.
- On `ACTION`: validate, mutate state in Redis, return new state.
- On `BUY_UPGRADE`: check money, deduct, store upgrade, return state.
- `triggers.ts` is where you'd handle scheduler-based passive income if you want true server-side idle ticks (Devvit supports cron-style triggers).

---

### 3. Phaser scenes — actual game content

**`Preloader.ts`** — load your actual assets (room background, sim spritesheet, button icons, bar fill sprite). Nothing game-specific exists here yet.

**`MainMenu.ts`** — this can stay lightweight (a Play button that sends the player into `Game.ts`), but it needs to request state from the server on entry.

**`Game.ts`** — this is where all your notes' ideas land. The core loop to build:
- Receive `SimState` from the server via Devvit's `useChannel` / `postMessage` bridge
- Render need bars using sprite + `scaleX` (the notes' advice here is correct and applies fine)
- Render action buttons with click/tap handlers that fire `ToServerMessage`
- Local optimistic stat display that updates instantly on click, then syncs on server ACK
- Idle decay display — run locally in Phaser with `time.addEvent`, but the authoritative decay lives server-side
- Object pooling for floating `+30` pop-ups (notes' advice is correct here)

**`GameOver.ts`** — triggered when a stat hits 0. Probably just a "Your sim is unhappy" screen with a retry that resets state server-side.

---

### 4. Assets (blocking everything else)
You need at minimum before `Preloader.ts` can do anything real:
- A sim character sprite sheet (idle + eat + sleep + play animations)
- A room background
- Bar fill image (single horizontal rectangle, colored)
- 4 action button icons

Kenney.nl's "Tiny Town" or "RPG Urban Pack" are good free sources. Even placeholder colored rectangles in Aseprite will unblock coding.

---

## What to Ignore from the Notes (Devvit-Specific Conflicts)

| Note Advice | Reality in Devvit |
|---|---|
| `localStorage` for save/load | Use `context.redis` — localStorage isn't reliable in the webview sandbox |
| `document.createElement` for FPS counter | Works but is hacky; use Phaser's built-in debug or BitmapText |
| `touchmove` event listener on `e.target === canvas` | Devvit wraps the webview; test this carefully, may conflict |
| itch.io hosting | Irrelevant — deployment is `devvit upload` |
| Texture atlas with TexturePacker | Still valid and good advice, just lower priority for a prototype |

---

## Suggested Next Steps in Order

1. Flesh out `shared/api.ts` with your full message + state types
2. Wire up `server/routes/api.ts` to read/write Redis with basic action handling
3. Drop placeholder art assets in `public/assets/` so Preloader isn't empty
4. Build `Game.ts` with hardcoded local state first (no server calls) to get the visual loop working
5. Replace local state with the real Devvit message bridge
6. Add offline progress calculation in the server's `LOAD_STATE` handler
7. Add upgrades last — they're the idle multiplier layer on top of the core loop

The notes are a decent conceptual reference for the Phaser side, but treat the server architecture section as a complete rewrite relative to what Devvit actually requires.

Since I can't read your actual source files, I'll write the concrete implementation for each layer based on the Devvit Phaser template conventions. This picks up directly from step 1.

---

## Step 1 — `src/shared/api.ts`

This is your contract. Write it once, import it everywhere.

```typescript
// src/shared/api.ts

export type SimAction = 'eat' | 'sleep' | 'play' | 'work';

export type UpgradeId =
  | 'auto_fridge'    // passive hunger recovery
  | 'auto_bed'       // passive energy recovery
  | 'auto_tv'        // passive fun recovery
  | 'auto_job';      // passive money income

export interface Upgrade {
  id: UpgradeId;
  label: string;
  cost: number;
  description: string;
  statTarget: keyof SimStats;
  tickAmount: number; // how much it recovers per server tick
}

export interface SimStats {
  hunger: number;   // 0–100
  energy: number;
  fun: number;
  money: number;
}

export interface SimState extends SimStats {
  upgrades: UpgradeId[];
  mood: number;       // derived: average of hunger/energy/fun
  lastSeen: number;   // unix ms timestamp — used for offline decay calc
}

// Client → Server
export type ToServerMessage =
  | { type: 'LOAD_STATE' }
  | { type: 'ACTION'; action: SimAction }
  | { type: 'BUY_UPGRADE'; upgradeId: UpgradeId };

// Server → Client
export type ToClientMessage =
  | { type: 'STATE_UPDATE'; state: SimState }
  | { type: 'ACTION_RESULT'; action: SimAction; delta: Partial<SimStats>; newState: SimState }
  | { type: 'UPGRADE_RESULT'; success: boolean; upgradeId: UpgradeId; newState: SimState }
  | { type: 'ERROR'; message: string };

// Shared constants — single source of truth for both sides
export const STAT_DECAY_PER_SECOND = {
  hunger: 0.5,
  energy: 0.3,
  fun: 0.4,
} as const;

export const ACTION_DELTAS: Record<SimAction, Partial<SimStats>> = {
  eat:   { hunger: +30, energy: -5,  money: -2  },
  sleep: { energy: +40, hunger: -5               },
  play:  { fun:    +35, energy: -10, money: -1   },
  work:  { money:  +20, energy: -15, fun:    -10 },
};

export const UPGRADES: Record<UpgradeId, Upgrade> = {
  auto_fridge: { id: 'auto_fridge', label: 'Mini Fridge', cost: 50,  description: 'Slowly restores hunger', statTarget: 'hunger', tickAmount: 0.2 },
  auto_bed:    { id: 'auto_bed',    label: 'Comfy Bed',   cost: 75,  description: 'Slowly restores energy', statTarget: 'energy', tickAmount: 0.15 },
  auto_tv:     { id: 'auto_tv',     label: 'Big TV',      cost: 60,  description: 'Slowly restores fun',    statTarget: 'fun',    tickAmount: 0.15 },
  auto_job:    { id: 'auto_job',    label: 'WFH Setup',   cost: 100, description: 'Earns passive income',   statTarget: 'money',  tickAmount: 0.1  },
};

export const INITIAL_STATE: SimState = {
  hunger: 80,
  energy: 80,
  fun:    80,
  money:  10,
  upgrades: [],
  mood: 80,
  lastSeen: Date.now(),
};

export function calcMood(stats: SimStats): number {
  return Math.round((stats.hunger + stats.energy + stats.fun) / 3);
}

export function clamp(val: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, val));
}
```

---

## Step 2 — `src/server/core/post.ts`

This is where state lives and mutates. Devvit's Redis is your database.

```typescript
// src/server/core/post.ts
import { Devvit } from '@devvit/public-api';
import {
  SimState,
  SimAction,
  UpgradeId,
  INITIAL_STATE,
  ACTION_DELTAS,
  UPGRADES,
  STAT_DECAY_PER_SECOND,
  calcMood,
  clamp,
  ToClientMessage,
} from '../../shared/api.js';

const STATE_KEY = (postId: string) => `sim:state:${postId}`;

// ─── Load & offline decay ────────────────────────────────────────────────────

export async function loadState(
  redis: Devvit.Context['redis'],
  postId: string
): Promise<SimState> {
  const raw = await redis.get(STATE_KEY(postId));
  const state: SimState = raw ? JSON.parse(raw) : { ...INITIAL_STATE, lastSeen: Date.now() };

  const now = Date.now();
  const elapsedSeconds = Math.min((now - state.lastSeen) / 1000, 3600); // cap at 1hr offline

  // Apply offline decay
  const decayed = applyDecay(state, elapsedSeconds);
  decayed.lastSeen = now;
  decayed.mood = calcMood(decayed);

  await saveState(redis, postId, decayed);
  return decayed;
}

function applyDecay(state: SimState, seconds: number): SimState {
  const next = { ...state };

  next.hunger = clamp(state.hunger - STAT_DECAY_PER_SECOND.hunger * seconds);
  next.energy = clamp(state.energy - STAT_DECAY_PER_SECOND.energy * seconds);
  next.fun    = clamp(state.fun    - STAT_DECAY_PER_SECOND.fun    * seconds);

  // Passive income from upgrades during offline time
  for (const uid of state.upgrades) {
    const upgrade = UPGRADES[uid];
    const gain = upgrade.tickAmount * seconds;
    if (upgrade.statTarget === 'money') {
      next.money = next.money + gain; // money doesn't cap at 100
    } else {
      (next as any)[upgrade.statTarget] = clamp(
        (next as any)[upgrade.statTarget] + gain
      );
    }
  }

  return next;
}

// ─── Actions ─────────────────────────────────────────────────────────────────

export async function handleAction(
  redis: Devvit.Context['redis'],
  postId: string,
  action: SimAction
): Promise<ToClientMessage> {
  const state = await loadState(redis, postId);
  const delta = ACTION_DELTAS[action];
  const next = { ...state };

  for (const [key, val] of Object.entries(delta) as [keyof typeof delta, number][]) {
    if (key === 'money') {
      next.money = Math.max(0, next.money + val);
    } else {
      (next as any)[key] = clamp((next as any)[key] + val);
    }
  }

  next.mood = calcMood(next);
  next.lastSeen = Date.now();

  await saveState(redis, postId, next);

  return {
    type: 'ACTION_RESULT',
    action,
    delta,
    newState: next,
  };
}

// ─── Upgrades ────────────────────────────────────────────────────────────────

export async function handleBuyUpgrade(
  redis: Devvit.Context['redis'],
  postId: string,
  upgradeId: UpgradeId
): Promise<ToClientMessage> {
  const state = await loadState(redis, postId);
  const upgrade = UPGRADES[upgradeId];

  if (!upgrade) {
    return { type: 'ERROR', message: 'Unknown upgrade' };
  }
  if (state.upgrades.includes(upgradeId)) {
    return { type: 'ERROR', message: 'Already purchased' };
  }
  if (state.money < upgrade.cost) {
    return { type: 'ERROR', message: 'Not enough money' };
  }

  const next: SimState = {
    ...state,
    money: state.money - upgrade.cost,
    upgrades: [...state.upgrades, upgradeId],
    lastSeen: Date.now(),
  };
  next.mood = calcMood(next);

  await saveState(redis, postId, next);

  return { type: 'UPGRADE_RESULT', success: true, upgradeId, newState: next };
}

// ─── Persistence ─────────────────────────────────────────────────────────────

async function saveState(
  redis: Devvit.Context['redis'],
  postId: string,
  state: SimState
): Promise<void> {
  await redis.set(STATE_KEY(postId), JSON.stringify(state));
}
```

---

## Step 3 — `src/server/routes/api.ts`

Wire the messages to the handlers.

```typescript
// src/server/routes/api.ts
import { Devvit } from '@devvit/public-api';
import { ToServerMessage, ToClientMessage } from '../../shared/api.js';
import { loadState, handleAction, handleBuyUpgrade } from '../core/post.js';

export async function handleMessage(
  message: ToServerMessage,
  context: Devvit.Context
): Promise<ToClientMessage> {
  const postId = context.postId ?? 'unknown';
  const redis = context.redis;

  switch (message.type) {
    case 'LOAD_STATE': {
      const state = await loadState(redis, postId);
      return { type: 'STATE_UPDATE', state };
    }
    case 'ACTION': {
      return handleAction(redis, postId, message.action);
    }
    case 'BUY_UPGRADE': {
      return handleBuyUpgrade(redis, postId, message.upgradeId);
    }
    default: {
      return { type: 'ERROR', message: 'Unknown message type' };
    }
  }
}
```

Then in `server/index.ts`, plug this into the Devvit `addCustomPostType` webview message handler — it'll look roughly like:

```typescript
// src/server/index.ts (relevant excerpt)
Devvit.addCustomPostType({
  name: 'Cozy Clicker',
  render: context => {
    const { mount } = context.webView;
    // ...
  },
});

// Wire the message bridge
Devvit.addWebViewEventHandler('message', async (event, context) => {
  const msg = event.data.message as ToServerMessage;
  const response = await handleMessage(msg, context);
  await context.webView.postMessage('myWebView', response);
});
```

---

## Step 4 — `src/client/scenes/Game.ts`

Build this in two phases. **Phase A** is local-only so you can see and test the game without the server bridge working. **Phase B** swaps in real messages.

### Phase A — Local state, fully playable

```typescript
// src/client/scenes/Game.ts
import Phaser from 'phaser';
import {
  SimState,
  SimAction,
  ToClientMessage,
  ACTION_DELTAS,
  UPGRADES,
  STAT_DECAY_PER_SECOND,
  calcMood,
  clamp,
  INITIAL_STATE,
  UpgradeId,
} from '../../shared/api';

const BAR_WIDTH = 160;
const BAR_HEIGHT = 16;
const STATS: (keyof Pick<SimState, 'hunger' | 'energy' | 'fun'>)[] = ['hunger', 'energy', 'fun'];
const BAR_COLORS: Record<string, number> = {
  hunger: 0xff6b6b,
  energy: 0x6bcbff,
  fun:    0xf9e04b,
};

export class Game extends Phaser.Scene {
  private state: SimState = { ...INITIAL_STATE, lastSeen: Date.now() };
  private simSprite!: Phaser.GameObjects.Sprite;
  private bars: Record<string, Phaser.GameObjects.Rectangle> = {};
  private moneyText!: Phaser.GameObjects.Text;
  private moodText!: Phaser.GameObjects.Text;
  private popUpPool!: Phaser.GameObjects.Group;
  private decayTimer!: Phaser.Time.TimerEvent;
  private passiveTimer!: Phaser.Time.TimerEvent;

  constructor() {
    super('Game');
  }

  create() {
    // Background
    this.add.image(400, 300, 'bg').setDisplaySize(800, 600);

    // Sim sprite (placeholder rectangle until you have a real spritesheet)
    this.simSprite = this.add.sprite(300, 380, 'sim');
    this.anims.create({
      key: 'idle',
      frames: this.anims.generateFrameNumbers('sim', { start: 0, end: 3 }),
      frameRate: 6,
      repeat: -1,
    });
    this.simSprite.play('idle');

    // Need bars
    this.buildNeedBars();

    // Money + mood
    this.moneyText = this.add.text(560, 50, '$0', { fontSize: '22px', color: '#fff' });
    this.moodText  = this.add.text(560, 80, 'Mood: 80', { fontSize: '18px', color: '#aaffaa' });

    // Action buttons
    this.buildActionButtons();

    // Upgrade panel
    this.buildUpgradePanel();

    // Pop-up pool
    this.popUpPool = this.add.group({
      classType: Phaser.GameObjects.Text,
      maxSize: 20,
      runChildUpdate: false,
    });

    // Timers
    this.decayTimer = this.time.addEvent({
      delay: 1000,
      callback: this.tickDecay,
      callbackScope: this,
      loop: true,
    });

    this.passiveTimer = this.time.addEvent({
      delay: 2000,
      callback: this.tickPassive,
      callbackScope: this,
      loop: true,
    });

    // Request real state from server (Phase B)
    this.requestServerState();
  }

  // ── Bars ────────────────────────────────────────────────────────────────────

  private buildNeedBars() {
    const labels = { hunger: 'Hunger', energy: 'Energy', fun: 'Fun' };
    STATS.forEach((stat, i) => {
      const y = 50 + i * 40;
      this.add.text(20, y - 2, labels[stat], { fontSize: '14px', color: '#ccc' });
      // Background track
      this.add.rectangle(150, y + 8, BAR_WIDTH, BAR_HEIGHT, 0x333333).setOrigin(0, 0.5);
      // Fill bar (key: use a Rectangle and set width directly — no Graphics redraw)
      this.bars[stat] = this.add
        .rectangle(150, y + 8, BAR_WIDTH, BAR_HEIGHT, BAR_COLORS[stat])
        .setOrigin(0, 0.5);
    });
  }

  private updateBars() {
    STATS.forEach(stat => {
      this.bars[stat].width = (this.state[stat] / 100) * BAR_WIDTH;
    });
    this.moneyText.setText(`$${Math.floor(this.state.money)}`);
    this.moodText.setText(`Mood: ${this.state.mood}`);
  }

  // ── Action Buttons ──────────────────────────────────────────────────────────

  private buildActionButtons() {
    const actions: { action: SimAction; label: string; x: number; y: number }[] = [
      { action: 'eat',   label: '🍔 Eat',   x: 550, y: 300 },
      { action: 'sleep', label: '😴 Sleep', x: 660, y: 300 },
      { action: 'play',  label: '🎮 Play',  x: 550, y: 360 },
      { action: 'work',  label: '💼 Work',  x: 660, y: 360 },
    ];

    actions.forEach(({ action, label, x, y }) => {
      const bg = this.add.rectangle(x, y, 90, 44, 0x4a4a8a).setInteractive({ useHandCursor: true });
      const text = this.add.text(x, y, label, { fontSize: '14px', color: '#fff' }).setOrigin(0.5);

      bg.on('pointerover',  () => bg.setFillStyle(0x6a6aaa));
      bg.on('pointerout',   () => bg.setFillStyle(0x4a4a8a));
      bg.on('pointerdown',  () => this.onAction(action));
    });
  }

  private onAction(action: SimAction) {
    const delta = ACTION_DELTAS[action];

    // Optimistic local update
    for (const [key, val] of Object.entries(delta) as [keyof typeof delta, number][]) {
      if (key === 'money') {
        this.state.money = Math.max(0, this.state.money + val);
      } else {
        (this.state as any)[key] = clamp((this.state as any)[key] + val);
      }
    }
    this.state.mood = calcMood(this.state);
    this.updateBars();

    // Floating pop-up
    const sign = Object.entries(delta)[0];
    if (sign) this.spawnPopUp(this.simSprite.x, this.simSprite.y - 40, sign[0], sign[1]);

    // Send to server (Phase B)
    this.sendToServer({ type: 'ACTION', action });
  }

  // ── Upgrades ────────────────────────────────────────────────────────────────

  private buildUpgradePanel() {
    this.add.text(530, 420, 'Upgrades', { fontSize: '16px', color: '#ffdd88' });

    let offsetY = 0;
    (Object.keys(UPGRADES) as UpgradeId[]).forEach((uid) => {
      const upgrade = UPGRADES[uid];
      const y = 450 + offsetY;

      const bg = this.add
        .rectangle(620, y, 160, 30, 0x2a2a4a)
        .setInteractive({ useHandCursor: true });

      const label = this.add
        .text(620, y, `${upgrade.label} $${upgrade.cost}`, { fontSize: '12px', color: '#ccc' })
        .setOrigin(0.5);

      bg.setData('upgradeId', uid);
      bg.setData('label', label);

      bg.on('pointerdown', () => {
        if (!this.state.upgrades.includes(uid)) {
          this.sendToServer({ type: 'BUY_UPGRADE', upgradeId: uid });
        }
      });

      offsetY += 38;
    });
  }

  // ── Timers ──────────────────────────────────────────────────────────────────

  private tickDecay() {
    this.state.hunger = clamp(this.state.hunger - STAT_DECAY_PER_SECOND.hunger);
    this.state.energy = clamp(this.state.energy - STAT_DECAY_PER_SECOND.energy);
    this.state.fun    = clamp(this.state.fun    - STAT_DECAY_PER_SECOND.fun);
    this.state.mood   = calcMood(this.state);
    this.updateBars();

    if (this.state.mood < 20) {
      this.scene.start('GameOver');
    }
  }

  private tickPassive() {
    for (const uid of this.state.upgrades) {
      const upgrade = UPGRADES[uid];
      const gain = upgrade.tickAmount * 2; // 2s tick
      if (upgrade.statTarget === 'money') {
        this.state.money += gain;
      } else {
        (this.state as any)[upgrade.statTarget] = clamp(
          (this.state as any)[upgrade.statTarget] + gain
        );
      }
    }
    this.state.mood = calcMood(this.state);
    this.updateBars();
  }

  // ── Pop-ups ─────────────────────────────────────────────────────────────────

  private spawnPopUp(x: number, y: number, stat: string, val: number) {
    const sign = val >= 0 ? '+' : '';
    const color = val >= 0 ? '#aaffaa' : '#ff8888';
    const popup = this.add.text(x, y, `${sign}${val} ${stat}`, {
      fontSize: '18px',
      color,
    }).setOrigin(0.5);

    this.tweens.add({
      targets: popup,
      y: y - 60,
      alpha: 0,
      duration: 1000,
      onComplete: () => popup.destroy(),
    });
  }

  // ── Server Bridge (Phase B) ──────────────────────────────────────────────────
  // These are stubs — they become real once you wire Devvit's postMessage API

  private requestServerState() {
    this.sendToServer({ type: 'LOAD_STATE' });
  }

  private sendToServer(msg: import('../../shared/api').ToServerMessage) {
    // In Devvit this is: window.parent.postMessage({ type: 'devvit-message', message: msg }, '*')
    // For local testing just no-op it
    if (typeof window !== 'undefined' && window.parent !== window) {
      window.parent.postMessage({ type: 'devvit-message', message: msg }, '*');
    }
  }

  // Call this from the Devvit message listener setup in game.ts
  public receiveServerMessage(msg: ToClientMessage) {
    switch (msg.type) {
      case 'STATE_UPDATE':
      case 'ACTION_RESULT':
        this.state = msg.type === 'STATE_UPDATE' ? msg.state : msg.newState;
        this.state.mood = calcMood(this.state);
        this.updateBars();
        break;
      case 'UPGRADE_RESULT':
        if (msg.success) {
          this.state = msg.newState;
          this.updateBars();
        }
        break;
    }
  }
}
```

---

## Step 5 — Wire the message bridge in `game.ts`

```typescript
// src/client/game.ts (relevant addition)
import { Game } from './scenes/Game';

// After Phaser game is created, listen for server messages
window.addEventListener('message', (event) => {
  if (event.data?.type !== 'devvit-message') return;
  const msg = event.data.message;
  if (!msg) return;

  // Get the active Game scene and pipe the message in
  const gameScene = phaserGame.scene.getScene('Game') as Game;
  if (gameScene?.receiveServerMessage) {
    gameScene.receiveServerMessage(msg);
  }
});
```

---

## What You Can Do Right Now Without Assets

The Phase A code above will run with placeholder colored rectangles if you stub `sim` as:

```typescript
// In Preloader.ts — temporary until you have sprites
create() {
  // Generate a placeholder sim texture programmatically
  const g = this.make.graphics({ x: 0, y: 0, add: false });
  g.fillStyle(0xffcc99);
  g.fillRect(0, 0, 48, 64);
  g.generateTexture('sim', 48, 64);
  g.destroy();

  // Placeholder bg
  const bg = this.make.graphics({ x: 0, y: 0, add: false });
  bg.fillStyle(0x2d4a2d);
  bg.fillRect(0, 0, 800, 600);
  bg.generateTexture('bg', 800, 600);
  bg.destroy();

  this.scene.start('MainMenu');
}
```

That gets you a fully interactive, testable game loop — decay running, buttons working, bars moving — with zero external assets. Drop in real sprites whenever they're ready and nothing else changes.

---

## Remaining Gap: `todo.md`

You already have this file — open it and replace whatever's in there with this checklist based on everything above:

```
[ ] shared/api.ts — finalize message types and constants
[ ] server/core/post.ts — Redis load/save/decay/actions
[ ] server/routes/api.ts — message router
[ ] server/index.ts — wire Devvit webView message handler
[ ] Preloader.ts — placeholder textures (unblocks everything)
[ ] Game.ts — Phase A local loop (bars, buttons, decay, passive)
[ ] game.ts — window message listener for server bridge
[ ] Game.ts — Phase B server sync (receiveServerMessage live)
[ ] Real sprite assets (sim spritesheet, room bg, button icons)
[ ] GameOver.ts — mood = 0 screen + reset trigger
[ ] Upgrade panel — visual "owned" state (grey out purchased)
[ ] MainMenu.ts — start screen + Reddit username display
```

The critical path to a playable prototype is: `shared/api.ts` → `Preloader.ts` stubs → `Game.ts` Phase A. Everything else builds on top of that.

Picking up from where we left off. The remaining pieces are the full scene implementations, the complete Devvit server wiring (the most complex part), and the scheduler for server-side passive income.

---

## `src/client/scenes/Boot.ts`

Boot does one thing: validate the environment and hand off to Preloader. In a Devvit app it's also where you detect whether you're running inside Reddit's webview or in a local dev server, which changes how the message bridge behaves.

```typescript
// src/client/scenes/Boot.ts
import Phaser from 'phaser';

export const IS_DEVVIT = typeof window !== 'undefined' && window.parent !== window;

export class Boot extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload() {
    // Load only what's needed for the loading screen itself
    // (progress bar background, logo if you have one)
    // Keep this minimal — heavy assets go in Preloader
  }

  create() {
    // Notify Reddit that the webview is ready to receive messages
    if (IS_DEVVIT) {
      window.parent.postMessage({ type: 'webViewReady' }, '*');
    }

    this.scene.start('Preloader');
  }
}
```

The `webViewReady` message is what triggers Devvit's server side to send the initial `LOAD_STATE` — without it the server doesn't know the client is listening yet.

---

## `src/client/scenes/Preloader.ts`

Full implementation with a real loading bar, placeholder texture generation, and a clean handoff.

```typescript
// src/client/scenes/Preloader.ts
import Phaser from 'phaser';

export class Preloader extends Phaser.Scene {
  constructor() {
    super('Preloader');
  }

  preload() {
    this.buildLoadingBar();

    // Real assets — comment these out until the files exist
    // this.load.image('bg', 'assets/bg.png');
    // this.load.spritesheet('sim', 'assets/sim.png', { frameWidth: 48, frameHeight: 64 });
    // this.load.image('bar-fill', 'assets/bar-fill.png');
    // this.load.image('btn-eat',   'assets/btn-eat.png');
    // this.load.image('btn-sleep', 'assets/btn-sleep.png');
    // this.load.image('btn-play',  'assets/btn-play.png');
    // this.load.image('btn-work',  'assets/btn-work.png');
  }

  create() {
    this.generatePlaceholderTextures();
    this.scene.start('MainMenu');
  }

  // ── Loading Bar ─────────────────────────────────────────────────────────────

  private buildLoadingBar() {
    const { width, height } = this.scale;
    const cx = width / 2;
    const cy = height / 2;

    const trackW = 320;
    const trackH = 20;

    this.add.rectangle(cx, cy, trackW + 4, trackH + 4, 0x333333);
    const fill = this.add.rectangle(cx - trackW / 2, cy, 0, trackH, 0x88aaff).setOrigin(0, 0.5);
    const label = this.add.text(cx, cy + 30, 'Loading...', {
      fontSize: '14px',
      color: '#aaaaaa',
    }).setOrigin(0.5);

    this.load.on('progress', (p: number) => {
      fill.width = trackW * p;
      label.setText(`Loading... ${Math.floor(p * 100)}%`);
    });

    this.load.on('complete', () => {
      label.setText('Ready!');
    });
  }

  // ── Placeholder Textures ─────────────────────────────────────────────────────
  // Generates all textures programmatically so the game is fully playable
  // before any real art exists. Replace each block by uncommenting the
  // real asset load in preload() and deleting the corresponding generator here.

  private generatePlaceholderTextures() {
    this.makeBg();
    this.makeSim();
    this.makeBarFill();
    this.makeButtonTextures();
    this.makeUpgradePanelBg();
  }

  private makeBg() {
    if (this.textures.exists('bg')) return;
    const g = this.make.graphics({ add: false });

    // Floor
    g.fillStyle(0x5c3d2e);
    g.fillRect(0, 420, 800, 180);

    // Wall
    g.fillStyle(0xd4c5a9);
    g.fillRect(0, 0, 800, 420);

    // Baseboard
    g.fillStyle(0xb8a89a);
    g.fillRect(0, 415, 800, 10);

    // Window
    g.fillStyle(0x87ceeb);
    g.fillRect(580, 80, 140, 120);
    g.lineStyle(4, 0xcccccc);
    g.strokeRect(580, 80, 140, 120);
    g.lineStyle(2, 0xcccccc);
    g.lineBetween(650, 80, 650, 200);
    g.lineBetween(580, 140, 720, 140);

    // Rug
    g.fillStyle(0x8b4b6b);
    g.fillEllipse(280, 460, 280, 80);

    g.generateTexture('bg', 800, 600);
    g.destroy();
  }

  private makeSim() {
    if (this.textures.exists('sim')) return;
    const g = this.make.graphics({ add: false });
    const frames = 4;
    const fw = 48;
    const fh = 64;

    for (let i = 0; i < frames; i++) {
      const ox = i * fw;
      const bounce = i % 2 === 0 ? 0 : -2; // subtle idle bob

      // Body
      g.fillStyle(0x5b8dd9);
      g.fillRect(ox + 12, 28 + bounce, 24, 26);

      // Head
      g.fillStyle(0xffcc99);
      g.fillCircle(ox + 24, 18 + bounce, 14);

      // Eyes
      g.fillStyle(0x333333);
      g.fillCircle(ox + 19, 16 + bounce, 2);
      g.fillCircle(ox + 29, 16 + bounce, 2);

      // Smile
      g.lineStyle(2, 0x333333);
      g.beginPath();
      g.arc(ox + 24, 20 + bounce, 5, 0.2, Math.PI - 0.2);
      g.strokePath();

      // Legs
      g.fillStyle(0x2c2c54);
      g.fillRect(ox + 13, 52 + bounce, 8, 10);
      g.fillRect(ox + 27, 52 + bounce, 8, 10);
    }

    g.generateTexture('sim', fw * frames, fh);
    g.destroy();

    // Register as a spritesheet manually since we used generateTexture
    // (Phaser auto-slices based on the frameConfig you provide to addSpriteSheet)
    this.textures.get('sim').add(
      '__BASE', 0, 0, 0, 48 * 4, 64
    );
  }

  private makeBarFill() {
    if (this.textures.exists('bar-fill')) return;
    const g = this.make.graphics({ add: false });
    g.fillStyle(0xffffff);
    g.fillRect(0, 0, 160, 16);
    g.generateTexture('bar-fill', 160, 16);
    g.destroy();
  }

  private makeButtonTextures() {
    const buttons = [
      { key: 'btn-eat',   color: 0xcc4444, label: 'EAT'   },
      { key: 'btn-sleep', color: 0x4444cc, label: 'SLEEP' },
      { key: 'btn-play',  color: 0x44aa44, label: 'PLAY'  },
      { key: 'btn-work',  color: 0xaa8822, label: 'WORK'  },
    ];

    buttons.forEach(({ key, color }) => {
      if (this.textures.exists(key)) return;
      const g = this.make.graphics({ add: false });
      g.fillStyle(color);
      g.fillRoundedRect(0, 0, 90, 44, 8);
      g.generateTexture(key, 90, 44);
      g.destroy();
    });
  }

  private makeUpgradePanelBg() {
    if (this.textures.exists('upgrade-panel')) return;
    const g = this.make.graphics({ add: false });
    g.fillStyle(0x1a1a2e, 0.9);
    g.fillRoundedRect(0, 0, 200, 200, 10);
    g.lineStyle(1, 0x4444aa);
    g.strokeRoundedRect(0, 0, 200, 200, 10);
    g.generateTexture('upgrade-panel', 200, 200);
    g.destroy();
  }
}
```

---

## `src/client/scenes/MainMenu.ts`

```typescript
// src/client/scenes/MainMenu.ts
import Phaser from 'phaser';

export class MainMenu extends Phaser.Scene {
  constructor() {
    super('MainMenu');
  }

  create() {
    const { width, height } = this.scale;
    const cx = width / 2;

    this.add.image(cx, height / 2, 'bg').setDisplaySize(width, height);

    // Title
    this.add.text(cx, 160, 'Cozy Clicker', {
      fontSize: '48px',
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 6,
      fontStyle: 'bold',
    }).setOrigin(0.5);

    this.add.text(cx, 220, 'Keep your Sim happy!', {
      fontSize: '20px',
      color: '#dddddd',
      stroke: '#000000',
      strokeThickness: 3,
    }).setOrigin(0.5);

    // Play button
    const playBg = this.add.rectangle(cx, 320, 160, 54, 0x4a4a8a)
      .setInteractive({ useHandCursor: true });
    const playText = this.add.text(cx, 320, '▶  Play', {
      fontSize: '22px',
      color: '#ffffff',
    }).setOrigin(0.5);

    playBg.on('pointerover', () => {
      playBg.setFillStyle(0x6a6acc);
      this.tweens.add({ targets: playBg, scaleX: 1.05, scaleY: 1.05, duration: 80 });
    });
    playBg.on('pointerout', () => {
      playBg.setFillStyle(0x4a4a8a);
      this.tweens.add({ targets: playBg, scaleX: 1, scaleY: 1, duration: 80 });
    });
    playBg.on('pointerdown', () => this.scene.start('Game'));

    // How to play
    this.add.text(cx, 420, [
      '🍔 Eat  •  😴 Sleep  •  🎮 Play  •  💼 Work',
      'Keep all bars from hitting zero!',
      'Earn money → buy upgrades → go idle',
    ], {
      fontSize: '14px',
      color: '#bbbbbb',
      align: 'center',
      lineSpacing: 8,
    }).setOrigin(0.5);

    // Idle sim animation on the menu
    const menuSim = this.add.sprite(cx, 510, 'sim');
    if (this.anims.exists('idle')) {
      menuSim.play('idle');
    }
  }
}
```

---

## `src/client/scenes/GameOver.ts`

```typescript
// src/client/scenes/GameOver.ts
import Phaser from 'phaser';
import { IS_DEVVIT } from './Boot';

export class GameOver extends Phaser.Scene {
  constructor() {
    super('GameOver');
  }

  create() {
    const { width, height } = this.scale;
    const cx = width / 2;

    // Dim overlay
    this.add.rectangle(cx, height / 2, width, height, 0x000000, 0.75);

    this.add.text(cx, 180, '😢', { fontSize: '64px' }).setOrigin(0.5);

    this.add.text(cx, 270, 'Your Sim gave up', {
      fontSize: '36px',
      color: '#ff6666',
      stroke: '#000',
      strokeThickness: 4,
      fontStyle: 'bold',
    }).setOrigin(0.5);

    this.add.text(cx, 330, 'All needs hit zero.\nTime for a fresh start.', {
      fontSize: '18px',
      color: '#cccccc',
      align: 'center',
      lineSpacing: 6,
    }).setOrigin(0.5);

    // Try Again button
    const retryBg = this.add.rectangle(cx, 420, 160, 50, 0x884444)
      .setInteractive({ useHandCursor: true });
    this.add.text(cx, 420, '↺  Try Again', {
      fontSize: '20px',
      color: '#ffffff',
    }).setOrigin(0.5);

    retryBg.on('pointerdown', () => {
      // Tell server to reset state
      if (IS_DEVVIT) {
        window.parent.postMessage(
          { type: 'devvit-message', message: { type: 'RESET_STATE' } },
          '*'
        );
      }
      this.scene.start('Game');
    });

    // Stats summary (passed from Game scene via registry)
    const survived = this.registry.get('survivedSeconds') as number ?? 0;
    const earned   = this.registry.get('totalEarned')    as number ?? 0;

    this.add.text(cx, 490, [
      `⏱ Survived: ${this.formatTime(survived)}`,
      `💰 Total earned: $${Math.floor(earned)}`,
    ], {
      fontSize: '15px',
      color: '#aaaaaa',
      align: 'center',
      lineSpacing: 6,
    }).setOrigin(0.5);
  }

  private formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s`;
  }
}
```

Then in `Game.ts` before transitioning to GameOver, push stats into the registry:

```typescript
// Inside tickDecay() in Game.ts, before scene.start('GameOver')
this.registry.set('survivedSeconds', this.survivedSeconds);
this.registry.set('totalEarned', this.totalEarned);
this.scene.start('GameOver');
```

Add `survivedSeconds` and `totalEarned` as class properties that increment in your timers.

---

## `src/server/index.ts` — Full Devvit Wiring

This is the most important file and the one most likely to differ from whatever the template generated. Here's the complete picture:

```typescript
// src/server/index.ts
import { Devvit, useState, useWebView } from '@devvit/public-api';
import { ToServerMessage, ToClientMessage, INITIAL_STATE } from '../shared/api.js';
import { handleMessage } from './routes/api.js';
import { loadState } from './core/post.js';

Devvit.configure({
  redditAPI: true,
  redis: true,
});

// ── Custom Post Type ──────────────────────────────────────────────────────────

Devvit.addCustomPostType({
  name: 'Cozy Clicker',
  height: 'tall',

  render: (context) => {
    const webView = useWebView<ToServerMessage, ToClientMessage>({
      url: 'game.html',

      async onMessage(message, webView) {
        // Route all client messages through the handler
        const response = await handleMessage(message, context);
        await webView.postMessage(response);
      },

      async onUnmount() {
        // Persist lastSeen when the user closes the post
        // loadState already updates lastSeen on load, so this is a no-op
        // but you could do a final save here if needed
      },
    });

    return (
      <vstack height="100%" width="100%" alignment="center middle">
        <webview
          id="myWebView"
          url="game.html"
          width="100%"
          height="100%"
          onMessage={(msg) => webView.onMessage(msg as ToServerMessage)}
        />
      </vstack>
    );
  },
});

// ── Menu Item: Create Post ─────────────────────────────────────────────────────

Devvit.addMenuItem({
  label: 'Create Cozy Clicker Post',
  location: 'subreddit',
  onPress: async (event, context) => {
    const subreddit = await context.reddit.getCurrentSubreddit();
    const post = await context.reddit.submitPost({
      title: 'Cozy Clicker — Keep your Sim happy!',
      subredditName: subreddit.name,
      preview: (
        <vstack height="100%" width="100%" alignment="center middle">
          <text size="large">🏠 Cozy Clicker</text>
          <text>Click to play!</text>
        </vstack>
      ),
    });
    context.ui.showToast({ text: 'Post created!' });
    context.ui.navigateTo(post);
  },
});

// ── Scheduler: Server-side passive income ticks ───────────────────────────────
// This runs even when no one has the post open, making the idle progression real

Devvit.addSchedulerJob({
  name: 'passive_tick',
  onRun: async (event, context) => {
    // The job payload carries the postId
    const postId = event.data?.postId as string | undefined;
    if (!postId) return;

    // loadState handles decay + passive upgrades and saves automatically
    await loadState(context.redis, postId);
  },
});

// ── Trigger: Schedule passive ticks when a post is created ───────────────────

Devvit.addTrigger({
  event: 'PostCreate',
  onEvent: async (event, context) => {
    if (!event.post) return;

    // Schedule a recurring tick every 60 seconds for this post
    await context.scheduler.runJob({
      name: 'passive_tick',
      data: { postId: event.post.id },
      cron: '* * * * *', // every minute
    });
  },
});

export default Devvit;
```

---

## `src/server/routes/triggers.ts`

For anything beyond the basic scheduler — vote triggers, comment triggers, or special events:

```typescript
// src/server/routes/triggers.ts
import { Devvit } from '@devvit/public-api';
import { loadState, saveState } from '../core/post.js';

// Example: bonus money when someone upvotes the post
export async function onPostVote(
  postId: string,
  direction: number, // +1 or -1
  context: Devvit.Context
) {
  if (direction !== 1) return; // only upvotes

  const state = await loadState(context.redis, postId);
  const bonusState = {
    ...state,
    money: state.money + 5,
  };
  // saveState is not exported yet — add it to post.ts exports
  await context.redis.set(`sim:state:${postId}`, JSON.stringify(bonusState));
}
```

You'd wire this inside a `Devvit.addTrigger({ event: 'PostVote', ... })` block in `index.ts` when you're ready for it. Not critical for the prototype.

---

## `src/server/core/post.ts` — One Missing Export

Add `RESET_STATE` handling since `GameOver.ts` sends it, and export `saveState` so triggers can use it:

```typescript
// Add to post.ts

export async function resetState(
  redis: Devvit.Context['redis'],
  postId: string
): Promise<SimState> {
  const fresh: SimState = { ...INITIAL_STATE, lastSeen: Date.now() };
  await saveState(redis, postId, fresh);
  return fresh;
}

// Make saveState exported
export async function saveState(  // remove 'async function' → change to export
  redis: Devvit.Context['redis'],
  postId: string,
  state: SimState
): Promise<void> {
  await redis.set(STATE_KEY(postId), JSON.stringify(state));
}
```

And add `RESET_STATE` to the router in `api.ts`:

```typescript
// In api.ts switch statement
case 'RESET_STATE': {
  const state = await resetState(redis, postId);
  return { type: 'STATE_UPDATE', state };
}
```

And add it to the shared type in `api.ts`:

```typescript
export type ToServerMessage =
  | { type: 'LOAD_STATE' }
  | { type: 'ACTION'; action: SimAction }
  | { type: 'BUY_UPGRADE'; upgradeId: UpgradeId }
  | { type: 'RESET_STATE' };  // ← add this
```

---

## `src/client/game.ts` — Full Entry Point

```typescript
// src/client/game.ts
import Phaser from 'phaser';
import { Boot }      from './scenes/Boot';
import { Preloader } from './scenes/Preloader';
import { MainMenu }  from './scenes/MainMenu';
import { Game }      from './scenes/Game';
import { GameOver }  from './scenes/GameOver';
import { ToClientMessage } from '../shared/api';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: 800,
  height: 600,
  backgroundColor: '#1a1a2e',
  parent: 'game-container',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [Boot, Preloader, MainMenu, Game, GameOver],
};

const phaserGame = new Phaser.Game(config);

// ── Devvit message bridge ────────────────────────────────────────────────────

window.addEventListener('message', (event) => {
  // Filter to Devvit messages only
  if (event.data?.type !== 'devvit-message') return;
  const msg = event.data?.data?.message as ToClientMessage | undefined;
  if (!msg) return;

  const gameScene = phaserGame.scene.getScene('Game') as Game | null;
  if (gameScene?.scene.isActive() && gameScene.receiveServerMessage) {
    gameScene.receiveServerMessage(msg);
  }
});

export default phaserGame;
```

---

## Final Dependency Map

Here's how every file connects, which makes the build order obvious:

```
shared/api.ts
    ↓ imported by both sides
server/core/post.ts          client/scenes/Boot.ts
    ↓                              ↓
server/routes/api.ts         client/scenes/Preloader.ts
    ↓                              ↓
server/index.ts              client/scenes/MainMenu.ts
    (Devvit entry)                 ↓
                             client/scenes/Game.ts ←→ server (postMessage)
                                   ↓
                             client/scenes/GameOver.ts
                                   ↑
                             client/game.ts (wires message bridge)
```

---

## Updated `todo.md`

```
DONE (scaffolding exists):
[x] Project structure (Devvit + Phaser + Vite + TypeScript)
[x] Scene stubs (Boot, Preloader, MainMenu, Game, GameOver)
[x] Server route stubs (api, forms, menu, triggers)

PHASE A — Local loop (no server needed, do these first):
[ ] shared/api.ts           — types, constants, ACTION_DELTAS, UPGRADES
[ ] Preloader.ts            — loading bar + all placeholder textures
[ ] Boot.ts                 — webViewReady postMessage + IS_DEVVIT export
[ ] Game.ts                 — bars, buttons, decay timer, passive timer, pop-ups
[ ] MainMenu.ts             — title screen, play button, menu sim
[ ] GameOver.ts             — death screen, stats summary, retry button
[ ] game.ts                 — Phaser config + message bridge listener

PHASE B — Server sync (do these after Phase A is playable):
[ ] server/core/post.ts     — Redis load/save/decay/actions/reset
[ ] server/routes/api.ts    — message router (LOAD, ACTION, BUY, RESET)
[ ] server/index.ts         — Devvit.addCustomPostType + scheduler + trigger
[ ] Wire RESET_STATE in api.ts and shared/api.ts

PHASE C — Polish:
[ ] Real sim spritesheet (idle, eat, sleep, play animations)
[ ] Real room background art
[ ] Upgrade panel: grey out purchased upgrades visually
[ ] survivedSeconds + totalEarned tracking in Game.ts
[ ] Post-vote bonus trigger in triggers.ts
[ ] devvit upload + test on staging subreddit
```

Phase A can be done entirely with `vite dev` in a browser tab — no Reddit account, no `devvit playtest` needed. That's the fastest path to seeing the game running.

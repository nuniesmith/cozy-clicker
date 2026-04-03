import * as Phaser from 'phaser';
import {
  SimState,
  INITIAL_STATE,
  ACTION_DELTAS,
  STAT_DECAY_PER_SECOND,
  clamp,
  calcMood,
  StatId,
  SimAction,
  ToClientMessage,
} from '../../shared/api';

// ---------------------------------------------------------------------------
// Layout constants (1024 × 768 base)
// ---------------------------------------------------------------------------
const PADDING = 32;
const BAR_WIDTH = 340;
const BAR_HEIGHT = 28;
const BAR_GAP = 52;
const BUTTON_W = 180;
const BUTTON_H = 52;
const BUTTON_GAP = 16;

// Colours keyed to the real StatId union: hunger | thirst | energy | fun
const STAT_COLOURS: Record<StatId, number> = {
  hunger: 0xf4a261,
  thirst: 0x4cc9f0,
  energy: 0x2a9d8f,
  fun: 0xe9c46a,
};

const STAT_IDS: StatId[] = ['hunger', 'thirst', 'energy', 'fun'];
const SIM_ACTIONS: SimAction[] = ['eat', 'sleep', 'play'];

const BAR_BG = 0x2c2c3e;
const LABEL_COLOUR = '#ffffff';
const VALUE_COLOUR = '#cccccc';
const BUTTON_BG = 0x3a3a5c;
const BUTTON_HOVER = 0x5a5a8c;
const BUTTON_TEXT = '#e0e0ff';
const COIN_COLOUR = '#ffd700';

// ---------------------------------------------------------------------------
// UI bookkeeping types
// ---------------------------------------------------------------------------
interface StatBar {
  bg: Phaser.GameObjects.Rectangle;
  fill: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
  value: Phaser.GameObjects.Text;
}

interface ActionButton {
  bg: Phaser.GameObjects.Rectangle;
  text: Phaser.GameObjects.Text;
  action: SimAction;
}

// ---------------------------------------------------------------------------
// Game scene
// ---------------------------------------------------------------------------
export class Game extends Phaser.Scene {
  // ── State ─────────────────────────────────────────────────────────────────
  private state!: SimState;

  // ── UI refs ───────────────────────────────────────────────────────────────
  private statBars: Partial<Record<StatId, StatBar>> = {};
  private actionButtons: ActionButton[] = [];
  private statusText!: Phaser.GameObjects.Text;
  private coinText!: Phaser.GameObjects.Text;
  private moodText!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: 'Game' });
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  create(): void {
    this.state = structuredClone(INITIAL_STATE);

    this.buildBackground();
    this.buildStatBars();
    this.buildActionButtons();
    this.buildHUD();

    this.scale.on('resize', this.onResize, this);
    this.refreshUI();
    console.log('[Game] Scene created.');
  }

  override update(_time: number, delta: number): void {
    this.applyStatDecay(delta / 1000); // ms → seconds
    this.refreshUI();
  }

  // ── Server bridge ──────────────────────────────────────────────────────────

  receiveServerMessage(msg: ToClientMessage): void {
    console.log('[Game] Server message:', msg);

    switch (msg.type) {
      case 'stateUpdate':
      case 'actionResult':
        // Both carry a full SimState — replace local copy with authoritative state
        this.state = msg.state;
        this.refreshUI();
        if (msg.type === 'actionResult') {
          this.showStatus('✓ action confirmed');
        }
        break;

      case 'error':
        this.showStatus(`⚠ ${msg.message}`, '#ff6b6b');
        break;
    }
  }

  private sendToServer(
    msg: Parameters<typeof window.parent.postMessage>[0]
  ): void {
    window.parent?.postMessage({ type: 'devvit-message', message: msg }, '*');
  }

  // ── Simulation ─────────────────────────────────────────────────────────────

  private applyStatDecay(dt: number): void {
    for (const id of STAT_IDS) {
      this.state.stats[id] = clamp(
        this.state.stats[id] - STAT_DECAY_PER_SECOND[id] * dt
      );
    }
  }

  private applyAction(action: SimAction): void {
    const deltas = ACTION_DELTAS[action];

    // Apply stat deltas
    for (const id of STAT_IDS) {
      const d = deltas[id] ?? 0;
      this.state.stats[id] = clamp(this.state.stats[id] + d);
    }

    // Apply coin reward
    this.state.coins += deltas.coins;

    this.sendToServer({ type: 'action', action });
    this.showStatus(`${action}…`);
    this.refreshUI();
  }

  // ── UI builders ────────────────────────────────────────────────────────────

  private buildBackground(): void {
    const { width, height } = this.scale;
    this.add.rectangle(0, 0, width, height, 0x1a1a2e).setOrigin(0, 0);

    this.add
      .text(width / 2, PADDING, 'Cozy Clicker', {
        fontSize: '28px',
        fontFamily: 'Arial',
        color: '#e0e0ff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5, 0)
      .setName('title');
  }

  private buildStatBars(): void {
    const startY = 90;
    const ids = STAT_IDS;

    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]!;
      const x = PADDING;
      const y = startY + i * BAR_GAP;

      const label = this.add.text(x, y, id.toUpperCase(), {
        fontSize: '14px',
        fontFamily: 'Arial',
        color: LABEL_COLOUR,
        fontStyle: 'bold',
      });

      const barX = x + 110;
      const barY = y + 4;

      const bg = this.add
        .rectangle(barX, barY, BAR_WIDTH, BAR_HEIGHT, BAR_BG)
        .setOrigin(0, 0);
      const fill = this.add
        .rectangle(barX, barY, BAR_WIDTH, BAR_HEIGHT, STAT_COLOURS[id])
        .setOrigin(0, 0);

      const value = this.add.text(barX + BAR_WIDTH + 10, y, '100', {
        fontSize: '14px',
        fontFamily: 'Arial',
        color: VALUE_COLOUR,
      });

      this.statBars[id] = { bg, fill, label, value };
    }
  }

  private buildActionButtons(): void {
    const startX = PADDING;
    const startY = 380;

    for (let i = 0; i < SIM_ACTIONS.length; i++) {
      const action = SIM_ACTIONS[i]!;
      const col = i % 3;
      const row = Math.floor(i / 3);
      const x = startX + col * (BUTTON_W + BUTTON_GAP);
      const y = startY + row * (BUTTON_H + BUTTON_GAP);

      const bg = this.add
        .rectangle(x, y, BUTTON_W, BUTTON_H, BUTTON_BG)
        .setOrigin(0, 0)
        .setInteractive({ useHandCursor: true })
        .on('pointerover', () => bg.setFillStyle(BUTTON_HOVER))
        .on('pointerout', () => bg.setFillStyle(BUTTON_BG))
        .on('pointerdown', () => this.applyAction(action));

      const label = `${action}  +${ACTION_DELTAS[action].coins}🪙`;
      const text = this.add
        .text(x + BUTTON_W / 2, y + BUTTON_H / 2, label, {
          fontSize: '15px',
          fontFamily: 'Arial',
          color: BUTTON_TEXT,
          fontStyle: 'bold',
        })
        .setOrigin(0.5, 0.5);

      this.actionButtons.push({ bg, text, action });
    }
  }

  private buildHUD(): void {
    const { width, height } = this.scale;

    this.coinText = this.add
      .text(width - PADDING, PADDING, '🪙 0', {
        fontSize: '18px',
        fontFamily: 'Arial',
        color: COIN_COLOUR,
        fontStyle: 'bold',
      })
      .setOrigin(1, 0)
      .setName('coinText');

    this.moodText = this.add
      .text(PADDING, height - PADDING - 24, 'Mood: –', {
        fontSize: '14px',
        fontFamily: 'Arial',
        color: '#aaaaff',
      })
      .setName('moodText');

    this.statusText = this.add
      .text(width / 2, height - PADDING, '', {
        fontSize: '14px',
        fontFamily: 'Arial',
        color: '#aaffaa',
      })
      .setOrigin(0.5, 1)
      .setName('statusText');
  }

  // ── UI refresh ─────────────────────────────────────────────────────────────

  private refreshUI(): void {
    // Stat bars
    for (const id of STAT_IDS) {
      const bar = this.statBars[id];
      if (!bar) continue;
      const val = this.state.stats[id];
      bar.fill.width = BAR_WIDTH * (clamp(val) / 100);
      bar.value.setText(Math.round(val).toString());
    }

    // Coins & mood
    this.coinText?.setText(`🪙 ${this.state.coins}`);
    this.moodText?.setText(`Mood: ${Math.round(calcMood(this.state))}%`);
  }

  private showStatus(msg: string, colour = '#aaffaa'): void {
    this.statusText.setText(msg).setColor(colour);
    this.time.delayedCall(2500, () => this.statusText.setText(''));
  }

  // ── Resize ─────────────────────────────────────────────────────────────────

  private onResize(): void {
    const { width, height } = this.scale;

    (
      this.children.getByName('title') as Phaser.GameObjects.Text | null
    )?.setPosition(width / 2, PADDING);
    (
      this.children.getByName('coinText') as Phaser.GameObjects.Text | null
    )?.setPosition(width - PADDING, PADDING);
    (
      this.children.getByName('moodText') as Phaser.GameObjects.Text | null
    )?.setPosition(PADDING, height - PADDING - 24);

    this.statusText?.setPosition(width / 2, height - PADDING);
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────

  shutdown(): void {
    this.scale.off('resize', this.onResize, this);
  }
}

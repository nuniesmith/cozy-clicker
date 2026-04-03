import * as Phaser from 'phaser';
import { Boot } from './scenes/Boot';
import { GameOver } from './scenes/GameOver';
import { Game as MainGame } from './scenes/Game';
import { MainMenu } from './scenes/MainMenu';
import { Preloader } from './scenes/Preloader';
import type { ToClientMessage } from '../shared/api';

// ---------------------------------------------------------------------------
// Phaser configuration
// ---------------------------------------------------------------------------
const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game-container',
  backgroundColor: '#028af8',
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 1024,
    height: 768,
  },
  scene: [Boot, Preloader, MainMenu, MainGame, GameOver],
};

// ---------------------------------------------------------------------------
// Game bootstrap
// ---------------------------------------------------------------------------
let phaserGame: Phaser.Game;

/**
 * Starts the Phaser game and wires the Devvit postMessage bridge.
 * Called once the DOM is ready.
 */
function startGame(parent: string): void {
  phaserGame = new Phaser.Game({ ...config, parent });

  // The game emits 'ready' after all scenes are instantiated but before any
  // scene's create() runs.  We listen for the Game scene's own 'create'
  // event (forwarded via the EventEmitter) so we know it is fully alive
  // before we start routing server messages to it.
  phaserGame.events.once('ready', () => {
    const gameScene = phaserGame.scene.getScene('Game') as MainGame | null;

    if (!gameScene) {
      console.error('[Bridge] Could not find Game scene after ready event.');
      return;
    }

    // Wait until the scene has actually run create() before marking it live.
    gameScene.events.once('create', () => {
      console.log('[Bridge] Game scene is live – message bridge active.');
      registerMessageBridge(gameScene);
    });
  });
}

// ---------------------------------------------------------------------------
// Devvit postMessage bridge
// ---------------------------------------------------------------------------
function registerMessageBridge(gameScene: MainGame): void {
  window.addEventListener('message', (event: MessageEvent) => {
    // Devvit wraps messages in { type: 'devvit-message', message: <payload> }
    if (event.data?.type !== 'devvit-message') return;

    const msg = event.data.message as ToClientMessage;
    console.log('[Bridge] → Game scene:', msg);
    gameScene.receiveServerMessage(msg);
  });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  startGame('game-container');
});

import { Boot } from './scenes/Boot';
import { GameOver } from './scenes/GameOver';
import { Game as MainGame } from './scenes/Game';
import { MainMenu } from './scenes/MainMenu';
import { AUTO, Game as PhaserGame } from 'phaser';
import { Preloader } from './scenes/Preloader';
import * as Phaser from 'phaser';
import type { ToClientMessage } from '../shared/api';

// Phaser config
const config: Phaser.Types.Core.GameConfig = {
  type: AUTO,
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

let phaserGame: PhaserGame;
let gameScene: MainGame | null = null;

const StartGame = (parent: string) => {
  phaserGame = new PhaserGame({ ...config, parent });

  // Step 5: Wire message bridge
  phaserGame.events.once('ready', () => {
    gameScene = phaserGame.scene.scenes.find(
      (s) => s.scene?.key === 'Game'
    ) as MainGame;
    console.log('Game scene ready for sync');
  });
};

// Devvit postMessage bridge (matches Game.ts sendToServer)
window.addEventListener('message', (event: MessageEvent) => {
  if (gameScene && event.data.type === 'devvit-message') {
    gameScene.receiveServerMessage(event.data.message as ToClientMessage);
  }
});

document.addEventListener('DOMContentLoaded', () => {
  StartGame('game-container');
});

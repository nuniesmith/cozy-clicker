import * as Phaser from 'phaser';
import type { ToClientMessage, SimState } from '../../shared/api';

export class Game extends Phaser.Scene {
  state: SimState;
  hungerBar!: Phaser.GameObjects.Rectangle;
  thirstBar!: Phaser.GameObjects.Rectangle;
  energyBar!: Phaser.GameObjects.Rectangle;

  receiveServerMessage(message: ToClientMessage): void {
    switch (message.type) {
      case 'stateUpdate':
      case 'actionResult':
        this.state = message.state;
        // TODO: Update UI (bars, text, etc.)
        break;
      case 'error':
        console.error(message.message);
        // TODO: Show error toast or message
        break;
    }
  }
}

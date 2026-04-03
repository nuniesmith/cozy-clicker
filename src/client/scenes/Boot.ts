import { Scene } from 'phaser';

export class Boot extends Scene {
  constructor() {
    super('Boot');
  }


    this.load.image('background', '../assets/bg.png');
  }

  create() {
    this.scene.start('Preloader');
  }
}

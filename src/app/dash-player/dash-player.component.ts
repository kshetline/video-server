import { Component, EventEmitter, Input, Output } from '@angular/core';
import { MediaPlayer, MediaPlayerClass } from 'dashjs';
import { encodeForUri } from '@tubular/util';

@Component({
  selector: 'app-dash-player',
  templateUrl: './dash-player.component.html',
  styleUrls: ['./dash-player.component.scss']
})
export class DashPlayerComponent {
  private player: MediaPlayerClass;
  private _src: string;

  currentResolution = '';

  @Output() onClose = new EventEmitter<void>();

  @Input() get src(): string { return this._src; }
  set src(value: string) {
    if (this._src !== value) {
      this._src = value;

      if (this.player) {
        this.player.destroy();
        this.player = undefined;
      }

      if (!value)
        this.onClose.emit();
      else {
        const url = '/api/stream' + value.split('/').map(s => encodeForUri(s)).join('/');

        this.player = MediaPlayer().create();
        this.player.on('qualityChangeRendered', evt => {
          const info = this.player.getBitrateInfoListFor('video')[evt.newQuality];

          setTimeout(() => this.currentResolution = `${info.width}x${info.height}`);
        });
        this.player.initialize(document.querySelector('#video-player'), url, true);
      }
    }
  }
}

import { Component, EventEmitter, HostListener, Input, Output } from '@angular/core';
import { MediaPlayer, MediaPlayerClass } from 'dashjs';
import { encodeForUri } from '@tubular/util';

@Component({
  selector: 'app-dash-player',
  templateUrl: './dash-player.component.html',
  styleUrls: ['./dash-player.component.scss']
})
export class DashPlayerComponent {
  private mouseTimer: any;
  private player: MediaPlayerClass;
  private _src: string;

  currentResolution = '';
  showHeader = false;
  webMUrl = '';

  @HostListener('window:mousemove') onMouseMove(): void {
    if (this.mouseTimer)
      clearTimeout(this.mouseTimer);

    this.showHeader = true;
    this.mouseTimer = setTimeout(() => this.showHeader = false, 5000);
  }

  @Output() onClose = new EventEmitter<void>();

  @Input() get src(): string { return this._src; }
  set src(value: string) {
    if (this._src !== value) {
      this._src = value;
      this.currentResolution = '';
      this.webMUrl = '';

      if (this.player) {
        this.player.destroy();
        this.player = undefined;
      }

      if (!value)
        this.onClose.emit();
      else {
        this.showHeader = true;

        const url = '/api/stream' + (value.startsWith('/') ? '' : '/') + value.split('/').map(s => encodeForUri(s)).join('/');

        if (url.endsWith('.mpd')) {
          this.player = MediaPlayer().create();
          this.player.on('playbackProgress', () => {
            const info = this.player.getBitrateInfoListFor('video')[this.player.getQualityFor('video')];

            setTimeout(() => this.currentResolution = `${info.width}x${info.height}`);
          });
          this.player.initialize(document.querySelector('#video-player'), url, true);
        }
        else
          this.webMUrl = url;
      }
    }
  }
}

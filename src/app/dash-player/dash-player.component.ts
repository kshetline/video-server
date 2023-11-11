import { Component, EventEmitter, HostListener, Input, OnDestroy, OnInit, Output } from '@angular/core';
import { MediaPlayer, MediaPlayerClass } from 'dashjs';
import { encodeForUri, toNumber } from '@tubular/util';
import { max, min } from '@tubular/math';

@Component({
  selector: 'app-dash-player',
  templateUrl: './dash-player.component.html',
  styleUrls: ['./dash-player.component.scss']
})
export class DashPlayerComponent implements OnDestroy, OnInit {
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

  @HostListener('window:touchstart') onTouchStart(): void {
    this.onMouseMove();
  }

  onKeyDown = (evt: KeyboardEvent): void => {
    let newQuality = -1;

    if (this.player) {
      if (evt.key === ']')
        newQuality = min(this.player.getQualityFor('video') + 1, 2);
      else if (evt.key === '[')
        newQuality = max(this.player.getQualityFor('video') - 1, 0);
    }

    if (newQuality >= 0) {
      this.player.setQualityFor('video', newQuality);
      evt.stopPropagation();
      evt.preventDefault();
    }
  };

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
        let playerId = '#webm-player';

        if (url.endsWith('.mpd')) {
          this.player = MediaPlayer().create();
          this.player.on('playbackProgress', () => {
            const info = this.player.getBitrateInfoListFor('video')[this.player.getQualityFor('video')];

            setTimeout(() => this.currentResolution = `${info.width}x${info.height}`);
          });
          playerId = '#dash-player';
          this.player.initialize(document.querySelector(playerId), url, false);
        }
        else
          this.webMUrl = url;

        this.findPlayer(playerId);
      }
    }
  }

  ngOnInit(): void {
    window.addEventListener('keydown', this.onKeyDown, true);
  }

  ngOnDestroy(): void {
    window.removeEventListener('keydown', this.onKeyDown, true);
  }

  private volumeChange = (evt: Event): void => {
    localStorage.setItem('vs_player_volume', (evt.target as HTMLVideoElement).volume.toString());
  };

  private findPlayer(id: string, tries = 0): void {
    const playerElem = document.querySelector(id) as HTMLVideoElement;

    if (!playerElem) {
      if (tries < 120)
        setTimeout(() => this.findPlayer(id, tries + 1), 50);

      return;
    }

    const lastVolume = localStorage.getItem('vs_player_volume');

    if (lastVolume)
      playerElem.volume = max(toNumber(lastVolume), 0.05);

    playerElem.addEventListener('volumechange', this.volumeChange);
    setTimeout(() => {
      if (this.player)
        this.player.play();
      else
        playerElem.play().catch(err => console.error(err));
    }, 1000);
  }
}

import { Component, EventEmitter, HostListener, Input, OnDestroy, OnInit, Output } from '@angular/core';
import { MediaPlayer, MediaPlayerClass } from 'dashjs';
import { encodeForUri, toNumber } from '@tubular/util';
import { max, min } from '@tubular/math';
import { AuthService } from '../auth.service';

@Component({
  selector: 'app-dash-player',
  templateUrl: './dash-player.component.html',
  styleUrls: ['./dash-player.component.scss']
})
export class DashPlayerComponent implements OnDestroy, OnInit {
  private aspectRatio = -1;
  private mouseTimer: any;
  private player: MediaPlayerClass;
  private _src: string;

  currentResolution = '';
  narrow = false;
  showHeader = false;
  videoUrl = '';

  constructor(private authService: AuthService) {}

  @HostListener('window:mousemove') onMouseMove(): void {
    if (this.mouseTimer)
      clearTimeout(this.mouseTimer);

    this.showHeader = true;
    this.mouseTimer = setTimeout(() => this.showHeader = false, 5000);
  }

  @HostListener('window:touchstart') onTouchStart(): void {
    this.onMouseMove();
  }

  @HostListener('window:resize') onResize(): void {
    const windowAspect = window.innerWidth / window.innerHeight;

    if (this.aspectRatio > 0)
      this.narrow = (windowAspect > this.aspectRatio);
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
      this.videoUrl = '';
      this.aspectRatio = -1;

      if (this.player) {
        this.player.destroy();
        this.player = undefined;
      }

      if (!value)
        this.onClose.emit();
      else {
        this.showHeader = true;

        const url = '/api/stream' + (value.startsWith('/') ? '' : '/') + value.split('/').map(s => encodeForUri(s)).join('/');
        let playerId = '#direct-player';

        if (url.endsWith('.mpd')) {
          this.player = MediaPlayer().create();
          playerId = '#dash-player';
          this.player.updateSettings({ streaming: { buffer: { fastSwitchEnabled: true } } });
          this.player.initialize(document.querySelector(playerId), url, false);
        }
        else
          this.videoUrl = url;

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

    playerElem.addEventListener('loadedmetadata', () => {
      this.aspectRatio = playerElem.videoWidth / playerElem.videoHeight;
      this.onResize();
    });
    playerElem.addEventListener('ended', () => this.onMouseMove());
    playerElem.addEventListener('pause', () => this.onMouseMove());
    playerElem.addEventListener('progress', () => {
      const resolution = `${playerElem.videoWidth}x${playerElem.videoHeight}`;

      if (this.authService.getSession().name === 'admin' && this.currentResolution !== resolution)
        this.onMouseMove();

      this.currentResolution = resolution;
    });
    playerElem.addEventListener('volumechange', this.volumeChange);
    setTimeout(() => {
      if (this.player)
        this.player.play();
      else
        playerElem.play().catch(err => console.error(err));
    }, 1000);
  }
}

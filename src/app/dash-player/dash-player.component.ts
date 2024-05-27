import { Component, EventEmitter, HostListener, Input, OnDestroy, OnInit, Output } from '@angular/core';
import { MediaPlayer, MediaPlayerClass } from 'dashjs';
import { encodeForUri, toNumber } from '@tubular/util';
import { max, min } from '@tubular/math';
import { AuthService } from '../auth.service';
import { StatusInterceptor } from '../status.service';
import { HttpClient } from '@angular/common/http';
import { checksum53 } from '../../../server/src/shared-utils';
import { PlaybackProgress } from '../../../server/src/shared-types';

@Component({
  selector: 'app-dash-player',
  templateUrl: './dash-player.component.html',
  styleUrls: ['./dash-player.component.scss']
})
export class DashPlayerComponent implements OnDestroy, OnInit {
  private aspectRatio = -1;
  private mouseTimer: any;
  private playerElem: HTMLVideoElement;
  private _src: string;
  private timeChangeTimer: any;

  currentResolution = '';
  narrow = false;
  player: MediaPlayerClass;
  showHeader = false;
  videoUri = '';
  videoUrl = '';

  constructor(private http: HttpClient, private authService: AuthService) {}

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
    const windowAspect = (window.innerWidth - 28) / (window.innerHeight - 28);

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
      this.videoUri = '';
      this.videoUrl = '';
      this.aspectRatio = -1;
      this.playerElem = undefined;

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

        this.videoUri = value.replace(/^\//, '');
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

  closeVideo(): void {
    this.registerTimeChange(true);
    this.onClose.emit();
    this.playerElem = undefined;
  }

  private findPlayer(id: string, tries = 0): void {
    this.playerElem = document.querySelector(id) as HTMLVideoElement;

    if (!this.playerElem) {
      if (tries < 120)
        setTimeout(() => this.findPlayer(id, tries + 1), 50);

      return;
    }

    const lastVolume = localStorage.getItem('vs_player_volume');

    if (lastVolume)
      this.playerElem.volume = max(toNumber(lastVolume), 0.05);

    this.playerElem.addEventListener('loadedmetadata', () => {
      this.aspectRatio = this.playerElem.videoWidth / this.playerElem.videoHeight;
      this.onResize();
    });
    this.playerElem.addEventListener('ended', () => { this.registerTimeChange(true); this.onMouseMove(); });
    this.playerElem.addEventListener('pause', () => { this.registerTimeChange(true); this.onMouseMove(); });
    this.playerElem.addEventListener('seeked', () => { this.registerTimeChange(); this.onMouseMove(); });
    this.playerElem.addEventListener('progress', () => {
      this.registerTimeChange();

      const resolution = `${this.playerElem.videoWidth}x${this.playerElem.videoHeight}`;

      if (this.authService.getSession().name === 'admin' && this.currentResolution !== resolution)
        this.onMouseMove();

      this.currentResolution = resolution;
      StatusInterceptor.alive();
    });
    this.playerElem.addEventListener('volumechange', this.volumeChange);
    setTimeout(() => {
      if (this.player)
        this.player.play();
      else
        this.playerElem.play().catch(err => console.error(err));
    }, 1000);
  }

  private sendTimeChange(): void {
    if (this.videoUri || this.playerElem)
      this.http.put('/api/stream/progress',
        {
          cs: checksum53(this.videoUri.normalize()),
          time: this.player ? this.player.time() : this.playerElem.currentTime,
          duration: this.player ? this.player.duration() : this.playerElem.duration
        } as PlaybackProgress)
        .subscribe();
  }

  private registerTimeChange(force = false): void {
    if (!this.player && !this.playerElem)
      // eslint-disable-next-line no-useless-return
      return;
    else if (force) {
      if (this.timeChangeTimer) {
        clearTimeout(this.timeChangeTimer);
        this.timeChangeTimer = undefined;
      }

      this.sendTimeChange();
    }
    else if (!this.timeChangeTimer)
      this.timeChangeTimer = setTimeout(() => {
        this.timeChangeTimer = undefined;
        this.sendTimeChange();
      }, 5000);
  }
}

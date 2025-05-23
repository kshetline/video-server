import { Component, EventEmitter, HostListener, Input, OnDestroy, OnInit, Output } from '@angular/core';
import { MediaPlayer, MediaPlayerClass } from 'dashjs';
import { encodeForUri, toNumber } from '@tubular/util';
import { max, min } from '@tubular/math';
import { AuthService } from '../auth.service';
import { StatusInterceptor } from '../status.service';
import { HttpClient } from '@angular/common/http';
import { hashUri, itemPath } from '../../../server/src/shared-utils';
import { LibraryItem, PlaybackProgress } from '../../../server/src/shared-types';
import { broadcastMessage } from '../video-ui-utils';
import { Button } from 'primeng/button';

export interface LibItem {
  aggregationId?: number;
  duration: number;
  hash: string;
  id?: number;
  position?: number;
  positionUser: number;
  streamUri: string;
  watched?: boolean;
  watchedByUser: boolean;
}

export interface ItemStreamPair {
  item: LibItem | LibraryItem;
  stream: string;
}

@Component({
  selector: 'app-dash-player',
  templateUrl: './dash-player.component.html',
  styleUrls: ['./dash-player.component.scss'],
  imports: [Button]
})
export class DashPlayerComponent implements OnDestroy, OnInit {
  private aspectRatio = -1;
  private delay = 0;
  private delayMonitor: any = undefined;
  private mouseTimer: any;
  private playerElem: HTMLVideoElement;
  private _src: ItemStreamPair;
  private timeChangeTimer: any;

  countdown: number;
  countdownTimer: any;
  currentResolution = '';
  lastPlayTime = 0;
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

    if (this.lastPlayTime && evt.key === 'Escape') {
      evt.preventDefault();
      this.dontContinue();
    }
    else if (this.lastPlayTime && evt.key === 'Enter') {
      evt.preventDefault();
      this.yesContinue();
    }
    else if (this.player) {
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

  @Input() get src(): ItemStreamPair { return this._src; }
  set src(value: ItemStreamPair) {
    if (this._src !== value) {
      this._src = value;
      this.currentResolution = '';
      this.videoUri = '';
      this.videoUrl = '';
      this.aspectRatio = -1;
      this.playerElem = undefined;
      this.delay = 0;

      if (this.player) {
        this.player.destroy();
        this.player = undefined;
      }

      if (!value)
        this.onClose.emit();
      else {
        const stream = value.stream;

        this.showHeader = true;

        const url = '/api/stream' + (stream.startsWith('/') ? '' : '/') + stream.split('/').map(s => encodeForUri(s)).join('/');
        let playerId = '#direct-player';

        if (url.endsWith('.mpd')) {
          this.http.get<number>('/api/stream/get-delay' + url.substring(11))
            .subscribe(delay => {
              this.delay = delay;
              this.monitorDelay();
            });

          this.player = MediaPlayer().create();
          playerId = '#dash-player';
          this.player.updateSettings({ streaming: { buffer: { fastSwitchEnabled: true } } });
          this.player.initialize(document.querySelector(playerId), url, false);
        }
        else
          this.videoUrl = url;

        this.videoUri = stream.replace(/^\//, '');
        this.findPlayer(playerId);

        let lpt: number;

        if ((lpt = value.item.positionUser) > 60 && lpt < value.item.duration - 5) {
          this.lastPlayTime = lpt;

          if (this.countdownTimer)
            clearInterval(this.countdownTimer);

          this.countdown = 15;
          this.countdownTimer = setInterval(() => {
            --this.countdown;

            if (this.countdown <= 0) {
              clearInterval(this.countdownTimer);
              this.countdownTimer = undefined;
              this.lastPlayTime = 0;
            }
          }, 1000);
        }
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

  dontContinue(): void {
    this.lastPlayTime = 0;
  }

  yesContinue(): void {
    if (this.player)
      this.player.seek(this.lastPlayTime - 3);
    else if (this.playerElem)
      this.playerElem.currentTime = this.lastPlayTime - 3;

    this.lastPlayTime = 0;
  }

  closeVideo(): void {
    this.registerTimeChange(true);
    this.onClose.emit();
    this.playerElem = undefined;

    if (this.player) {
      this.player.destroy();
      this.player = undefined;
    }

    if (this.delayMonitor) {
      clearInterval(this.delayMonitor);
      this.delayMonitor = undefined;
    }
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
    this.playerElem.addEventListener('playing', () => this.monitorDelay());
    this.playerElem.addEventListener('seeking', () => this.monitorDelay());
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
    if (this.src.item && (this.player || this.playerElem)) {
      this.src.item.positionUser = this.player ? this.player.time() : this.playerElem.currentTime;

      if (this.src.item.id) {
        const item = this.src.item;

        setTimeout(() => broadcastMessage('idUpdate2', itemPath(item as LibraryItem)));
      }
    }

    if (this.videoUri)
      this.http.put('/api/stream/progress',
        {
          hash: hashUri(this.videoUri),
          duration: this.player ? this.player.duration() : this.playerElem.duration,
          offset: this.player ? this.player.time() : this.playerElem.currentTime
        } as PlaybackProgress, { responseType: 'text' })
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

  private monitorDelay(count = 0): void {
    if (!this.player || this.delay < 0.045 || count > 40 || this.delayMonitor)
      return;

    const time = this.player.time();

    if (time >= this.delay)
      this.delayMonitor = null;
    else if (count > 10 && time < this.delay && !this.player.isPaused()) {
      this.player.seek(this.delay);
      this.delayMonitor = null;
    }
    else
      this.delayMonitor = setTimeout(() => {
        this.delayMonitor = undefined;
        this.monitorDelay(count + 1);
      }, 100);
  }
}

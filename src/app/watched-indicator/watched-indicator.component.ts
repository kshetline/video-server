import { Component, ElementRef, EventEmitter, Input, OnDestroy, OnInit, Output } from '@angular/core';
import { LibraryItem, PlaybackProgress } from '../../../server/src/shared-types';
import { AuthService } from '../auth.service';
import { HttpClient } from '@angular/common/http';
import { getWatchInfo, hashUri, itemPath } from '../../../server/src/shared-utils';
import { LibItem } from '../dash-player/dash-player.component';
import { webSocketMessagesEmitter } from '../video-ui-utils';
import { updatedItem } from '../app.component';
import { isEqual } from '@tubular/util';
import { min } from '@tubular/math';

@Component({
  selector: 'app-watched-indicator',
  templateUrl: './watched-indicator.component.html',
  styleUrls: ['./watched-indicator.component.scss']
})
export class WatchedIndicatorComponent implements OnDestroy, OnInit {
  private _asAdmin = false;
  private duration = 0;
  private observer = MutationObserver;
  private progress = 0;
  private _progressBar: string;
  private stream: string;
  private updateTimer: any;
  private _video: LibraryItem | LibItem;

  activated = false;
  busy = false;
  incomplete = false;
  mixed = false;
  started = false;
  watched = false;

  constructor(private elem: ElementRef, private httpClient: HttpClient, private auth: AuthService) {
  }

  ngOnInit(): void {
    // @ts-ignore // Not sure why I need this ts-ignore, or the (this.observer as any) either. What's wrong with the MutationObserver definition?
    this.observer = new MutationObserver(_mutations => {
      if (!this.updateTimer) {
        this.updateTimer = setTimeout(() => {
          this.updateTimer = undefined;
          this.updateProgressBar();
        }, 500);
      }
    });
    (this.observer as any).observe(this.elem.nativeElement, { childList: true, subtree: true });

    webSocketMessagesEmitter().subscribe(msg => {
      switch (msg.type) {
        case 'idUpdate2':
          const path = itemPath(this.video as LibraryItem);

          if (isEqual((msg.data as number[]).slice(0, path.length), path)) {
            this.video = updatedItem(this.video as LibraryItem);
            this.examineWatchedStates(this.video);
          }
          break;
      }
    });
  }

  ngOnDestroy(): void {
    (this.observer as any).disconnect();
  }

  @Input() get progressBar(): string { return this._progressBar; }
  set progressBar(value: string) {
    if (this._progressBar !== value) {
      this._progressBar = value;
      this.updateProgressBar();
    }
  }

  @Input() get video(): LibraryItem | LibItem { return this._video; }
  set video(value: LibraryItem | LibItem) {
    if (this._video !== value) {
      this._video = value;

      if (value)
        this.examineWatchedStates(value);
    }
  }

  @Input() get asAdmin(): boolean { return this._asAdmin; }
  set asAdmin(value: boolean) {
    if (this._asAdmin !== value) {
      this._asAdmin = value;
      this.examineWatchedStates(this.video);
    }
  }

  @Input() fade: 'watched' | 'unwatched' | '' | null = null;

  @Output() onUpdate = new EventEmitter<void>();

  showIndicator(): boolean {
    return this.asAdmin ? this.auth.isAdmin() : !!this.stream;
  }

  doFade(): boolean {
    return (this.fade === 'watched' && this.watched) || (this.fade === 'unwatched' && !this.watched);
  }

  start(): void {
    this.started = true;
    this.activated = false;
  }

  toggleWatched(): void {
    this.activated = true;

    if (this.busy)
      return;

    if (this.video) {
      if (!this.asAdmin) {
        this.busy = true;
        this.httpClient.put('/api/stream/progress',
          {
            hash: hashUri(this.stream),
            duration: this.duration,
            offset: 0,
            watched: !this.watched,
            id: this.video.id
          } as PlaybackProgress, { responseType: 'text' })
          .subscribe({ next: () => {
            this.onUpdate.emit();
            this.watched = !this.watched;
          }, complete: () => this.busy = false });
      }
      else if (this.video.id) {
        this.busy = true;
        this.httpClient.put(`/api/library/set-watched?id=${this.video.id}&watched=${this.watched ? 0 : 1}`, null)
          .subscribe({ next: () => {
            this.onUpdate.emit();
            this.watched = !this.watched;
          }, complete: () => this.busy = false });
      }
    }
  }

  end(): void {
    this.started = false;
    this.activated = false;
  }

  private examineWatchedStates(item: LibraryItem | LibItem): void {
    const wi = getWatchInfo(this.asAdmin, item as LibraryItem);

    this.duration = wi.duration;
    this.incomplete = wi.incomplete;
    this.mixed = wi.mixed;
    this.progress = wi.position > 0 && wi.duration > 0 ? min(wi.position * 100 / wi.duration, 100) : 0;
    this.stream = wi.stream;
    this.watched = wi.watched;
    this.updateProgressBar();
  }

  private updateProgressBar(): void {
    if (this.progressBar) {
      const bar = document.getElementById(this.progressBar);
      const inner = bar.firstElementChild as HTMLElement;

      bar.style.visibility = this.showIndicator() && this.progress > 0 && this.progress < 100 ? 'visible' : 'hidden';
      inner.style.width = this.progress.toFixed(1) + '%';
    }
  }
}

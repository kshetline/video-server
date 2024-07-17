import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { LibraryItem, PlaybackProgress } from '../../../server/src/shared-types';
import { AuthService } from '../auth.service';
import { HttpClient } from '@angular/common/http';
import { getWatchInfo, hashUrl, itemPath } from '../../../server/src/shared-utils';
import { LibItem } from '../dash-player/dash-player.component';
import { webSocketMessagesEmitter } from '../video-ui-utils';
import { updatedItem } from '../app.component';
import { isEqual } from '@tubular/util';

@Component({
  selector: 'app-watched-indicator',
  templateUrl: './watched-indicator.component.html',
  styleUrls: ['./watched-indicator.component.scss']
})
export class WatchedIndicatorComponent implements OnInit {
  private _asAdmin = false;
  private duration = 0;
  private stream: string;
  private _video: LibraryItem | LibItem;

  busy = false;
  incomplete = false;
  mixed = false;
  watched = false;

  constructor(private httpClient: HttpClient, private auth: AuthService) {}

  ngOnInit(): void {
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

  toggleWatched(): void {
    if (this.busy)
      return;

    if (this.video) {
      if (!this.asAdmin) {
        this.busy = true;
        this.httpClient.put('/api/stream/progress',
          {
            hash: hashUrl(this.stream),
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

  private examineWatchedStates(item: LibraryItem | LibItem): void {
    const wi = getWatchInfo(this.asAdmin, item as LibraryItem);

    this.duration = wi.duration;
    this.incomplete = wi.incomplete;
    this.mixed = wi.mixed;
    this.stream = wi.stream;
    this.watched = wi.watched;
  }
}

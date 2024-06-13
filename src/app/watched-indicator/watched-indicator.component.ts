import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { LibraryItem, PlaybackProgress } from '../../../server/src/shared-types';
import { AuthService } from '../auth.service';
import { HttpClient } from '@angular/common/http';
import { hashUrl, isAnyCollection } from '../../../server/src/shared-utils';
import { LibItem } from '../dash-player/dash-player.component';
import { webSocketMessagesEmitter } from '../video-ui-utils';

interface WatchCounts {
  watched: number;
  unwatched: number;
}

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

  mixed = false;
  watched = false;

  constructor(private httpClient: HttpClient, private auth: AuthService) {}

  ngOnInit(): void {
    webSocketMessagesEmitter().subscribe(msg => {
      switch (msg.type) {
        case 'idUpdate':
          if (this.video)
            this.examineWatchedStates(this.video);
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
    if (this.video) {
      if (!this.asAdmin && this.stream) {
        this.httpClient.put('/api/stream/progress',
          {
            hash: hashUrl(this.stream),
            duration: this.duration,
            offset: 0,
            watched: !this.watched,
            id: this.video.id
          } as PlaybackProgress, { responseType: 'text' })
          .subscribe(() => {
            this.onUpdate.emit();
            this.watched = !this.watched;
            this.video.watchedByUser = this.watched;
          });
      }
      else if (this.asAdmin && this.video.id) {
        this.httpClient.put(`/api/library/set-watched?id=${this.video.id}&watched=${this.watched ? 0 : 1}`, null).subscribe(() => {
          this.onUpdate.emit();
          this.watched = !this.watched;
          this.video.watched = !this.video.watched;
        });
      }
    }
  }

  private examineWatchedStates(item: LibraryItem | LibItem, counts?: WatchCounts, dataLength?: number): void {
    let atTop = false;
    const aItem = item as LibraryItem;

    if (!counts) {
      atTop = true;
      this.duration = 0;
      this.stream = null;
      this.mixed = false;
      counts = { watched: 0, unwatched: 0 };
    }

    if (!this.asAdmin && item.streamUri && !this.stream) {
      this.stream = item.streamUri;
      this.duration = item.duration / 1000;
    }

    if (item.duration != null && ((this.asAdmin && !isAnyCollection(aItem)) || item.streamUri)) {
      let watched = this.asAdmin ? item.watched : item.watchedByUser;

      if (atTop && this.asAdmin && !watched && aItem.parent?.watched && aItem.parent?.data?.length === 1)
        watched = true;

      counts.watched += watched ? 1 : 0;
      counts.unwatched += watched || dataLength === 1 ? 0 : 1;
    }

    if (aItem.data)
      aItem.data.forEach(i => this.examineWatchedStates(i, counts, aItem.data.length));

    if (atTop) {
      this.watched = (counts.watched > 0);
      this.mixed = (counts.watched > 0 && counts.unwatched > 0);
    }
  }
}

import { Component, EventEmitter, Input, Output } from '@angular/core';
import { LibraryItem, PlaybackProgress } from '../../../server/src/shared-types';
import { AuthService } from '../auth.service';
import { HttpClient } from '@angular/common/http';
import { hashUrl } from '../../../server/src/shared-utils';
import { LibItem } from '../dash-player/dash-player.component';
import { updateItem } from '../app.component';

@Component({
  selector: 'app-watched-indicator',
  templateUrl: './watched-indicator.component.html',
  styleUrls: ['./watched-indicator.component.scss']
})
export class WatchedIndicatorComponent {
  private _video: LibraryItem | LibItem;

  constructor(private httpClient: HttpClient, private auth: AuthService) {}

  @Input() get video(): LibraryItem | LibItem { return this._video; }
  set video(value: LibraryItem | LibItem) {
    if (this._video !== value) {
      this._video = value;
    }
  }

  @Input() asAdmin = false;

  @Output() onUpdate = new EventEmitter<void>();

  showShow(): boolean {
    return !!(this.video?.streamUri && (!this.asAdmin || this.auth.isAdmin()));
  }

  wasWatched(): boolean {
    return !!(this.asAdmin ? this.video?.watched : this.video?.watchedByUser);
  }

  toggleWatched(): void {
    if (this.video) {
      if (!this.asAdmin) {
        this.httpClient.put('/api/stream/progress',
          {
            hash: hashUrl(this.video.streamUri),
            duration: this.video.duration / 1000,
            offset: 0,
            watched: !this.video.watchedByUser
          } as PlaybackProgress, { responseType: 'text' })
          .subscribe(() => this.onUpdate.emit());
      }
      else if (this.video.id) {
        this.httpClient.put(`/api/library/set-watched?id=${this.video.id}&watched=${this.video.watched ? 0 : 1}`, null).subscribe(() => {
          this.onUpdate.emit();
          this.video.watched = !this.video.watched;
          updateItem(this.video as LibraryItem);
        });
      }
    }
  }
}

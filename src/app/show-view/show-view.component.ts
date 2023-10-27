import { Component, EventEmitter, HostListener, Input, Output } from '@angular/core';
import { LibraryItem, VType } from '../../../server/src/shared-types';
import { checksum53, getSeasonTitle } from '../video-ui-utils';
import { encodeForUri } from '@tubular/util';
import { max, round } from '@tubular/math';

@Component({
  selector: 'app-show-view',
  templateUrl: './show-view.component.html',
  styleUrls: ['./show-view.component.scss']
})
export class ShowViewComponent {
  readonly checksum53 = checksum53;
  readonly encodeForUri = encodeForUri;
  readonly getSeasonTitle = getSeasonTitle;
  readonly TV_SEASON = VType.TV_SEASON;

  private _show: LibraryItem;

  selection: LibraryItem;
  video: LibraryItem;
  videoChoices: LibraryItem[] = [];
  videoIndex = 0;

  @Input() get show(): LibraryItem { return this._show; }
  set show(value: LibraryItem) {
    if (this._show !== value) {
      this._show = value;
      this.videoChoices = [];

      const gatherVideos = (item: LibraryItem): void => {
        if (item.type === VType.FILE)
          this.videoChoices.push(item);

        if (item.data?.length > 0)
          item.data.forEach(child => gatherVideos(child));
      };

      gatherVideos(value);
      this.videoIndex = max(this.videoChoices.findIndex(vc => !vc.watched), 0);
      this.video = this.videoChoices[this.videoIndex];
      this.selection = this.video.parent ?? this.video;
    }
  }

  @Output() goBack: EventEmitter<void> = new EventEmitter();

  @HostListener('window:keydown', ['$event']) onKeyDown(event: KeyboardEvent): void {
    if (this.show && event.key === 'Escape')
      this.goBack.emit();
  }

  showYear(): boolean {
    return this.show.year && (this.show.type === VType.MOVIE || !this.show.airDate);
  }

  showAirDate(): boolean {
    return this.selection.airDate && this.show.type === VType.TV_SEASON && !this.showYear();
  }

  getDuration(): string {
    return round(this.video.duration / 60000) + ' minutes';
  }

  getGenres(): string {
    if (this.show.genres?.length > 0)
      return this.show.genres.join(', ');
    else
      return '';
  }
}

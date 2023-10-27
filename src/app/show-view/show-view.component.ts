import { Component, EventEmitter, HostListener, Input, Output } from '@angular/core';
import { LibraryItem, VType } from '../../../server/src/shared-types';
import { checksum53, getSeasonTitle } from '../video-ui-utils';
import { encodeForUri } from '@tubular/util';
import { round } from '@tubular/math';

@Component({
  selector: 'app-show-view',
  templateUrl: './show-view.component.html',
  styleUrls: ['./show-view.component.scss']
})
export class ShowViewComponent {
  readonly checksum53 = checksum53;
  readonly encodeForUri = encodeForUri;
  readonly getSeasonTitle = getSeasonTitle;

  private _show: LibraryItem;

  @Input() get show(): LibraryItem { return this._show; }
  set show(value: LibraryItem) {
    if (this._show !== value) {
      this._show = value;
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

  showReleaseDate(): boolean {
    return this.show.airDate && this.show.type === VType.TV_EPISODE && !this.showYear();
  }

  getDuration(): string {
    return round(this.show.duration / 60000) + ' minutes';
  }

  getGenres(): string {
    if (this.show.genres?.length > 0)
      return this.show.genres.join(', ');
    else
      return '';
  }
}

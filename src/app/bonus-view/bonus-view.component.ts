import { Component, EventEmitter, HostListener, Input, Output } from '@angular/core';
import { LibraryItem, VType } from '../../../server/src/shared-types';
import { checksum53, getImageParam } from '../video-ui-utils';
import { encodeForUri } from '@tubular/util';

@Component({
  selector: 'app-bonus-view',
  templateUrl: './bonus-view.component.html',
  styleUrls: ['./bonus-view.component.scss']
})
export class BonusViewComponent {
  private _source: LibraryItem;

  extras: string[] = [];

  @Input() get source(): LibraryItem { return this._source; }
  set source(value: LibraryItem) {
    if (this._source !== value) {
      this._source = value;
      this.extras = [];

      if (value) {
        let src = value;

        while (src) {
          if (src.extras)
            this.extras.push(...src.extras);

          src = src.parent;
        }
      }
    }
  }

  @Output() goBack: EventEmitter<void> = new EventEmitter();

  @HostListener('window:keydown', ['$event']) onKeyDown(event:KeyboardEvent): void {
    if (this.source && event.key === 'Escape')
      this.goBack.emit();
  }

  getBackgroundUrl(): string {
    let show = this.source;

    while (show && show.type !== VType.MOVIE && show.type !== VType.TV_SEASON)
      show = show.parent;

    if (show)
      return `url("/api/img/backdrop?id=${show.id}&cs=${checksum53(show.name)}${getImageParam()}")`;
    else
      return null;
  }

  uriToTitle(uri: string): string {
    return uri.replace(/^(.*\/)/, '').replace(/\.mkv$/, '').replace(/？/g, '?').replace(/：/g, ':');
  }

  startDownload(elem: HTMLElement): void {
    const link = elem.parentElement?.querySelector('a');

    if (link)
      link.click();
  }

  downloadLink(uri: string): string {
    return '/api/download?url=' + encodeForUri(uri);
  }
}

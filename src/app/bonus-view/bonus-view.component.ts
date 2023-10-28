import { Component, EventEmitter, HostListener, Input, Output } from '@angular/core';
import { LibraryItem, VType } from '../../../server/src/shared-types';
import { checksum53 } from '../video-ui-utils';

@Component({
  selector: 'app-bonus-view',
  templateUrl: './bonus-view.component.html',
  styleUrls: ['./bonus-view.component.scss']
})
export class BonusViewComponent {
  @Input() source: LibraryItem;

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
      return `url("/api/backdrop?id=${show.id}&cs=${checksum53(show.name)}")`;
    else
      return null;
  }
}

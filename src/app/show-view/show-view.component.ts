import { Component, EventEmitter, HostListener, Input, Output } from '@angular/core';
import { LibraryItem } from '../../../server/src/shared-types';
import { checksum53, getSeasonTitle } from '../video-ui-utils';
import { encodeForUri } from '@tubular/util';

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

  @HostListener('window:keydown', ['$event']) onKeyDown(event:KeyboardEvent): void {
    if (this.show && event.key === 'Escape')
      this.goBack.emit();
  }
}

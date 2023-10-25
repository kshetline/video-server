import { Component, EventEmitter, HostListener, Input, Output } from '@angular/core';
import { LibraryItem } from '../../../server/src/shared-types';
import { getSeasonTitle } from '../video-ui-utils';

@Component({
  selector: 'app-show-view',
  templateUrl: './show-view.component.html',
  styleUrls: ['./show-view.component.scss']
})
export class ShowViewComponent {
  getSeasonTitle = getSeasonTitle;

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

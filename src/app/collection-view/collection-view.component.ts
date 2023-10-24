import { Component, EventEmitter, HostListener, Input, Output } from '@angular/core';
import { LibraryItem } from '../../../server/src/shared-types';
import { checksum53 } from '../video-ui-utils';

@Component({
  selector: 'app-collection-view',
  templateUrl: './collection-view.component.html',
  styleUrls: ['./collection-view.component.scss']
})
export class CollectionViewComponent {
  checksum53 = checksum53;

  private _collection: LibraryItem;

  items: LibraryItem[];

  @Input() get collection(): LibraryItem { return this._collection; }
  set collection(value: LibraryItem) {
    if (this._collection !== value) {
      this._collection = value;
      this.items = value.data;
    }
  }

  @Output() goBack: EventEmitter<void> = new EventEmitter();

  @HostListener('window:keydown', ['$event']) onKeyDown(event:KeyboardEvent): void {
    if (this.collection && event.key === 'Escape')
      this.goBack.emit();
  }
}

import { Component, EventEmitter, HostListener, Input, Output } from '@angular/core';
import { LibraryItem } from '../../../server/src/shared-types';
import { checksum53, hashTitle } from '../video-ui-utils';

function getSortTime(item: LibraryItem): number {
  if (item.airDate)
    return +new Date(item.airDate);
  else if (item.releaseDate)
    return +new Date(item.releaseDate);
  if (item.year)
    return +new Date(item.year + '-06-01');
  else
    return 0;
}

@Component({
  selector: 'app-collection-view',
  templateUrl: './collection-view.component.html',
  styleUrls: ['./collection-view.component.scss']
})
export class CollectionViewComponent {
  readonly hashTitle = hashTitle;

  private _collection: LibraryItem;

  items: LibraryItem[];
  overview = '';

  @Input() get collection(): LibraryItem { return this._collection; }
  set collection(value: LibraryItem) {
    if (this._collection !== value) {
      this._collection = value;
      this.items = value?.data;

      if (this.items)
        this.items.sort((a, b) => getSortTime(a) - getSortTime(b));
    }
  }

  @Input() currentShow: LibraryItem;

  @Output() goBack: EventEmitter<void> = new EventEmitter();
  @Output() showSelected: EventEmitter<LibraryItem> = new EventEmitter();

  @HostListener('window:keydown', ['$event']) onKeyDown(event:KeyboardEvent): void {
    if (this.collection && !this.currentShow && event.key === 'Escape')
      this.goBack.emit();
  }

  onClick(item: LibraryItem): void {
    this.showSelected.emit(item);
  }

  getPosterUrl(item: LibraryItem): string {
    return `/api/img/poster?id=${item.id}&cs=${checksum53(item.name)}&w=300&h=450`;
  }
}

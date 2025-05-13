import { Component, EventEmitter, HostListener, Input, Output } from '@angular/core';
import { LibraryItem } from '../../../server/src/shared-types';
import { hashTitle, isCollection, isTvShow } from '../../../server/src/shared-utils';
import { floor } from '@tubular/math';
import { StatusInterceptor } from '../status.service';
import { checksum53 } from '@tubular/util';
import { Button } from 'primeng/button';
import { NgOptimizedImage } from '@angular/common';
import { WatchedIndicatorComponent } from '../watched-indicator/watched-indicator.component';
import { RatingComponent } from '../rating/rating.component';

function getSortTime(item: LibraryItem): number {
  if (item.airDate)
    return +new Date(item.airDate);
  else if (item.releaseDate)
    return +new Date(item.releaseDate);
  else if (!item.year && (item.data || [])[0]?.year)
    return +new Date(item.data[0].year + '-06-01');
  else if (item.year)
    return +new Date(item.year + '-06-01');
  else
    return 0;
}

@Component({
  selector: 'app-collection-view',
  templateUrl: './collection-view.component.html',
  styleUrls: ['./collection-view.component.scss'],
  imports: [Button, NgOptimizedImage, WatchedIndicatorComponent, RatingComponent]
})
export class CollectionViewComponent {
  readonly hashTitle = hashTitle;

  private _collection: LibraryItem;

  items: LibraryItem[];
  overview = '';
  subCollection: LibraryItem;

  @Input() get collection(): LibraryItem { return this._collection; }
  set collection(value: LibraryItem) {
    if (this._collection !== value) {
      StatusInterceptor.alive();
      this._collection = value;
      this.items = value?.data;

      if (this.items)
        this.items.sort((a, b) => getSortTime(a) - getSortTime(b));
    }
  }

  @Input() currentShow: LibraryItem;
  @Input() filter: string;

  @Output() goBack: EventEmitter<void> = new EventEmitter();
  @Output() showSelected: EventEmitter<LibraryItem> = new EventEmitter();

  @HostListener('window:keydown', ['$event']) onKeyDown(event:KeyboardEvent): void {
    if (this.collection && !this.currentShow && event.key === 'Escape')
      this.goBack.emit();
  }

  onClick(item: LibraryItem): void {
    if (this.subCollection)
      return;

    if (isCollection(item) || isTvShow(item))
      this.subCollection = item;
    else
      this.showSelected.emit(item);
  }

  getPosterUrl(item: LibraryItem): string {
    if (item.id !== floor(item.id))
      return '/assets/folder.svg';
    else
      return `/api/img/poster?id=${item.id}&cs=${checksum53(item.originalName || item.name)}&w=300&h=450`;
  }
}

import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { LibraryItem, VideoLibrary, VType } from '../../../server/src/shared-types';
import { checksum53, hashTitle, librarySorter } from '../video-ui-utils';
import { clone, encodeForUri, stripDiacriticals_lc } from '@tubular/util';
import { faFolderOpen } from '@fortawesome/free-regular-svg-icons';
import { faShare } from '@fortawesome/free-solid-svg-icons';

function isMovie(item: LibraryItem): boolean {
  return item.type === VType.MOVIE ||
    (item.type === VType.COLLECTION && item.data?.length > 0 && item.data[0].type === VType.MOVIE);
}

function containsMovie(item: LibraryItem): boolean {
  if (isMovie(item))
    return true;

  for (const child of (item.data || [])) {
    if (containsMovie(child))
      return true;
  }

  return false;
}

function isTV(item: LibraryItem): boolean {
  return item.isTV || item.type === VType.TV_SHOW || item.type === VType.TV_SEASON ||
      item.type === VType.TV_EPISODE || item.type === VType.TV_COLLECTION ||
      (item.type === VType.COLLECTION && item.data?.length > 0 && isTV(item.data[0]));
}

function containsTV(item: LibraryItem): boolean {
  if (isTV(item))
    return true;

  for (const child of (item.data || [])) {
    if (containsTV(child))
      return true;
  }

  return false;
}

@Component({
  selector: 'app-poster-view',
  templateUrl: './poster-view.component.html',
  styleUrls: ['./poster-view.component.scss']
})
export class PosterViewComponent implements OnInit {
  readonly COLLECTION = VType.COLLECTION;
  readonly faFolderOpen = faFolderOpen;
  readonly faShare = faShare;
  readonly hashTitle = hashTitle;

  private _library: VideoLibrary;
  private _filter = 'All';
  private _searchText = '';

  filterChoices = ['All', 'Movies', 'TV', '4K', '3D'];

  intersectionObserver: IntersectionObserver;
  items: LibraryItem[];
  mutationObserver: MutationObserver;
  overview = '';
  showThumbnail: Record<string, boolean> = {};

  @Input() get library(): VideoLibrary { return this._library; }
  set library(value : VideoLibrary) {
    if (this._library !== value) {
      this._library = value;
      this.items = value?.array;
      this.showThumbnail = {};
      this.refilter();
    }
  }

  @Output() itemClicked: EventEmitter<LibraryItem> = new EventEmitter();

  get filter(): string { return this._filter; }
  set filter(value: string) {
    if (this._filter !== value) {
      this._filter = value;
      this.refilter();
    }
  }

  get searchText(): string { return this._searchText; }
  set searchText(value: string) {
    if (this._searchText !== value) {
      this._searchText = value;
      this.refilter();
    }
  }

  ngOnInit(): void {
    this.intersectionObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting && entry.target.hasAttribute('data-thumbnail'))
          this.showThumbnail[entry.target.getAttribute('data-thumbnail')] = true;
      });
    });

    this.mutationObserver = new MutationObserver((mutationList, _observer) => {
      mutationList.forEach(mr => {
        if (mr.type === 'childList') {
          mr.addedNodes.forEach(node => {
            const imageWrappers = (node as HTMLElement).querySelectorAll &&
              (node as HTMLElement).querySelectorAll('.poster-thumbnail-wrapper');

            if (imageWrappers)
              imageWrappers.forEach(iw => this.intersectionObserver.observe(iw));
          });

          mr.removedNodes.forEach(node => {
            const imageWrappers = (node as HTMLElement).querySelectorAll &&
              (node as HTMLElement).querySelectorAll('.poster-thumbnail-wrapper');

            if (imageWrappers)
              imageWrappers.forEach(iw => this.intersectionObserver.unobserve(iw));
          });
        }
      });
    });

    this.mutationObserver.observe(document.body, { childList: true, subtree: true });
  }

  onClick(item: LibraryItem): void {
    this.itemClicked.emit(item);
  }

  getPosterUrl(item: LibraryItem): string {
    if (item.aliasPosterPath)
      return `/api/img/poster?uri=${encodeForUri(item.aliasPosterPath)}&w=300&h=450`;
    else if (item.isAlias && !item.isLink)
      return '/assets/folder.svg';
    else
      return `/api/img/poster?id=${item.id}&cs=${checksum53(item.originalName || item.name)}&w=300&h=450`;
  }

  private refilter(): void {
    this.showThumbnail = {};
    document.querySelector('.poster-grid').scrollTop = 0;

    if (!this.searchText && this.filter === 'All') {
      this.items = this.library.array;
      return;
    }

    let matchFunction: (item: LibraryItem) => boolean;

    switch (this.filter) {
      case 'All':
        matchFunction = (_item: LibraryItem): boolean => true;
        break;
      case 'Movies':
        matchFunction = containsMovie;
        break;
      case 'TV':
        matchFunction = containsTV;
        break;
      case '4K':
        matchFunction = (item: LibraryItem): boolean => item.is4k;
        break;
      case '3D':
        matchFunction = (item: LibraryItem): boolean => item.is3d;
        break;
    }

    const isAMatch = (item: LibraryItem): boolean => this.matchesSearch(item) && matchFunction(item);

    this.items = clone(this.library.array).filter(item => isAMatch(item));

    const deepFilter = (items: LibraryItem[]): void => {
      for (let i = 0; i < items.length; ++i) {
        const item = items[i];

        if (item.type === VType.COLLECTION) {
          deepFilter(item.data);

          const innerCount = item.data.reduce((sum, child) => sum + (isAMatch(child) ? 1 : 0), 0);

          // If only one match within a collection, surface that one match and eliminate the collection
          if (innerCount === 1)
            items[i] = item.data.find(c => isAMatch(c));
          // If multiple matches within a collection, filter collection items that don't match.
          else if (innerCount < item.data.length)
            item.data = item.data.filter(c => isAMatch(c));
        }
      }
    };

    deepFilter(this.items);
    this.items.sort(librarySorter);

    const reassignParents = (items: LibraryItem[], newParent?: LibraryItem): void => {
      for (const item of items) {
        item.parent = newParent;
        reassignParents(item.data || [], item);
      }
    };

    reassignParents(this.items);

    // Purge duplicate results
    let lastID = -1;

    for (let i = this.items.length - 1; i >= 0; --i) {
      const item = this.items[i];

      if (item.id === lastID && lastID >= 0) {
        if (!this.matchesSearch(item, true))
          this.items.splice(i, 1);
        else {
          const other = this.items[i + 1];

          if (!other.isAlias && this.matchesSearch(other, true))
            this.items.splice(i, 1);
          else
            this.items.splice(i + 1, 1);
        }
      }

      lastID = item.id;
    }

    // Purge items included in a displayed collection
    const currentCollections = new Set(this.items.filter(i => i.type === VType.COLLECTION));

    for (let i = this.items.length - 1; i >= 0; --i) {
      const item = this.items[i];

      if (item.type !== VType.COLLECTION && currentCollections.has(item.parent))
        this.items.splice(i, 1);
    }
  }

  private findItemById(id: number, items = this.items): LibraryItem {
    for (const item of items) {
      if (item.id === id)
        return item;

      const match = this.findItemById(id, item.data || []);

      if (match)
        return match;
    }

    return null;
  }

  private matchesSearch(item: LibraryItem, simpleMatch = false): boolean {
    if (!this.searchText)
      return true;
    else if (!item.name || item.type === VType.TV_EPISODE || item.type === VType.FILE)
      return false;

    const text = stripDiacriticals_lc(this.searchText);

    if (stripDiacriticals_lc(item.name).includes(text))
      return true;
    else if (simpleMatch || item.isAlias)
      return false;
    else { // Does the name of an ancestor collection match?
      let testItem = this.findItemById(item.id)?.parent;

      while (testItem) {
        if (testItem.type === VType.COLLECTION && stripDiacriticals_lc(testItem.name).includes(text))
          return true;

        testItem = testItem.parent;
      }
    }

    for (const child of (item.data || [])) {
      if (this.matchesSearch(child))
        return true;
    }

    return false;
  }
}

import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { VideoLibrary, LibraryItem, VType } from '../../../server/src/shared-types';
import { checksum53, hashTitle } from '../video-ui-utils';
import { stripDiacriticals_lc } from '@tubular/util';

function isMovie(item: LibraryItem): boolean {
  return item.type === VType.MOVIE ||
    (item.type === VType.COLLECTION && item.data?.length > 0 && item.data[0].type === VType.MOVIE);
}

function isTV(item: LibraryItem): boolean {
  return item.type === VType.TV_SHOW || item.type === VType.TV_SEASON ||
      item.type === VType.TV_EPISODE || item.type === VType.TV_COLLECTION ||
      (item.type === VType.COLLECTION && item.data?.length > 0 && isTV(item.data[0]));
}

@Component({
  selector: 'app-poster-view',
  templateUrl: './poster-view.component.html',
  styleUrls: ['./poster-view.component.scss']
})
export class PosterViewComponent implements OnInit {
  readonly COLLECTION = VType.COLLECTION;
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
    return `/api/img/poster?id=${item.id}&cs=${checksum53(item.originalName || item.name)}&w=300&h=450`;
  }

  private refilter(): void {
    this.showThumbnail = {};

    document.querySelector('.poster-grid').scrollTop = 0;

    switch (this.filter) {
      case 'All':
        this.items = this.library.array.filter(item => this.matchesSearch(item));
        break;
      case 'Movies':
        this.items = this.library.array.filter(item => this.matchesSearch(item) && isMovie(item));
        break;
      case 'TV':
        this.items = this.library.array.filter(item => this.matchesSearch(item) && isTV(item));
        break;
      case '4K':
        this.items = this.library.array.filter(item => this.matchesSearch(item) && item.is4k);
        break;
      case '3D':
        this.items = this.library.array.filter(item => this.matchesSearch(item) && item.is3d);
        break;
    }
  }

  private matchesSearch(item: LibraryItem): boolean {
    if (!this.searchText)
      return true;
    else if (!item.name || item.type === VType.TV_EPISODE || item.type === VType.FILE)
      return false;

    const text = stripDiacriticals_lc(this.searchText);

    if (stripDiacriticals_lc(item.name).includes(text))
      return true;

    for (const child of (item.data || [])) {
      if (this.matchesSearch(child))
        return true;
    }

    return false;
  }
}

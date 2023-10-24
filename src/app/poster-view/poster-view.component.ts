import { Component, Input, OnInit } from '@angular/core';
import { Collection, CollectionItem, VType } from '../../../server/src/shared-types';
import { checksum53 } from '../video-ui-utils';
import { stripDiacriticals_lc } from '@tubular/util';

function isMovie(item: CollectionItem): boolean {
  return item.type === VType.MOVIE ||
    (item.type === VType.COLLECTION && item.data?.length > 0 && item.data[0].type === VType.MOVIE);
}

function isTV(item: CollectionItem): boolean {
  return item.type === VType.TV_SHOW || item.type === VType.TV_SEASON || item.type === VType.TV_EPISODE ||
      (item.type === VType.COLLECTION && item.data?.length > 0 && isTV(item.data[0]));
}

@Component({
  selector: 'app-poster-view',
  templateUrl: './poster-view.component.html',
  styleUrls: ['./poster-view.component.scss']
})
export class PosterViewComponent implements OnInit {
  COLLECTION = VType.COLLECTION;

  private _collection: Collection;
  private _filter = 'All';
  private _searchText = '';

  filterChoices = ['All', 'Movies', 'TV', '4K', '3D'];

  intersectionObserver: IntersectionObserver;
  items: CollectionItem[];
  mutationObserver: MutationObserver;
  overview = '';

  @Input() get collection(): Collection { return this._collection; }
  set collection(value : Collection) {
    if (this._collection !== value) {
      this._collection = value;
      this.items = value?.array;
    }
  }

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
        if (entry.isIntersecting && !entry.target.querySelector('img')) {
          const div = entry.target as HTMLDivElement;
          const id = div.getAttribute('data-id');
          const name = div.getAttribute('data-name');
          const img = document.createElement('img');

          img.src = `/api/poster?id=${id}&cs=${checksum53(name)}&w=300&h=450`;
          img.width = 150;
          img.height = 225;
          img.alt = name;
          div.appendChild(img);
        }
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

  private refilter(): void {
    switch (this.filter) {
      case 'All':
        this.items = this.collection.array.filter(item => this.matchesSearch(item));
        break;
      case 'Movies':
        this.items = this.collection.array.filter(item => this.matchesSearch(item) && isMovie(item));
        break;
      case 'TV':
        this.items = this.collection.array.filter(item => this.matchesSearch(item) && isTV(item));
        break;
      case '4K':
        this.items = this.collection.array.filter(item => this.matchesSearch(item) && item.is4k);
        break;
      case '3D':
        this.items = this.collection.array.filter(item => this.matchesSearch(item) && item.is3d);
        break;
    }
  }

  private matchesSearch(item: CollectionItem): boolean {
    if (!this.searchText)
      return true;
    else if (!item.name || item.type === VType.TV_EPISODE || item.type === VType.TV_SEASON || item.type === VType.FILE)
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

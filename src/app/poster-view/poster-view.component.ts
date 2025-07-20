import { Component, EventEmitter, Input, OnDestroy, OnInit, Output } from '@angular/core';
import { LibraryItem, VideoLibrary, WatchStatus } from '../../../server/src/shared-types';
import { ceil, floor, min, random } from '@tubular/math';
import { checksum53, clone, encodeForUri, getOrSet } from '@tubular/util';
import { faFolderOpen } from '@fortawesome/free-regular-svg-icons';
import { faShare } from '@fortawesome/free-solid-svg-icons';
import { filter, getWatchInfo, hashTitle, isCollection } from '../../../server/src/shared-utils';
import { webSocketMessagesEmitter } from '../video-ui-utils';
import { fromEvent } from 'rxjs/internal/observable/fromEvent';
import { debounceTime } from 'rxjs/internal/operators/debounceTime';
import { Subscription } from 'rxjs/internal/Subscription';
import { AuthService } from '../auth.service';
import { AppComponent } from '../app.component';
import { IconField } from 'primeng/iconfield';
import { InputIcon } from 'primeng/inputicon';
import { FormsModule } from '@angular/forms';
import { InputText } from 'primeng/inputtext';
import { TreeSelect } from 'primeng/treeselect';
import { Select } from 'primeng/select';
import { NgOptimizedImage } from '@angular/common';
import { Button } from 'primeng/button';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import { WatchedIndicatorComponent } from '../watched-indicator/watched-indicator.component';
import { RatingComponent } from '../rating/rating.component';

function titleAdjust(title: string): string {
  return title.replace(/\s+Season\s+\d/i, '');
}

const SORT_CHOICES = [
  { label: 'Alphabetical', code: 'A' },
  { label: 'Watching', code: 'W' },
  { label: 'Random', code: 'R' },
  { label: 'Recently Added', code: 'D' },
  { label: 'Zidoo Watching', code: 'Z' },
];

@Component({
  selector: 'app-poster-view',
  templateUrl: './poster-view.component.html',
  styleUrls: ['./poster-view.component.scss'],
  imports: [IconField, InputIcon, FormsModule, InputText, TreeSelect, Select, Button, NgOptimizedImage,
            FaIconComponent, WatchedIndicatorComponent, RatingComponent]
})
export class PosterViewComponent implements OnDestroy, OnInit {
  readonly faFolderOpen = faFolderOpen;
  readonly faShare = faShare;
  readonly floor = floor;
  readonly hashTitle = hashTitle;
  readonly isCollection = isCollection;
  readonly titleAdjust = titleAdjust;

  private _filterNode: any;
  private _genres: string[] = [];
  private genresLabel: HTMLElement;
  private _library: VideoLibrary;
  private randomCache = new Map<number, number>();
  private resizeDebounceSub: Subscription;
  private resizeSub: Subscription;
  private _sortMode = SORT_CHOICES[0];
  private watchedCache = new Map<number, WatchStatus>();
  private yearAgo = new Date(Date.now() - 31536000000).getTime();

  filterChoices = ['All', 'Movies', 'TV', '4K', '3D'];
  filterNodes: any[];
  letterGroups: string[] = [];
  items: LibraryItem[];
  overview = '';
  resizing = false;
  sortChoices = clone(SORT_CHOICES);

  constructor(private authService: AuthService) {
    this.updateFilterNodes();
    this._filterNode = this.filterNodes[0];
  }

  @Output() filterChanged: EventEmitter<string> = new EventEmitter();

  @Input() get library(): VideoLibrary { return this._library; }
  set library(value: VideoLibrary) {
    if (this._library !== value) {
      this._library = value;
      this.items = value?.array;
      this.refilter();
    }
  }

  @Input() get genres(): string[] { return this._genres; }
  set genres(value: string[]) {
    if (this._genres !== value) {
      this._genres = value;
      this.updateFilterNodes();
      this.refilter();
    }
  }

  @Output() itemClicked: EventEmitter<LibraryItem> = new EventEmitter();

  @Input() fullLibrary = false;

  get filterNode(): any { return this._filterNode; }
  set filterNode(value: any) {
    if (this._filterNode !== value) {
      const lastValue = this._filterNode;

      this._filterNode = value;
      this.filterChanged.emit(value.label);

      if (value.key === 'g')
        setTimeout(() => this.filterNode = lastValue);
      else {
        if (value.parent?.key === 'g') {
          this.filter = null;
          this.genre = value.label;
        }
        else {
          this.filter = value.label;
          this.genre = null;
        }

        this.refilter();
      }
    }
  }

  get sortMode(): any { return this._sortMode; }
  set sortMode(value: any) {
    if (this._sortMode !== value) {
      this._sortMode = value;
      this.randomCache.clear();
      this.watchedCache.clear();
      this.refilter();
    }
  }

  get filter(): string { return AppComponent.filter; }
  set filter(value: string) { AppComponent.filter = value; }

  get genre(): string { return AppComponent.genre; }
  set genre(value: string) { AppComponent.genre = value; }

  get searchText(): string { return AppComponent.searchText; }
  set searchText(value: string) {
    if (AppComponent.searchText !== value) {
      AppComponent.searchText = value;
      this.refilter();
    }
  }

  ngOnInit(): void {
    if (this.authService.isLoggedIn())
      this.updateSortChoices();

    webSocketMessagesEmitter().subscribe(msg => {
      switch (msg.type) {
        case 'session_start':
          this.updateSortChoices(true);
          break;

        case 'idUpdate':
          this.watchedCache.delete(msg.data);
          break;
      }
    });

    this.updateFilterNodes();

    const resizes = fromEvent(window, 'resize');

    this.resizeSub = resizes.subscribe(() => this.resizing = true);
    this.resizeDebounceSub = resizes.pipe(debounceTime(500)).subscribe(() => this.determineLetterNavGroups());
    this.determineLetterNavGroups();
  }

  ngOnDestroy(): void {
    if (this.resizeSub)
      this.resizeSub.unsubscribe();

    if (this.resizeSub)
      this.resizeDebounceSub.unsubscribe();
  }

  onClick(item: LibraryItem): void {
    this.itemClicked.emit(item);
  }

  randomize(): void {
    this.randomCache.clear();
    this.refilter();
  }

  getPosterUrl(item: LibraryItem): string {
    if (item.aliasPosterPath)
      return `/api/img/poster?uri=${encodeForUri(item.aliasPosterPath)}&w=300&h=450`;
    else if ((item.isAlias && !item.isLink) || item.id !== floor(item.id))
      return '/assets/folder.svg';
    else
      return `/api/img/poster?id=${item.id}&cs=${checksum53(item.originalName || item.name)}&w=300&h=450`;
  }

  jumpScroll(target: string): void {
    target = target.substring(0, 1);

    const grid: HTMLElement = document.querySelector('.poster-grid');

    if (target === '0') {
      grid.scrollTop = 0;
      return;
    }

    const elems = document.querySelectorAll('.poster-grid .library-item .title');

    for (const elem of Array.from(elems) as HTMLElement[]) {
      if (elem.innerText.replace(/^(A|An|The)\s+/, '').toUpperCase() >= target) {
        const rect = elem.parentElement.getBoundingClientRect();

        grid.scrollTop += rect.y - grid.getBoundingClientRect().y - 28;
        break;
      }
    }
  }

  private genresClick = (evt: MouseEvent): void => {
    evt.stopPropagation();

    const button = (evt.currentTarget as HTMLElement)?.parentElement.querySelector('button');

    if (button)
      button.click(); // Expand or collapse Genres instead of selecting Genres as a tree item.
  };

  filterShow(): void {
    const filterTree = document.getElementById('filter-tree');
    const nodes: HTMLElement[] = Array.from(filterTree?.querySelectorAll('.p-treenode-label > span') || []);

    this.genresLabel = nodes.find(n => n.innerText === 'Genres')?.parentElement;

    if (this.genresLabel) {
      this.genresLabel.addEventListener('click', this.genresClick, { capture: true });
    }
  }

  filterHide(): void {
    if (this.genresLabel)
      this.genresLabel.removeEventListener('click', this.genresClick);
  }

  private refilter(): void {
    const grid: HTMLElement = document.querySelector('.poster-grid');

    if (!grid)
      return;

    grid.style.scrollBehavior = 'auto';
    grid.scrollTop = 0;
    this.yearAgo = new Date(Date.now() - 31536000000).getTime();
    setTimeout(() => grid.style.scrollBehavior = 'smooth', 1000);

    let sort: (a: LibraryItem, b: LibraryItem, admin?: boolean) => number;
    let admin = false;

    switch (this.sortMode.code) {
      case 'D': sort = this.recentSorter; break;
      case 'R': sort = this.randomSorter; break;
      case 'W': sort = this.watchSorter; break;
      case 'Z': sort = this.watchSorter; admin = true; break;
    }

    this.items = filter(this.library?.array || [], this.searchText, this.filter, this.genre, sort, admin);
  }

  private determineLetterNavGroups(): void {
    const availableHeight = document.querySelector('.poster-grid').clientHeight - 14;

    for (let span = 1; span <= 4; ++span) {
      const count = ceil(26 / span) + 1;
      const neededHeight = count * 21;

      if (neededHeight <= availableHeight) {
        if (count !== this.letterGroups.length) {
          this.letterGroups = ['0'];

          for (let i = 0; i < count - 1; ++i) {
            const char = String.fromCharCode(65 + i * span);

            if (span === 1)
              this.letterGroups[i + 1] = char;
            else if (span === 2)
              this.letterGroups[i + 1] = char + String.fromCharCode(66 + i * span);
            else
              this.letterGroups[i + 1] = char + '-' + String.fromCharCode(min(64 + (i + 1) * span, 90));
          }
        }

        break;
      }
    }

    this.resizing = false;
  }

  private updateFilterNodes(): void {
    const genres = this.genres.map(g => ({ label: g }));

    this.filterNodes = this.filterChoices.map(fc => ({ label: fc }));
    this.filterNodes.push(({ key: 'g', label: 'Genres', children : genres }));
  }

  private updateSortChoices(refilter = false): void {
    this.sortChoices = SORT_CHOICES.filter(sc => this.authService.isAdmin() || sc.code !== 'Z');
    this.sortMode = this.sortChoices[0];

    if (refilter)
      this.refilter();
  }

  private getWatchStatus(item: LibraryItem, admin: boolean): WatchStatus {
    return getOrSet(this.watchedCache, item.id, () => {
      const info = getWatchInfo(admin, item);

      if (info.mixed || (info.position > 0 && info.position < info.duration))
        return WatchStatus.WATCHING;
      else if (info.watched)
        return WatchStatus.WATCHED;
      else
        return WatchStatus.UNWATCHED;
    });
  }

  private recentSorter = (a: LibraryItem, b: LibraryItem, admin = false): number => {
    const bt = Math.max(getWatchInfo(admin, b).addedTime, this.yearAgo);
    const at = Math.max(getWatchInfo(admin, a).addedTime, this.yearAgo);

    return bt - at;
  };

  private watchSorter = (a: LibraryItem, b: LibraryItem, admin = false): number => {
    return this.getWatchStatus(a, admin) - this.getWatchStatus(b, admin);
  };

  private randomSorter = (a: LibraryItem, b: LibraryItem): number => {
    const sa = getOrSet(this.randomCache, a.id, () => random());
    const sb = getOrSet(this.randomCache, b.id, () => random());

    return sa - sb;
  };
}

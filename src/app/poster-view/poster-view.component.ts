import { Component, EventEmitter, Input, OnDestroy, OnInit, Output } from '@angular/core';
import { LibraryItem, VideoLibrary, WatchStatus } from '../../../server/src/shared-types';
import { ceil, floor, min, random } from '@tubular/math';
import { checksum53, clone, encodeForUri, getOrSet } from '@tubular/util';
import { faFolderOpen } from '@fortawesome/free-regular-svg-icons';
import { faShare } from '@fortawesome/free-solid-svg-icons';
import { getWatchInfo, hashTitle, isCollection, isFile, isMovie, isTvCollection, isTvEpisode, isTvSeason, isTvShow, librarySorter } from '../../../server/src/shared-utils';
import { searchForm, webSocketMessagesEmitter } from '../video-ui-utils';
import { fromEvent } from 'rxjs/internal/observable/fromEvent';
import { debounceTime } from 'rxjs/internal/operators/debounceTime';
import { Subscription } from 'rxjs/internal/Subscription';
import { AuthService } from '../auth.service';

function isAMovie(item: LibraryItem): boolean {
  return item.isTvMovie || isMovie(item) ||
    (isCollection(item) && item.data?.length > 0 && !!item.data.find(i => isAMovie(i)));
}

function containsMovie(item: LibraryItem): boolean {
  if (isAMovie(item))
    return true;
  else if (isTvCollection(item))
    return false;

  for (const child of (item.data || [])) {
    if (containsMovie(child))
      return true;
  }

  return false;
}

function isTV(item: LibraryItem): boolean {
  return item.isTV || item.isTvMovie || isTvShow(item) || isTvSeason(item) ||
      isTvEpisode(item) || isTvCollection(item) ||
      (isCollection(item) && item.data?.length > 0 && !!item.data.find(i => isTV(i)));
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

function titleAdjust(title: string): string {
  return title.replace(/\s+Season\s+\d/i, '');
}

function matchesGenre(item: LibraryItem, genre: string): boolean {
  if (item.genres?.find(g => g === genre))
    return true;
  else if (!item.data)
    return false;

  for (const child of item.data) {
    if (matchesGenre(child, genre))
      return true;
  }

  return false;
}

const SORT_CHOICES = [
  { label: 'Alphabetical', code: 'A' },
  { label: 'Watching', code: 'W' },
  { label: 'Random', code: 'R' },
  { label: 'Zidoo Watching', code: 'Z' },
];

@Component({
  selector: 'app-poster-view',
  templateUrl: './poster-view.component.html',
  styleUrls: ['./poster-view.component.scss']
})
export class PosterViewComponent implements OnDestroy, OnInit {
  readonly faFolderOpen = faFolderOpen;
  readonly faShare = faShare;
  readonly floor = floor;
  readonly hashTitle = hashTitle;
  readonly isCollection = isCollection;
  readonly titleAdjust = titleAdjust;

  private filter = 'All';
  private _filterNode: any;
  private genre: string;
  private _genres: string[] = [];
  private _library: VideoLibrary;
  private loadingTimers = new Map<Element, any>();
  private randomCache = new Map<number, number>();
  private resizeDebounceSub: Subscription;
  private resizeSub: Subscription;
  private _searchText = '';
  private _sortMode = SORT_CHOICES[0];
  private watchedCache = new Map<number, WatchStatus>();

  filterChoices = ['All', 'Movies', 'TV', '4K', '3D'];
  filterNodes: any[];
  letterGroups: string[] = [];
  items: LibraryItem[];
  intersectionObserver: IntersectionObserver;
  mutationObserver: MutationObserver;
  overview = '';
  resizing = false;
  showThumbnail: Record<string, boolean> = {};
  sortChoices = clone(SORT_CHOICES);

  constructor(private authService: AuthService) {
    this.updateFilterNodes();
    this._filterNode = this.filterNodes[0];
  }

  @Input() get library(): VideoLibrary { return this._library; }
  set library(value : VideoLibrary) {
    if (this._library !== value) {
      this._library = value;
      this.items = value?.array;
      this.showThumbnail = {};
      this.refilter();
    }
  }

  @Input() get genres(): string[] { return this._genres; }
  set genres(value : string[]) {
    if (this._genres !== value) {
      this._genres = value;
      this.updateFilterNodes();
      this.refilter();
    }
  }

  @Output() itemClicked: EventEmitter<LibraryItem> = new EventEmitter();

  get filterNode(): any { return this._filterNode; }
  set filterNode(value: any) {
    if (this._filterNode !== value) {
      const lastValue = this._filterNode;

      this._filterNode = value;

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
    if (this.authService.isLoggedIn())
      this.updateSortChoices();

    webSocketMessagesEmitter().subscribe(msg => {
      switch (msg.type) {
        case 'session_start':
          this.updateSortChoices(true);
      }
    });

    this.updateFilterNodes();

    this.intersectionObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        const target = entry.target;
        const thumbnail = target.getAttribute('data-thumbnail');

        if (this.showThumbnail[thumbnail])
          return;

        const timer = this.loadingTimers.get(target);

        if (entry.isIntersecting && thumbnail && !timer) {
          const loadingTimer = setTimeout(() => {
            this.showThumbnail[thumbnail] = true;
            this.loadingTimers.delete(target);
          }, 100);
          this.loadingTimers.set(target, loadingTimer);
        }
        else if (!entry.isIntersecting && timer) {
          clearTimeout(timer);
          this.loadingTimers.delete(target);
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

    const grid = document.querySelector('.poster-grid') as HTMLElement;

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

  private refilter(): void {
    const grid = document.querySelector('.poster-grid') as HTMLElement;

    this.showThumbnail = {};
    grid.style.scrollBehavior = 'auto';
    grid.scrollTop = 0;
    setTimeout(() => grid.style.scrollBehavior = 'smooth', 1000);

    if (!this.searchText && this.filter === 'All' && this.sortMode.code === 'A') {
      this.items = this.library?.array || [];
      return;
    }

    let matchFunction: (item: LibraryItem) => boolean;
    let filterSeasons = false;

    switch (this.filter) {
      case 'All':
        matchFunction = (_item: LibraryItem): boolean => true;
        filterSeasons = true;
        break;
      case 'Movies':
        matchFunction = containsMovie;
        filterSeasons = true;
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

      default:
        matchFunction = (item: LibraryItem): boolean => matchesGenre(item, this.genre);
    }

    const isAMatch = (item: LibraryItem): boolean => this.matchesSearch(item) && matchFunction(item);

    this.items = clone(this.library.array).filter(item => isAMatch(item));

    const deepFilter = (items: LibraryItem[], matcher = isAMatch): void => {
      for (let i = 0; i < items.length; ++i) {
        let item = items[i];

        if (isCollection(item) || (isTvShow(item) && filterSeasons)) {
          const saveMatcher = matcher;

          if (this.matchesSearch(item, true))
            matcher = matchFunction;
          else if (item.isAlias) {
            const orig = (item.parent ? (item.parent.data || []) : this.items).find(i => !i.isAlias && i.id === item.id);

            if (orig && this.matchesSearch(orig, true))
              matcher = matchFunction;
          }

          deepFilter(item.data, matcher);

          const innerCount = item.data.reduce((sum, child) => sum + (matcher(child) ? 1 : 0), 0);

          // If only one match within a collection, surface that one match and eliminate the collection
          if (innerCount === 1) {
            items[i] = item = item.data.find(c => matcher(c));

            if (isTvSeason(item) && !this.matchesSearch(item, true))
              item.name = item.parent.name + ' • ' + item.name;
          }
          // If multiple but partial matches within a collection, filter collection items that don't match.
          else if (innerCount < item.data.length)
            item.data = item.data.filter(c => matcher(c));

          matcher = saveMatcher;
        }
      }
    };

    deepFilter(this.items);
    this.items.sort((a, b) => {
      let diff = 0;

      switch (this.sortMode.code) {
        case 'R': diff = this.randomSorter(a, b); break;
        case 'W': diff = this.watchSorter(a, b); break;
        case 'Z': diff = this.watchSorter(a, b, true); break;
      }

      if (diff !== 0)
        return diff;

      return librarySorter(a, b);
    });

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
    const currentCollections = new Set(this.items.filter(i => isCollection(i)).map(i => i.id));

    for (let i = this.items.length - 1; i >= 0; --i) {
      let item = this.items[i];

      if (isCollection(item)) {
        if (item.isAlias)
          item = this.findItemById(item.id);

        if (item && item.parent && currentCollections.has(item.parent.id))
          this.items.splice(i, 1);
      }
    }
  }

  private findItemById(id: number, items = this.items): LibraryItem {
    for (const item of items) {
      if (item.isAlias && !item.parent)
        continue;
      else if (item.id === id)
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
    else if ((!item.name && !item.title) || isTvEpisode(item) || isFile(item))
      return false;

    const text = searchForm(this.searchText);
    const itemText = (item.name && item.title ? item.name + '_' + item.title : item.name || item.title || '');

    if (searchForm(itemText).includes(text))
      return true;
    else if (simpleMatch || item.isAlias)
      return false;
    else { // Does the name of an ancestor collection match?
      let testItem = item.parent && this.findItemById(item.id)?.parent;

      while (testItem) {
        const itemText = (testItem.name && testItem.title ? testItem.name + ';' + testItem.title : testItem.name || testItem.title || '');

        if (isCollection(testItem) && searchForm(itemText).includes(text))
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

  private determineLetterNavGroups(): void {
    const availableHeight = (document.querySelector('.poster-grid') as HTMLElement).clientHeight - 14;

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

      if (info.mixed)
        return WatchStatus.WATCHING;
      else if (info.watched)
        return WatchStatus.WATCHED;
      else
        return WatchStatus.UNWATCHED;
    });
  }

  private watchSorter = (a: LibraryItem, b: LibraryItem, admin = false): number => {
    return this.getWatchStatus(a, admin) - this.getWatchStatus(b, admin);
  };

  private randomSorter = (a: LibraryItem, b: LibraryItem): number => {
    const sa = getOrSet(this.randomCache, a.id, () => random());
    const sb = getOrSet(this.randomCache, b.id, () => random());

    return sa - sb;
  };
}

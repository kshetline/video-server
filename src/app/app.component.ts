import { AfterViewInit, Component, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { VideoLibrary, LibraryItem, ServerStatus, VType } from '../../server/src/shared-types';
import { checksum53, addBackLinks, getZIndex, incrementImageIndex } from './video-ui-utils';
import { isEqual } from '@tubular/util';
import { floor } from '@tubular/math';
import { AuthService } from './auth.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent implements AfterViewInit, OnInit {
  private canPoll = false;
  private gettingLibrary = false;

  bonusSource: LibraryItem;
  currentCollection: LibraryItem;
  currentShow: LibraryItem;
  library: VideoLibrary;
  status: ServerStatus;

  constructor(private httpClient: HttpClient, private auth: AuthService) {}

  ngOnInit(): void {
    fetch('/assets/tiny_clear.png').finally();

    window.addEventListener('click', evt => {
      if (evt.altKey) {
        evt.preventDefault();
        evt.stopImmediatePropagation();

        let topZRange: number = undefined;
        const elems = document.elementsFromPoint(evt.clientX, evt.clientY);
        const updates: { elem: Element, type: string, file: string, saveImg?: string }[] = [];

        for (const elem of elems) {
          const zRange = floor(getZIndex(elem) / 100);

          if (topZRange == null)
            topZRange = zRange;
          else if (zRange < topZRange)
            break;

          let src: string;

          if (elem.localName === 'img')
            src = (elem as HTMLImageElement).src;
          else if ((elem as HTMLElement).style?.backgroundImage)
            src = (elem as HTMLElement).style.backgroundImage;

          let $ = src && /\b(poster|backdrop)\?id=(\d+)(?:&id2=(\d+))?&cs=([0-9A-F]+)\b/.exec(src);
          let file: string;

          if ($)
            file = `${$[2]}${$[3] ? '-' + $[3] : ''}-${$[4]}.jpg`;
          else if (src) {
            $ = /\b(logo)\?url=(.+)(\.\w+)/.exec(src);

            if ($)
              file = checksum53(decodeURIComponent($[2] + $[3])) + $[3];
          }

          if ($)
            updates.push({ elem, type: $[1], file });
        }

        updates.forEach(update => {
          if (update.elem.localName === 'img') {
            update.saveImg = (update.elem as HTMLImageElement).src;
            (update.elem as HTMLImageElement).src = '/assets/tiny_clear.png';
          }
          else {
            update.saveImg = (update.elem as HTMLElement).style.backgroundImage;
            (update.elem as HTMLElement).style.backgroundImage = 'url("/assets/tiny_clear.png")';
          }

          this.httpClient.post('/api/img/refresh', null, {
            params: {
              type: update.type,
              file: update.file
            }
          }).subscribe({
            complete: () => {
              const fetchImg = update.saveImg.replace(/^url\(['"]/, '').replace(/['"]\)/, '').replace(/&ii=\d+/, '') +
                  `&ii=${(incrementImageIndex())}`;

              fetch(fetchImg, { cache: 'reload' }).finally(() => {
                setTimeout(() => {
                  if (update.elem.localName === 'img')
                    (update.elem as HTMLImageElement).src = fetchImg;
                  else
                    (update.elem as HTMLElement).style.backgroundImage = `url("${fetchImg}")`;
                }, 500);
              });
            }
          });
        });
      }
    }, true);

    if (navigator.serviceWorker) {
      navigator.serviceWorker.register('/assets/service.js').then(reg =>
        console.log('Service worker registration succeeded:', reg))
        .catch(err => {
          console.error('Service worker registration failed:', err);
          this.pollStatus();
        });
    }
    else
      console.warn('Service worker not available');
  }

  ngAfterViewInit(): void {
    if (this.auth.isLoggedIn())
      this.pollLibrary();

    this.httpClient.get('/api/status').subscribe({
      next: (status: ServerStatus) => this.status = status,
      complete: () => this.canPoll = true
    });

    this.auth.loginStatus.subscribe(state => {
      if (state)
        this.pollLibrary();
    });
  }

  itemClicked(item: LibraryItem): void {
    if (item?.type === VType.COLLECTION || item?.type === VType.TV_SHOW || item?.type === VType.TV_COLLECTION)
      this.currentCollection = item;
    else if (item?.type === VType.MOVIE || item?.type === VType.TV_SEASON)
      this.currentShow = item;
  }

  private pollLibrary(): void {
    if (this.gettingLibrary)
      return;

    this.gettingLibrary = true;
    this.httpClient.get('/api/library').subscribe({
      next: (library: VideoLibrary) => {
        if (!isEqual(this.library, library, { keysToIgnore: ['lastUpdate', 'parent'] })) {
          addBackLinks(library.array);
          this.library = library;
        }
        else
          this.library.lastUpdate = library.lastUpdate;
      },
      complete: () => this.gettingLibrary = false
    });
  }

  isLoggedIn(): boolean {
    return this.auth.isLoggedIn();
  }

  isLoggedOut(): boolean {
    return this.auth.isLoggedOut();
  }

  logOut(): void {
    this.auth.logout();
  }

  private pollStatus = (): void => {
    if (!this.canPoll)
      setTimeout(() => this.pollStatus(), 100);
    else {
      this.httpClient.get('/api/status').subscribe({
        next: (status: ServerStatus) => {
          const finished = status.ready && (!this.status || !this.status.ready);
          this.status = status;

          if (finished ||
              (this.library && status.lastUpdate && new Date(this.library.lastUpdate) < new Date(status.lastUpdate)))
            this.pollLibrary();

          setTimeout(() => this.pollStatus(), this.status.updateProgress < 0 ? 60000 : 1000);
        },
        error: () => setTimeout(() => this.pollStatus(), 100)
      });
    }
  };
}

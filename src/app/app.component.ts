import { AfterViewInit, Component, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { LibraryItem, ServerStatus, VideoLibrary } from '../../server/src/shared-types';
import { addBackLinks, getZIndex, incrementImageIndex } from './video-ui-utils';
import { isEqual } from '@tubular/util';
import { floor } from '@tubular/math';
import { AuthService } from './auth.service';
import { ConfirmationService } from 'primeng/api';
import { checksum53, isAnyCollection, isMovie, isTvSeason, isTvShow } from '../../server/src/shared-utils';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
  providers: [ConfirmationService]
})
export class AppComponent implements AfterViewInit, OnInit {
  private canPoll = false;
  private gettingLibrary = false;

  bonusSource: LibraryItem;
  currentCollection: LibraryItem;
  currentShow: LibraryItem;
  library: VideoLibrary;
  playing = false;
  showRefreshDialog = false;
  status: ServerStatus;

  constructor(
    private httpClient: HttpClient,
    private auth: AuthService,
    private confirmationService: ConfirmationService
  ) {}

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

    if (navigator.serviceWorker && Date.now() < 0) { // TODO: Enable push events
      navigator.serviceWorker.register('/assets/service.js').then(reg =>
        console.log('Service worker registration succeeded:', reg))
        .catch(err => {
          console.error('Service worker registration failed:', err);
          this.pollStatus();
        });
    }
    else {
      console.warn('Service worker not available');
      this.pollStatus();
    }
  }

  ngAfterViewInit(): void {
    if (this.auth.isLoggedIn())
      this.pollLibrary();

    this.httpClient.get<ServerStatus>('/api/status').subscribe({
      next: status => this.status = status,
      complete: () => this.canPoll = true
    });

    this.auth.loginStatus.subscribe(state => {
      if (state)
        this.pollLibrary();
    });
  }

  itemClicked(item: LibraryItem): void {
    if (isAnyCollection(item) || isTvShow(item))
      this.currentCollection = item;
    else if (isMovie(item) || isTvSeason(item))
      this.currentShow = item;
  }

  private pollLibrary(): void {
    if (this.gettingLibrary)
      return;

    this.gettingLibrary = true;
    this.httpClient.get<VideoLibrary>('/api/library').subscribe({
      next: library => {
        this.gettingLibrary = false;

        if (!isEqual(this.library, library, { keysToIgnore: ['lastUpdate', 'parent'] })) {
          addBackLinks(library.array);
          this.library = library;
        }
        else
          this.library.lastUpdate = library.lastUpdate;
      },
      error: () => { this.gettingLibrary = false; setTimeout(() => this.pollLibrary(), 2000); }
    });
  }

  isLoggedIn(): boolean {
    return this.auth.isLoggedIn();
  }

  isLoggedOut(): boolean {
    return this.auth.isLoggedOut();
  }

  goHome(): void {
    this.bonusSource = this.currentCollection = this.currentShow = undefined;
  }

  logOut(): void {
    this.confirmationService.confirm({
      message: 'Are you sure you want to log out?',
      header: 'Log out',
      icon: 'pi pi-exclamation-triangle',
      accept: () => {
        this.goHome();
        this.auth.logout();
      }
    });
  }

  isAdmin(): boolean {
    return this.auth.getSession()?.role === 'admin';
  }

  userName(): string {
    return this.auth.getSession()?.name;
  }

  refresh(quick = false): void {
    this.showRefreshDialog = false;
    this.httpClient.post(`/api/library-refresh${quick ? '?quick=true' : ''}`, null).subscribe(() => {
      setTimeout(() => this.pollStatus(), 500);
    });
  }

  posterWallHidden(): boolean {
    return !!(this.bonusSource || this.currentCollection || this.currentShow);
  }

  private pollStatus = (): void => {
    if (!this.canPoll)
      setTimeout(() => this.pollStatus(), 250);
    else {
      this.httpClient.get<ServerStatus>('/api/status').subscribe({
        next: status => {
          const finished = status.ready && (!this.status || !this.status.ready);
          this.status = status;

          if (finished ||
              (this.library && status.lastUpdate && new Date(this.library.lastUpdate) < new Date(status.lastUpdate)))
            this.pollLibrary();

          setTimeout(() => this.pollStatus(), this.status.updateProgress < 0 ? 60000 : 2000);
        },
        error: () => setTimeout(() => this.pollStatus(), 1000)
      });
    }
  };
}

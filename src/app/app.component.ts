import { AfterViewInit, Component, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { LibraryItem, ServerStatus, VideoLibrary } from '../../server/src/shared-types';
import { addBackLinks, broadcastMessage, getZIndex, incrementImageIndex } from './video-ui-utils';
import { isEqual, isValidJson, processMillis } from '@tubular/util';
import { floor } from '@tubular/math';
import { AuthService } from './auth.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { checksum53, isAnyCollection, isMovie, isTvSeason, isTvShow } from '../../server/src/shared-utils';
import { StatusInterceptor } from './status.service';
import { Observable } from 'rxjs';
import { shareReplay } from 'rxjs/internal/operators/shareReplay';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
  providers: [ConfirmationService, MessageService, StatusInterceptor]
})
export class AppComponent implements AfterViewInit, OnInit {
  private getSparseLibrary = true;
  private gettingLibrary = false;
  private readyToPoll = false;
  private reestablishing = false;
  private webSocket: WebSocket;

  bonusSource: LibraryItem;
  clickDelayed = false;
  clickTimer: any;
  currentCollection: LibraryItem;
  currentShow: LibraryItem;
  library: VideoLibrary;
  logoffTime = 0;
  playing = false;
  showAdminPage = false;
  socketOpen = false;
  status: ServerStatus;
  wsReady = false;

  constructor(
    private httpClient: HttpClient,
    private auth: AuthService,
    private confirmationService: ConfirmationService,
    private messageService: MessageService
  ) {
    StatusInterceptor.getHttpStatusUpdates(status => {
      if ([401, 403, 440].indexOf(status) >= 0) {
        this.messageService.clear();
        auth.logout();
      }

      switch (status) {
        case 440:
          this.messageService.add({
            severity: 'warn', summary: 'Session Expired',
            detail: 'Your login session has expired.', sticky: true
          });
          break;
        case 403:
          this.messageService.add({
            severity: 'error', summary: 'Forbidden',
            detail: 'Access forbidden.', sticky: true
          });
          break;
        case 401:
          this.messageService.add({
            severity: 'error', summary: 'Unauthorized',
            detail: 'Unauthorized access.', sticky: true
          });
          break;
      }
    });
  }

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
  }

  ngAfterViewInit(): void {
    if (this.auth.isLoggedIn())
      this.pollLibrary();

    this.getStatusObservable().subscribe({
      next: status => {
        this.status = status;

        if (this.status.wsPort)
          this.connectToWebSocket();
        else {
          console.warn('Web socket not available');
          this.pollStatus();
        }
      },
      complete: () => this.readyToPoll = true
    });

    this.auth.loginStatus.subscribe(state => {
      if (state)
        this.pollLibrary();
      else
        this.logoffTime = processMillis();
    });
  }

  itemClicked(item: LibraryItem): void {
    const setItem = (newItem: LibraryItem): void => {
      if (isAnyCollection(newItem) || isTvShow(newItem))
        this.currentCollection = newItem;
      else if (isMovie(newItem) || isTvSeason(newItem))
        this.currentShow = newItem;
    };

    if (item.parentId == null) {
      this.clickTimer = setTimeout(() => {
        this.clickDelayed = true;
        this.clickTimer = undefined;
      }, 500);

      this.httpClient.get<LibraryItem>('/api/library?id=' + item.id).subscribe(fullItem => {
        this.clickDelayed = false;

        if (this.clickTimer) {
          clearTimeout(this.clickTimer);
          this.clickTimer = undefined;
        }

        const index = fullItem ? this.library.array.findIndex(i => i.id === item.id) : -1;

        if (index >= 0) {
          this.library.array[index] = fullItem;
          addBackLinks(fullItem.data, fullItem);
          setItem(fullItem);
        }
        else
          console.error('Did not find id', item.id);
      });
    }
    else
      setItem(item);
  }

  private pollLibrary(): void {
    if (this.gettingLibrary)
      return;

    this.gettingLibrary = true;
    this.httpClient.get<VideoLibrary>('/api/library' + (this.getSparseLibrary ? '?sparse=true' : '')).subscribe({
      next: library => {
        this.gettingLibrary = false;

        if (this.getSparseLibrary) {
          this.getSparseLibrary = false;
          setTimeout(() => this.pollLibrary());
        }

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
    this.showAdminPage = false;
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
    return this.auth.isAdmin();
  }

  userName(): string {
    return this.auth.getSession()?.name;
  }

  posterWallHidden(): boolean {
    return !!(this.bonusSource || this.currentCollection || this.currentShow || this.showAdminPage);
  }

  clearStatusMessage(): void {
    if (processMillis() > this.logoffTime + 500)
      this.messageService.clear();
  }

  resetLogoffTime(): void {
    this.logoffTime = processMillis();
  }

  private receiveStatus(status: ServerStatus): void {
    const finished = status.ready && (!this.status || !this.status.ready);

    status.localAccess = status.localAccess ?? this.status.localAccess;
    this.status = status;

    if (finished ||
        (this.library && status.lastUpdate && new Date(this.library.lastUpdate) < new Date(status.lastUpdate)))
      this.pollLibrary();
  }

  private pollStatus = (): void => {
    if (this.wsReady) {}
    else if (!this.readyToPoll)
      setTimeout(() => this.pollStatus(), 500);
    else {
      this.getStatusObservable().subscribe({
        next: status => {
          this.receiveStatus(status);
          setTimeout(() => this.pollStatus(), this.status.updateProgress < 0 ? 60000 : 2000);
        },
        error: () => setTimeout(() => this.pollStatus(), 1000)
      });
    }
  };

  private connectToWebSocket(): void {
    console.info('connectToWebSocket()');
    const protocol = (/https/.test(location.protocol) ? 'wss' : 'ws');
    const port = this.status.wsPort < 0 ? location.port : this.status.wsPort;
    let socketEverOpen = false;

    this.webSocket = new WebSocket(`${protocol}://${location.hostname}:${port}`);
    this.webSocket.addEventListener('open', () => {
      socketEverOpen = true;
      this.socketOpen = true;
      this.wsReady = true;

      if (this.reestablishing) {
        this.reestablishing = false;
        this.getStatusObservable().subscribe(status => this.status = status);
      }
    });
    this.webSocket.addEventListener('close', () => {
      console.warn('Web socket closed');
      if (this.socketOpen) {
        this.socketOpen = false;
        this.reestablishing = true;
        setTimeout(() => this.connectToWebSocket(), 500);
      }
    });
    this.webSocket.addEventListener('error', () => {
      if (socketEverOpen) {
        this.socketOpen = false;
        this.reestablishing = true;
        setTimeout(() => this.connectToWebSocket(), 500);
      }
      else {
        this.socketOpen = false;
        console.warn('Web socket connection failed');
        this.webSocket = undefined;
        this.wsReady = false;
        this.pollStatus();
      }
    });
    this.webSocket.addEventListener('message', evt => {
      const message = isValidJson(evt.data) ? JSON.parse(evt.data) : evt.data;

      if (message?.type === 'status')
        this.receiveStatus(message.data);

      if (message?.type)
        broadcastMessage(message.type, isValidJson(message.data) ? JSON.parse(message.data) : message.data);
    });
  }

  private getStatusObservable(): Observable<ServerStatus> {
    return this.httpClient.get<ServerStatus>('/api/status').pipe(shareReplay());
  }
}

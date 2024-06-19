import { AfterViewInit, Component, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { LibraryItem, ServerStatus, VideoLibrary, VideoStats } from '../../server/src/shared-types';
import { broadcastMessage, getZIndex, incrementImageIndex, webSocketMessagesEmitter } from './video-ui-utils';
import { isEqual, isValidJson, processMillis } from '@tubular/util';
import { floor } from '@tubular/math';
import { AuthService } from './auth.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import {
  addBackLinks, checksum53, findAliases as _findAliases, isAnyCollection, isMovie, isTvSeason, isTvShow,
  itemPath, syncValues, ts
} from '../../server/src/shared-utils';
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
  private socketEverOpen = false;
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
    This = this;

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

    webSocketMessagesEmitter().subscribe(msg => {
      switch (msg.type) {
        case 'idUpdate':
          this.updateItem(msg.data, false);
          break;
      }
    });

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

  private setItem(newItem: LibraryItem): void {
    if (isAnyCollection(newItem) || isTvShow(newItem))
      this.currentCollection = newItem;
    else if (isMovie(newItem) || isTvSeason(newItem))
      this.currentShow = newItem;
  }

  itemClicked(item: LibraryItem): void {
    if (item.parentId == null) {
      this.clickTimer = setTimeout(() => {
        this.clickDelayed = true;
        this.clickTimer = undefined;
      }, 500);

      this.updateItem(item.id);
    }
    else
      this.setItem(item);
  }

  updateItem(id: number, setCurrent = true): void {
    this.httpClient.get<LibraryItem>('/api/library?id=' + id).subscribe(source => {
      this.clickDelayed = false;

      if (this.clickTimer) {
        clearTimeout(this.clickTimer);
        this.clickTimer = undefined;
      }

      if (!source)
        return;

      const target = this.findId(id);

      if (target) {
        if (target.parent) {
          const index = target.parent.data?.findIndex(i => i.id === id);

          if (index >= 0) {
            target.parent.data[index] = source;
            source.parent = target.parent;
          }
        }
        else {
          const index = this.library.array.findIndex(i => i.id === id);

          if (index >= 0)
            this.library.array[index] = source;
        }

        setTimeout(() => broadcastMessage('idUpdate2', itemPath(target)));
        addBackLinks(source.data, source);

        const aliases = this.findAliases(id);

        aliases.forEach(a => {
          if (a !== source) {
            syncValues(source, a);
            setTimeout(() => broadcastMessage('idUpdate2', itemPath(a)));
          }
        });

        if (setCurrent)
          this.setItem(source);

        if (this.currentShow?.id) {
          const match = this.findId(this.currentShow.id);

          if (match)
            this.currentShow = match;
        }

        if (this.currentCollection?.id) {
          const match = this.findId(this.currentCollection.id);

          if (match)
            this.currentCollection = match;
        }
      }
      else
        console.error('Did not find id', id);
    });
  }

  updatedItem(item: LibraryItem): LibraryItem {
    const path = itemPath(item);
    let newItem: LibraryItem;
    let array = this.library?.array;

    while (array && path.length > 0) {
      const id = path.splice(0, 1)[0];

      newItem = array.find(a => a.id === id);

      if (!newItem)
        break;

      array = newItem.data;
    }

    return newItem;
  }

  findId(id: number, item?: LibraryItem, canBeAlias?: boolean): LibraryItem {
    if (!item)
      item = { data: this.library.array } as LibraryItem;

    if (item.id === id && (canBeAlias || !item.isAlias))
      return item;
    else if (item.data) {
      for (const child of item.data) {
        const match = this.findId(id, child, !!canBeAlias);

        if (match)
          return match;
      }
    }

    if (canBeAlias == null)
      return this.findId(id, null, true);

    return null;
  }

  findAliases(id: number): LibraryItem[] {
    return _findAliases(id, this.library);
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

  clickAdminPage(): void {
    this.showAdminPage = true;
    this.getStatusObservable();
  }

  private receiveStatus(status: ServerStatus, broadcast = false): void {
    const finished = status.ready && (!this.status || !this.status.ready);

    status.localAccess = status.localAccess ?? this.status.localAccess;
    this.status = status;

    if (broadcast)
      broadcastMessage('status', status);

    if (this.wsReady && (finished ||
        (this.library && status.lastUpdate && new Date(this.library.lastUpdate) < new Date(status.lastUpdate))))
      this.pollLibrary();
  }

  private pollStatus = (): void => {
    if (this.wsReady) {}
    else if (!this.readyToPoll)
      setTimeout(() => this.pollStatus(), 500);
    else {
      this.getStatusObservable().subscribe({
        next: status => {
          this.receiveStatus(status, true);
          setTimeout(() => this.pollStatus(), this.status.updateProgress < 0 ? 60000 : 2000);
        },
        error: () => setTimeout(() => this.pollStatus(), 1000)
      });
    }
  };

  private connectToWebSocket(): void {
    console.info(ts(), 'Connect to web socket');
    const protocol = (/https/.test(location.protocol) ? 'wss' : 'ws');
    const port = this.status.wsPort < 0 ? location.port : this.status.wsPort;

    this.webSocket = new WebSocket(`${protocol}://${location.hostname}:${port}`);
    this.webSocket.addEventListener('open', () => {
      console.info(ts(), 'Web socket opened');
      this.socketOpen = true;
      this.wsReady = true;

      if (!this.socketEverOpen) {
        let lastTick = Date.now();
        let sleepDetected = false;

        this.socketEverOpen = true;
        setInterval(() => {
          const currTick = Date.now();
          const gap = currTick - lastTick;

          if (!sleepDetected && gap > 2000) {
            sleepDetected = true;
            console.info(ts(), 'Sleep detected');
          }
          else if (sleepDetected && gap < 1500) {
            sleepDetected = false;
            console.info(ts(), 'Sleep ended');

            if (this.socketOpen)
              this.webSocket.close();
            else {
              this.reestablishing = true;
              this.connectToWebSocket();
            }
          }

          lastTick = currTick;
        }, 1000);
      }

      if (this.reestablishing) {
        this.reestablishing = false;
        this.getStatusObservable();
        this.httpClient.get('/api/admin/stats').subscribe((stats: VideoStats) => broadcastMessage('videoStats', stats));
      }
    });
    this.webSocket.addEventListener('close', () => {
      console.warn(ts(), 'Web socket closed');
      if (this.socketOpen) {
        this.socketOpen = false;
        this.reestablishing = true;
        this.wsReady = false;
        setTimeout(() => this.connectToWebSocket(), 500);
      }
    });
    this.webSocket.addEventListener('error', evt => {
      console.error(ts(), 'Web socket error:', evt.type);
      if (this.socketEverOpen) {
        this.socketOpen = false;
        this.reestablishing = true;
        this.wsReady = false;
        setTimeout(() => this.connectToWebSocket(), 500);
      }
      else {
        this.socketOpen = false;
        console.warn(ts(), 'Web socket connection failed');
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
    const observable = this.httpClient.get<ServerStatus>('/api/status').pipe(shareReplay());

    observable.subscribe(status => this.receiveStatus(status, true));

    return observable;
  }
}

let This: AppComponent;

export function updatedItem(item: LibraryItem): LibraryItem {
  if (This)
    return This.updatedItem(item);
  else
    return null;
}

import { Component, EventEmitter, HostListener, Input, OnInit, Output } from '@angular/core';
import { LibraryItem } from '../../../server/src/shared-types';
import { canPlayVP9, getImageParam } from '../video-ui-utils';
import { encodeForUri } from '@tubular/util';
import { HttpClient } from '@angular/common/http';
import { checksum53, isMovie, isTvShow } from '../../../server/src/shared-utils';
import { StatusInterceptor } from '../status.service';
import { MenuItem } from 'primeng/api';
import { AuthService } from '../auth.service';
import { ItemStreamPair } from '../dash-player/dash-player.component';

@Component({
  selector: 'app-bonus-view',
  templateUrl: './bonus-view.component.html',
  styleUrls: ['./bonus-view.component.scss']
})
export class BonusViewComponent implements OnInit {
  private _playSrc: ItemStreamPair = undefined;
  private _source: LibraryItem;

  extras: string[] = [];
  players: string[] = [];
  playerMenus: MenuItem[][] = [];
  streamUris = new Map<string, string>();

  constructor(private httpClient: HttpClient, private auth: AuthService) {}

  @Input() get playSrc(): ItemStreamPair { return this._playSrc; }
  set playSrc(value: ItemStreamPair) {
    if (this._playSrc !== value) {
      this._playSrc = value;
      this.playing.emit(!!value);
    }
  }

  @Input() get source(): LibraryItem { return this._source; }
  set source(value: LibraryItem) {
    if (this._source !== value) {
      StatusInterceptor.alive();
      this._source = value;
      this.extras = [];
      this.playSrc = undefined;
      this.playerMenus = [];

      if (value) {
        let src = value;

        while (src) {
          if (src.extras) {
            this.extras.push(...src.extras);
            src.extras.forEach(extra =>
              this.httpClient.get<string>(`/api/stream-check?uri=${encodeForUri(extra)}${canPlayVP9() ? '' : '&mobile=true'}`)
                .subscribe(streamUri => {
                  if (streamUri)
                    this.streamUris.set(extra, streamUri);
                })
            );
          }

          src = src.parent;
        }
      }
    }
  }

  @Output() goBack: EventEmitter<void> = new EventEmitter();
  @Output() playing: EventEmitter<boolean> = new EventEmitter();

  @HostListener('window:keydown', ['$event']) onKeyDown(event:KeyboardEvent): void {
    if (this.source && event.key === 'Escape')
      this.goBack.emit();
  }

  ngOnInit(): void {
    this.httpClient.get<string[]>('/api/players').subscribe(players => this.players = players);
  }

  getBackgroundUrl(): string {
    let show = this.source;

    while (show && !isMovie(show) && !isTvShow(show))
      show = show.parent;

    if (show)
      return `url("/api/img/backdrop?id=${show.id}&cs=${checksum53(show.originalName || show.name)}${getImageParam()}")`;
    else
      return null;
  }

  uriToTitle(uri: string): string {
    return uri.replace(/^(.*\/)/, '').replace(/\.mkv$/, '').replace(/？/g, '?').replace(/：/g, ':');
  }

  startDownload(elem: HTMLElement): void {
    const link = elem.parentElement?.querySelector('a');

    if (link)
      link.click();
  }

  downloadLink(uri: string): string {
    return '/api/download?url=' + encodeForUri(uri);
  }

  play(uri: string): void {
    this.playSrc = { item: null, stream: this.streamUris.get(uri) };
  }

  getPlayerMenu(index: number, uri: string): MenuItem[] {
    if (!this.playerMenus[index])
      this.playerMenus[index] = this.players.map((name, i) => ({
        label: `Play: ${name}`,
        command: () => this.playOnMediaPlayer(i, uri)
      }));

    return this.playerMenus[index];
  }

  playOnMediaPlayer(player: number, uri: string): void {
    this.httpClient.get(`/api/play?uri=${encodeForUri(uri)}&player=${player}`).subscribe();
  }

  localAccess(): boolean {
    return this.players.length > 0 && this.auth.getSession()?.role === 'admin' && StatusInterceptor.localAccess;
  }

  closePlayer(): void {
    this.playSrc = undefined;
  }
}

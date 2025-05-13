import { Component, EventEmitter, HostListener, Input, OnInit, Output } from '@angular/core';
import { LibraryItem, PlaybackProgress } from '../../../server/src/shared-types';
import { canPlayVP9, getImageParam } from '../video-ui-utils';
import { checksum53, encodeForUri } from '@tubular/util';
import { HttpClient } from '@angular/common/http';
import { hashUri, isMovie, isTvShow } from '../../../server/src/shared-utils';
import { StatusInterceptor } from '../status.service';
import { MenuItem } from 'primeng/api';
import { AuthService } from '../auth.service';
import { ItemStreamPair, LibItem } from '../dash-player/dash-player.component';

@Component({
  selector: 'app-bonus-view',
  templateUrl: './bonus-view.component.html',
  styleUrls: ['./bonus-view.component.scss'],
  standalone: false
})
export class BonusViewComponent implements OnInit {
  private commonTitleStart = '';
  private _playSrc: ItemStreamPair = undefined;
  private _source: LibraryItem;

  extras: LibraryItem[] = [];
  itemsByStream = new Map<string, LibItem>();
  players: string[] = [];
  playerMenus: MenuItem[][] = [];
  streamUris = new Map<string, string>();
  video: LibraryItem;

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
      this.streamUris.clear();
      this.commonTitleStart = '';

      if (value) {
        let src = value;

        while (src) {
          if (src.extras) {
            this.extras.push(...src.extras);
            src.extras.forEach(extra =>
              this.httpClient.get<string>(`/api/stream-check?uri=${encodeForUri(extra.uri)}${canPlayVP9() ? '' : '&mobile=true'}`)
                .subscribe(streamUri => {
                  if (streamUri) {
                    this.streamUris.set(extra.uri, streamUri);

                    if (this.streamUris.size === this.extras.length)
                      this.getPlaybackInfo();
                  }
                })
            );

            for (let i = 0; i < src.extras.length; ++i) {
              const extra = src.extras[i];
              const start = (/^([^•]+\s*•\s*)/.exec(extra.title) || [])[1];

              if (start && i === 0)
                this.commonTitleStart = start;
              else if (!start || start !== this.commonTitleStart) {
                this.commonTitleStart = '';
                break;
              }
            }
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

  getExtraTitle(item: LibraryItem): string {
    if (item.title?.includes('•'))
      return item.title.substring(this.commonTitleStart.length);

    return item.uri.replace(/^(.*\/)/, '').replace(/\.mkv$/, '').replace(/？/g, '?').replace(/：/g, ':');
  }

  startDownload(elem?: HTMLElement): void {
    const link = elem?.parentElement?.querySelector('a');

    if (link)
      link.click();
  }

  downloadLink(uri: string): string {
    return '/api/download?url=' + encodeForUri(uri);
  }

  play(uri: string): void {
    const stream = this.streamUris.get(uri);

    this.playSrc = { item: this.itemsByStream.get(stream), stream };
  }

  getVideo(uri: string): LibItem {
    const stream = this.streamUris.get(uri);

    return stream && this.itemsByStream.get(stream);
  }

  getPlayerMenu(index: number): MenuItem[] {
    if (!this.playerMenus[index])
      this.playerMenus[index] = [{
        label: 'Zidoo play options...',
        command: (): void => {
          this.video = this.extras[index];
        }
      }];

    return this.playerMenus[index];
  }

  localAccess(): boolean {
    return this.players.length > 0 && this.auth.getSession()?.role === 'admin' && StatusInterceptor.localAccess;
  }

  closePlayer(): void {
    this.playSrc = undefined;
    this.getPlaybackInfo();
  }

  getPlaybackInfo(): void {
    const choices = Array.from(this.streamUris.values());
    const videos = choices.map(c => hashUri(c)).join();

    this.itemsByStream.clear();
    this.httpClient.get(`/api/stream/progress?videos=${encodeForUri(videos)}`).subscribe((response: PlaybackProgress[]) => {
      for (const stream of choices) {
        const hash = hashUri(stream);
        const match = response.find(row => row.hash === hash);

        if (match)
          this.itemsByStream.set(stream,
            { hash, duration: match.duration, positionUser: match.offset, streamUri: stream, watchedByUser: match.watched });
        else
          this.itemsByStream.set(stream, { hash, duration: 0, positionUser: 0, streamUri: stream, watchedByUser: false });
      }
    });
  }
}

import { Component, EventEmitter, HostListener, Input, Output } from '@angular/core';
import { LibraryItem } from '../../../server/src/shared-types';
import { canPlayVP9, getImageParam } from '../video-ui-utils';
import { encodeForUri } from '@tubular/util';
import { HttpClient } from '@angular/common/http';
import { checksum53, isMovie, isTvShow } from '../../../server/src/shared-utils';
import { StatusInterceptor } from '../status.service';

@Component({
  selector: 'app-bonus-view',
  templateUrl: './bonus-view.component.html',
  styleUrls: ['./bonus-view.component.scss']
})
export class BonusViewComponent {
  private _playSrc = '';
  private _source: LibraryItem;

  extras: string[] = [];
  streamUris = new Map<string, string>();

  constructor(private httpClient: HttpClient) {}

  @Input() get playSrc(): string { return this._playSrc; }
  set playSrc(value: string) {
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
      this.playSrc = '';

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
    this.playSrc = this.streamUris.get(uri);
  }

  closePlayer(): void {
    this.playSrc = '';
  }
}

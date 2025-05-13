import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { LibraryItem, Track, VType } from '../../../server/src/shared-types';
import { ConfirmationService, MenuItem, MessageService } from 'primeng/api';
import { HttpClient } from '@angular/common/http';
import { encodeForUri, isObject, isString, isValidJson, toInt } from '@tubular/util';
import { max } from '@tubular/math';
import { AuthService } from '../auth.service';

const languageNames = new Intl.DisplayNames(['en'], { type: 'language' });

function subtitleName(name: string): string {
  if (/^\w\w$/.test(name)) {
    const lang = languageNames.of(name);

    if (lang)
      name = `Forced ${lang} subtitles`;
  }

  return name;
}

function errorText(err: any): string {
  if (isString(err)) {
    if (isValidJson(err))
      err = JSON.parse(err);
    else
      return err;
  }

  if (isObject(err)) {
    if (err.message || err.msg)
      return err.message || err.msg;
    else if (err.status && err.statusText)
      return `${err.status}: ${err.statusText}`;
  }

  err = err?.toString();

  return err && err !== '[object Object]' ? err : 'unknown error';
}

@Component({
  selector: 'app-play-options',
  templateUrl: './play-options.component.html',
  styleUrls: ['./play-options.component.scss'],
  standalone: false
})
export class PlayOptionsComponent implements OnInit {
  private static lastPlayers: MenuItem[] = [];

  private _closed = false;
  private _video: LibraryItem;

  audio: Track[] = [];
  audioChoices: MenuItem[] = [];
  audioLangs = new Set<string>();
  audioIndex = '0';
  busy = false;
  canChoose = false;
  defaultLang = 'en';
  forcedSubs = new Set<string>();
  playerIndex = '0';
  players: MenuItem[] = [];
  subtitle: Track[] = [];
  subtitleChoices: MenuItem[] = [];
  subtitleLangs = new Set<string>();
  subtitleIndex = '0';
  usePlayerDefaults = true;

  constructor(private httpClient: HttpClient,
              public auth: AuthService,
              private messageService: MessageService,
              private confirmationService: ConfirmationService) {
    this.players = PlayOptionsComponent.lastPlayers;
  }

  get closed(): boolean { return this._closed; }
  set closed(value: boolean) {
    if (value && !this._closed) {
      this.busy = false;
      this.messageService.clear();
      this.close.emit();
    }

    this._closed = !!value;
  }

  @Input() get video(): LibraryItem { return this._video; }
  set video(value: LibraryItem) {
    if (this._video !== value) {
      this._video = value;
      this.audio = value?.audio || [];
      this.subtitle = value?.subtitle || [];

      this.audioIndex = '0';
      this.audioLangs.clear();
      this.defaultLang = 'en';
      this.subtitleIndex = '0';
      this.subtitleLangs.clear();
      this.forcedSubs.clear();
      this.canChoose = false;

      if (value) {
        this.audioChoices = this.audio.map((a, i) => ({ label: a.name, id: i.toString() }));
        this.audio.forEach(a => this.audioLangs.add(a.language));
        this.subtitleChoices = this.subtitle.map((a, i) => ({ label: subtitleName(a.name), id: (i + 1).toString() }));
        this.subtitleChoices.splice(0, 0, { label: 'None', id: '0' });
        this.subtitle.forEach(s => this.subtitleLangs.add(s.language));
        this.subtitle.filter(s => s.isForced).forEach(s => this.forcedSubs.add(s.language));
        this.canChoose = (this.audio.length > 1 || this.subtitle.length > 0);
        this.audioIndex = max(this.audio.findIndex(a => a.isDefault), 0).toString();
        this.defaultLang = this.audioLangs[this.audioIndex]?.language || 'en';
        this.audioChanged();
      }
    }
  }

  @Output() close: EventEmitter<void> = new EventEmitter();

  ngOnInit(): void {
    this.httpClient.get<string[]>('/api/players').subscribe(players => {
      this.players = [];
      players.forEach((name, i) => this.players.push({
        label: name,
        id: i.toString()
      }));

      if (this.players.length > 1)
        PlayOptionsComponent.lastPlayers = this.players;
    });
  }

  audioChanged(): void {
    const index = toInt(this.audioIndex);
    const audio = this.audio[index];
    let subIndex = 0;

    if (!audio.isolatedMusic)
      subIndex = this.subtitle.findIndex(s => s.isForced && s.language === audio.language) + 1;

    this.subtitleIndex = subIndex.toString();
  }

  demo(): boolean {
    return this.auth.getSession()?.role === 'demo';
  }

  private showError(err: any): void {
    this.busy = false;

    if (!this.closed) {
      this.messageService.add({
        severity: 'error', summary: 'Play Options Error',
        detail: errorText(err), sticky: true
      });
    }
  }

  playOnMediaPlayer(): void {
    let alreadyPlaying = false;
    const makeTrackSelections = (): void => {
      let url = `/api/setTracks?player=${this.playerIndex}`;

      if (this.audio.length > 1)
        url += `&audio=${this.audioIndex}`;

      if (this.subtitle.length > 0)
        url += `&subtitle=${this.subtitleIndex}`;

      if (alreadyPlaying)
        url += '&ignorePlaying';

      this.httpClient.get(url).subscribe({
        next: (response: any) => {
          if (response?.status && response.status !== 200)
            this.showError(response);
          else if (response?.inProgress && !alreadyPlaying) {
            alreadyPlaying = true;
            this.confirmationService.confirm({
              message: 'Do you want to resend your audio/subtitle selections which may have been blocked?',
              header: 'Possible Restart/Continue Prompt Delay',
              icon: 'pi pi-exclamation-triangle',
              accept: () => makeTrackSelections(),
              reject: () => this.closed = true
            });
          }
          else
            this.closed = true;
        },
        error: (err) => this.showError(err)
      });
    };

    this.messageService.clear();
    this.busy = true;

    const url = this.video.type === VType.EXTRA ?
      `/api/play?uri=${encodeForUri(this.video.uri)}&player=${this.playerIndex}` :
      `/api/play?id=${this.video?.aggregationId}&player=${this.playerIndex}`;

    this.httpClient.get(url).subscribe({
      next: (response: any) => {
        if (response?.status && response.status !== 200)
          this.showError(response);
        else if (this.canChoose && !this.usePlayerDefaults) {
          alreadyPlaying = !!response?.alreadyPlaying;
          setTimeout(() => makeTrackSelections(), 250);
        }
        else
          this.closed = true;
      },
      error: (err) => this.showError(err)
    });
  }
}

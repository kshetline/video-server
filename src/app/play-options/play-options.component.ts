import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { LibraryItem, Track } from '../../../server/src/shared-types';
import { MenuItem, MessageService } from 'primeng/api';
import { HttpClient } from '@angular/common/http';
import { toInt } from '@tubular/util';
import { max } from '@tubular/math';

const languageNames = new Intl.DisplayNames(['en'], { type: 'language' });

function subtitleName(name: string): string {
  if (/^\w\w$/.test(name)) {
    const lang = languageNames.of(name);

    if (lang)
      name = `Forced ${lang} subtitles`;
  }

  return name;
}

@Component({
  selector: 'app-play-options',
  templateUrl: './play-options.component.html',
  styleUrls: ['./play-options.component.scss']
})
export class PlayOptionsComponent implements OnInit {
  private _video: LibraryItem;

  audio: Track[] = [];
  audioChoices: MenuItem[] = [];
  audioIndex = '0';
  playerIndex = '0';
  players: MenuItem[] = [];
  subtitle: Track[] = [];
  subtitleChoices: MenuItem[] = [];
  subtitleIndex = '0';

  constructor(private httpClient: HttpClient, private messageService: MessageService) {}

  @Input() get video(): LibraryItem { return this._video; }
  set video(value: LibraryItem) {
    if (this._video !== value) {
      this._video = value;
      this.audio = value?.audio || [];
      this.subtitle = value?.subtitle || [];

      this.audioChoices = this.audio.map((a, i) => ({ label: a.name, id: i.toString() }));
      this.subtitleChoices = this.subtitle.map((a, i) => ({ label: subtitleName(a.name), id: (i + 1).toString() }));
      this.subtitleChoices.splice(0, 0, { label: 'None', id: '0' });
      this.audioIndex = '0';
      this.subtitleIndex = '0';

      if (value) {
        this.audioIndex = max(this.audio.findIndex(a => a.isDefault), 0).toString();
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
    });
  }

  audioChanged(): void {
    const index = toInt(this.audioIndex);
    const audio = this.audio[index];
    let subIndex = 0;

    if (!audio.isCommentary && !audio.isolatedMusic)
      subIndex = this.subtitle.findIndex(s => s.isForced && s.language === audio.language) + 1;

    this.subtitleIndex = subIndex.toString();
  }

  private showError(err: any): void {
    this.messageService.add({
      severity: 'error', summary: 'Play Options Error',
      detail: err.toString(), sticky: true
    });
  }

  playOnMediaPlayer(): void {
    this.httpClient.get(`/api/play?id=${this.video?.aggregationId}&player=${this.playerIndex}`).subscribe({
      next: () => {
        this.httpClient.get(`/api/setTracks?player=${this.playerIndex}&audio=${this.audioIndex}&subtitle=${this.subtitleIndex}`).subscribe({
          next: () => this.close.emit(),
          error: (err) => this.showError(err)
        });
      },
      error: (err) => this.showError(err)
    });
  }
}

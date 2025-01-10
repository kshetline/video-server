import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { LibraryItem, Track } from '../../../server/src/shared-types';
import { MenuItem } from 'primeng/api';
import { HttpClient } from '@angular/common/http';
import { toInt } from '@tubular/util';

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
  audioIndex = '1';
  playerIndex = '0';
  players: MenuItem[] = [];
  subtitle: Track[] = [];
  subtitleChoices: MenuItem[] = [];
  subtitleIndex = '0';

  constructor(private httpClient: HttpClient) {}

  @Input() get video(): LibraryItem { return this._video; }
  set video(value: LibraryItem) {
    if (this._video !== value) {
      this._video = value;
      this.audio = value?.audio || [];
      this.subtitle = value?.subtitle || [];

      this.audioChoices = this.audio.map((a, i) => ({ label: a.name, id: (i + 1).toString() }));
      this.subtitleChoices = this.subtitle.map((a, i) => ({ label: subtitleName(a.name), id: (i + 1).toString() }));
      this.subtitleChoices.splice(0, 0, { label: 'None', id: '0' });
      this.audioIndex = '1';
      this.subtitleIndex = '0';

      if (value) {
        this.audioIndex = (this.audio.findIndex(a => a.isDefault) + 1).toString();
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
    const index = toInt(this.audioIndex) - 1;
    const audio = this.audio[index];
    let subIndex = 0;

    if (!audio.isCommentary && !audio.isolatedMusic)
      subIndex = this.subtitle.findIndex(s => s.isForced && s.language === audio.language) + 1;

    this.subtitleIndex = subIndex.toString();
  }

  playOnMediaPlayer(): void {
    this.httpClient.get(`/api/play?id=${this.video?.aggregationId}&player=${this.playerIndex}`).subscribe({
      complete: () => this.close.emit()
    });
  }
}

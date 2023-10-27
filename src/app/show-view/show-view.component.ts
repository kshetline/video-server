import { Component, EventEmitter, HostListener, Input, Output } from '@angular/core';
import { LibraryItem, VType } from '../../../server/src/shared-types';
import { checksum53, getSeasonTitle } from '../video-ui-utils';
import { encodeForUri } from '@tubular/util';
import { max, round } from '@tubular/math';

@Component({
  selector: 'app-show-view',
  templateUrl: './show-view.component.html',
  styleUrls: ['./show-view.component.scss']
})
export class ShowViewComponent {
  readonly checksum53 = checksum53;
  readonly encodeForUri = encodeForUri;
  readonly getSeasonTitle = getSeasonTitle;
  readonly TV_SEASON = VType.TV_SEASON;

  private _show: LibraryItem;

  selection: LibraryItem;
  video: LibraryItem;
  videoChoices: LibraryItem[] = [];
  videoLabels: string[] = [];
  videoIndex = 0;

  @Input() get show(): LibraryItem { return this._show; }
  set show(value: LibraryItem) {
    if (this._show !== value) {
      this._show = value;
      this.videoChoices = [];
      this.videoLabels = [];
      this.videoIndex = 0;
      this.video = undefined;
      this.selection = undefined;

      if (!value)
        return;

      const choices = this.videoChoices;
      const isTV = (value.type === VType.TV_SEASON);
      let count2k = 0;
      let count4k = 0;
      let count3d = 0;
      const gatherVideos = (item: LibraryItem): void => {
        if (item.type === VType.FILE) {
          this.videoChoices.push(item);
          count2k += (item.isFHD || item.is2k) && !item.is3d ? 1 : 0;
          count4k += item.is4k ? 1 : 0;
          count3d += item.is3d ? 1 : 0;
        }

        if (item.data?.length > 0)
          item.data.forEach(child => gatherVideos(child));
      };

      gatherVideos(value);

      choices.sort((a, b) => {
        if (isTV && a.parent.episode !== b.parent.episode)
          return (a.parent.episode || 0) - (b.parent.episode || 0);

        if (count4k && a.is4k && !b.is4k)
          return -1;

        if (count4k && !a.is4k && b.is4k)
          return 1;

        if (count3d && a.is3d && !b.is3d)
          return -1;

        if (count3d && !a.is3d && b.is3d)
          return 1;

        return 0;
      });

      this.videoIndex = max(choices.findIndex(vc => !vc.watched && (vc.is4k || !count4k)), 0);
      this.video = this.videoChoices[this.videoIndex];
      this.selection = this.video.parent ?? this.video;

      let episodeIndex = 0;
      let lastEpisode = -1;
      const hasDuplicateEpisodes = isTV && !!choices.find((vc, i) =>
        vc.parent.episode === choices[i + 1]?.parent.episode);

      this.videoLabels = choices.map((vc, i) => {
        if (this.show.type === VType.TV_SEASON) {
          if (!hasDuplicateEpisodes)
            return vc.parent.episode.toString();

          if (vc.parent.episode !== lastEpisode) {
            lastEpisode = vc.parent.episode;
            episodeIndex = 1;
          }

          return `${vc.parent.episode}-${episodeIndex++}`;
        }

        if (vc.is4k && count4k === 1 && (count2k > 0 || count3d > 0))
          return '4K';

        if (vc.is3d && count3d === 1 && (count2k > 0 || count4k > 0))
          return '3D';

        if ((vc.isFHD || vc.is2k) && count2k === 1 && (count3d > 0 || count4k > 0))
          return count3d && !count4k ? '2D' : '2K';

        return String.fromCharCode(65 + i);
      });
    }
  }

  @Output() goBack: EventEmitter<void> = new EventEmitter();

  @HostListener('window:keydown', ['$event']) onKeyDown(event: KeyboardEvent): void {
    if (this.show && event.key === 'Escape')
      this.goBack.emit();
  }

  showYear(): boolean {
    return this.show.year && (this.show.type === VType.MOVIE || !this.show.airDate);
  }

  showAirDate(): boolean {
    return this.selection.airDate && this.show.type === VType.TV_SEASON && !this.showYear();
  }

  getDuration(): string {
    return round(this.video.duration / 60000) + ' minutes';
  }

  getGenres(): string {
    if (this.show.genres?.length > 0)
      return this.show.genres.join(', ');
    else
      return '';
  }
}

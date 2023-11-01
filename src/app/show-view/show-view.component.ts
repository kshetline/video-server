import { Component, EventEmitter, HostListener, Input, Output } from '@angular/core';
import { Cut, LibraryItem, VType } from '../../../server/src/shared-types';
import { checksum53, getSeasonTitle } from '../video-ui-utils';
import { encodeForUri } from '@tubular/util';
import { max, round } from '@tubular/math';

const FADER_TRANSITION_DURATION = '0.75s';

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
  private backgroundMain = '';
  private backgroundChangeInProgress = false;
  private pendingBackgroundIndex = -1;
  private thumbnailMode = false;

  anyOverview = false;
  backgroundOverlay = '';
  categoryLabels: string[] = [];
  faderOpacity = '0';
  selection: LibraryItem;
  thumbnail: string;
  thumbnailWidth = '0';
  transitionDuration = FADER_TRANSITION_DURATION;
  video: LibraryItem;
  videoCategory = 1;
  videoChoices: LibraryItem[][] = [];
  videoLabels: string[] = [];
  videoIndex = 0;

  @Input() get show(): LibraryItem { return this._show; }
  set show(value: LibraryItem) {
    if (this._show !== value) {
      this._show = value;
      this.videoChoices = [];
      this.videoLabels = [];
      this.categoryLabels = [];
      this.videoCategory = 0;
      this.videoIndex = 0;
      this.video = undefined;
      this.selection = undefined;
      this.anyOverview = false;
      this.backgroundMain = '';
      this.thumbnail = undefined;
      this.thumbnailMode = false;
      this.thumbnailWidth = '0';
      this.transitionDuration = FADER_TRANSITION_DURATION;
      this.backgroundChangeInProgress = false;
      this.pendingBackgroundIndex = -1;

      if (!value)
        return;

      const choices: LibraryItem[] = [];
      const isTV = (value.type === VType.TV_SEASON);
      let count2k = 0;
      let count4k = 0;
      let count3d = 0;
      let countOSE = 0;
      const cuts = new Map<number, number>();
      const episodes = new Set<number>();
      let hasDuplicateEpisodes = false;
      const gatherVideos = (item: LibraryItem): void => {
        if (item.type === VType.FILE) {
          choices.push(item);

          if (item.cut)
            cuts.set(item.cut, (cuts.get(item.cut) || 0) + 1);

          count2k += (item.isFHD || item.is2k) && !item.is3d ? 1 : 0;
          count4k += item.is4k ? 1 : 0;
          count3d += item.is3d ? 1 : 0;
          countOSE += /Original Special Effects/i.test(item.uri) ? 1 : 0;

          if (item.parent.episode > 0) {
            if (episodes.has(item.parent.episode))
              hasDuplicateEpisodes = true;
            else
              episodes.add(item.parent.episode);
          }
        }

        if (item.data?.length > 0)
          item.data.forEach(child => gatherVideos(child));
      };

      gatherVideos(value);

      choices.sort((a, b) => {
        if (isTV && a.parent.episode !== b.parent.episode)
          return (a.parent.episode || 0) - (b.parent.episode || 0);

        if (!isTV && a.cut !== b.cut)
          return (b.cut || Cut.NA) - (a.cut || Cut.NA);

        if (count4k && a.is4k && !b.is4k)
          return -1;

        if (count4k && !a.is4k && b.is4k)
          return 1;

        if (count3d && a.is3d && !b.is3d)
          return -1;

        if (count3d && !a.is3d && b.is3d)
          return 1;

        if (count2k && a.is2k && !b.is2k)
          return -1;

        if (count2k && !a.is2k && b.is2k)
          return 1;

        return 0;
      });

      this.anyOverview = !!choices.find(vc => vc.parent.overview);

      let episodeIndex = 0;
      let lastEpisode = -1;

      this.videoLabels = choices.map((vc, i) => {
        if (this.show.type === VType.TV_SEASON && episodes.size > 1) {
          if (!hasDuplicateEpisodes)
            return vc.parent.episode.toString();

          if (vc.parent.episode !== lastEpisode) {
            lastEpisode = vc.parent.episode;
            episodeIndex = 0;
          }

          ++episodeIndex;

          if (countOSE === episodes.size || count4k === count2k)
            return `${vc.parent.episode}`;
          else
            return `${vc.parent.episode}-${episodeIndex++}`;
        }

        let cut = '';

        if (!isTV && cuts.size > 0)
          cut = ['', 'TC-', 'ITC-', 'UR-', 'EC-', 'DC-', 'FC-', 'SE-'][vc.cut];

        if (vc.is4k && count4k === max(cuts.size, 1) && (count2k > 0 || count3d > 0))
          return cut + '4K';

        if (vc.is3d && count3d === max(cuts.size, 1) && (count2k > 0 || count4k > 0))
          return cut + '3D';

        if ((vc.isFHD || vc.is2k) && count2k === max(cuts.size, 1) && (count3d > 0 || count4k > 0))
          return cut + (count3d && !count4k ? '2D' : '2K');

        if (cut)
          return cut.slice(0, -1);

        return String.fromCharCode(65 + i);
      });

      if ((countOSE > 0 && countOSE === episodes.size) || (count4k > 0 && count4k === count2k)) {
        if (countOSE === episodes.size)
          this.categoryLabels = ['Updated FX', 'Original FX'];
        else
          this.categoryLabels = ['4K', '2K'];

        this.videoChoices = [
          choices.filter((_vc, i) => i % 2 === 0),
          choices.filter((_vc, i) => i % 2 === 1)
        ];
        this.videoLabels = this.videoLabels.filter((_vl, i) => i % 2 === 0);
      }
      else
        this.videoChoices = [choices];

      this.videoIndex = max(this.videoChoices[0].findIndex(vc => !vc.watched), 0);
      this.video = this.videoChoices[0][this.videoIndex];
      this.selection = this.video.parent ?? this.video;
      this.selectVideo(this.videoIndex);
    }
  }

  @Input() currentBonus: LibraryItem;

  @Output() goBack: EventEmitter<void> = new EventEmitter();
  @Output() viewBonus: EventEmitter<LibraryItem> = new EventEmitter();

  @HostListener('window:keydown', ['$event']) onKeyDown(event: KeyboardEvent): void {
    if (this.show && !this.currentBonus && event.key === 'Escape')
      this.goBack.emit();
    else if (event.key === 'ArrowLeft' && this.videoIndex > 0)
      this.selectVideo(this.videoIndex - 1);
    else if (event.key === 'ArrowRight' && this.videoIndex < this.videoLabels.length - 1)
      this.selectVideo(this.videoIndex + 1);
  }

  getBackground(): string {
    if (this.show?.type !== VType.TV_SEASON || !this.backgroundMain)
      return (this.backgroundMain = this.getBackgroundAux());
    else
      return this.backgroundMain;
  }

  private getBackgroundAux(ignoreEpisode = false): string {
    const id2 = !ignoreEpisode && this.show?.type === VType.TV_SEASON && this.video?.parent.id;

    return `/api/backdrop?id=${this.show.id}${id2 ? '&id2=' + id2 : ''}&cs=${checksum53(this.show.name)}`;
  }

  hasBonusMaterial(): boolean {
    return !!(this.video?.extras || this.video?.parent?.extras || this.show?.extras || this.show?.parent?.extras);
  }

  hasYear(): boolean {
    return this.show.year && this.show.type === VType.MOVIE;
  }

  hasAirDate(): boolean {
    return this.selection.airDate && this.show.type === VType.TV_SEASON && !this.hasYear();
  }

  getDuration(): string {
    return round(this.video.duration / 60000) + ' minutes';
  }

  getVoteAverage(): number {
    return this.video.voteAverage || this.show.voteAverage;
  }

  getGenres(): string {
    if (this.show.genres?.length > 0)
      return this.show.genres.join(', ');
    else
      return '';
  }

  cssUrl(url: string): string {
    return 'url("' + url + '")';
  }

  selectVideo(index: number): void {
    this.videoIndex = index;
    this.video = this.videoChoices[this.videoCategory][index];
    this.selection = this.video.parent ?? this.video;

    if (this.show?.type === VType.TV_SEASON) {
      if (this.backgroundChangeInProgress) {
        this.pendingBackgroundIndex = index;
        return;
      }

      this.backgroundChangeInProgress = true;

      const newBackground = this.getBackgroundAux();
      const img = new Image();

      img.addEventListener('load', () => {
        img.remove();

        if (this.thumbnailMode || img.naturalHeight < 800) {
          this.thumbnailMode = true;
          this.faderOpacity = '0';
          this.backgroundMain = this.getBackgroundAux(true);
          this.thumbnail = newBackground;
          this.thumbnailWidth = round(img.naturalWidth * 200 / img.naturalHeight) + 'px';
          this.checkPendingBackgroundChange();

          return;
        }

        this.backgroundOverlay = newBackground;
        this.transitionDuration = FADER_TRANSITION_DURATION;
        this.faderOpacity = '100';

        setTimeout(() => {
          this.backgroundMain = newBackground;
          this.transitionDuration = '0s';
          this.faderOpacity = '0';
          this.checkPendingBackgroundChange();
        }, parseFloat(FADER_TRANSITION_DURATION) * 1000 + 100);
      });

      img.addEventListener('error', () => {
        img.remove();
        this.faderOpacity = '0';
        this.backgroundMain = this.getBackgroundAux(true);
        this.checkPendingBackgroundChange();
      });

      img.src = newBackground;
    }

    const focus = document.querySelector(':focus') as HTMLElement;

    if (focus?.getAttribute('type') === 'radio')
      focus.blur();
  }

  startOfPath(): string {
    return (this.video?.uri || '').replace(/^\//, '').replace(/(.*)\/.+$/, '$1');
  }

  endOfPath(): string {
    return (this.video?.uri || '').replace(/.*(\/.+)$/, '$1');
  }

  downloadLink(): string {
    return '/api/download?url=' + encodeForUri(this.video?.uri || '');
  }

  startDownload(elem: HTMLElement): void {
    const link = elem.parentElement?.querySelector('a');

    if (link)
      link.click();
  }

  private checkPendingBackgroundChange(): void {
    setTimeout(() => {
      this.backgroundChangeInProgress = false;

      const pending = this.pendingBackgroundIndex;

      if (pending >= 0) {
        this.pendingBackgroundIndex = -1;
        this.selectVideo(pending);
      }
    });
  }
}

import { Component, EventEmitter, HostListener, Input, OnInit, Output } from '@angular/core';
import { Cut, LibraryItem } from '../../../server/src/shared-types';
import { canPlayVP9, getImageParam, getSeasonTitle, setCssVariable } from '../video-ui-utils';
import { encodeForUri } from '@tubular/util';
import { floor, max, round } from '@tubular/math';
import { HttpClient } from '@angular/common/http';
import { checksum53, isFile, isMovie, isTvSeason } from '../../../server/src/shared-utils';
import { StatusInterceptor } from '../status.service';
import { AuthService } from '../auth.service';
import { MenuItem, MessageService } from 'primeng/api';

const FADER_TRANSITION_DURATION = '0.75s';

interface Person {
  image?: string;
  isDirector?: boolean;
  name: string;
  role?: string;
}

@Component({
  selector: 'app-show-view',
  templateUrl: './show-view.component.html',
  styleUrls: ['./show-view.component.scss'],
  providers: [MessageService]
})
export class ShowViewComponent implements OnInit {
  readonly getSeasonTitle = getSeasonTitle;
  readonly isTvSeason = isTvSeason;

  private backgroundMain = '';
  private backgroundChangeInProgress = false;
  private checkedForStream = new Set<number>();
  private pendingBackgroundIndex = -1;
  private _playSrc = '';
  private _show: LibraryItem;
  private thumbnailMode = false;

  anyOverview = false;
  backgroundOverlay = '';
  badges: string[] = [];
  categoryLabels: string[] = [];
  faderOpacity = '0';
  people: Person[] = [];
  players: MenuItem[] = [];
  selection: LibraryItem;
  showCast = false;
  streamUri: string;
  thumbnail: string;
  thumbnailWidth = '0';
  transitionDuration = FADER_TRANSITION_DURATION;
  video: LibraryItem;
  videoCategory = 1;
  videoChoices: LibraryItem[][] = [];
  videoLabels: string[] = [];
  videoIndex = 0;

  constructor(
    private httpClient: HttpClient,
    private auth: AuthService,
    private messageService: MessageService
  ) {}

  ngOnInit(): void {
    this.httpClient.get<string[]>('/api/players').subscribe(players => {
      this.players = [];
      players.forEach((name, i) => this.players.push({
        label: `Play: ${name}`,
        command: () => this.playOnMediaPlayer(i)
      }));
    });
  }

  @Input() get show(): LibraryItem { return this._show; }
  set show(value: LibraryItem) {
    if (this._show !== value) {
      StatusInterceptor.alive();
      this._show = value;
      this.videoChoices = [];
      this.videoLabels = [];
      this.categoryLabels = [];
      this.videoCategory = 0;
      this.videoIndex = 0;
      this.video = undefined;
      this.people = [];
      this.showCast = false;
      this.selection = undefined;
      this.anyOverview = false;
      this.backgroundMain = '';
      this.thumbnail = undefined;
      this.thumbnailMode = false;
      this.thumbnailWidth = '0';
      this.transitionDuration = FADER_TRANSITION_DURATION;
      this.backgroundChangeInProgress = false;
      this.pendingBackgroundIndex = -1;
      this.checkedForStream.clear();

      if (!value)
        return;

      if (value.directors)
        value.directors.forEach(d => this.people.push({ image: d.profilePath, isDirector: true, name: d.name }));

      if (value.actors)
        value.actors.forEach(d => this.people.push({ image: d.profilePath, name: d.name, role: d.character }));

      const choices: LibraryItem[] = [];
      const isTV = isTvSeason(value);
      let count2k = 0;
      let count4k = 0;
      let count3d = 0;
      let countOSE = 0;
      const cuts = new Map<number, number>();
      const episodes = new Set<number>();
      let hasDuplicateEpisodes = false;
      const gatherVideos = (item: LibraryItem): void => {
        if (isFile(item)) {
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
        if ((isTvSeason(this.show) || this.show.isTV) && episodes.size > 1) {
          if (!hasDuplicateEpisodes)
            return vc.parent.episode.toString();

          if (vc.parent.episode !== lastEpisode) {
            lastEpisode = vc.parent.episode;
            episodeIndex = 0;
          }

          ++episodeIndex;

          if ((countOSE > 0 && countOSE === episodes.size) || (count4k > 0 && count4k === count2k))
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

      if (episodes.size && (countOSE === episodes.size || (count4k > 0 && count4k === count2k))) {
        if (countOSE > 0)
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

  @Input() get playSrc(): string { return this._playSrc; }
  set playSrc(value: string) {
    if (this._playSrc !== value) {
      this._playSrc = value;
      this.playing.emit(!!value);
    }
  }

  @Input() currentBonus: LibraryItem;

  @Output() goBack: EventEmitter<void> = new EventEmitter();
  @Output() viewBonus: EventEmitter<LibraryItem> = new EventEmitter();
  @Output() playing: EventEmitter<boolean> = new EventEmitter();

  @HostListener('window:keydown', ['$event']) onKeyDown(event: KeyboardEvent): void {
    if (this.show && !this.currentBonus && event.key === 'Escape')
      this.goBack.emit();
    else if (event.key === 'ArrowLeft' && this.videoIndex > 0)
      this.selectVideo(this.videoIndex - 1);
    else if (event.key === 'ArrowRight' && this.videoIndex < this.videoLabels.length - 1)
      this.selectVideo(this.videoIndex + 1);
  }

  @HostListener('window:resize') onResize(): void {
    setCssVariable('--overview-width', 'unset');
  }

  getLogoUrl(): string {
    return `/api/img/logo?url=${encodeForUri(this.show.logo)}`;
  }

  getPosterUrl(item: LibraryItem): string {
    if (item.id !== floor(item.id))
      return '/assets/folder.svg';
    else
      return `/api/img/poster?id=${item.id}&cs=${checksum53(item.originalName || item.name)}&w=300&h=450`;
  }

  getBackground(): string {
    if (!isTvSeason(this.show) || !this.backgroundMain)
      return (this.backgroundMain = this.getBackgroundAux());
    else
      return this.backgroundMain;
  }

  private getBackgroundAux(ignoreEpisode = false): string {
    const id2 = !ignoreEpisode && isTvSeason(this.show) && this.video?.parent.id;

    return `/api/img/backdrop?id=${this.show.id}${id2 ? '&id2=' + id2 : ''}&cs=${checksum53(this.show.originalName ||
      this.show.name)}${getImageParam()}`;
  }

  hasBonusMaterial(): boolean {
    return !!(this.video?.extras || this.video?.parent?.extras || this.show?.extras || this.show?.parent?.extras);
  }

  hasYear(): boolean {
    return this.show.year && isMovie(this.show);
  }

  hasAirDate(): boolean {
    return this.selection.airDate && isTvSeason(this.show) && !this.hasYear();
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
    this.updateBadges();
    this.streamUri = canPlayVP9() ? this.video.streamUri : this.video.mobileUri;

    if (!this.streamUri && !this.checkedForStream.has(this.video.id))
      this.httpClient.get<string>(`/api/stream-check?id=${this.video.id}${canPlayVP9() ? '' : '&mobile=true'}`)
        .subscribe(streamUri => this.streamUri = streamUri);

    if (isTvSeason(this.show)) {
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
    return (this.video?.shadowUri || this.video?.uri || '').replace(/^\//, '').replace(/(.*)\/.+$/, '$1');
  }

  endOfPath(): string {
    return (this.video?.shadowUri || this.video?.uri || '').replace(/.*(\/.+)$/, '$1');
  }

  downloadLink(): string {
    return '/api/download?url=' + encodeForUri(this.video?.uri || '');
  }

  startDownload(elem: HTMLElement): void {
    const link = elem.parentElement?.querySelector('a');

    if (link)
      link.click();
  }

  play(): void {
    if (!this.streamUri)
      this.messageService.add({ severity: 'warn', summary: 'Can\'t play in browser', detail: 'Streaming not available.' });
    else
      this.playSrc = this.streamUri;
  }

  playOnMediaPlayer(player: number): void {
    this.httpClient.get(`/api/play?id=${this.video.aggregationId}&type=${this.video.type}&player=${player}`).subscribe();
  }

  closePlayer(): void {
    this.playSrc = '';
  }

  getProfileUrl(person: Person): string {
    return `/api/img/profile?uri=${encodeForUri(person.image)}&w=200&h=300`;
  }

  toggleCast(): void {
    if (!this.showCast) {
      const overviewContent = document.querySelector('.overview-content') as HTMLElement;

      if (overviewContent)
        setCssVariable('--overview-width', overviewContent.getBoundingClientRect().width + 'px');
    }

    this.showCast = !this.showCast;
  }

  localAccess(): boolean {
    return this.players.length > 0 && this.auth.getSession()?.role === 'admin' && StatusInterceptor.localAccess;
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

  private updateBadges(): void {
    const b = this.badges = [];
    const v = this.video;

    if (v.is4k)
      b.push('4K');
    else if (v.is3d)
      b.push('3D');
    else if (v.is2k || v.isFHD)
      b.push('2K');
    else if (v.isHD)
      b.push('720p');

    if ((v.video || [])[0]?.codec)
      b.push(v.video[0].codec.replace(/\s+.*$/, ''));

    if (v.isHdr)
      b.push('HDR');

    const codecs = new Set<string>();

    for (let i = 0; i < (v.audio ? v.audio.length : 0); ++i) {
      const a = v.audio[i];
      let codec = a?.codec || '';
      let chan = a?.channels || '';
      let text: string;

      if (/\bmpeg\b/i.test(codec))
        codec = 'MP3';
      else if (/^ac-?3$/i.test(codec))
        codec = 'DD';

      if (/^stereo$/i.test(chan) && /\bmono\b/i.test(a.name))
        chan = 'Mono';

      if (codec) {
        if (!codecs.has(codec) && a.language === v.audio[0].language)
          text = codec + (chan && (i === 0 || /\bmono\b/i.test(chan) ? ' ' + chan : ''));

        codecs.add(codec);
      }
      else if (chan && i === 0)
        text = chan;

      if (text && text !== 'DD')
        b.push(text);
    }
  }
}

import { Component, EventEmitter, HostListener, Input, OnInit, Output } from '@angular/core';
import { LibraryItem, PlaybackProgress } from '../../../server/src/shared-types';
import { areImagesSimilar, canPlayVP9, getImageParam, getSeasonTitle, setCssVariable, webSocketMessagesEmitter } from '../video-ui-utils';
import { checksum53, compareCaseSecondary, encodeForUri, nfe, toMaxFixed } from '@tubular/util';
import { floor, max, round } from '@tubular/math';
import { HttpClient } from '@angular/common/http';
import { hashUri, isFile, isMovie, isTvSeason } from '../../../server/src/shared-utils';
import { StatusInterceptor } from '../status.service';
import { AuthService } from '../auth.service';
import { MenuItem, MessageService } from 'primeng/api';
import { ItemStreamPair } from '../dash-player/dash-player.component';
import { updatedItem } from '../app.component';

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
  private choices: LibraryItem[] = [];
  private pendingBackgroundIndex = -1;
  private _playSrc: ItemStreamPair = undefined;
  private _show: LibraryItem;
  private thumbnailMode = false;

  anyOverview = false;
  backgroundOverlay = '';
  badges: string[] = [];
  badgeExtras: string[][] = [];
  categoryLabels: string[] = [];
  faderOpacity = '0';
  identicalThumbnail = false;
  people: Person[] = [];
  playOptions: MenuItem[] = [{ label: 'Zidoo play options...', command: () => this.showPlayOptions = true }];
  roleId = -1;
  selection: LibraryItem;
  showCast = false;
  showPlayOptions = false;
  streamUri: string;
  thumbnail: string;
  thumbnailNaturalWidth = 0;
  thumbnailWidth = '0';
  transitionDuration = FADER_TRANSITION_DURATION;
  video: LibraryItem;
  videoCategory = 1;
  videoChoices: LibraryItem[][] = [];
  videoLabels: string[] = [];
  videoIndex = 0;

  constructor(
    private httpClient: HttpClient,
    public auth: AuthService,
    private messageService: MessageService
  ) {}

  ngOnInit(): void {
    webSocketMessagesEmitter().subscribe(msg => {
      switch (msg.type) {
        case 'idUpdate2':
          this.choices = this.choices.map(c => updatedItem(c));
          this.videoChoices = this.videoChoices.map(vc => vc.map(c => updatedItem(c)));
          break;
      }
    });
  }

  @Input() get show(): LibraryItem { return this._show; }
  set show(value: LibraryItem) {
    if (this._show !== value) {
      let keepIndex = -1;

      if (this._show && value && this._show.id === value.id && this._show.data?.length > 1 && this._show.data.length === value.data?.length)
        keepIndex = this.videoIndex;

      StatusInterceptor.alive();
      this._show = value;
      this.videoChoices = [];
      this.choices = [];
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
      this.identicalThumbnail = false;
      this.thumbnailNaturalWidth = 0;
      this.thumbnailWidth = '0';
      this.transitionDuration = FADER_TRANSITION_DURATION;
      this.backgroundChangeInProgress = false;
      this.pendingBackgroundIndex = -1;
      this.checkedForStream.clear();
      this.showPlayOptions = false;

      if (!value)
        return;

      if (value.directors)
        value.directors.forEach(d => this.people.push({ image: d.profilePath, isDirector: true, name: d.name }));

      if (value.actors)
        value.actors.forEach(d => this.people.push({ image: d.profilePath, name: d.name, role: d.character }));

      const isTV = isTvSeason(value);
      let count2k = 0;
      let count4k = 0;
      let count3d = 0;
      let countOSE = 0;
      const cutSorts = new Map<string, number>();
      const episodes = new Set<number>();
      let hasDuplicateEpisodes = false;
      const gatherVideos = (item: LibraryItem): void => {
        if (isFile(item)) {
          this.choices.push(item);

          if (item.cut)
            cutSorts.set(item.cut, item.cutSort || 0);

          count2k += (item.isFHD || item.is2k) && !item.is3d ? 1 : 0;
          count4k += item.is4k ? 1 : 0;
          count3d += item.is3d ? 1 : 0;
          countOSE += /Original Special Effects/i.test(item.uri) ? 1 : 0;

          const episode = item.parent.episode + (item.cutSort || 0) / 100;

          if (episode > 0) {
            if (episodes.has(episode))
              hasDuplicateEpisodes = true;
            else
              episodes.add(episode);
          }
        }

        if (item.data?.length > 0)
          item.data.forEach(child => gatherVideos(child));
      };

      gatherVideos(value);

      this.choices.sort((a, b) => {
        if (!isTV && a.cutSort !== b.cutSort)
          return a.cutSort - b.cutSort;

        if (isTV && a.parent.episode !== b.parent.episode)
          return (a.parent.episode || 0) - (b.parent.episode || 0);

        if (a.cutSort !== b.cutSort)
          return a.cutSort - b.cutSort;

        if (!isTV && a.cut !== b.cut)
          return compareCaseSecondary(a.cut, b.cut);

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

      this.anyOverview = !!this.choices.find(vc => vc.parent.overview);

      let episodeIndex = 0;
      let lastEpisode = -1;

      this.videoLabels = this.choices.map((vc, i) => {
        if ((isTvSeason(this.show) || this.show.isTV) && episodes.size > 1) {
          if (!hasDuplicateEpisodes)
            return vc.parent.episode.toString() + (vc.cut ? '-' + vc.cut : '');

          if (vc.parent.episode !== lastEpisode) {
            lastEpisode = vc.parent.episode;
            episodeIndex = 0;
          }

          ++episodeIndex;

          if ((countOSE > 0 && countOSE === episodes.size) || (count4k > 0 && count4k === count2k))
            return vc.parent.episode.toString();
          else
            return `${vc.parent.episode}-${episodeIndex++}`;
        }

        let cut = vc.cut || '';

        if (vc.is4k && count4k === max(cutSorts.size, 1) && (count2k > 0 || count3d > 0))
          cut += '-4K';
        else if (vc.is3d && count3d === max(cutSorts.size, 1) && (count2k > 0 || count4k > 0))
          cut += '-3D';
        else if ((vc.isFHD || vc.is2k) && count2k === max(cutSorts.size, 1) && (count3d > 0 || count4k > 0))
          cut += (count3d && !count4k ? '2D' : '2K');

        if (cut)
          return cut.replace(/^-/, '');

        return String.fromCharCode(65 + i);
      });

      if (episodes.size && (countOSE === episodes.size || (count4k > 0 && count4k === count2k))) {
        if (countOSE > 0)
          this.categoryLabels = ['Updated FX', 'Original FX'];
        else
          this.categoryLabels = ['4K', '2K'];

        this.videoChoices = [
          this.choices.filter((_vc, i) => i % 2 === 0),
          this.choices.filter((_vc, i) => i % 2 === 1)
        ];
        this.videoLabels = this.videoLabels.filter((_vl, i) => i % 2 === 0);
      }
      else
        this.videoChoices = [this.choices];

      this.videoIndex = keepIndex >= 0 ? keepIndex : max(this.videoChoices[0].findIndex(vc => !vc.watchedByUser), 0);
      this.video = this.videoChoices[0][this.videoIndex];
      this.selection = this.video.parent ?? this.video;
      this.selectVideo(this.videoIndex);
      this.getPlaybackInfo();
    }
  }

  @Input() get playSrc(): ItemStreamPair { return this._playSrc; }
  set playSrc(value: ItemStreamPair) {
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
    return (nfe(this.video?.extras) || nfe(this.video?.parent?.extras) || nfe(this.show?.extras) ||
            nfe(this.show?.parent?.extras) || []).length > 0;
  }

  hasYear(): boolean {
    return this.show.year && isMovie(this.show);
  }

  hasAirDate(): boolean {
    return this.selection?.airDate && isTvSeason(this.show) && !this.hasYear();
  }

  getDuration(): string {
    return this.video ? round((this.video.duration || this.video.parent.duration) / 60) + ' minutes' : '';
  }

  getVoteAverage(): number {
    return this.video?.voteAverage || this.show?.voteAverage;
  }

  getGenres(): string {
    if (this.show.genres?.length > 0)
      return this.show?.genres.join(', ') || '';
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
    this.streamUri = this.auth.isDemo() ? this.video.sampleUri :
      canPlayVP9() ? this.video.streamUri : this.video.mobileUri;

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
          areImagesSimilar(img, this.backgroundMain).then(similar => this.identicalThumbnail = similar);
          this.thumbnail = newBackground;
          this.thumbnailNaturalWidth = img.naturalWidth;
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
      this.playSrc = { item: this.video, stream: this.streamUri };
  }

  closePlayer(): void {
    this.playSrc = undefined;
    this.getPlaybackInfo();
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
    return this.auth.getSession()?.role === 'admin' && StatusInterceptor.localAccess;
  }

  demo(): boolean {
    return this.auth.getSession()?.role === 'demo';
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
    const videoTrack = (v.video || [])[0];
    const codecs = new Set<string>();
    const combos = new Set<string>();

    this.badgeExtras = [];

    if (!v)
      return;
    else if (v.is4k)
      b.push('4K-UHD');
    else if (v.is3d)
      b.push('3D');
    else if (v.is2k || v.isFHD)
      b.push('2K');
    else if (v.isHD)
      b.push('720p');

    if (videoTrack?.codec)
      b.push(videoTrack.codec.replace(/\s+.*$/, ''));

    if (v.hdr)
      b.push(v.hdr);

    if (videoTrack?.frameRate) {
      this.badgeExtras[b.length] = toMaxFixed(videoTrack.frameRate, 3).split('.');
      b.push('FR');
    }

    if (v.aspectRatio)
      b.push(v.aspectRatio);

    for (let i = 0; i < v.audio?.length || 0; ++i) {
      const a = v.audio[i];
      let codec = a?.codec || '';
      let chan = a?.channels || '';
      const stereo = /\bstereo\b/i.test(chan);
      let extra: string[];
      let text: string;

      if (codec === 'DTS-HD MA')
        codec = 'DTS-HD';
      else if (/\bmpeg\b/i.test(codec))
        codec = 'MP3';
      else if (/^ac-?3$/i.test(codec))
        codec = 'DD';

      if (/^stereo$/i.test(chan) && /\bmono\b/i.test(a.name))
        chan = 'Mono';

      if (codec === 'TrueHD') {
        if (chan === 'Atmos')
          text = 'Atmos';
        else if (!stereo)
          extra = [chan];
      }
      else if (codec === 'DTS-HD' || codec === 'DTS-X') {
        text = codec;

        if (!stereo)
          extra = [chan];
      }
      else if (codec) {
        if (!codecs.has(codec) && a.language === v.audio[0].language)
          text = codec + (stereo ? '' : (chan && (i === 0 || /\bmono\b/i.test(chan) ?
            (chan === 'Atmos' ? '\n' : ' ') + chan : '')));

        codecs.add(codec);
      }
      else if (chan && i === 0)
        text = chan;

      const combo = [text, ...(extra ?? [])].join();

      if (text && text !== 'DD' && !combos.has(combo)) {
        this.badgeExtras[b.length] = extra;
        b.push(text);
        combos.add(combo);
      }
    }

    if (v.defaultSubtitles)
      b.push('DS');

    if (v.commentaryAudio)
      b.push('AC');

    if (v.commentaryText)
      b.push('TC');
  }

  getPlaybackInfo(): void {
    const videos = this.choices.filter(c => c.streamUri).map(c => hashUri(c.streamUri)).join();

    this.httpClient.get(`/api/stream/progress?videos=${encodeForUri(videos)}`).subscribe((response: PlaybackProgress[]) => {
      for (const item of this.choices) {
        const hash = item.streamUri && hashUri(item.streamUri);
        const match = hash && response.find(row => row.hash === hash);

        if (match) {
          item.duration = item.duration || match.duration;
          item.lastUserWatchTime = match.last_watched;
          item.positionUser = match.offset;
          item.watchedByUser = match.watched;
        }
        else {
          item.lastUserWatchTime = -1;
          item.positionUser = 0;
          item.watchedByUser = false;
        }
      }
    });
  }
}

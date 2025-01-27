import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { formatSecondsToDays, formatSize, webSocketMessagesEmitter } from '../video-ui-utils';
import { HttpClient } from '@angular/common/http';
import { ServerStatus, VideoStats } from '../../../server/src/shared-types';
import { clone } from '@tubular/util';
import { ConfirmationService } from 'primeng/api';
import { repoll } from '../app.component';

@Component({
  selector: 'app-admin-view',
  templateUrl: './admin-view.component.html',
  styleUrls: ['./admin-view.component.scss']
})
export class AdminViewComponent implements OnInit {
  readonly formatSecondsToDays = formatSecondsToDays;
  readonly formatSize = formatSize;

  private statusTimer: any;

  constructor(private httpClient: HttpClient, private confirmationService: ConfirmationService) {}

  options: Record<string, any> = { // TODO: better typing
    earliest: new Date(Date.now() - 86_400_000 * 7)
  };

  currentFile = '';
  encodeProgress = '';
  indeterminate = false;
  lastStatus: ServerStatus;
  listToShow: string[];
  setEarliest = false;
  showRefreshDialog = false;
  stopPending = false;
  updateProgress = -1;
  videoStats: VideoStats;

  @Input() status: ServerStatus;

  @Output() goBack: EventEmitter<void> = new EventEmitter();

  ngOnInit(): void {
    webSocketMessagesEmitter().subscribe(msg => {
      switch (msg.type) {
        case 'audio-progress':
          this.encodeProgress = 'Audio: ' + msg.data;
          break;

        case 'currentFile':
          this.currentFile = msg.data;
          this.encodeProgress = '';
          break;

        case 'status':
          if (this.statusTimer) {
            clearInterval(this.statusTimer);
            this.statusTimer = undefined;
          }

          this.indeterminate = false;
          this.lastStatus = (msg.data as ServerStatus);
          this.updateProcessSettings();
          this.currentFile = this.lastStatus.currentFile;
          this.stopPending = this.lastStatus.stopPending;
          this.updateProgress = this.lastStatus.updateProgress;
          this.encodeProgress = this.lastStatus.encodeProgress;
          break;

        case 'video-progress':
          this.encodeProgress = msg.data;
          break;

        case 'videoStatsProgress':
          this.updateProgress = msg.data;
          break;

        case 'videoStats':
          this.videoStats = (msg.data as VideoStats);
          this.currentFile = this.lastStatus?.currentFile || '';
          this.encodeProgress = '';
          break;
      }
    });

    this.httpClient.get('/api/admin/stats').subscribe((stats: VideoStats) => {
      this.videoStats = stats;
      this.updateProcessSettings();
      repoll();
    });

    document.body.addEventListener('click', evt => {
      if (this.listToShow) {
        const list = document.getElementById('show-list');
        let target = evt.target;

        while (target) {
          if (target === list)
            return;
          else
            target = (target as HTMLElement).parentElement;
        }

        this.listToShow = null;
        evt.stopPropagation();
      }
    }, true);

    document.body.addEventListener('keydown', evt => {
      if (this.listToShow && evt.key === 'Escape') {
        this.listToShow = null;
        evt.stopPropagation();
      }
    }, true);
  }

  refresh(quick = false): void {
    this.showRefreshDialog = false;
    this.updateProgress = 0;
    this.awaitFeedback();
    this.httpClient.post(`/api/admin/library-refresh${quick ? '?quick=true' : ''}`, null).subscribe();
  }

  refreshInventory(): void {
    this.updateProgress = 0;
    this.awaitFeedback();
    this.httpClient.get('/api/admin/stats?update=true').subscribe((stats: VideoStats) => this.videoStats = stats);
  }

  updateProcessSettings(): void {
    if (this.lastStatus?.processing && this.lastStatus.processArgs) {
      const pa = this.lastStatus.processArgs;
      const options = {
        generateFallbackAudio: pa.fallback,
        generateStreaming: pa.streaming,
        mkvFlags: pa.mkvFlags,
        mkvFlagsDryRun: pa.mkvFlagsDryRun,
        mkvFlagsUpdateBackups: pa.mkvFlagsUpdateBackups,
        skipExtras: pa.skipExtras,
        skipMovies: pa.skipMovies,
        skipTv: pa.skipTv,
        validate: pa.validate
      } as any;

      if (pa.earliest) {
        options.earliest = new Date(pa.earliest);
        this.setEarliest = true;
      }
      else {
        options.earliest = undefined;
        this.setEarliest = false;
      }

      if (pa.start)
        options.walkStart = pa.start;

      if (pa.stop)
        options.walkStop = pa.stop;

      this.options = options;
    }
  }

  isProcessing(): boolean {
    return this.status?.processing || this.indeterminate;
  }

  runProcess(): void {
    const options = clone(this.options);

    if (options.walkStart)
      options.walkStart = options.walkStart.trim();
    else
      delete options.walkStart;

    if (options.walkStop)
      options.walkStop = options.walkStop.trim();
    else
      delete options.walkStop;

    if (!this.setEarliest)
      delete options.earliest;

    this.awaitFeedback();
    this.httpClient.post('/api/admin/process', options, { responseType: 'text' }).subscribe();
  }

  sendStop(): void {
    if (this.status?.processing && !this.stopPending)
      this.confirmationService.confirm({
        message: 'Are you sure you want to stop the current process?',
        header: 'Stop Process',
        icon: 'pi pi-exclamation-triangle',
        accept: () => {
          this.httpClient.post('/api/admin/stop', null).subscribe();
        }
      });
  }

  private awaitFeedback(): void {
    this.indeterminate = true;
    this.statusTimer = setInterval(repoll, 1000);
  }
}

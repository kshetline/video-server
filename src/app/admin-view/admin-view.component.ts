import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { formatSize, webSocketMessagesEmitter } from '../video-ui-utils';
import { HttpClient } from '@angular/common/http';
import { ServerStatus, VideoStats } from '../../../server/src/shared-types';
import { clone } from '@tubular/util';
import { characterToProgress } from '../../../server/src/shared-utils';

@Component({
  selector: 'app-admin-view',
  templateUrl: './admin-view.component.html',
  styleUrls: ['./admin-view.component.scss']
})
export class AdminViewComponent implements OnInit {
  readonly formatSize = formatSize;

  constructor(private httpClient: HttpClient) {}

  options: Record<string, any> = { // TODO: better typing
    earliest: new Date(Date.now() - 86_400_000 * 7)
  };

  currentFile = '';
  encodeProgress = '';
  setEarliest = false;
  showRefreshDialog = false;
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
          this.currentFile = (msg.data as ServerStatus).currentFile;
          this.updateProgress = (msg.data as ServerStatus).updateProgress;
          break;

        case 'video-progress':
          this.encodeProgress = msg.data;
          break;

        case 'videoStatsProgress':
          this.updateProgress = characterToProgress(msg.data);
          break;

        case 'videoStats':
          this.videoStats = (msg.data as VideoStats);
          this.updateProgress = -1;
          this.currentFile = '';
          this.encodeProgress = '';
          break;
      }
    });

    this.httpClient.get('/api/admin/stats').subscribe((stats: VideoStats) => this.videoStats = stats);
  }

  refresh(quick = false): void {
    this.showRefreshDialog = false;
    this.updateProgress = 0;
    this.httpClient.post(`/api/admin/library-refresh${quick ? '?quick=true' : ''}`, null).subscribe();
  }

  refreshInventory(): void {
    this.updateProgress = 0;
    this.httpClient.get('/api/admin/stats?update=true').subscribe((stats: VideoStats) => this.videoStats = stats);
  }

  runProcess(): void {
    const options = clone(this.options);

    if (!this.setEarliest)
      delete options.earliest;

    this.httpClient.post('/api/admin/process', options).subscribe();
  }
}

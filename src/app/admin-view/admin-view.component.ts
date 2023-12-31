import { Component, EventEmitter, OnInit, Output } from '@angular/core';
import { formatSize, webSocketMessagesEmitter } from '../video-ui-utils';
import { HttpClient } from '@angular/common/http';
import { ServerStatus, VideoStats } from '../../../server/src/shared-types';

@Component({
  selector: 'app-admin-view',
  templateUrl: './admin-view.component.html',
  styleUrls: ['./admin-view.component.scss']
})
export class AdminViewComponent implements OnInit {
  readonly formatSize = formatSize;

  constructor(private httpClient: HttpClient) {}

  inventoryProgress = -1;
  showRefreshDialog = false;
  updateProgress = -1;
  videoStats: VideoStats;

  @Output() goBack: EventEmitter<void> = new EventEmitter();

  ngOnInit(): void {
    webSocketMessagesEmitter().subscribe(msg => {
      switch (msg.type) {
        case 'status':
          this.updateProgress = (msg.data as ServerStatus).updateProgress;
          break;

        case 'videoStatsProgress':
          if (msg.data <= '9')
            this.inventoryProgress = 3.57;
          else if (msg.data >= 'A')
            this.inventoryProgress = (msg.data.toString().charCodeAt(0) - 63) * 3.57;

          break;

        case 'videoStats':
          this.videoStats = (msg.data as VideoStats);
          this.inventoryProgress = -1;
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
    this.inventoryProgress = 0;
    this.httpClient.get('/api/admin/stats?update=true').subscribe((stats: VideoStats) => this.videoStats = stats);
  }
}

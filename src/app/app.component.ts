import { AfterViewInit, Component, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { VideoLibrary, LibraryItem, ServerStatus, VType } from '../../server/src/shared-types';
import { addBackLinks } from './video-ui-utils';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent implements AfterViewInit, OnInit {
  private canPoll = false;
  private gettingLibrary = false;

  currentCollection: LibraryItem;
  currentShow: LibraryItem;
  library: VideoLibrary;
  status: ServerStatus;

  constructor(private httpClient: HttpClient) {}

  ngOnInit(): void {
    navigator.serviceWorker.register('/assets/service.js').then(reg =>
      console.log('Service worker registration succeeded:', reg))
      .catch(err => {
        console.error('Service worker registration failed:', err);
        this.pollStatus();
      });
  }

  ngAfterViewInit(): void {
    this.pollLibrary();
    this.httpClient.get('/api/status').subscribe({
      next: (status: ServerStatus) => this.status = status,
      complete: () => this.canPoll = true
    });
  }

  itemClicked(item: LibraryItem): void {
    if (item?.type === VType.COLLECTION || item?.type === VType.TV_SHOW || item?.type === VType.TV_COLLECTION)
      this.currentCollection = item;
    else if (item?.type === VType.MOVIE || item?.type === VType.TV_SEASON)
      this.currentShow = item;
  }

  private pollLibrary(): void {
    if (this.gettingLibrary)
      return;

    this.gettingLibrary = true;
    this.httpClient.get('/api/library').subscribe({
      next: (library: VideoLibrary) => {
        addBackLinks(library.array);
        this.library = library;
      },
      complete: () => this.gettingLibrary = false
    });
  }

  private pollStatus = (): void => {
    if (!this.canPoll)
      setTimeout(() => this.pollStatus(), 100);
    else {
      this.httpClient.get('/api/status').subscribe({
        next: (status: ServerStatus) => {
          this.status = status;

          if (this.library && status.lastUpdate && new Date(this.library.lastUpdate) < new Date(status.lastUpdate))
            this.pollLibrary();

          setTimeout(() => this.pollStatus(), this.status.updateProgress < 0 ? 60000 : 1000);
        },
        error: () => setTimeout(() => this.pollStatus(), 100)
      });
    }
  };
}

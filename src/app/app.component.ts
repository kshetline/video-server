import { AfterViewInit, Component, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { VideoLibrary, LibraryItem, ServerStatus, VType } from '../../server/src/shared-types';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent implements AfterViewInit, OnInit {
  private canPoll = false;

  currentCollection: LibraryItem;
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
    this.httpClient.get('/api/library').subscribe((library: VideoLibrary) => {
      this.library = library;
    });
    this.httpClient.get('/api/status').subscribe({
      next: (status: ServerStatus) => this.status = status,
      complete: () => this.canPoll = true
    });
  }

  itemClicked(item: LibraryItem): void {
    console.log(item.name);
    if (item?.type === VType.COLLECTION)
      this.currentCollection = item;
  }

  private pollStatus = (): void => {
    if (!this.canPoll)
      setTimeout(() => this.pollStatus(), 100);
    else {
      this.httpClient.get('/api/status').subscribe({
        next: (status: ServerStatus) => {
          this.status = status;
          setTimeout(() => this.pollStatus(), this.status.updateProgress < 0 ? 60000 : 1000);
        },
        error: () => setTimeout(() => this.pollStatus(), 100)
      });
    }
  };
}

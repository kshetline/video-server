import { AfterViewInit, Component, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Collection, CollectionItem, ServerStatus, VType } from '../../server/src/shared-types';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent implements AfterViewInit, OnInit {
  private canPoll = false;

  collection: Collection;
  currentCollection: CollectionItem;
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
    this.httpClient.get('/api/collection').subscribe((collection: Collection) => {
      this.collection = collection;
    });
    this.httpClient.get('/api/status').subscribe({
      next: (status: ServerStatus) => this.status = status,
      complete: () => this.canPoll = true
    });
  }

  itemClicked(item: CollectionItem): void {
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

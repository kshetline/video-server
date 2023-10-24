import { AfterViewInit, Component, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Collection } from '../../server/src/shared-types';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent implements AfterViewInit, OnInit {
  collection: Collection;

  constructor(private httpClient: HttpClient) {}

  ngOnInit(): void {
    navigator.serviceWorker.register('/assets/service.js').then(reg =>
      console.log('Service worker registration succeeded:', reg))
      .catch(err => console.error('Service worker registration failed:', err));
  }

  ngAfterViewInit(): void {
    this.httpClient.get('/api/collection').subscribe((collection: Collection) => {
      this.collection = collection;
    });
  }
}

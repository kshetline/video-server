import { AfterViewInit, Component } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Collection } from '../../server/src/shared-types';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent implements AfterViewInit {
  collection: Collection;

  constructor(private httpClient: HttpClient) {}

  ngAfterViewInit(): void {
    this.httpClient.get('/api/collection').subscribe((collection: Collection) => {
      this.collection = collection;
    });
  }
}

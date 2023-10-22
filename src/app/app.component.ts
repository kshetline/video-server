import { AfterViewInit, Component } from '@angular/core';
import { HttpClient } from '@angular/common/http';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent implements AfterViewInit {
  count = 0;

  constructor(private httpClient: HttpClient) {}

  ngAfterViewInit(): void {
    this.httpClient.get('/api/collection').subscribe((collection: any) => {
      this.count = collection.mainFileCount + collection.bonusFileCount;
    });
  }
}

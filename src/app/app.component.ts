import { AfterViewInit, Component, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Collection, CollectionItem } from '../../server/src/shared-types';

export function checksum53(s: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;

  for (let i = 0, ch; i < s.length; ++i) {
    ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }

  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);

  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).toUpperCase().padStart(14, '0');
}

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent implements AfterViewInit, OnInit {
  collection: Collection;
  intersectionObserver: IntersectionObserver;
  items: CollectionItem[];
  mutationObserver: MutationObserver;

  constructor(private httpClient: HttpClient) {}

  ngOnInit(): void {
    this.intersectionObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting && !entry.target.querySelector('img')) {
          const div = entry.target as HTMLDivElement;
          const id = div.getAttribute('data-id');
          const name = div.getAttribute('data-name');
          const img = document.createElement('img');

          img.src = `/api/poster?id=${id}&cs=${checksum53(name)}&w=150&h=225`;
          img.width = 150;
          img.height = 225;
          img.alt = name;
          div.appendChild(img);
        }
      });
    });

    this.mutationObserver = new MutationObserver((mutationList, _observer) => {
      mutationList.forEach(mr => {
        if (mr.type === 'childList') {
          mr.addedNodes.forEach(node => {
            const imageWrapper = (node as HTMLElement).querySelector('.poster-thumbnail-wrapper');

            if (imageWrapper)
              this.intersectionObserver.observe(imageWrapper);
          });
        }
      });
    });

    this.mutationObserver.observe(document.body, { childList: true, subtree: true });
  }

  ngAfterViewInit(): void {
    this.httpClient.get('/api/collection').subscribe((collection: Collection) => {
      this.collection = collection;
      this.items = collection.array;
    });
  }
}

import { Component, Input, OnInit } from '@angular/core';
import { Collection, CollectionItem, VType } from '../../../server/src/shared-types';
import { checksum53 } from '../video-ui-utils';

@Component({
  selector: 'app-poster-view',
  templateUrl: './poster-view.component.html',
  styleUrls: ['./poster-view.component.scss']
})
export class PosterViewComponent implements OnInit {
  COLLECTION = VType.COLLECTION;

  private _collection: Collection;

  intersectionObserver: IntersectionObserver;
  items: CollectionItem[];
  mutationObserver: MutationObserver;
  overview = '';

  @Input() get collection(): Collection { return this._collection; }
  set collection(newValue : Collection) {
    if (this._collection !== newValue) {
      this._collection = newValue;
      this.items = newValue?.array;
    }
  }

  ngOnInit(): void {
    this.intersectionObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting && !entry.target.querySelector('img')) {
          const div = entry.target as HTMLDivElement;
          const id = div.getAttribute('data-id');
          const name = div.getAttribute('data-name');
          const img = document.createElement('img');

          img.src = `/api/poster?id=${id}&cs=${checksum53(name)}&w=300&h=450`;
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
            const imageWrappers = (node as HTMLElement).querySelectorAll &&
              (node as HTMLElement).querySelectorAll('.poster-thumbnail-wrapper');

            if (imageWrappers)
              imageWrappers.forEach(iw => this.intersectionObserver.observe(iw));
          });

          mr.removedNodes.forEach(node => {
            const imageWrappers = (node as HTMLElement).querySelectorAll &&
              (node as HTMLElement).querySelectorAll('.poster-thumbnail-wrapper');

            if (imageWrappers)
              imageWrappers.forEach(iw => this.intersectionObserver.unobserve(iw));
          });
        }
      });
    });

    this.mutationObserver.observe(document.body, { childList: true, subtree: true });
  }
}

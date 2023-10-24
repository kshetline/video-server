import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CollectionItem } from '../../../server/src/shared-types';

@Component({
  selector: 'app-collection-view',
  templateUrl: './collection-view.component.html',
  styleUrls: ['./collection-view.component.scss']
})
export class CollectionViewComponent {
  @Input() collection: CollectionItem;
  @Output() goBack: EventEmitter<void> = new EventEmitter();
}

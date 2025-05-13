import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-rating',
  templateUrl: './rating.component.html',
  styleUrls: ['./rating.component.scss'],
  standalone: false
})
export class RatingComponent {
  @Input() value = 0;
  @Input() stars = 5;
  @Input() topValue = 5;
}

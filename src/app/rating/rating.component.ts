import { Component, Input } from '@angular/core';
import { NgFor } from '@angular/common';

@Component({
  selector: 'app-rating',
  templateUrl: './rating.component.html',
  styleUrls: ['./rating.component.scss'],
  imports: [NgFor]
})
export class RatingComponent {
  @Input() value = 0;
  @Input() stars = 5;
  @Input() topValue = 5;
}

import { Directive, ElementRef, EventEmitter, Input, OnDestroy, OnInit, Output } from '@angular/core';
import { Subscription } from 'rxjs/internal/Subscription';
import { fromEvent } from 'rxjs/internal/observable/fromEvent';
import { switchMap, takeUntil, timer } from 'rxjs';

@Directive({
  selector: '[longPress]',
})
export class LongPressDirective implements OnInit, OnDestroy {
  @Input() duration = 500;
  @Output() longPress = new EventEmitter<void>();

  sub!: Subscription;

  constructor(private el: ElementRef) {}

  ngOnInit(): void {
    const mouseDown$ = fromEvent(this.el.nativeElement, 'mousedown');
    const mouseUp$ = fromEvent(this.el.nativeElement, 'mouseup');
    this.sub = mouseDown$
      .pipe(switchMap(() => timer(this.duration).pipe(takeUntil(mouseUp$))))
      .subscribe(() => this.longPress.emit());
  }

  ngOnDestroy(): void {
    this.sub.unsubscribe();
  }
}

import { Directive, ElementRef, EventEmitter, Input, OnDestroy, OnInit, Output } from '@angular/core';
import { Subscription } from 'rxjs/internal/Subscription';
import { fromEvent } from 'rxjs/internal/observable/fromEvent';
import { merge, switchMap, takeUntil, tap, timer } from 'rxjs';

@Directive({
  selector: '[longPress]',
})
export class LongPressDirective implements OnInit, OnDestroy {
  private endSub!: Subscription;
  private pressSub!: Subscription;

  @Input() duration = 750;

  @Output() longStart = new EventEmitter<void>();
  @Output() longPress = new EventEmitter<void>();
  @Output() longEnd = new EventEmitter<void>();

  constructor(private el: ElementRef) {}

  ngOnInit(): void {
    const start$ = merge(fromEvent(this.el.nativeElement, 'mousedown'),
                         fromEvent(this.el.nativeElement, 'touchstart'));
    const end$ = merge(fromEvent(this.el.nativeElement, 'mouseup'),
                       fromEvent(this.el.nativeElement, 'touchend'),
                       fromEvent(this.el.nativeElement, 'mouseleave'));

    this.endSub = end$.subscribe(() => this.longEnd.emit());
    this.pressSub = start$
      .pipe(tap(() => this.longStart.emit()))
      .pipe(switchMap(() => timer(this.duration).pipe(takeUntil(end$))))
      .subscribe(() => this.longPress.emit());
  }

  ngOnDestroy(): void {
    this.endSub.unsubscribe();
    this.pressSub.unsubscribe();
  }
}

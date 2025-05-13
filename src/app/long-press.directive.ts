import { Directive, ElementRef, EventEmitter, Input, OnDestroy, OnInit, Output } from '@angular/core';
import { Subscription } from 'rxjs/internal/Subscription';
import { fromEvent } from 'rxjs/internal/observable/fromEvent';
import { filter, merge, switchMap, takeUntil, tap, timer } from 'rxjs';

@Directive({
  selector: '[longPress]',
  standalone: false
})
export class LongPressDirective implements OnInit, OnDestroy {
  readonly elem: HTMLElement;

  private endSub!: Subscription;
  private pressSub!: Subscription;

  @Input() duration = 750;

  @Output() longStart = new EventEmitter<void>();
  @Output() longPress = new EventEmitter<void>();
  @Output() longEnd = new EventEmitter<void>();
  @Output() metaClick = new EventEmitter<void>();

  private press = (evt: MouseEvent): void => evt.metaKey ? this.longPress.emit() : null;

  constructor(el: ElementRef) {
    this.elem = el.nativeElement;
  }

  ngOnInit(): void {
    const start$ = merge(fromEvent(this.elem, 'mousedown').pipe(filter((e: MouseEvent) => e.button === 0)),
                         fromEvent(this.elem, 'touchstart'));
    const end$ = merge(fromEvent(this.elem, 'mouseup'),
                       fromEvent(this.elem, 'touchend'),
                       fromEvent(this.elem, 'mouseleave'),
                       fromEvent(this.elem, 'touchcancel'));

    this.endSub = end$.subscribe(() => this.longEnd.emit());
    this.pressSub = start$
      .pipe(tap(() => this.longStart.emit()))
      .pipe(switchMap(() => timer(this.duration).pipe(takeUntil(end$))))
      .subscribe(() => this.longPress.emit());

    this.elem.addEventListener('click', this.press);
  }

  ngOnDestroy(): void {
    this.endSub.unsubscribe();
    this.pressSub.unsubscribe();
    this.elem.removeEventListener('click', this.press);
  }
}

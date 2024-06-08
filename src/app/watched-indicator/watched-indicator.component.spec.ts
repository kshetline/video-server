import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WatchedIndicatorComponent } from './watched-indicator.component';

describe('WatchedIndicatorComponent', () => {
  let component: WatchedIndicatorComponent;
  let fixture: ComponentFixture<WatchedIndicatorComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [WatchedIndicatorComponent]
    })
      .compileComponents();

    fixture = TestBed.createComponent(WatchedIndicatorComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

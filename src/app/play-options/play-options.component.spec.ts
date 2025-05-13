import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PlayOptionsComponent } from './play-options.component';

describe('PlayOptionsComponent', () => {
  let component: PlayOptionsComponent;
  let fixture: ComponentFixture<PlayOptionsComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [PlayOptionsComponent]
    });
    fixture = TestBed.createComponent(PlayOptionsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

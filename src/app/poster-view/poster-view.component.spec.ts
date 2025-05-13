import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PosterViewComponent } from './poster-view.component';

describe('PosterViewComponent', () => {
  let component: PosterViewComponent;
  let fixture: ComponentFixture<PosterViewComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PosterViewComponent]
    })
      .compileComponents();

    fixture = TestBed.createComponent(PosterViewComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

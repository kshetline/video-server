import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ShowViewComponent } from './show-view.component';

describe('ShowViewComponent', () => {
  let component: ShowViewComponent;
  let fixture: ComponentFixture<ShowViewComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ShowViewComponent]
    })
      .compileComponents();

    fixture = TestBed.createComponent(ShowViewComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

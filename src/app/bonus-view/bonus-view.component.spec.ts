import { ComponentFixture, TestBed } from '@angular/core/testing';

import { BonusViewComponent } from './bonus-view.component';

describe('BonusViewComponent', () => {
  let component: BonusViewComponent;
  let fixture: ComponentFixture<BonusViewComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BonusViewComponent]
    })
      .compileComponents();

    fixture = TestBed.createComponent(BonusViewComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

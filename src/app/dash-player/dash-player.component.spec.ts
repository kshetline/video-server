import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DashPlayerComponent } from './dash-player.component';

describe('DashPlayerComponent', () => {
  let component: DashPlayerComponent;
  let fixture: ComponentFixture<DashPlayerComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [DashPlayerComponent]
    })
      .compileComponents();

    fixture = TestBed.createComponent(DashPlayerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

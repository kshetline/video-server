import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CollectionViewComponent } from './collection-view.component';

describe('CollectionViewComponent', () => {
  let component: CollectionViewComponent;
  let fixture: ComponentFixture<CollectionViewComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CollectionViewComponent]
    })
      .compileComponents();

    fixture = TestBed.createComponent(CollectionViewComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

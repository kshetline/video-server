import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { HttpClientJsonpModule, HttpClientModule } from '@angular/common/http';
import { NgOptimizedImage } from '@angular/common';

import { AppComponent } from './app.component';
import { BonusViewComponent } from './bonus-view/bonus-view.component';
import { ButtonModule } from 'primeng/button';
import { CollectionViewComponent } from './collection-view/collection-view.component';
import { InputTextModule } from 'primeng/inputtext';
import { PosterViewComponent } from './poster-view/poster-view.component';
import { RadioButtonModule } from 'primeng/radiobutton';
import { RatingComponent } from './rating/rating.component';
import { TooltipModule } from 'primeng/tooltip';
import { ShowViewComponent } from './show-view/show-view.component';

@NgModule({
  declarations: [
    AppComponent,
    BonusViewComponent,
    PosterViewComponent,
    CollectionViewComponent,
    ShowViewComponent,
    RatingComponent,
  ],
  imports: [
    BrowserModule,
    ButtonModule,
    FormsModule,
    HttpClientModule,
    HttpClientJsonpModule,
    InputTextModule,
    NgOptimizedImage,
    RadioButtonModule,
    TooltipModule
  ],
  providers: [],
  bootstrap: [AppComponent]
})

export class AppModule { }

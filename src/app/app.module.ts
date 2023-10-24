import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { HttpClientJsonpModule, HttpClientModule } from '@angular/common/http';

import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { ButtonModule } from 'primeng/button';
import { CollectionViewComponent } from './collection-view/collection-view.component';
import { InputTextModule } from 'primeng/inputtext';
import { PosterViewComponent } from './poster-view/poster-view.component';
import { RadioButtonModule } from 'primeng/radiobutton';
import { RatingModule } from 'primeng/rating';
import { TooltipModule } from 'primeng/tooltip';
import { ShowViewComponent } from './show-view/show-view.component';

@NgModule({
  declarations: [
    AppComponent,
    PosterViewComponent,
    CollectionViewComponent,
    ShowViewComponent
  ],
  imports: [
    AppRoutingModule,
    BrowserModule,
    ButtonModule,
    FormsModule,
    HttpClientModule,
    HttpClientJsonpModule,
    InputTextModule,
    RadioButtonModule,
    RatingModule,
    TooltipModule
  ],
  providers: [],
  bootstrap: [AppComponent]
})

export class AppModule { }

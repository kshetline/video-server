import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { HTTP_INTERCEPTORS, HttpClientJsonpModule, HttpClientModule } from '@angular/common/http';
import { NgOptimizedImage } from '@angular/common';

import { AppComponent } from './app.component';
import { BonusViewComponent } from './bonus-view/bonus-view.component';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { ButtonModule } from 'primeng/button';
import { CollectionViewComponent } from './collection-view/collection-view.component';
import { InputTextModule } from 'primeng/inputtext';
import { PasswordModule } from 'primeng/password';
import { PosterViewComponent } from './poster-view/poster-view.component';
import { RadioButtonModule } from 'primeng/radiobutton';
import { RatingComponent } from './rating/rating.component';
import { TooltipModule } from 'primeng/tooltip';
import { ShowViewComponent } from './show-view/show-view.component';
import { AuthInterceptor } from './auth-interceptor';
import { LoginComponent } from './login/login.component';

@NgModule({
  declarations: [
    AppComponent,
    BonusViewComponent,
    PosterViewComponent,
    CollectionViewComponent,
    ShowViewComponent,
    RatingComponent,
    LoginComponent,
  ],
  imports: [
    BrowserAnimationsModule,
    BrowserModule,
    ButtonModule,
    FormsModule,
    HttpClientModule,
    HttpClientJsonpModule,
    InputTextModule,
    NgOptimizedImage,
    PasswordModule,
    RadioButtonModule,
    TooltipModule
  ],
  providers: [
    { provide: HTTP_INTERCEPTORS, useClass: AuthInterceptor, multi: true }
  ],
  bootstrap: [AppComponent]
})

export class AppModule { }

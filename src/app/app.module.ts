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
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DashPlayerComponent } from './dash-player/dash-player.component';
import { DialogModule } from 'primeng/dialog';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { InputTextModule } from 'primeng/inputtext';
import { LoginComponent } from './login/login.component';
import { PasswordModule } from 'primeng/password';
import { PosterViewComponent } from './poster-view/poster-view.component';
import { ProgressBarModule } from 'primeng/progressbar';
import { RadioButtonModule } from 'primeng/radiobutton';
import { RatingComponent } from './rating/rating.component';
import { ToastModule } from 'primeng/toast';
import { TooltipModule } from 'primeng/tooltip';
import { ShowViewComponent } from './show-view/show-view.component';
import { StatusInterceptor } from './status.service';

@NgModule({
  declarations: [
    AppComponent,
    BonusViewComponent,
    CollectionViewComponent,
    DashPlayerComponent,
    LoginComponent,
    PosterViewComponent,
    RatingComponent,
    ShowViewComponent
  ],
  imports: [
    BrowserAnimationsModule,
    BrowserModule,
    ButtonModule,
    ConfirmDialogModule,
    DialogModule,
    FontAwesomeModule,
    FormsModule,
    HttpClientModule,
    HttpClientJsonpModule,
    InputTextModule,
    NgOptimizedImage,
    PasswordModule,
    ProgressBarModule,
    RadioButtonModule,
    ToastModule,
    TooltipModule
  ],
  providers: [
    { provide: HTTP_INTERCEPTORS, useClass: StatusInterceptor, multi: true }
  ],
  bootstrap: [AppComponent]
})

export class AppModule {}

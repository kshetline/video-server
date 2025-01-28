import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { HTTP_INTERCEPTORS, provideHttpClient, withInterceptorsFromDi, withJsonpSupport } from '@angular/common/http';
import { NgOptimizedImage } from '@angular/common';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';

import { AppComponent } from './app.component';
import { BonusViewComponent } from './bonus-view/bonus-view.component';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { CollectionViewComponent } from './collection-view/collection-view.component';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DashPlayerComponent } from './dash-player/dash-player.component';
import { DatePickerModule } from 'primeng/datepicker';
import { DialogModule } from 'primeng/dialog';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { IconField } from 'primeng/iconfield';
import { InputIcon } from 'primeng/inputicon';
import { InputTextModule } from 'primeng/inputtext';
import { LoginComponent } from './login/login.component';
import { PasswordModule } from 'primeng/password';
import { PosterViewComponent } from './poster-view/poster-view.component';
import { ProgressBarModule } from 'primeng/progressbar';
import { RadioButtonModule } from 'primeng/radiobutton';
import { RatingComponent } from './rating/rating.component';
import { SelectModule } from 'primeng/select';
import { SplitButtonModule } from 'primeng/splitbutton';
import { TreeModule } from 'primeng/tree';
import { TreeSelectModule } from 'primeng/treeselect';
import { ToastModule } from 'primeng/toast';
import { TooltipModule } from 'primeng/tooltip';
import { ShowViewComponent } from './show-view/show-view.component';
import { StatusInterceptor } from './status.service';
import { AdminViewComponent } from './admin-view/admin-view.component';
import { WatchedIndicatorComponent } from './watched-indicator/watched-indicator.component';
import { LongPressDirective } from './long-press.directive';
import { PlayOptionsComponent } from './play-options/play-options.component';
import { appConfig } from './mytheme';

@NgModule({
  declarations: [
    AdminViewComponent,
    AppComponent,
    BonusViewComponent,
    CollectionViewComponent,
    DashPlayerComponent,
    LoginComponent,
    LongPressDirective,
    PosterViewComponent,
    RatingComponent,
    ShowViewComponent,
    WatchedIndicatorComponent,
    PlayOptionsComponent
  ],
  bootstrap: [AppComponent],
  imports: [
    BrowserAnimationsModule,
    BrowserModule,
    ButtonModule,
    CheckboxModule,
    ConfirmDialogModule,
    DatePickerModule,
    DialogModule,
    FontAwesomeModule,
    FormsModule,
    IconField,
    InputIcon,
    InputTextModule,
    NgOptimizedImage,
    PasswordModule,
    ProgressBarModule,
    RadioButtonModule,
    SelectModule,
    SplitButtonModule,
    ToastModule,
    TooltipModule,
    TreeModule,
    TreeSelectModule
  ],
  providers: [
    { provide: HTTP_INTERCEPTORS, useClass: StatusInterceptor, multi: true },
    provideAnimationsAsync(),
    appConfig.providers[1],
    provideHttpClient(withInterceptorsFromDi(), withJsonpSupport())
  ]
})

export class AppModule {}

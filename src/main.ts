import { HTTP_INTERCEPTORS, provideHttpClient, withInterceptorsFromDi, withJsonpSupport } from '@angular/common/http';
import { StatusInterceptor } from './app/status.service';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { appConfig } from './app/mytheme';
import { provideAnimations } from '@angular/platform-browser/animations';
import { BrowserModule, bootstrapApplication } from '@angular/platform-browser';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DatePickerModule } from 'primeng/datepicker';
import { DialogModule } from 'primeng/dialog';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { FormsModule } from '@angular/forms';
import { InputTextModule } from 'primeng/inputtext';
import { NgOptimizedImage } from '@angular/common';
import { PasswordModule } from 'primeng/password';
import { ProgressBarModule } from 'primeng/progressbar';
import { RadioButtonModule } from 'primeng/radiobutton';
import { SelectModule } from 'primeng/select';
import { SplitButtonModule } from 'primeng/splitbutton';
import { ToastModule } from 'primeng/toast';
import { TooltipModule } from 'primeng/tooltip';
import { TreeModule } from 'primeng/tree';
import { TreeSelectModule } from 'primeng/treeselect';
import { AppComponent } from './app/app.component';
import { importProvidersFrom } from '@angular/core';

bootstrapApplication(AppComponent, {
  providers: [
    importProvidersFrom(BrowserModule, ButtonModule, CheckboxModule, ConfirmDialogModule,
      DatePickerModule, DialogModule, FontAwesomeModule, FormsModule, InputTextModule, NgOptimizedImage,
      PasswordModule, ProgressBarModule, RadioButtonModule, SelectModule, SplitButtonModule, ToastModule,
      TooltipModule, TreeModule, TreeSelectModule),
    { provide: HTTP_INTERCEPTORS, useClass: StatusInterceptor, multi: true },
    provideAnimationsAsync(),
    appConfig.providers[1],
    provideHttpClient(withInterceptorsFromDi(), withJsonpSupport()),
    provideAnimations()
  ]
})
  .catch(err => console.error(err));

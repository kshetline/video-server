import { AuthService } from './auth.service';
import { Injectable } from '@angular/core';
import { HttpEvent, HttpHandler, HttpInterceptor, HttpRequest } from '@angular/common/http';
import { Observable } from 'rxjs/internal/Observable';

@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  constructor(private auth: AuthService) {}

  intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    let authReq = req;
    const token = this.auth.getToken();

    if (token)
      authReq = req.clone({ headers: req.headers.set('Authorization', this.auth.getToken()) });

    return next.handle(authReq);
  }
}

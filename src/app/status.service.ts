import { Injectable } from '@angular/core';
import { HttpInterceptor, HttpEvent, HttpHandler, HttpRequest, HttpEventType, HttpClient } from '@angular/common/http';
import { map, Observable } from 'rxjs';
import { Subscription } from 'rxjs/internal/Subscription';
import { BehaviorSubject } from 'rxjs/internal/BehaviorSubject';
import { shareReplay } from 'rxjs/internal/operators/shareReplay';

const RENEW_INTERVAL = 600_000; // 10 minutes

@Injectable()
export class StatusInterceptor implements HttpInterceptor {
  private static _localAccess = false;
  private static httpClient: HttpClient;
  private static httpStatus = new BehaviorSubject<number>(0);
  private static httpStatusObserver = StatusInterceptor.httpStatus.asObservable();
  private static renewTimer: any;

  static alive(): void {
    if (!StatusInterceptor.renewTimer) {
      StatusInterceptor.renewTimer = setTimeout(() => {
        StatusInterceptor.renewTimer = undefined;

        if (StatusInterceptor.httpClient)
          StatusInterceptor.httpClient.get('/api/renew');
      }, RENEW_INTERVAL);
    }
  }

  static stopRenewal(): void {
    if (StatusInterceptor.renewTimer) {
      clearTimeout(StatusInterceptor.renewTimer);
      StatusInterceptor.renewTimer = undefined;
    }
  }

  static getHttpStatusUpdates(callback: (observer: number) => void): Subscription {
    return StatusInterceptor.httpStatusObserver.subscribe(callback);
  }

  static sendHttpStatus(status: number): void {
    StatusInterceptor.httpStatus.next(status);
  }

  static get localAccess(): boolean { return StatusInterceptor._localAccess; }

  constructor(httpClient: HttpClient) {
    StatusInterceptor.httpClient = httpClient;
  }

  intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    const observer = next.handle(req).pipe(map(evt => {
      if (evt.type === HttpEventType.Response && !/\/api\/(renew|status)$/.test(req.url)) {
        const status = evt.status;

        StatusInterceptor.httpStatus.next(status);

        if (status === 200)
          StatusInterceptor.alive();
      }

      return evt;
    })).pipe(shareReplay());

    if (/\/api\/status$/.test(req.url))
      observer.subscribe((res: any) => { if (res.body) StatusInterceptor._localAccess = !!res.body.localAccess; });

    return observer;
  }
}

import { Injectable } from '@angular/core';
import { HttpInterceptor, HttpEvent, HttpHandler, HttpRequest, HttpResponse, HttpEventType, HttpClient } from '@angular/common/http';
import { map, Observable } from 'rxjs';
import { Subscription } from 'rxjs/internal/Subscription';
import { BehaviorSubject } from 'rxjs/internal/BehaviorSubject';

const RENEW_INTERVAL = 600_000; // 10 minutes

@Injectable()
export class StatusInterceptor implements HttpInterceptor {
  private static httpClient: HttpClient;
  private static renewTimer: any;
  private static status = new BehaviorSubject<number>(0);
  private static statusObserver = StatusInterceptor.status.asObservable();

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

  static getStatusUpdates(callback: (observer: number) => void): Subscription {
    return StatusInterceptor.statusObserver.subscribe(callback);
  }

  static sendStatus(status: number): void {
    StatusInterceptor.status.next(status);
  }

  constructor(httpClient: HttpClient) {
    StatusInterceptor.httpClient = httpClient;
  }

  intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    return next.handle(req).pipe(map(evt => {
      if (evt.type === HttpEventType.Response && !/\/api\/(renew|status)$/.test(req.url)) {
        const status = (evt as HttpResponse<any>).status;

        StatusInterceptor.status.next(status);

        if (status === 200)
          StatusInterceptor.alive();
      }

      return evt;
    }));
  }
}

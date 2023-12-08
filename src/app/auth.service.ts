import { ApplicationRef, EventEmitter, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { toInt } from '@tubular/util';
import { Observable } from 'rxjs/internal/Observable';
import { UserSession } from '../../server/src/shared-types';
import { StatusInterceptor } from './status.service';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private currentSession: UserSession;

  constructor(private http: HttpClient, private appRef: ApplicationRef) {
    const lastSession = localStorage.getItem('vs_session');

    if (lastSession) {
      try {
        this.currentSession = JSON.parse(atob(lastSession));
      }
      catch {}
    }
  }

  loginStatus = new EventEmitter<boolean>();

  login(user: string, pwd: string): Observable<any> {
    const observable = this.http.post('/api/login', { user, pwd });

    observable.subscribe({
      next: (session: UserSession) => {
        this.setSession(session);
        this.loginStatus.next(true);
        this.appRef.tick();
      },
      error: () => this.loginStatus.next(false)
    });

    return observable;
  }

  private setSession(session: UserSession): void {
    const expiration = (session?.expiration as number || 0);

    localStorage.setItem('vs_expires_at', expiration.toString());
    localStorage.setItem('vs_session', btoa(JSON.stringify(session)));
    this.currentSession = session;
  }

  logout(): void {
    if (this.isLoggedOut())
      return;

    this.currentSession = undefined;
    localStorage.removeItem('vs_expires_at');
    localStorage.removeItem('vs_session');
    StatusInterceptor.stopRenewal();
    setTimeout(() => this.appRef.tick());
  }

  private wasLoggedIn = false;

  isLoggedIn(): boolean {
    const loggedIn = this.currentSession && Date.now() < this.getExpiration();

    if (this.wasLoggedIn && !loggedIn)
      setTimeout(() => StatusInterceptor.sendHttpStatus(440));

    return (this.wasLoggedIn = loggedIn);
  }

  isLoggedOut(): boolean {
    return !this.isLoggedIn();
  }

  getExpiration(): number {
    return toInt(localStorage.getItem('vs_expires_at'));
  }

  getSession(): UserSession {
    if (!this.currentSession) {
      try {
        this.currentSession = JSON.parse(atob(localStorage.getItem('vs_session')));
      }
      catch {}
    }

    return this.currentSession;
  }
}

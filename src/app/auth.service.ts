import { ApplicationRef, EventEmitter, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { toInt } from '@tubular/util';
import { Observable } from 'rxjs/internal/Observable';
import { UserSession } from '../../server/src/shared-types';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private currentSession: UserSession;

  constructor(private http: HttpClient, private appRef: ApplicationRef) {}

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
    this.currentSession = undefined;
    localStorage.removeItem('vs_expires_at');
    localStorage.removeItem('vs_session');
    this.appRef.tick();
  }

  isLoggedIn(): boolean {
    return this.currentSession && Date.now() < this.getExpiration();
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

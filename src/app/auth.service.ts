import { EventEmitter, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { toInt } from '@tubular/util';
import { Observable } from 'rxjs/internal/Observable';
import { UserSession } from '../../server/src/shared-types';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  constructor(private http: HttpClient) {}

  loginStatus = new EventEmitter<boolean>();

  login(user: string, pwd: string): Observable<any> {
    const observable = this.http.post('/api/login', { user, pwd });

    observable.subscribe({
      next: (session: UserSession) => {
        this.setSession(session);
        this.loginStatus.next(true);
      },
      error: () => this.loginStatus.next(false)
    });

    return observable;
  }

  private setSession(session: UserSession): void {
    const expiration = (session?.expiration as number || 0);

    localStorage.setItem('vs_expires_at', expiration.toString());
  }

  logout(): void {
    localStorage.removeItem('vs_expires_at');
  }

  isLoggedIn(): boolean {
    return Date.now() < this.getExpiration();
  }

  isLoggedOut(): boolean {
    return !this.isLoggedIn();
  }

  getExpiration(): number {
    return toInt(localStorage.getItem('vs_expires_at'));
  }
}

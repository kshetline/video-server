import { EventEmitter, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { toInt } from '@tubular/util';
import { Observable } from 'rxjs/internal/Observable';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  constructor(private http: HttpClient) {}

  loginStatus = new EventEmitter<boolean>();

  login(user: string, pwd: string): Observable<any> {
    const observable = this.http.post('/api/login', { user, pwd });

    observable.subscribe({
      next: jwt => {
        this.setSession(jwt.toString());
        this.loginStatus.next(true);
      },
      error: () => this.loginStatus.next(false)
    });

    return observable;
  }

  private setSession(jwt: string): void {
    const payload = JSON.parse(atob(jwt.split('.')[1] || 'null'));

    localStorage.setItem('vs_jwt', jwt);
    localStorage.setItem('vs_expires_at', ((payload?.exp as number || 0) * 1000).toString());
  }

  getToken(): string {
    return localStorage.getItem('vs_jwt');
  }

  logout(): void {
    localStorage.removeItem('vs_jwt');
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

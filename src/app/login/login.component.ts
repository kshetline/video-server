import { Component } from '@angular/core';
import { AuthService } from '../auth.service';

@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss']
})
export class LoginComponent {
  user = '';
  password = '';

  constructor(private auth: AuthService) {}

  login(): void {
    this.auth.login(this.user, this.password);
  }
}

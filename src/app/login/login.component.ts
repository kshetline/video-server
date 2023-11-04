import { AfterViewInit, Component } from '@angular/core';
import { AuthService } from '../auth.service';

@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss']
})
export class LoginComponent implements AfterViewInit {
  user = '';
  password = '';

  constructor(private auth: AuthService) {}

  ngAfterViewInit(): void {
    const userInput = document.querySelector('#username') as HTMLInputElement;

    if (userInput) {
      userInput.focus();
      setTimeout(() => userInput.select(), 250);
    }
  }

  login(): void {
    if (this.user && this.password)
      this.auth.login(this.user, this.password);
  }
}

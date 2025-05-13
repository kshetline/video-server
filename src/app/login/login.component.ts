import { AfterViewInit, Component, EventEmitter, OnInit, Output } from '@angular/core';
import { AuthService } from '../auth.service';
import { FormsModule } from '@angular/forms';
import { InputText } from 'primeng/inputtext';
import { Password } from 'primeng/password';
import { Button } from 'primeng/button';

@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss'],
  imports: [FormsModule, InputText, Password, Button]
})
export class LoginComponent implements AfterViewInit, OnInit {
  error = '';
  user = '';
  password = '';

  @Output() open = new EventEmitter<void>();
  @Output() typing = new EventEmitter<void>();

  constructor(private auth: AuthService) {}

  ngOnInit(): void {
    this.open.emit();
  }

  ngAfterViewInit(): void {
    const userInput = document.querySelector('#username') as HTMLInputElement;

    if (userInput) {
      userInput.focus();
      setTimeout(() => userInput.select(), 250);
    }
  }

  login(): void {
    this.error = '';
    this.typing.emit();

    if (this.user && this.password)
      this.auth.login(this.user, this.password).subscribe({
        error: () => this.error = 'Login failed'
      });
  }
}

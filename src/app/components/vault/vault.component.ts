import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthStatus } from '../../models/interfaces';

@Component({
  selector: 'app-vault',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './vault.component.html',
  styleUrls: ['./vault.component.css']
})
export class VaultComponent {
  @Input() authStatus: AuthStatus = 'Checking';
  @Input() errorMessage: string = '';
  @Input() appVersion: string = '1.1.0';
  
  @Output() unlock = new EventEmitter<string>();

  password = '';

  onSubmit() {
    if (!this.password.trim()) return;
    this.unlock.emit(this.password);
  }
}

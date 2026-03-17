import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { AuthStatus } from '../../models/interfaces';
import { VaultService } from '../../services/vault.service';

@Component({
  selector: 'app-titlebar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './titlebar.component.html',
  styleUrls: ['./titlebar.component.css']
})
export class TitlebarComponent {
  @Input() authStatus: AuthStatus = 'Checking';
  @Input() isDarkMode = false;
  @Input() spellCheckEnabled = false;
  @Input() autoStartEnabled = false;

  @Output() toggleDarkMode = new EventEmitter<void>();
  @Output() toggleFontSettings = new EventEmitter<void>();
  @Output() toggleSpellCheck = new EventEmitter<void>();
  @Output() toggleAutoStart = new EventEmitter<void>();
  @Output() toggleBin = new EventEmitter<void>();
  @Output() toggleHelp = new EventEmitter<void>();

  constructor(private vaultService: VaultService) {}

  async onMinimize() {
    await getCurrentWindow().minimize();
  }

  async onMaximize() {
    try {
      await this.vaultService.toggleMaximize();
    } catch (err) {
      console.error(err);
    }
  }

  async onClose() {
    await getCurrentWindow().close();
  }
}

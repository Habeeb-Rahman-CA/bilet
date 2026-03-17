import { Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { AuthStatus } from '../models/interfaces';

@Injectable({ providedIn: 'root' })
export class VaultService {

  async checkAuthStatus(): Promise<AuthStatus> {
    return invoke<AuthStatus>('check_auth_status');
  }

  async unlock(password: string): Promise<string> {
    return invoke<string>('unlock_db', { password });
  }

  async lock(): Promise<string> {
    return invoke<string>('lock_vault');
  }

  async toggleMaximize(): Promise<void> {
    await invoke('toggle_maximize');
  }

  async saveFileToLocal(path: string, content: string): Promise<string> {
    return invoke<string>('save_file_to_local', { path, content });
  }
}

import { Injectable } from '@angular/core';
import { enable, disable, isEnabled } from '@tauri-apps/plugin-autostart';

@Injectable({ providedIn: 'root' })
export class SettingsService {

  // ===== Dark Mode =====

  loadDarkMode(): boolean {
    const saved = localStorage.getItem('darkMode');
    const isDark = saved === 'true' || (saved === null && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (isDark) {
      document.documentElement.classList.add('dark-mode');
    }
    return isDark;
  }

  setDarkMode(enabled: boolean): void {
    localStorage.setItem('darkMode', enabled.toString());
    if (enabled) {
      document.documentElement.classList.add('dark-mode');
    } else {
      document.documentElement.classList.remove('dark-mode');
    }
  }

  // ===== Spell Check =====

  loadSpellCheck(): boolean {
    return localStorage.getItem('spellcheck') === 'true';
  }

  setSpellCheck(enabled: boolean): void {
    localStorage.setItem('spellcheck', String(enabled));
  }

  // ===== Font Persistence =====

  loadSelectedFont(): string | null {
    return localStorage.getItem('selectedFont');
  }

  saveSelectedFont(fontName: string): void {
    localStorage.setItem('selectedFont', fontName);
  }

  // ===== Autostart =====

  async isAutoStartEnabled(): Promise<boolean> {
    try {
      return await isEnabled();
    } catch (err) {
      console.warn('Autostart plugin not available:', err);
      return false;
    }
  }

  async toggleAutoStart(currentlyEnabled: boolean): Promise<boolean> {
    if (currentlyEnabled) {
      await disable();
    } else {
      await enable();
    }
    return isEnabled();
  }
}

import { Injectable } from '@angular/core';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { enable, disable, isEnabled } from '@tauri-apps/plugin-autostart';
import { save, open } from '@tauri-apps/plugin-dialog';
import { AuthStatus, Pad, PadVersion, BinItem } from '../models/app.models';

@Injectable({
  providedIn: 'root'
})
export class TauriService {

  // --- Auth Commands ---
  async checkAuthStatus(): Promise<AuthStatus> {
    return await invoke<AuthStatus>("check_auth_status");
  }

  async unlockVault(password: string): Promise<void> {
    await invoke("unlock_db", { password });
  }

  // --- Pad Commands ---
  async getPads(): Promise<Pad[]> {
    return await invoke<Pad[]>("get_pads");
  }

  async addPad(title: string, content: string): Promise<number> {
    return await invoke<number>("add_pad", { title, content });
  }

  async updatePad(id: number, title: string, content: string): Promise<void> {
    await invoke("update_pad", { id, title, content });
  }

  async deletePadToBin(id: number): Promise<void> {
    await invoke("delete_pad", { id });
  }

  async openPadTab(id: number): Promise<void> {
    await invoke("open_pad_tab", { id });
  }

  async closePadTab(id: number): Promise<void> {
    await invoke("close_pad_tab", { id });
  }

  async updatePadFilePath(id: number, filePath: string): Promise<void> {
    await invoke("update_pad_file_path", { id, file_path: filePath });
  }

  // --- Bin Commands ---
  async getBinPads(): Promise<Pad[]> {
    return await invoke<Pad[]>("get_bin_pads");
  }

  async restoreBinItem(id: number): Promise<void> {
    await invoke("restore_pad", { id });
  }

  async deletePermanently(id: number): Promise<void> {
    await invoke("permanent_delete_pad", { id });
  }

  async clearBin(): Promise<void> {
    await invoke("clear_bin");
  }

  // --- Version Commands ---
  async getPadVersions(padId: number): Promise<PadVersion[]> {
    return await invoke<PadVersion[]>("get_pad_versions", { padId });
  }

  async savePadVersion(padId: number, content: string, label: string | null = null, retention: number = 50): Promise<number> {
    return await invoke<number>("save_pad_version", { padId, content, label, retention });
  }

  async updateVersionLabel(id: number, label: string | null): Promise<void> {
    await invoke("update_version_label", { id, label });
  }

  async deletePadVersion(id: number): Promise<void> {
    await invoke("delete_pad_version", { id });
  }

  // --- Local File Operations ---
  async saveFileToLocal(path: string, content: string): Promise<void> {
    await invoke("save_file_to_local", { path, content });
  }

  // --- Font Commands ---
  async getCustomFonts(): Promise<any[]> {
    return await invoke<any[]>('get_custom_fonts');
  }

  async uploadCustomFont(name: string, srcPath: string): Promise<any> {
    return await invoke('upload_custom_font', { name, srcPath });
  }

  async deleteCustomFont(name: string): Promise<void> {
    await invoke('delete_custom_font', { name });
  }

  // --- Window Operations ---
  async minimizeWindow(): Promise<void> {
    await getCurrentWindow().minimize();
  }

  async toggleMaximize(): Promise<void> {
    await invoke("toggle_maximize");
  }

  async closeWindow(): Promise<void> {
    await getCurrentWindow().close();
  }

  async setAlwaysOnTop(isSticky: boolean): Promise<void> {
    await getCurrentWindow().setAlwaysOnTop(isSticky);
  }

  getWindow() {
    return getCurrentWindow();
  }

  // --- Autostart Plugin ---
  async isAutostartEnabled(): Promise<boolean> {
    try {
      return await isEnabled();
    } catch {
      return false;
    }
  }

  async enableAutostart(): Promise<void> {
    await enable();
  }

  async disableAutostart(): Promise<void> {
    await disable();
  }

  // --- Dialog Plugin ---
  async openDialog(options: any): Promise<string | string[] | null> {
    return await open(options);
  }

  async saveDialog(options: any): Promise<string | null> {
    return await save(options);
  }

  // --- Utility ---
  convertAssetUrl(path: string): string {
    return convertFileSrc(path);
  }
}

import { Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { Pad } from '../models/interfaces';
import { BehaviorSubject, map } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class PadsService {
  private padsSubject = new BehaviorSubject<Pad[]>([]);
  pads$ = this.padsSubject.asObservable();

  openTabs$ = this.pads$.pipe(
    map(pads => pads.filter(p => p.is_open && !p.is_deleted).sort((a, b) => a.tab_index - b.tab_index))
  );

  activePad$ = this.pads$.pipe(
    map(pads => pads.find(p => p.is_active) || null)
  );

  async loadPads() {
    try {
      const pads = await invoke<Pad[]>('get_pads');
      this.padsSubject.next(pads);
      return pads;
    } catch (err) {
      console.error('Failed to load pads:', err);
      return [];
    }
  }

  async getBinPads(): Promise<Pad[]> {
    return invoke<Pad[]>('get_bin_pads');
  }

  async addPad(title: string, content: string): Promise<number> {
    const id = await invoke<number>('add_pad', { title, content });
    await this.loadPads();
    return id;
  }

  async updatePad(id: number, title: string, content: string): Promise<string> {
    const res = await invoke<string>('update_pad', { id, title, content });
    await this.loadPads();
    return res;
  }

  async deletePad(id: number): Promise<string> {
    const res = await invoke<string>('delete_pad', { id });
    await this.loadPads();
    return res;
  }

  async restorePad(id: number): Promise<string> {
    const res = await invoke<string>('restore_pad', { id });
    await this.loadPads();
    return res;
  }

  async permanentDeletePad(id: number): Promise<string> {
    return invoke<string>('permanent_delete_pad', { id });
  }

  async updatePadMetadata(
    id: number,
    options: { is_open?: boolean; is_active?: boolean; tab_index?: number }
  ): Promise<string> {
    const res = await invoke<string>('update_pad_metadata', { id, ...options });
    await this.loadPads();
    return res;
  }

  async clearPadBin(): Promise<string> {
    return invoke<string>('clear_pad_bin');
  }
}

import { Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { Note } from '../models/interfaces';
import { BehaviorSubject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class NotesService {
  private notesSubject = new BehaviorSubject<Note[]>([]);
  notes$ = this.notesSubject.asObservable();

  async loadNotes(): Promise<Note[]> {
    try {
      const notes = await invoke<Note[]>('get_notes');
      this.notesSubject.next(notes);
      return notes;
    } catch (err) {
      console.error('Failed to load notes:', err);
      return [];
    }
  }

  async getBinNotes(): Promise<Note[]> {
    return invoke<Note[]>('get_bin_notes');
  }

  async addNote(content: string): Promise<string> {
    const res = await invoke<string>('add_note', { content });
    await this.loadNotes();
    return res;
  }

  async updateNote(id: number, content: string): Promise<string> {
    const res = await invoke<string>('update_note', { id, content });
    await this.loadNotes();
    return res;
  }

  async deleteNote(id: number): Promise<string> {
    const res = await invoke<string>('delete_note', { id });
    await this.loadNotes();
    return res;
  }

  async restoreNote(id: number): Promise<string> {
    const res = await invoke<string>('restore_note', { id });
    await this.loadNotes();
    return res;
  }

  async permanentDeleteNote(id: number): Promise<string> {
    return invoke<string>('permanent_delete_note', { id });
  }

  async togglePin(id: number): Promise<string> {
    const res = await invoke<string>('toggle_pin', { id });
    await this.loadNotes();
    return res;
  }

  async clearBin(): Promise<string> {
    return invoke<string>('clear_bin');
  }
}

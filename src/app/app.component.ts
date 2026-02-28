import { Component, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { enable, disable, isEnabled } from '@tauri-apps/plugin-autostart';

interface Note {
  id: number;
  content: string;
}

type AuthStatus = 'SetupRequired' | 'Locked' | 'Unlocked';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, FormsModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent {
  notes: Note[] = [];
  newNote = '';
  editingNoteId: number | null = null;
  editContent = '';
  autoStartEnabled = false;

  // Vault Status
  authStatus: AuthStatus = 'Locked';
  password = '';
  errorMessage = '';

  // Idle Detection
  private idleTimeout = 1 * 60 * 1000; // 5 minutes
  private lastActivity = Date.now();
  private idleCheckInterval: any;

  async ngOnInit() {
    try {
      this.autoStartEnabled = await isEnabled();
    } catch (err) {
      console.warn('Autostart plugin not available:', err);
    }

    // Check if we need to setup or unlock
    this.authStatus = await invoke<AuthStatus>('check_auth_status');

    if (this.authStatus === 'Unlocked') {
      this.startIdleDetection();
    }
  }

  @HostListener('window:mousemove')
  @HostListener('window:keydown')
  @HostListener('window:click')
  @HostListener('window:scroll')
  resetIdleTimer() {
    this.lastActivity = Date.now();
  }

  startIdleDetection() {
    if (this.idleCheckInterval) clearInterval(this.idleCheckInterval);

    this.idleCheckInterval = setInterval(() => {
      if (this.authStatus === 'Unlocked') {
        const now = Date.now();
        if (now - this.lastActivity > this.idleTimeout) {
          console.log('User idle for too long. Locking vault...');
          this.lockVault();
        }
      }
    }, 10000); // Check every 10 seconds
  }

  async unlockVault() {
    if (!this.password.trim()) return;

    try {
      this.errorMessage = '';
      await invoke('unlock_db', { password: this.password });
      this.authStatus = 'Unlocked';
      this.password = '';
      this.lastActivity = Date.now();
      this.startIdleDetection();
      await this.loadNotes();
    } catch (err: any) {
      console.error('Failed to unlock vault:', err);
      this.errorMessage = err.toString();
    }
  }

  async lockVault() {
    try {
      await invoke('lock_vault');
      this.authStatus = 'Locked';
      this.notes = []; // Clear sensitive data from memory
      this.newNote = '';
      this.password = '';
      if (this.idleCheckInterval) {
        clearInterval(this.idleCheckInterval);
      }
    } catch (err) {
      console.error('Failed to lock vault:', err);
    }
  }

  async toggleAutoStart() {
    try {
      if (this.autoStartEnabled) {
        await disable();
      } else {
        await enable();
      }
      this.autoStartEnabled = await isEnabled();
    } catch (err) {
      console.error('Failed to toggle autostart:', err);
    }
  }

  async loadNotes() {
    try {
      this.notes = await invoke<Note[]>('get_notes');
      console.log(`Loaded ${this.notes.length} notes from encrypted DB`);
    } catch (err) {
      console.error('Failed to load notes:', err);
    }
  }

  async addNote() {
    if (!this.newNote.trim()) return;

    try {
      await invoke('add_note', { content: this.newNote });
      this.newNote = '';
      await this.loadNotes();
    } catch (err) {
      console.error('Failed to add note:', err);
    }
  }

  startEdit(note: Note) {
    this.editingNoteId = note.id;
    this.editContent = note.content;
  }

  cancelEdit() {
    this.editingNoteId = null;
    this.editContent = '';
  }

  async updateNote() {
    if (!this.editContent.trim() || this.editingNoteId === null) return;

    try {
      await invoke('update_note', { id: this.editingNoteId, content: this.editContent });
      this.editingNoteId = null;
      this.editContent = '';
      await this.loadNotes();
    } catch (err) {
      console.error('Failed to update note:', err);
    }
  }

  async deleteNote(id: number) {
    try {
      await invoke('delete_note', { id });
      await this.loadNotes();
    } catch (err) {
      console.error('Failed to delete note:', err);
    }
  }

  async minimize() {
    const appWindow = getCurrentWindow();
    await appWindow.minimize();
  }

  async maximize() {
    const appWindow = getCurrentWindow();
    await appWindow.toggleMaximize();
  }

  async close() {
    const appWindow = getCurrentWindow();
    await appWindow.close();
  }
}

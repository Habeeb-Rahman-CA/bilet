import { Component, HostListener, ViewChild, ElementRef, AfterViewChecked } from '@angular/core';
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
export class AppComponent implements AfterViewChecked {
  @ViewChild('noteInput') noteInput!: ElementRef;
  @ViewChild('editInput') editInput?: ElementRef;
  private needsFocus = false;
  private editNeedsFocus = false;

  notes: Note[] = [];
  newNote = '';
  selectedNoteId: number | null = null;
  editingNoteId: number | null = null;
  isConfirmingDeleteId: number | null = null;
  editContent = '';
  autoStartEnabled = false;

  // Vault Status
  authStatus: AuthStatus = 'Locked';
  password = '';
  errorMessage = '';

  // Idle Detection
  private idleTimeout = 10 * 60 * 1000; // 10 minutes
  private lastActivity = Date.now();
  private idleCheckInterval: any;

  async ngOnInit() {
    try {
      this.autoStartEnabled = await isEnabled();
    } catch (err) {
      console.warn('Autostart plugin not available:', err);
    }

    this.authStatus = await invoke<AuthStatus>('check_auth_status');

    if (this.authStatus === 'Unlocked') {
      this.startIdleDetection();
      this.triggerFocus();
    }

    getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (focused && this.authStatus === 'Unlocked') {
        this.triggerFocus();
      }
    });
  }

  ngAfterViewChecked() {
    if (this.needsFocus && this.noteInput) {
      this.noteInput.nativeElement.focus();
      this.needsFocus = false;
    }
    if (this.editNeedsFocus && this.editInput) {
      this.editInput.nativeElement.focus();
      this.editNeedsFocus = false;
    }
  }

  triggerFocus() {
    this.needsFocus = true;
  }

  triggerEditFocus() {
    this.editNeedsFocus = true;
  }

  @HostListener('window:keydown', ['$event'])
  handleGlobalKeys(event: KeyboardEvent) {
    this.resetIdleTimer(); // Merge activity reset

    if (this.authStatus !== 'Unlocked') return;

    // --- List Navigation & Focus ---

    // Ctrl + L: Focus List / Select first note
    if (event.ctrlKey && event.key.toLowerCase() === 'l') {
      event.preventDefault();
      if (this.notes.length > 0) {
        if (this.selectedNoteId === null) {
          this.selectedNoteId = this.notes[0].id;
        }
        this.editingNoteId = null; // Close any open edit
        this.isConfirmingDeleteId = null;
      }
    }

    // Ctrl + A: Focus Input
    if (event.ctrlKey && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      this.selectedNoteId = null;
      this.editingNoteId = null;
      this.isConfirmingDeleteId = null;
      this.triggerFocus();
    }

    // Arrow keys for navigation (only if something is selected and not editing)
    if (this.selectedNoteId !== null && this.editingNoteId === null && this.isConfirmingDeleteId === null) {
      const currentIndex = this.notes.findIndex(n => n.id === this.selectedNoteId);

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        const nextIndex = (currentIndex + 1) % this.notes.length;
        this.selectedNoteId = this.notes[nextIndex].id;
        this.scrollSelectedIntoView();
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        const prevIndex = (currentIndex - 1 + this.notes.length) % this.notes.length;
        this.selectedNoteId = this.notes[prevIndex].id;
        this.scrollSelectedIntoView();
      }
    }

    // --- Actions on Selected Note ---

    if (this.selectedNoteId !== null && this.editingNoteId === null) {
      // Ctrl + E: Edit
      if (event.ctrlKey && event.key.toLowerCase() === 'e') {
        event.preventDefault();
        const note = this.notes.find(n => n.id === this.selectedNoteId);
        if (note) this.startEdit(note);
      }
      // Ctrl + D: Delete Confirmation
      if (event.ctrlKey && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        this.isConfirmingDeleteId = this.selectedNoteId;
      }
    }

    // While Editing
    if (this.editingNoteId !== null) {
      if (event.ctrlKey && event.key.toLowerCase() === 's') {
        event.preventDefault();
        this.updateNote();
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        this.cancelEdit();
      }
    }

    // While Confirming Delete
    if (this.isConfirmingDeleteId !== null) {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.deleteNote(this.isConfirmingDeleteId);
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        this.isConfirmingDeleteId = null;
      }
    }
  }

  @HostListener('window:mousemove')
  @HostListener('window:click')
  @HostListener('window:scroll')
  resetIdleTimer() {
    this.lastActivity = Date.now();
  }

  private scrollSelectedIntoView() {
    setTimeout(() => {
      const element = document.querySelector('.note-card.selected');
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }, 10);
  }

  startIdleDetection() {
    if (this.idleCheckInterval) clearInterval(this.idleCheckInterval);
    this.idleCheckInterval = setInterval(() => {
      if (this.authStatus === 'Unlocked') {
        const now = Date.now();
        if (now - this.lastActivity > this.idleTimeout) {
          this.lockVault();
        }
      }
    }, 10000);
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
      this.triggerFocus();
    } catch (err: any) {
      this.errorMessage = err.toString();
    }
  }

  async lockVault() {
    try {
      await invoke('lock_vault');
      this.authStatus = 'Locked';
      this.notes = [];
      this.newNote = '';
      this.password = '';
      this.selectedNoteId = null;
      this.editingNoteId = null;
      if (this.idleCheckInterval) clearInterval(this.idleCheckInterval);
    } catch (err) {
      console.error(err);
    }
  }

  async loadNotes() {
    try {
      this.notes = await invoke<Note[]>('get_notes');
    } catch (err) {
      console.error(err);
    }
  }

  async addNote() {
    if (!this.newNote.trim()) return;
    try {
      await invoke('add_note', { content: this.newNote });
      this.newNote = '';
      await this.loadNotes();
      this.selectedNoteId = null;
      this.triggerFocus();
    } catch (err) {
      console.error(err);
    }
  }

  async toggleAutoStart() {
    try {
      if (this.autoStartEnabled) await disable();
      else await enable();
      this.autoStartEnabled = await isEnabled();
    } catch (err) {
      console.error(err);
    }
  }

  // Debug selection
  selectNote(note: Note, event: MouseEvent) {
    if (this.editingNoteId === note.id) return;
    event.stopPropagation();
    this.selectedNoteId = note.id;
    this.isConfirmingDeleteId = null;
    console.log('Note selected:', this.selectedNoteId);
  }

  startEdit(note: Note) {
    this.editingNoteId = note.id;
    this.editContent = note.content;
    this.triggerEditFocus();
  }

  cancelEdit() {
    this.editingNoteId = null;
    this.editContent = '';
    this.triggerFocus();
  }

  async onEditChange() {
    if (this.editingNoteId === null) return;
    try {
      await invoke('update_note', { id: this.editingNoteId, content: this.editContent });
      const note = this.notes.find(n => n.id === this.editingNoteId);
      if (note) note.content = this.editContent;
    } catch (err) {
      console.error(err);
    }
  }

  async updateNote() {
    if (!this.editContent.trim() || this.editingNoteId === null) return;
    try {
      await invoke('update_note', { id: this.editingNoteId, content: this.editContent });
      this.editingNoteId = null;
      this.editContent = '';
      await this.loadNotes();
      this.triggerFocus();
    } catch (err) {
      console.error(err);
    }
  }

  async deleteNote(id: number) {
    try {
      await invoke('delete_note', { id });
      this.isConfirmingDeleteId = null;
      this.selectedNoteId = null;
      await this.loadNotes();
      this.triggerFocus();
    } catch (err) {
      console.error(err);
    }
  }

  async minimize() { await getCurrentWindow().minimize(); }
  async maximize() { await getCurrentWindow().toggleMaximize(); }
  async close() { await getCurrentWindow().close(); }
}

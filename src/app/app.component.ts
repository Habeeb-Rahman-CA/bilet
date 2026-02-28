import { Component, HostListener, ViewChild, ElementRef, AfterViewChecked, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { enable, disable, isEnabled } from '@tauri-apps/plugin-autostart';

interface Note {
  id: number;
  content: string;
  timestamp: string;
  is_pinned: boolean;
  is_deleted: boolean;
}

type AuthStatus = 'SetupRequired' | 'Locked' | 'Unlocked';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent implements AfterViewChecked, OnInit {
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
  showHelp = false;
  showSearch = false;
  showBin = false;
  searchQuery = '';
  binNotes: Note[] = [];
  selectedBinNoteId: number | null = null;
  @ViewChild('searchInput') searchInput?: ElementRef;
  private searchNeedsFocus = false;

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

    try {
      this.authStatus = await invoke<AuthStatus>('check_auth_status');

      if (this.authStatus === 'Unlocked') {
        await this.loadNotes();
        this.triggerFocus();
      }

      this.startIdleDetection(); // Renamed to startIdleCheck in the instruction, but keeping original for now.

      const win = getCurrentWindow();

      // Update state initially
      const isMax = await win.isMaximized();
      if (isMax) document.body.classList.add('maximized');

      // Listen for changes (resizing, snapping, etc.)
      await win.onResized(async () => {
        const currentlyMax = await win.isMaximized();
        if (currentlyMax) {
          document.body.classList.add('maximized');
        } else {
          document.body.classList.remove('maximized');
        }
      });

      win.onFocusChanged(({ payload: focused }) => {
        if (focused && this.authStatus === 'Unlocked') {
          this.triggerFocus();
        }
      });
    } catch (err) {
      console.error(err);
    }
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
    if (this.searchNeedsFocus && this.searchInput) {
      this.searchInput.nativeElement.focus();
      this.searchNeedsFocus = false;
    }
  }

  triggerFocus() {
    this.needsFocus = true;
  }

  triggerEditFocus() {
    this.editNeedsFocus = true;
  }

  triggerSearchFocus() {
    this.searchNeedsFocus = true;
  }

  @HostListener('window:keydown', ['$event'])
  handleGlobalKeys(event: KeyboardEvent) {
    this.resetIdleTimer(); // Merge activity reset

    if (this.authStatus !== 'Unlocked') return;

    // Toggle Help (Ctrl + H)
    if (event.ctrlKey && event.key.toLowerCase() === 'h') {
      event.preventDefault();
      this.showHelp = !this.showHelp;
    }

    // Toggle Bin (Ctrl + B)
    if (event.ctrlKey && event.key.toLowerCase() === 'b') {
      event.preventDefault();
      this.showBin = !this.showBin;
      if (this.showBin) {
        this.showHelp = false;
        this.showSearch = false;
        this.loadBinNotes();
      }
    }

    // Toggle Search (Ctrl + F)
    if (event.ctrlKey && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      this.showSearch = !this.showSearch;
      if (this.showSearch) {
        this.showHelp = false;
        this.searchQuery = '';
        this.triggerSearchFocus();
      }
    }

    // --- List Navigation & Focus ---

    // Ctrl + L: Focus List / Select first note
    if (event.ctrlKey && event.key.toLowerCase() === 'l') {
      event.preventDefault();
      this.showHelp = false;
      const list = this.showSearch ? this.getFilteredNotes() : this.notes;
      if (list.length > 0) {
        if (this.selectedNoteId === null || !list.find(n => n.id === this.selectedNoteId)) {
          this.selectedNoteId = list[0].id;
        }
        this.editingNoteId = null;
        this.isConfirmingDeleteId = null;
      }
    }

    // Ctrl + A: Focus Input
    if (event.ctrlKey && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      this.showHelp = false;
      this.showSearch = false;
      this.selectedNoteId = null;
      this.editingNoteId = null;
      this.isConfirmingDeleteId = null;
      this.triggerFocus();

      const container = document.querySelector('.container');
      if (container) container.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // Escape Handler
    if (event.key === 'Escape') {
      if (this.showHelp || this.showSearch || this.showBin) {
        this.showHelp = false;
        this.showSearch = false;
        this.showBin = false;
        event.preventDefault();
        return;
      }
    }

    // Arrow keys for navigation
    if (this.showBin) {
      if (this.binNotes.length > 0) {
        let currentIndex = this.binNotes.findIndex(n => n.id === this.selectedBinNoteId);
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          const nextIndex = (currentIndex + 1) % this.binNotes.length;
          this.selectedBinNoteId = this.binNotes[nextIndex].id;
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          const prevIndex = (currentIndex - 1 + this.binNotes.length) % this.binNotes.length;
          this.selectedBinNoteId = this.binNotes[prevIndex].id;
        }
      }
      return;
    }

    if (this.selectedNoteId !== null && this.editingNoteId === null && this.isConfirmingDeleteId === null) {
      const list = this.showSearch ? this.getFilteredNotes() : this.notes;
      const currentIndex = list.findIndex(n => n.id === this.selectedNoteId);

      if (currentIndex !== -1) {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          const nextIndex = (currentIndex + 1) % list.length;
          this.selectedNoteId = list[nextIndex].id;
          if (!this.showSearch) this.scrollSelectedIntoView();
        }

        if (event.key === 'ArrowUp') {
          event.preventDefault();
          const prevIndex = (currentIndex - 1 + list.length) % list.length;
          this.selectedNoteId = list[prevIndex].id;
          if (!this.showSearch) this.scrollSelectedIntoView();
        }
      }
    }

    // Enter in Search to select and scroll
    if (this.showSearch && event.key === 'Enter' && this.selectedNoteId) {
      const note = this.notes.find(n => n.id === this.selectedNoteId);
      if (note) this.selectSearchResult(note);
      event.preventDefault();
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

    // Confirm Deletion (Enter)
    if (event.key === 'Enter' && this.isConfirmingDeleteId !== null) {
      event.preventDefault();
      this.deleteNote(this.isConfirmingDeleteId);
      return;
    }

    // Toggle Pin (Ctrl + P)
    if (event.ctrlKey && event.key.toLowerCase() === 'p') {
      event.preventDefault();
      if (this.selectedNoteId !== null) {
        this.togglePin(this.selectedNoteId);
      }
    }

    // While Confirming Delete
    if (this.isConfirmingDeleteId !== null) {
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

  formatDate(dateStr: string): string {
    if (!dateStr) return '';
    try {
      // SQLite format is usually YYYY-MM-DD HH:MM:SS (UTC)
      // Append 'Z' to treat as UTC then convert to local
      const date = new Date(dateStr.replace(' ', 'T') + 'Z');
      return date.toLocaleString('en-GB', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
    } catch {
      return dateStr;
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

  handleNoteKeyDown(event: any) {
    if (event.key === 'Enter') {
      if (event.ctrlKey) {
        // Ctrl + Enter: Insert newline manually since we prevent default on plain Enter
        const target = event.target as HTMLTextAreaElement;
        const start = target.selectionStart;
        const end = target.selectionEnd;
        this.newNote = this.newNote.substring(0, start) + "\n" + this.newNote.substring(end);

        // Return focus and move cursor after next tick
        setTimeout(() => {
          target.selectionStart = target.selectionEnd = start + 1;
        }, 0);
      } else {
        // Plain Enter: Save
        event.preventDefault();
        this.addNote();
      }
    }
  }

  handleEditKeyDown(event: any) {
    if (event.key === 'Enter') {
      if (event.ctrlKey) {
        // Ctrl + Enter: Insert newline
        const target = event.target as HTMLTextAreaElement;
        const start = target.selectionStart;
        const end = target.selectionEnd;
        this.editContent = this.editContent.substring(0, start) + "\n" + this.editContent.substring(end);

        setTimeout(() => {
          target.selectionStart = target.selectionEnd = start + 1;
        }, 0);
      } else {
        // Plain Enter: Save
        event.preventDefault();
        this.updateNote();
      }
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
    // Find index before deleting
    const index = this.notes.findIndex(n => n.id === id);

    try {
      await invoke('delete_note', { id });
      this.isConfirmingDeleteId = null;
      await this.loadNotes();

      if (this.notes.length > 0) {
        // Select next available note at same index, or the last one if we deleted the end item
        const nextIndex = Math.min(index, this.notes.length - 1);
        this.selectedNoteId = this.notes[nextIndex].id;
      } else {
        this.selectedNoteId = null;
        this.triggerFocus();
      }
    } catch (err) {
      console.error(err);
    }
  }

  getFilteredNotes(): Note[] {
    if (!this.searchQuery.trim()) return this.notes;
    return this.notes.filter(n =>
      n.content.toLowerCase().includes(this.searchQuery.toLowerCase())
    );
  }

  selectSearchResult(note: Note) {
    this.showSearch = false;
    this.selectedNoteId = note.id;
    this.scrollSelectedIntoView();
  }

  async togglePin(id: number) {
    try {
      await invoke('toggle_pin', { id });
      await this.loadNotes();
    } catch (err) {
      console.error(err);
    }
  }

  async loadBinNotes() {
    try {
      this.binNotes = await invoke<Note[]>('get_bin_notes');
      if (this.binNotes.length > 0 && this.selectedBinNoteId === null) {
        this.selectedBinNoteId = this.binNotes[0].id;
      }
    } catch (err) {
      console.error(err);
    }
  }

  async restoreNote(id: number) {
    try {
      await invoke('restore_note', { id });
      await this.loadBinNotes();
      await this.loadNotes();
    } catch (err) {
      console.error(err);
    }
  }

  async permanentDeleteNote(id: number) {
    try {
      await invoke('permanent_delete_note', { id });
      await this.loadBinNotes();
    } catch (err) {
      console.error(err);
    }
  }

  async clearBin() {
    try {
      await invoke('clear_bin');
      await this.loadBinNotes();
    } catch (err) {
      console.error(err);
    }
  }

  async minimize() { await getCurrentWindow().minimize(); }
  async maximize() {
    try {
      await invoke('toggle_maximize');
    } catch (err) {
      console.error(err);
    }
  }
  async close() { await getCurrentWindow().close(); }
}

import { Component, HostListener, ViewChild, ElementRef, AfterViewChecked, OnInit, OnDestroy } from '@angular/core';
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

interface Pad {
  id: number;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
}

interface OpenTab {
  padId: number;
  title: string;
}

type AuthStatus = 'SetupRequired' | 'Locked' | 'Unlocked';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent implements AfterViewChecked, OnInit, OnDestroy {
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
  binItems: { id: number, type: 'task' | 'pad', content: string, timestamp: string }[] = [];
  selectedBinItemId: { id: number, type: 'task' | 'pad' } | null = null;
  isConfirmingBinDeleteId: { id: number, type: 'task' | 'pad' } | null = null;
  isConfirmingRestoreId: { id: number, type: 'task' | 'pad' } | null = null;
  isConfirmingClearAll = false;
  @ViewChild('searchInput') searchInput?: ElementRef;
  @ViewChild('padEditor') padEditor?: ElementRef;
  private searchNeedsFocus = false;
  private padEditorNeedsFocus = false;

  // Section switching
  activeSection: 'tasks' | 'notepad' = 'notepad';

  // Notepad state
  pads: Pad[] = [];
  openTabs: OpenTab[] = [];
  activeTabId: number | null = null;
  activePad: Pad | null = null;
  padContent = '';
  lineNumbers: number[] = [1];
  private autoSaveTimer: any = null;

  // Bookmarking/Marking lines
  padLineMarks: { [padId: number]: Set<number> } = {};

  isLineMarked(num: number): boolean {
    if (!this.activeTabId) return false;
    const marks = this.padLineMarks[this.activeTabId];
    return marks ? marks.has(num) : false;
  }

  toggleLineMark(num: number) {
    if (!this.activeTabId) return;
    if (!this.padLineMarks[this.activeTabId]) {
      this.padLineMarks[this.activeTabId] = new Set<number>();
    }
    const marks = this.padLineMarks[this.activeTabId];
    if (marks.has(num)) {
      marks.delete(num);
    } else {
      marks.add(num);
    }
  }

  // Vault Status
  authStatus: AuthStatus = 'Locked';
  password = '';
  errorMessage = '';

  availableFonts = [
    { name: 'Montserrat', family: "'Montserrat', sans-serif" },
    { name: 'Open Sans', family: "'Open Sans', sans-serif" },
    { name: 'Cascadia Code', family: "'Cascadia Code', monospace" },
    { name: 'Fira Code', family: "'Fira Code', monospace" },
    { name: 'JetBrains Mono', family: "'JetBrains Mono', monospace" }
  ];
  selectedFont = 'Montserrat';
  showFontSettings = false;
  focusedFontIndex = 0;

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
        await this.loadPads();
        this.triggerFocus();
      }

      this.startIdleDetection();

      const win = getCurrentWindow();

      const isMax = await win.isMaximized();
      if (isMax) document.body.classList.add('maximized');

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
          if (this.activeSection === 'tasks') {
            this.triggerFocus();
          } else {
            this.triggerPadEditorFocus();
          }
        }
      });
    } catch (err) {
      console.error(err);
    }
    this.loadFont();
  }

  ngOnDestroy() {
    if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
    if (this.idleCheckInterval) clearInterval(this.idleCheckInterval);
  }

  toggleFontSettings() {
    this.showFontSettings = !this.showFontSettings;
    if (this.showFontSettings) {
      this.focusedFontIndex = this.availableFonts.findIndex(f => f.name === this.selectedFont);
      if (this.focusedFontIndex === -1) this.focusedFontIndex = 0;
    }
  }

  loadFont() {
    const saved = localStorage.getItem('selectedFont');
    if (saved) {
      this.setFont(saved);
    } else {
      this.setFont('Montserrat');
    }
  }

  setFont(fontName: string) {
    this.selectedFont = fontName;
    localStorage.setItem('selectedFont', fontName);
    const font = this.availableFonts.find(f => f.name === fontName);
    if (font) {
      document.documentElement.style.setProperty('--main-font', font.family);
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
    if (this.padEditorNeedsFocus && this.padEditor) {
      this.padEditor.nativeElement.focus();
      this.padEditorNeedsFocus = false;
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

  triggerPadEditorFocus() {
    this.padEditorNeedsFocus = true;
  }

  @HostListener('window:keydown', ['$event'])
  handleGlobalKeys(event: KeyboardEvent) {
    this.resetIdleTimer(); // Merge activity reset

    if (this.authStatus !== 'Unlocked') return;

    // Ctrl + Shift + Space: Switch sections
    if (event.ctrlKey && event.shiftKey && event.code === 'Space') {
      event.preventDefault();
      this.switchSection(this.activeSection === 'tasks' ? 'notepad' : 'tasks');
      return;
    }

    // If in notepad section, handle notepad shortcuts then skip task shortcuts
    // If in notepad section, handle notepad specific keys completely here
    if (this.activeSection === 'notepad') {
      // Ctrl + N: New tab
      if (event.ctrlKey && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        this.createPad();
        return;
      }

      // Ctrl + Shift + D: Remove working tab
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        if (this.activeTabId) {
          this.deletePad(this.activeTabId);
        }
        return;
      }
      // Note: We do NOT 'return;' arbitrarily here so that Ctrl+H, Ctrl+B, etc below still run!
    }

    if (this.showFontSettings) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        this.focusedFontIndex = (this.focusedFontIndex + 1) % this.availableFonts.length;
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        this.focusedFontIndex = (this.focusedFontIndex - 1 + this.availableFonts.length) % this.availableFonts.length;
      } else if (event.key === 'Enter') {
        event.preventDefault();
        this.setFont(this.availableFonts[this.focusedFontIndex].name);
        this.showFontSettings = false;
      } else if (event.key === 'Escape') {
        event.preventDefault();
        this.showFontSettings = false;
      }
      return;
    }

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
        this.isConfirmingBinDeleteId = null;
        this.isConfirmingRestoreId = null;
        this.isConfirmingClearAll = false;
        this.loadBinItems();
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

    // --- Section Exclusive Shortcuts ---
    if (this.activeSection === 'notepad' && !this.showBin && !this.showSearch) {
      return; // Skip task-specific shortcuts unless in a global modal
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
      if (this.showBin && (this.isConfirmingBinDeleteId || this.isConfirmingRestoreId || this.isConfirmingClearAll)) {
        this.isConfirmingBinDeleteId = null;
        this.isConfirmingRestoreId = null;
        this.isConfirmingClearAll = false;
        event.preventDefault();
        return;
      }
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
      // Clear All Shortcut (Ctrl + Shift + C)
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'c') {
        event.preventDefault();
        this.isConfirmingClearAll = true;
        return;
      }

      // Enter for Bin confirmations
      if (event.key === 'Enter') {
        if (this.isConfirmingBinDeleteId !== null) {
          event.preventDefault();
          this.permanentDeleteItem(this.isConfirmingBinDeleteId);
          this.isConfirmingBinDeleteId = null;
          return;
        }
        if (this.isConfirmingRestoreId !== null) {
          event.preventDefault();
          this.restoreItem(this.isConfirmingRestoreId);
          this.isConfirmingRestoreId = null;
          return;
        }
        if (this.isConfirmingClearAll) {
          event.preventDefault();
          this.clearBin();
          this.isConfirmingClearAll = false;
          return;
        }
      }

      if (this.binItems.length > 0 && !this.isConfirmingBinDeleteId && !this.isConfirmingRestoreId && !this.isConfirmingClearAll) {
        let currentIndex = this.binItems.findIndex(n => n.id === this.selectedBinItemId?.id && n.type === this.selectedBinItemId?.type);

        // Ctrl + D (Permanent Delete)
        if (event.ctrlKey && event.key.toLowerCase() === 'd') {
          event.preventDefault();
          this.isConfirmingBinDeleteId = this.selectedBinItemId;
          return;
        }
        // Ctrl + R (Restore)
        if (event.ctrlKey && event.key.toLowerCase() === 'r') {
          event.preventDefault();
          this.isConfirmingRestoreId = this.selectedBinItemId;
          return;
        }

        if (event.key === 'ArrowDown') {
          event.preventDefault();
          const nextIndex = (currentIndex + 1) % this.binItems.length;
          this.selectedBinItemId = { id: this.binItems[nextIndex].id, type: this.binItems[nextIndex].type };
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          const prevIndex = (currentIndex - 1 + this.binItems.length) % this.binItems.length;
          this.selectedBinItemId = { id: this.binItems[prevIndex].id, type: this.binItems[prevIndex].type };
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

  switchSection(section: 'tasks' | 'notepad') {
    this.activeSection = section;
    // Close modals
    this.showHelp = false;
    this.showSearch = false;
    this.showBin = false;
    this.showFontSettings = false;

    if (section === 'tasks') {
      this.triggerFocus();
    } else {
      this.triggerPadEditorFocus();
    }
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
      await this.loadPads();

      // Ensure at least one tab is open on startup
      if (this.openTabs.length === 0) {
        if (this.pads.length === 0) {
          await this.createPad();
        } else {
          this.openTab(this.pads[0].id);
        }
      }

      this.triggerPadEditorFocus();
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
      // Reset notepad state
      this.pads = [];
      this.openTabs = [];
      this.activeTabId = null;
      this.activePad = null;
      this.padContent = '';
      this.lineNumbers = [1];
      this.activeSection = 'notepad';
      if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
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

  // ===== Notepad Methods =====

  async loadPads() {
    try {
      this.pads = await invoke<Pad[]>('get_pads');
    } catch (err) {
      console.error(err);
    }
  }

  async createPad() {
    try {
      const id = await invoke<number>('add_pad', { title: 'Untitled', content: '' });
      await this.loadPads();
      this.openTab(id);
    } catch (err) {
      console.error(err);
    }
  }

  getPadTabTitle(pad: Pad): string {
    const firstLine = pad.content.split('\n')[0]?.trim();
    return firstLine || 'Untitled';
  }

  async deletePad(padId: number, event?: MouseEvent) {
    if (event) event.stopPropagation();

    try {
      await invoke('delete_pad', { id: padId });

      const isOpen = this.openTabs.some(t => t.padId === padId);
      if (isOpen) {
        this.closeTab(padId);
      } else {
        await this.loadPads();
      }

      if (this.showBin) {
        this.loadBinItems();
      }
    } catch (err) {
      console.error(err);
    }
  }

  openTab(padId: number) {
    const pad = this.pads.find(p => p.id === padId);
    if (!pad) return;

    if (!this.openTabs.find(t => t.padId === padId)) {
      this.openTabs.push({ padId, title: this.getPadTabTitle(pad) });
    }

    this.activeTabId = padId;
    this.activePad = { ...pad };
    this.padContent = pad.content;
    this.updateLineNumbers();
    this.triggerPadEditorFocus();
  }

  closeTab(padId: number, event?: MouseEvent) {
    if (event) event.stopPropagation();

    if (this.activeTabId === padId && this.activePad) {
      this.savePadNow();
    }

    this.openTabs = this.openTabs.filter(t => t.padId !== padId);

    if (this.openTabs.length === 0) {
      // Always keep at least one tab
      this.createPad();
      return;
    }

    if (this.activeTabId === padId) {
      this.openTab(this.openTabs[this.openTabs.length - 1].padId);
    }
  }

  switchTab(padId: number) {
    if (this.activeTabId === padId) return;
    if (this.activePad) {
      this.savePadNow();
    }
    this.openTab(padId);
  }

  onPadContentChange() {
    this.updateLineNumbers();
    // Update tab title from first line
    const tab = this.openTabs.find(t => t.padId === this.activeTabId);
    if (tab) {
      const firstLine = this.padContent.split('\n')[0]?.trim();
      tab.title = firstLine || 'Untitled';
    }
    this.schedulePadAutoSave();
  }

  updateLineNumbers() {
    const count = this.padContent ? this.padContent.split('\n').length : 1;
    this.lineNumbers = Array.from({ length: count }, (_, i) => i + 1);
  }

  handlePadKeyDown(event: KeyboardEvent, editor: HTMLTextAreaElement) {
    if (event.altKey && event.shiftKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      this.duplicateLine(event.key, editor);
    } else if (event.altKey && !event.shiftKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      this.moveLine(event.key, editor);
    }
  }

  duplicateLine(direction: string, editor: HTMLTextAreaElement) {
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const text = this.padContent;

    let lineStart = text.lastIndexOf('\n', start - 1) + 1;
    let lineEnd = text.indexOf('\n', end);
    if (lineEnd === -1) lineEnd = text.length;

    const selectedLines = text.substring(lineStart, lineEnd);

    const before = text.substring(0, lineStart);
    const after = text.substring(lineEnd);

    this.padContent = before + selectedLines + '\n' + selectedLines + after;
    this.onPadContentChange();

    setTimeout(() => {
      if (direction === 'ArrowUp') {
        editor.setSelectionRange(start, end);
      } else {
        const offset = selectedLines.length + 1;
        editor.setSelectionRange(start + offset, end + offset);
      }
    });
  }

  moveLine(direction: string, editor: HTMLTextAreaElement) {
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const text = this.padContent;

    let lineStart = text.lastIndexOf('\n', start - 1) + 1;
    let lineEnd = text.indexOf('\n', end);
    // If exact end is on newline, avoid selecting the next line
    if (end > start && text[end - 1] === '\n') {
      lineEnd = end - 1;
    } else if (lineEnd === -1) {
      lineEnd = text.length;
    }

    const selectedLines = text.substring(lineStart, lineEnd);

    if (direction === 'ArrowUp') {
      if (lineStart === 0) return;
      let prevLineStart = text.lastIndexOf('\n', lineStart - 2) + 1;
      const prevLineText = text.substring(prevLineStart, lineStart - 1);

      const before = text.substring(0, prevLineStart);
      const after = text.substring(lineEnd);

      this.padContent = before + selectedLines + '\n' + prevLineText + after;
      this.onPadContentChange();

      const offset = -(prevLineText.length + 1);
      setTimeout(() => {
        editor.setSelectionRange(start + offset, end + offset);
      });
    } else {
      if (lineEnd === text.length) return;
      let nextLineEnd = text.indexOf('\n', lineEnd + 1);
      if (nextLineEnd === -1) nextLineEnd = text.length;

      const nextLineText = text.substring(lineEnd + 1, nextLineEnd);

      const before = text.substring(0, lineStart);
      const after = text.substring(nextLineEnd);

      this.padContent = before + nextLineText + '\n' + selectedLines + after;
      this.onPadContentChange();

      const offset = nextLineText.length + 1;
      setTimeout(() => {
        editor.setSelectionRange(start + offset, end + offset);
      });
    }
  }

  onEditorScroll(event: Event) {
    const editor = event.target as HTMLElement;
    const gutter = document.querySelector('.line-gutter') as HTMLElement;
    if (gutter) {
      gutter.scrollTop = editor.scrollTop;
    }
  }

  private schedulePadAutoSave() {
    if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
    this.autoSaveTimer = setTimeout(() => {
      this.savePadNow();
    }, 500);
  }

  private async savePadNow() {
    if (!this.activePad) return;
    const firstLine = this.padContent.split('\n')[0]?.trim();
    const title = firstLine || 'Untitled';
    try {
      await invoke('update_pad', {
        id: this.activePad.id,
        title,
        content: this.padContent
      });
      const pad = this.pads.find(p => p.id === this.activePad!.id);
      if (pad) {
        pad.title = title;
        pad.content = this.padContent;
        pad.updated_at = new Date().toISOString().replace('T', ' ').substring(0, 19);
      }
      this.activePad.title = title;
      this.activePad.content = this.padContent;
    } catch (err) {
      console.error(err);
    }
  }


  async loadBinItems() {
    try {
      const notes = await invoke<Note[]>('get_bin_notes');
      const pads = await invoke<Pad[]>('get_bin_pads');

      this.binItems = [
        ...notes.map(n => ({ id: n.id, type: 'task' as 'task' | 'pad', content: n.content, timestamp: n.timestamp })),
        ...pads.map(p => ({ id: p.id, type: 'pad' as 'task' | 'pad', content: this.getPadTabTitle(p), timestamp: p.updated_at }))
      ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      if (this.binItems.length > 0 && this.selectedBinItemId === null) {
        this.selectedBinItemId = { id: this.binItems[0].id, type: this.binItems[0].type };
      }
    } catch (err) {
      console.error(err);
    }
  }

  async restoreItem(item: { id: number, type: 'task' | 'pad' }) {
    try {
      if (item.type === 'task') {
        await invoke('restore_note', { id: item.id });
        await this.loadNotes();
      } else {
        await invoke('restore_pad', { id: item.id });
        await this.loadPads();

        // Re-open the tab if it's a pad so it's visible to the user immediately
        this.openTab(item.id);
      }
      await this.loadBinItems();
    } catch (err) {
      console.error(err);
    }
  }

  async permanentDeleteItem(item: { id: number, type: 'task' | 'pad' }) {
    try {
      if (item.type === 'task') {
        await invoke('permanent_delete_note', { id: item.id });
      } else {
        await invoke('permanent_delete_pad', { id: item.id });
      }
      await this.loadBinItems();
    } catch (err) {
      console.error(err);
    }
  }

  async clearBin() {
    try {
      await invoke('clear_bin');
      await invoke('clear_pad_bin');
      await this.loadBinItems();
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

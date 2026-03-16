import {
  Component,
  HostListener,
  ViewChild,
  ElementRef,
  AfterViewChecked,
  OnInit,
  OnDestroy,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { RouterOutlet } from "@angular/router";
import { FormsModule } from "@angular/forms";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";
import { save, open } from "@tauri-apps/plugin-dialog";

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
  is_deleted: boolean;
  is_open: boolean;
  is_active: boolean;
  tab_index: number;
}

type AuthStatus = "SetupRequired" | "Locked" | "Unlocked" | "Checking";

@Component({
  selector: "app-root",
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: "./app.component.html",
  styleUrl: "./app.component.css",
})
export class AppComponent implements AfterViewChecked, OnInit, OnDestroy {
  @ViewChild("noteInput") noteInput!: ElementRef<HTMLDivElement>;
  @ViewChild("editInput") editInput?: ElementRef<HTMLDivElement>;
  private needsFocus = false;
  private editNeedsFocus = false;

  notes: Note[] = [];
  selectedNoteId: number | null = null;
  editingNoteId: number | null = null;
  isConfirmingDeleteId: number | null = null;
  autoStartEnabled = false;
  showHelp = false;
  showSearch = false;
  showBin = false;
  searchQuery = "";
  binItems: {
    id: number;
    type: "task" | "pad";
    content: string;
    timestamp: string;
  }[] = [];
  selectedBinItemId: { id: number; type: "task" | "pad" } | null = null;
  isConfirmingBinDeleteId: { id: number; type: "task" | "pad" } | null = null;
  isConfirmingRestoreId: { id: number; type: "task" | "pad" } | null = null;
  isConfirmingClearAll = false;
  @ViewChild("searchInput") searchInput?: ElementRef;
  @ViewChild("padEditor") padEditor?: ElementRef<HTMLDivElement>;
  private searchNeedsFocus = false;
  private padEditorNeedsFocus = false;
  isConfirmingPadCloseId: number | null = null;

  // Section switching
  activeSection: "tasks" | "notepad" = "notepad";

  // Notepad state
  pads: Pad[] = [];
  activeTabId: number | null = null;
  activePad: Pad | null = null;
  padContent = "";
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
  authStatus: AuthStatus = "Checking";
  password = "";
  errorMessage = "";
  isDarkMode = false;
  appVersion = "1.0.0";

  private async saveSession() {
    // Deprecated
  }

  private async loadSession() {
    // Session is now part of loadPads -> auto-select active pad
    if (this.pads.length === 0) {
      await this.createPad();
    } else {
      const activePad = this.pads.find(p => p.is_active);
      if (activePad) {
        this.openTab(activePad.id, true);
      } else {
        const firstOpen = this.pads.find(p => p.is_open);
        if (firstOpen) {
          this.openTab(firstOpen.id);
        } else {
          // Migration/Cleanup: if nothing open but pads exist, open first
          this.openTab(this.pads[0].id);
        }
      }
    }
  }
  availableFonts: { name: string; family: string; isCustom?: boolean }[] = [
    { name: "Cascadia Code", family: "'Cascadia Code', monospace" },
    { name: "Fira Code", family: "'Fira Code', monospace" },
    { name: "JetBrains Mono", family: "'JetBrains Mono', monospace" },
  ];
  selectedFont = "Cascadia Code";
  showFontSettings = false;
  focusedFontIndex = 0;
  spellCheckEnabled = localStorage.getItem('spellcheck') === 'true';

  // Idle Detection
  private idleTimeout = 10 * 60 * 1000; // 10 minutes
  private lastActivity = Date.now();
  private idleCheckInterval: any;

  async ngOnInit() {
    await this.loadCustomFonts();
    try {
      this.autoStartEnabled = await isEnabled();
    } catch (err) {
      console.warn("Autostart plugin not available:", err);
    }

    try {
      this.authStatus = await invoke<AuthStatus>("check_auth_status");

      if (this.authStatus === "Unlocked") {
        await this.loadNotes();
        await this.loadPads();
        this.loadSession();
        this.triggerFocus();
      }

      this.startIdleDetection();

      const win = getCurrentWindow();

      const isMax = await win.isMaximized();
      if (isMax) document.body.classList.add("maximized");

      await win.onResized(async () => {
        const currentlyMax = await win.isMaximized();
        if (currentlyMax) {
          document.body.classList.add("maximized");
        } else {
          document.body.classList.remove("maximized");
        }
      });

      win.onFocusChanged(({ payload: focused }) => {
        if (focused && this.authStatus === "Unlocked") {
          if (this.activeSection === "tasks") {
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
    this.loadDarkMode();
  }

  ngOnDestroy() {
    if (this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer);
      this.savePadNow();
    }
    if (this.idleCheckInterval) clearInterval(this.idleCheckInterval);
    this.saveSession();
  }

  @HostListener("window:beforeunload")
  onBeforeUnload() {
    if (this.autoSaveTimer) {
      this.savePadNow();
    }
  }

  toggleFontSettings() {
    this.showFontSettings = !this.showFontSettings;
    if (this.showFontSettings) {
      this.focusedFontIndex = this.availableFonts.findIndex(
        (f) => f.name === this.selectedFont,
      );
      if (this.focusedFontIndex === -1) this.focusedFontIndex = 0;
    }
  }

  loadFont() {
    const saved = localStorage.getItem("selectedFont");
    if (saved) {
      this.setFont(saved);
    } else {
      this.setFont("Cascadia Code");
    }
  }

  setFont(fontName: string) {
    this.selectedFont = fontName;
    localStorage.setItem("selectedFont", fontName);
    const font = this.availableFonts.find((f) => f.name === fontName);
    if (font) {
      document.documentElement.style.setProperty("--main-font", font.family);
    }
  }

  loadDarkMode() {
    const saved = localStorage.getItem("darkMode");
    if (saved === "true" || (saved === null && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
      this.isDarkMode = true;
      document.body.classList.add("dark-mode");
    }
  }

  toggleDarkMode() {
    this.isDarkMode = !this.isDarkMode;
    localStorage.setItem("darkMode", this.isDarkMode.toString());
    if (this.isDarkMode) {
      document.body.classList.add("dark-mode");
    } else {
      document.body.classList.remove("dark-mode");
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

  @HostListener("window:keydown", ["$event"])
  handleGlobalKeys(event: KeyboardEvent) {
    this.resetIdleTimer(); // Merge activity reset

    if (this.authStatus !== "Unlocked") return;

    // Ctrl + Shift + Space: Switch sections
    if (event.ctrlKey && event.shiftKey && event.code === "Space") {
      event.preventDefault();
      this.switchSection(this.activeSection === "tasks" ? "notepad" : "tasks");
      return;
    }

    // If in notepad section, handle notepad shortcuts then skip task shortcuts
    // If in notepad section, handle notepad specific keys completely here
    if (this.activeSection === "notepad") {
      // Ctrl + S: Save Notepad to local
      if (event.ctrlKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (this.activeTabId) {
          this.downloadPadToLocal(this.activeTabId, false);
        }
        return;
      }

      // Ctrl + Space: Cycle tabs
      if (event.ctrlKey && !event.shiftKey && event.code === "Space") {
        event.preventDefault();
        this.cycleTab();
        return;
      }

      // Ctrl + N: New tab
      if (event.ctrlKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        this.createPad();
        return;
      }

      // Ctrl + Shift + D: Remove working tab
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "d") {
        event.preventDefault();
        if (this.activeTabId) {
          this.closeTab(this.activeTabId);
        }
        return;
      }
      // Note: We do NOT 'return;' arbitrarily here so that Ctrl+H, Ctrl+B, etc below still run!
    }

    if (this.showFontSettings) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        this.focusedFontIndex =
          (this.focusedFontIndex + 1) % this.availableFonts.length;
        this.scrollSelectedFontIntoView();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        this.focusedFontIndex =
          (this.focusedFontIndex - 1 + this.availableFonts.length) %
          this.availableFonts.length;
        this.scrollSelectedFontIntoView();
      } else if (event.key === "Enter") {
        event.preventDefault();
        this.setFont(this.availableFonts[this.focusedFontIndex].name);
        this.showFontSettings = false;
      } else if (event.key === "Escape") {
        event.preventDefault();
        this.showFontSettings = false;
      }
      return;
    }

    // Toggle Help (Ctrl + H)
    if (event.ctrlKey && event.key.toLowerCase() === "h") {
      event.preventDefault();
      this.showHelp = !this.showHelp;
    }

    // Toggle Bin (Ctrl + Shift + B)
    if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "b") {
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
      return;
    }

    // Toggle Search (Ctrl + F)
    if (event.ctrlKey && event.key.toLowerCase() === "f") {
      event.preventDefault();
      this.showSearch = !this.showSearch;
      if (this.showSearch) {
        this.showHelp = false;
        this.searchQuery = "";
        this.triggerSearchFocus();
      }
    }

    // Pad Close Confirmation Handler
    if (this.isConfirmingPadCloseId !== null) {
      if (event.ctrlKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        this.handlePadCloseModalAction('save');
        return;
      }
      if (event.ctrlKey && event.key.toLowerCase() === "d") {
        event.preventDefault();
        this.handlePadCloseModalAction('delete');
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        this.handlePadCloseModalAction('cancel');
        return;
      }
      // If we are confirming a pad close, block all other global shortcuts from firing
      event.preventDefault();
      return;
    }

    // Escape Handler
    if (event.key === "Escape") {
      if (
        this.showBin &&
        (this.isConfirmingBinDeleteId ||
          this.isConfirmingRestoreId ||
          this.isConfirmingClearAll)
      ) {
        this.isConfirmingBinDeleteId = null;
        this.isConfirmingRestoreId = null;
        this.isConfirmingClearAll = false;
        event.preventDefault();
        return;
      }
      if (
        this.showHelp ||
        this.showSearch ||
        this.showBin ||
        this.isConfirmingPadCloseId
      ) {
        this.showHelp = false;
        this.showSearch = false;
        this.showBin = false;
        this.isConfirmingPadCloseId = null;
        event.preventDefault();
        return;
      }
    }

    // --- Section Exclusive Shortcuts ---
    if (
      this.activeSection === "notepad" &&
      !this.showBin &&
      !this.showSearch &&
      !this.showHelp
    ) {
      return; // Skip task-specific shortcuts unless in a global modal
    }

    // --- List Navigation & Focus ---

    // Ctrl + L: Focus List / Select first note
    if (event.ctrlKey && event.key.toLowerCase() === "l") {
      event.preventDefault();
      this.showHelp = false;
      const list = this.showSearch ? this.getFilteredNotes() : this.notes;
      if (list.length > 0) {
        if (
          this.selectedNoteId === null ||
          !list.find((n) => n.id === this.selectedNoteId)
        ) {
          this.selectedNoteId = list[0].id;
        }
        this.editingNoteId = null;
        this.isConfirmingDeleteId = null;
      }
    }

    // Ctrl + A: Focus Input
    if (event.ctrlKey && event.key.toLowerCase() === "a") {
      event.preventDefault();
      this.showHelp = false;
      this.showSearch = false;
      this.selectedNoteId = null;
      this.editingNoteId = null;
      this.isConfirmingDeleteId = null;
      this.triggerFocus();

      const container = document.querySelector(".container");
      if (container) container.scrollTo({ top: 0, behavior: "smooth" });
    }

    // Arrow keys for navigation
    if (this.showBin) {
      // Clear All Shortcut (Ctrl + Shift + C)
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "c") {
        event.preventDefault();
        this.isConfirmingClearAll = true;
        return;
      }

      // Enter for Bin confirmations
      if (event.key === "Enter") {
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

      if (
        this.binItems.length > 0 &&
        !this.isConfirmingBinDeleteId &&
        !this.isConfirmingRestoreId &&
        !this.isConfirmingClearAll
      ) {
        let currentIndex = this.binItems.findIndex(
          (n) =>
            n.id === this.selectedBinItemId?.id &&
            n.type === this.selectedBinItemId?.type,
        );

        // Ctrl + D (Permanent Delete)
        if (event.ctrlKey && event.key.toLowerCase() === "d") {
          event.preventDefault();
          this.isConfirmingBinDeleteId = this.selectedBinItemId;
          return;
        }
        // Ctrl + R (Restore)
        if (event.ctrlKey && event.key.toLowerCase() === "r") {
          event.preventDefault();
          this.isConfirmingRestoreId = this.selectedBinItemId;
          return;
        }

        if (event.key === "ArrowDown") {
          event.preventDefault();
          const nextIndex = (currentIndex + 1) % this.binItems.length;
          this.selectedBinItemId = {
            id: this.binItems[nextIndex].id,
            type: this.binItems[nextIndex].type,
          };
          this.scrollSelectedBinIntoView();
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          const prevIndex =
            (currentIndex - 1 + this.binItems.length) % this.binItems.length;
          this.selectedBinItemId = {
            id: this.binItems[prevIndex].id,
            type: this.binItems[prevIndex].type,
          };
          this.scrollSelectedBinIntoView();
        }
      }
      return;
    }

    if (
      this.selectedNoteId !== null &&
      this.editingNoteId === null &&
      this.isConfirmingDeleteId === null
    ) {
      const list = this.showSearch ? this.getFilteredNotes() : this.notes;
      const currentIndex = list.findIndex((n) => n.id === this.selectedNoteId);

      if (currentIndex !== -1) {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          const nextIndex = (currentIndex + 1) % list.length;
          this.selectedNoteId = list[nextIndex].id;
          if (!this.showSearch) {
            this.scrollSelectedIntoView();
          } else {
            this.scrollSelectedSearchResultIntoView();
          }
        }

        if (event.key === "ArrowUp") {
          event.preventDefault();
          const prevIndex = (currentIndex - 1 + list.length) % list.length;
          this.selectedNoteId = list[prevIndex].id;
          if (!this.showSearch) {
            this.scrollSelectedIntoView();
          } else {
            this.scrollSelectedSearchResultIntoView();
          }
        }
      }
    }

    // Enter in Search to select and scroll
    if (this.showSearch && event.key === "Enter" && this.selectedNoteId) {
      const note = this.notes.find((n) => n.id === this.selectedNoteId);
      if (note) this.selectSearchResult(note);
      event.preventDefault();
    }

    // --- Actions on Selected Note ---

    if (this.selectedNoteId !== null && this.editingNoteId === null) {
      // Ctrl + E: Edit
      if (event.ctrlKey && event.key.toLowerCase() === "e") {
        event.preventDefault();
        const note = this.notes.find((n) => n.id === this.selectedNoteId);
        if (note) this.startEdit(note);
      }
      // Ctrl + D: Delete Confirmation
      if (event.ctrlKey && event.key.toLowerCase() === "d") {
        event.preventDefault();
        this.isConfirmingDeleteId = this.selectedNoteId;
      }
    }

    // While Editing
    if (this.editingNoteId !== null) {
      if (event.ctrlKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        this.updateNote();
      }
      if (event.key === "Escape") {
        event.preventDefault();
        this.cancelEdit();
      }
    }

    // Confirm Deletion (Enter)
    if (event.key === "Enter" && this.isConfirmingDeleteId !== null) {
      event.preventDefault();
      this.deleteNote(this.isConfirmingDeleteId);
      return;
    }

    // Toggle Pin (Ctrl + P)
    if (event.ctrlKey && event.key.toLowerCase() === "p") {
      event.preventDefault();
      if (this.selectedNoteId !== null) {
        this.togglePin(this.selectedNoteId);
      }
    }

    // While Confirming Delete
    if (this.isConfirmingDeleteId !== null) {
      if (event.key === "Escape") {
        event.preventDefault();
        this.isConfirmingDeleteId = null;
      }
    }
  }

  private scrollSelectedIntoView() {
    setTimeout(() => {
      const element = document.querySelector(".note-card.selected");
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }, 10);
  }

  private scrollSelectedBinIntoView() {
    setTimeout(() => {
      const element = document.querySelector(".bin-item.selected");
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }, 10);
  }

  private scrollSelectedSearchResultIntoView() {
    setTimeout(() => {
      const element = document.querySelector(".search-result-item.selected");
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }, 10);
  }

  private scrollSelectedFontIntoView() {
    setTimeout(() => {
      const element = document.querySelector(".font-item.focused");
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }, 10);
  }

  @HostListener("window:mousemove")
  @HostListener("window:click")
  @HostListener("window:scroll")
  resetIdleTimer() {
    this.lastActivity = Date.now();
  }

  startIdleDetection() {
    // Disabled as per user request to never ask for password again after first setup.
    /*
    if (this.idleCheckInterval) clearInterval(this.idleCheckInterval);
    this.idleCheckInterval = setInterval(() => {
      if (this.authStatus === "Unlocked") {
        const now = Date.now();
        if (now - this.lastActivity > this.idleTimeout) {
          this.lockVault();
        }
      }
    }, 10000);
    */
  }

  switchSection(section: "tasks" | "notepad") {
    this.activeSection = section;
    // Close modals
    this.showHelp = false;
    this.showSearch = false;
    this.showBin = false;
    this.showFontSettings = false;

    if (section === "tasks") {
      this.triggerFocus();
    } else {
      this.triggerPadEditorFocus();
    }
  }

  async unlockVault() {
    if (!this.password.trim()) return;
    try {
      this.errorMessage = "";
      await invoke("unlock_db", { password: this.password });
      this.authStatus = "Unlocked";
      this.password = "";
      this.lastActivity = Date.now();
      this.startIdleDetection();
      await this.loadNotes();
      await this.loadPads();
      this.loadSession();
      this.triggerPadEditorFocus();
    } catch (err: any) {
      this.errorMessage = err.toString();
    }
  }

  async lockVault() {
    // Manual locking is disabled as per user request to 'never ask again'.
    /*
    try {
      await invoke("lock_vault");
      this.authStatus = "Locked";
      this.notes = [];
      this.newNote = "";
      this.password = "";
      this.selectedNoteId = null;
      this.editingNoteId = null;
      this.pads = [];
      this.activeTabId = null;
      this.activePad = null;
      this.padContent = "";
      this.lineNumbers = [1];
      this.activeSection = "notepad";
      if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
      if (this.idleCheckInterval) clearInterval(this.idleCheckInterval);
    } catch (err) {
      console.error(err);
    }
    */
  }

  async loadNotes() {
    try {
      this.notes = await invoke<Note[]>("get_notes");
    } catch (err) {
      console.error(err);
    }
  }

  formatDate(dateStr: string): string {
    if (!dateStr) return "";
    try {
      // SQLite format is usually YYYY-MM-DD HH:MM:SS (UTC)
      // Append 'Z' to treat as UTC then convert to local
      const date = new Date(dateStr.replace(" ", "T") + "Z");
      return date.toLocaleString("en-GB", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
    } catch {
      return dateStr;
    }
  }

  async addNote() {
    const content = this.noteInput.nativeElement.innerHTML.trim();
    if (!content) return;
    try {
      await invoke("add_note", { content });
      this.noteInput.nativeElement.innerHTML = "";
      await this.loadNotes();
      this.selectedNoteId = null;
      this.triggerFocus();
    } catch (err) {
      console.error(err);
    }
  }

  handleNoteKeyDown(event: KeyboardEvent) {
    if (event.ctrlKey) {
      const key = event.key.toLowerCase();
      if (key === 'b' || key === 'i' || key === 'u') {
        event.preventDefault();
        const command = key === 'b' ? 'bold' : key === 'i' ? 'italic' : 'underline';
        document.execCommand(command, false);
        return;
      }
    }

    if (event.key === "Enter") {
      if (!event.ctrlKey && !event.shiftKey) {
        // Plain Enter: Save
        event.preventDefault();
        this.addNote();
      }
      // Ctrl+Enter and Shift+Enter will naturally insert newline/div in contenteditable
    }
  }

  handleEditKeyDown(event: KeyboardEvent, note: Note) {
    if (event.ctrlKey) {
      const key = event.key.toLowerCase();
      if (key === 'b' || key === 'i' || key === 'u') {
        event.preventDefault();
        const command = key === 'b' ? 'bold' : key === 'i' ? 'italic' : 'underline';
        document.execCommand(command, false);
        return;
      }
    }

    if (event.key === "Enter") {
      if (!event.ctrlKey && !event.shiftKey) {
        // Plain Enter: Save
        event.preventDefault();
        this.updateNote();
      }
    }

    if (event.key === "Escape") {
      event.preventDefault();
      this.cancelEdit();
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
    console.log("Note selected:", this.selectedNoteId);
  }

  startEdit(note: Note) {
    this.editingNoteId = note.id;
    this.triggerEditFocus();
  }

  cancelEdit() {
    this.editingNoteId = null;
    this.triggerFocus();
  }

  async updateNote() {
    if (this.editingNoteId === null || !this.editInput) return;
    const content = this.editInput.nativeElement.innerHTML.trim();
    try {
      await invoke("update_note", { id: this.editingNoteId, content });
      this.editingNoteId = null;
      await this.loadNotes();
    } catch (err) {
      console.error(err);
    }
  }

  async deleteNote(id: number) {
    // Find index before deleting
    const index = this.notes.findIndex((n) => n.id === id);

    try {
      await invoke("delete_note", { id });
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
    return this.notes.filter((n) =>
      n.content.toLowerCase().includes(this.searchQuery.toLowerCase()),
    );
  }

  selectSearchResult(note: Note) {
    this.showSearch = false;
    this.selectedNoteId = note.id;
    this.scrollSelectedIntoView();
  }

  async togglePin(id: number) {
    try {
      await invoke("toggle_pin", { id });
      await this.loadNotes();
    } catch (err) {
      console.error(err);
    }
  }

  // ===== Notepad Methods =====

  async loadPads() {
    try {
      this.pads = await invoke<Pad[]>("get_pads");
    } catch (err) {
      console.error(err);
    }
  }

  async createPad() {
    try {
      const id = await invoke<number>("add_pad", {
        title: "Untitled",
        content: "",
      });
      await this.loadPads();
      this.openTab(id);
    } catch (err) {
      console.error(err);
    }
  }

  getPadTabTitle(pad: Pad): string {
    // If it's a contenteditable blob, we extract text and get first line
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = pad.content;
    const text = tempDiv.innerText || '';
    const firstLine = text.split("\n")[0]?.trim();
    return firstLine || "Untitled";
  }

  async deletePad(padId: number, event?: MouseEvent) {
    if (event) event.stopPropagation();

    try {
      await invoke("delete_pad", { id: padId });

      const padToDelete = this.pads.find(p => p.id === padId);
      if (padToDelete && padToDelete.is_open) {
        this.forceCloseTabUI(padId);
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

  async openTab(padId: number, skipMetadata = false) {
    const pad = this.pads.find((p) => p.id === padId);
    if (!pad) return;

    if (!skipMetadata) {
      await invoke("update_pad_metadata", {
        id: padId,
        is_open: true,
        is_active: true,
      });
      await this.loadPads();
    }

    this.activeTabId = padId;
    this.activePad = { ...pad };
    this.padContent = pad.content;

    setTimeout(() => {
      if (this.padEditor) {
        this.padEditor.nativeElement.innerHTML = this.padContent;
        this.updateLineNumbers();
        this.triggerPadEditorFocus();
      }
    });
  }

  get openOrderedTabs(): Pad[] {
    return this.pads
      .filter((p) => p.is_open && !p.is_deleted)
      .sort((a, b) => a.tab_index - b.tab_index);
  }

  closeTab(padId: number, event?: MouseEvent) {
    if (event) event.stopPropagation();
    this.isConfirmingPadCloseId = padId;
  }

  async handlePadCloseModalAction(action: 'save' | 'delete' | 'cancel') {
    if (!this.isConfirmingPadCloseId) return;
    const padId = this.isConfirmingPadCloseId;

    if (action === 'cancel') {
      this.isConfirmingPadCloseId = null;
      return;
    }

    if (action === 'save') {
      this.isConfirmingPadCloseId = null;
      await this.downloadPadToLocal(padId, true);
    } else if (action === 'delete') {
      this.isConfirmingPadCloseId = null;
      await this.deletePad(padId);
      await this._closeTabInternal(padId);
    }
  }

  private async _closeTabInternal(padId: number) {
    if (this.activeTabId === padId) {
      const tabs = this.openOrderedTabs;
      const currentIndex = tabs.findIndex((t) => t.id === padId);
      let nextId: number | null = null;

      if (tabs.length > 1) {
        if (currentIndex < tabs.length - 1) {
          nextId = tabs[currentIndex + 1].id;
        } else {
          nextId = tabs[currentIndex - 1].id;
        }
      }

      await invoke("update_pad_metadata", { id: padId, is_open: false, is_active: false });
      if (nextId) {
        await this.openTab(nextId);
      } else {
        this.activeTabId = null;
        this.activePad = null;
        this.padContent = "";
        await this.loadPads();
        if (this.openOrderedTabs.length === 0) {
          await this.createPad();
        }
      }
    } else {
      await invoke("update_pad_metadata", { id: padId, is_open: false });
      await this.loadPads();
    }
  }

  async downloadPadToLocal(padId: number, closeTabAfter: boolean) {
    const pad = this.pads.find((p) => p.id === padId);
    if (!pad) return;

    let contentToSave = pad.content;
    let titleToSave = this.getPadTabTitle(pad);
    if (this.activeTabId === padId) {
      contentToSave = this.padContent;
    }

    try {
      const filePath = await save({
        filters: [{ name: "Text Document", extensions: ["txt", "md"] }],
        defaultPath: `${titleToSave}.txt`,
        title: "Download Pad to Local Computer",
      });

      if (filePath) {
        await invoke("save_file_to_local", {
          path: filePath,
          content: contentToSave,
        });
        if (closeTabAfter) {
          this._closeTabInternal(padId);
        }
      }
    } catch (err) {
      console.error(err);
    }
  }

  async forceCloseTabUI(padId: number) {
    // Deprecated, use _closeTabInternal
    await this._closeTabInternal(padId);
  }

  async cycleTab() {
    const tabs = this.openOrderedTabs;
    if (tabs.length <= 1) return;
    const currentIdx = tabs.findIndex((t) => t.id === this.activeTabId);
    const nextIdx = (currentIdx + 1) % tabs.length;
    await this.openTab(tabs[nextIdx].id);
  }

  async switchTab(padId: number) {
    if (this.activeTabId === padId) return;
    if (this.activePad) {
      this.savePadNow();
    }
    await this.openTab(padId);
  }

  onPadInput() {
    if (this.padEditor) {
      this.padContent = this.padEditor.nativeElement.innerHTML;
      this.onPadContentChange();
    }
  }

  onPadContentChange() {
    this.updateLineNumbers();
    const pad = this.pads.find((p) => p.id === this.activeTabId);
    if (pad) {
      if (!this.padEditor) return;
      // Get title from text content only
      const text = this.padEditor.nativeElement.innerText || '';
      const firstLine = text.split("\n")[0]?.trim();
      pad.title = firstLine || "Untitled";
    }
    this.schedulePadAutoSave();
  }

  updateLineNumbers() {
    if (!this.padEditor) return;
    const text = this.padEditor.nativeElement.innerText;
    const count = text ? text.split("\n").length : 1;
    this.lineNumbers = Array.from({ length: count }, (_, i) => i + 1);
  }

  handlePadKeyDown(event: KeyboardEvent, editor: HTMLElement) {
    if (
      this.showHelp ||
      this.showSearch ||
      this.showBin ||
      this.isConfirmingPadCloseId !== null
    ) {
      event.preventDefault();
      return;
    }
    if (event.ctrlKey) {
      const key = event.key.toLowerCase();
      if (key === 'b' || key === 'i' || key === 'u') {
        event.preventDefault();
        const command = key === 'b' ? 'bold' : key === 'i' ? 'italic' : 'underline';
        document.execCommand(command, false);
        this.onPadInput();
        return;
      }
    }

    if (
      event.altKey &&
      event.shiftKey &&
      (event.key === "ArrowUp" || event.key === "ArrowDown")
    ) {
      event.preventDefault();
      this.duplicateLine(event.key, editor);
    } else if (
      event.altKey &&
      !event.shiftKey &&
      (event.key === "ArrowUp" || event.key === "ArrowDown")
    ) {
      event.preventDefault();
      this.moveLine(event.key, editor);
    }
  }


  duplicateLine(direction: string, editor: any) {
    if (editor instanceof HTMLTextAreaElement) {
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      const text = this.padContent;

      let lineStart = text.lastIndexOf("\n", start - 1) + 1;
      let lineEnd = text.indexOf("\n", end);
      if (lineEnd === -1) lineEnd = text.length;

      const selectedLines = text.substring(lineStart, lineEnd);

      const before = text.substring(0, lineStart);
      const after = text.substring(lineEnd);

      this.padContent = before + selectedLines + "\n" + selectedLines + after;
      this.onPadContentChange();

      setTimeout(() => {
        if (direction === "ArrowUp") {
          editor.setSelectionRange(start, end);
        } else {
          const offset = selectedLines.length + 1;
          editor.setSelectionRange(start + offset, end + offset);
        }
      });
    }
  }

  moveLine(direction: string, editor: any) {
    if (editor instanceof HTMLTextAreaElement) {
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      const text = this.padContent;

      let lineStart = text.lastIndexOf("\n", start - 1) + 1;
      let lineEnd = text.indexOf("\n", end);
      // If exact end is on newline, avoid selecting the next line
      if (end > start && text[end - 1] === "\n") {
        lineEnd = end - 1;
      } else if (lineEnd === -1) {
        lineEnd = text.length;
      }

      const selectedLines = text.substring(lineStart, lineEnd);

      if (direction === "ArrowUp") {
        if (lineStart === 0) return;
        let prevLineStart = text.lastIndexOf("\n", lineStart - 2) + 1;
        const prevLineText = text.substring(prevLineStart, lineStart - 1);

        const before = text.substring(0, prevLineStart);
        const after = text.substring(lineEnd);

        this.padContent = before + selectedLines + "\n" + prevLineText + after;
        this.onPadContentChange();

        const offset = -(prevLineText.length + 1);
        setTimeout(() => {
          editor.setSelectionRange(start + offset, end + offset);
        });
      } else {
        if (lineEnd === text.length) return;
        let nextLineEnd = text.indexOf("\n", lineEnd + 1);
        if (nextLineEnd === -1) nextLineEnd = text.length;

        const nextLineText = text.substring(lineEnd + 1, nextLineEnd);

        const before = text.substring(0, lineStart);
        const after = text.substring(nextLineEnd);

        this.padContent = before + nextLineText + "\n" + selectedLines + after;
        this.onPadContentChange();

        const offset = nextLineText.length + 1;
        setTimeout(() => {
          editor.setSelectionRange(start + offset, end + offset);
        });
      }
    }
  }

  onEditorScroll(event: Event) {
    const editor = event.target as HTMLElement;
    const gutter = document.querySelector(".line-gutter") as HTMLElement;
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
    if (!this.activePad || !this.padEditor) return;
    const text = this.padEditor.nativeElement.innerText || '';
    const firstLine = text.split("\n")[0]?.trim();
    const title = firstLine || "Untitled";
    try {
      await invoke("update_pad", {
        id: this.activePad.id,
        title,
        content: this.padContent,
      });

      const pad = this.pads.find((p) => p.id === this.activePad!.id);
      if (pad) {
        pad.title = title;
        pad.content = this.padContent;
        pad.updated_at = new Date()
          .toISOString()
          .replace("T", " ")
          .substring(0, 19);
      }
      this.activePad.title = title;
      this.activePad.content = this.padContent;
    } catch (err) {
      console.error(err);
    }
  }

  async loadBinItems() {
    try {
      const notes = await invoke<Note[]>("get_bin_notes");
      const pads = await invoke<Pad[]>("get_bin_pads");

      this.binItems = [
        ...notes.map((n) => ({
          id: n.id,
          type: "task" as "task" | "pad",
          content: n.content,
          timestamp: n.timestamp,
        })),
        ...pads.map((p) => ({
          id: p.id,
          type: "pad" as "task" | "pad",
          content: this.getPadTabTitle(p),
          timestamp: p.updated_at,
        })),
      ].sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      );

      if (this.binItems.length > 0 && this.selectedBinItemId === null) {
        this.selectedBinItemId = {
          id: this.binItems[0].id,
          type: this.binItems[0].type,
        };
      }
    } catch (err) {
      console.error(err);
    }
  }

  async restoreItem(item: { id: number; type: "task" | "pad" }) {
    try {
      if (item.type === "task") {
        await invoke("restore_note", { id: item.id });
        await this.loadNotes();
      } else {
        await invoke("restore_pad", { id: item.id });
        await this.loadPads();

        // Re-open the tab if it's a pad so it's visible to the user immediately
        this.openTab(item.id);
      }
      await this.loadBinItems();
    } catch (err) {
      console.error(err);
    }
  }

  async permanentDeleteItem(item: { id: number; type: "task" | "pad" }) {
    try {
      if (item.type === "task") {
        await invoke("permanent_delete_note", { id: item.id });
      } else {
        await invoke("permanent_delete_pad", { id: item.id });
      }
      await this.loadBinItems();
    } catch (err) {
      console.error(err);
    }
  }

  async clearBin() {
    try {
      await invoke("clear_bin");
      await invoke("clear_pad_bin");
      await this.loadBinItems();
    } catch (err) {
      console.error(err);
    }
  }

  async minimize() {
    await getCurrentWindow().minimize();
  }
  async maximize() {
    try {
      await invoke("toggle_maximize");
    } catch (err) {
      console.error(err);
    }
  }
  async close() {
    await getCurrentWindow().close();
  }

  formatContent(content: string): string {
    if (!content) return '';

    // If it already contains HTML tags (from contenteditable), we want to preserve them
    // but we also want to support Markdown-style markers for the Task textareas.

    let result = content;

    // 1. Handle Markdown markers (for plain text areas)
    // Bold **text** -> <b>text</b>
    result = result.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
    // Italic *text* -> <i>text</i>
    result = result.replace(/\*(.*?)\*/g, '<i>$1</i>');

    // 2. We don't escape everything because contenteditable uses tags like <b>, <i>, <u> directly.
    // However, we should still handle newlines for plain text.
    if (!result.includes('<br>') && !result.includes('<div>')) {
      result = result.replace(/\n/g, '<br>');
    }

    return result;
  }

  async uploadFont() {
    try {
      const selected = await open({
        multiple: false,
        filters: [{
          name: 'Font',
          extensions: ['ttf', 'otf']
        }]
      });

      console.log('File dialog result:', selected);

      if (!selected) return;

      const filePath = typeof selected === 'string' ? selected : String(selected);
      console.log('Selected file path:', filePath);

      const fileName = filePath.split('\\').pop()?.split('/').pop() || '';
      const name = fileName.replace(/\.(ttf|otf)$/i, '') || 'CustomFont';
      console.log('Font name:', name);

      const result = await invoke('upload_custom_font', { name, srcPath: filePath });
      console.log('Upload result:', result);

      await this.loadCustomFonts();

      // Auto-select the newly added font
      this.setFont(name);
      this.showFontSettings = false;
    } catch (err) {
      console.error('Failed to upload font:', err);
    }
  }

  async loadCustomFonts() {
    try {
      const fonts = await invoke<any[]>('get_custom_fonts');
      console.log('Custom fonts from backend:', fonts);

      // Remove existing custom fonts from list to avoid duplicates
      this.availableFonts = this.availableFonts.filter(f => !f.isCustom);

      if (!fonts || fonts.length === 0) return;

      for (const font of fonts) {
        // Rust tuples serialize as arrays: [name, path]
        const name = font[0] || font.name;
        const path = font[1] || font.path;
        if (!name || !path) continue;

        const familyName = `Custom-${name}`;
        const assetUrl = convertFileSrc(path);
        console.log('Loading font:', name, 'from:', assetUrl);

        try {
          // Register @font-face dynamically
          const fontFace = new FontFace(familyName, `url("${assetUrl}")`);
          await fontFace.load();
          (document.fonts as any).add(fontFace);
          console.log('Font loaded successfully:', familyName);
        } catch (fontErr) {
          console.warn('FontFace load failed, trying style injection:', fontErr);
          // Fallback: inject a <style> tag with @font-face
          const style = document.createElement('style');
          style.textContent = `@font-face { font-family: "${familyName}"; src: url("${assetUrl}"); }`;
          document.head.appendChild(style);
        }

        this.availableFonts.push({
          name: name,
          family: `"${familyName}", monospace`,
          isCustom: true
        });
      }
    } catch (err) {
      console.error('Failed to load custom fonts:', err);
    }
  }

  async deleteCustomFont(fontName: string, event: MouseEvent) {
    event.stopPropagation();
    try {
      await invoke('delete_custom_font', { name: fontName });

      // If the deleted font was selected, switch to default
      if (this.selectedFont === fontName) {
        this.setFont('Cascadia Code');
      }

      await this.loadCustomFonts();
    } catch (err) {
      console.error('Failed to delete font:', err);
    }
  }

  toggleSpellCheck() {
    this.spellCheckEnabled = !this.spellCheckEnabled;
    localStorage.setItem('spellcheck', String(this.spellCheckEnabled));
  }
}

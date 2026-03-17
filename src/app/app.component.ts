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
import { FormsModule } from "@angular/forms";
import { take } from 'rxjs';
import { getCurrentWindow } from "@tauri-apps/api/window";
import { save } from "@tauri-apps/plugin-dialog";

import { Note, Pad, BinItem, AuthStatus } from "./models/interfaces";
import { VaultService } from "./services/vault.service";
import { NotesService } from "./services/notes.service";
import { PadsService } from "./services/pads.service";
import { FontService, FontEntry } from "./services/font.service";
import { SettingsService } from "./services/settings.service";
import { BinService } from "./services/bin.service";
import { SearchService } from "./services/search.service";
import { NotepadService } from "./services/notepad.service";

import { SplashComponent } from "./components/splash/splash.component";
import { TitlebarComponent } from "./components/titlebar/titlebar.component";
import { VaultComponent } from "./components/vault/vault.component";
import { TasksComponent } from "./components/tasks/tasks.component";
import { NotepadComponent } from './components/notepad/notepad.component';
import { HelpComponent } from './components/help/help.component';
import { SearchComponent } from './components/search/search.component';
import { BinComponent } from './components/bin/bin.component';
import { SettingsModalComponent } from './components/settings-modal/settings-modal.component';
import { PadCloseModalComponent } from './components/pad-close-modal/pad-close-modal.component';

@Component({
  selector: "app-root",
  standalone: true,
  imports: [
    CommonModule, 
    FormsModule, 
    SplashComponent, 
    TitlebarComponent, 
    VaultComponent, 
    TasksComponent, 
    NotepadComponent,
    HelpComponent,
    SearchComponent,
    BinComponent,
    SettingsModalComponent,
    PadCloseModalComponent
  ],
  templateUrl: "./app.component.html",
  styleUrl: "./app.component.css",
})
export class AppComponent implements AfterViewChecked, OnInit, OnDestroy {
  constructor(
    private vaultService: VaultService,
    private notesService: NotesService,
    private padsService: PadsService,
    private fontService: FontService,
    private settingsService: SettingsService,
    private binService: BinService,
    private searchService: SearchService,
    private notepadService: NotepadService,
  ) {}
  @ViewChild(TasksComponent) tasksComponent?: TasksComponent;
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
  showSplash = true;
  splashFading = false;
  searchQuery = "";
  @ViewChild("searchInput") searchInput?: ElementRef;
  @ViewChild("padEditor") padEditor?: ElementRef<HTMLDivElement>;
  private searchNeedsFocus = false;
  private padEditorNeedsFocus = false;
  private padEditorNeedsContent = false;
  isConfirmingPadCloseId: number | null = null;

  // Section switching
  activeSection: "tasks" | "notepad" = "notepad";

  // Notepad state
  pads: Pad[] = [];
  activeTabId: number | null = null;
  activePad: Pad | null = null;
  padContent = "";
  padText = ""; // plain-text mirror, always in sync with padEditor.innerText
  lineNumbers: number[] = [1];
  selectedPadText = ""; // currently selected text in the pad editor
  draggedTabId: number | null = null;
  dragEnterId: number | null = null; // for visual drop target feedback
  private autoSaveTimer: any = null;

  // Bookmarking/Marking lines

  isLineMarked(num: number): boolean {
    if (!this.activeTabId) return false;
    return this.notepadService.getLineMarks(this.activeTabId).has(num);
  }

  toggleLineMark(num: number) {
    if (!this.activeTabId) return;
    this.notepadService.toggleLineMark(this.activeTabId, num);
  }

  onSearchQueryChange(query: string) {
    this.searchService.setQuery(query);
  }
  authStatus: AuthStatus = "Checking";  // State
  errorMessage = "";
  appVersion = "1.1.0";
  // Idle Detection
  private idleTimeout = 10 * 60 * 1000; // 10 minutes
  private lastActivity = Date.now();
  private idleCheckInterval: any;

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
  availableFonts: FontEntry[] = [...this.fontService.defaultFonts];
  selectedFont = "Cascadia Code";
  showFontSettings = false;
  focusedFontIndex = 0;
  spellCheckEnabled = this.settingsService.loadSpellCheck();
  isDarkMode = false;

  async ngOnInit() {
    this.notesService.notes$.subscribe((notes: Note[]) => this.notes = notes);
    this.padsService.pads$.subscribe((pads: Pad[]) => this.pads = pads);

    await this.loadCustomFonts();
    this.autoStartEnabled = await this.settingsService.isAutoStartEnabled();

    try {
      this.authStatus = await this.vaultService.checkAuthStatus();

      if (this.authStatus === "Unlocked") {
        await this.loadNotes();
        await this.loadPads();
        this.loadSession();
        this.triggerFocus();
      }

      // Dismiss splash screen
      setTimeout(() => {
        this.splashFading = true;
        setTimeout(() => {
          this.showSplash = false;
        }, 600);
      }, 1400);

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

      win.onFocusChanged(({ payload: focused }: { payload: boolean }) => {
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
    const saved = this.settingsService.loadSelectedFont();
    this.setFont(saved || 'Cascadia Code');
  }

  setFont(fontName: string) {
    this.selectedFont = fontName;
    this.settingsService.saveSelectedFont(fontName);
    const font = this.availableFonts.find((f) => f.name === fontName);
    if (font) {
      this.fontService.setFontCSSVariable(font.family);
    }
  }

  loadDarkMode() {
    this.isDarkMode = this.settingsService.loadDarkMode();
  }

  toggleDarkMode() {
    this.isDarkMode = !this.isDarkMode;
    this.settingsService.setDarkMode(this.isDarkMode);
  }

  ngAfterViewChecked() {
    if (this.needsFocus && this.tasksComponent?.noteInput) {
      this.tasksComponent.noteInput.nativeElement.focus();
      this.needsFocus = false;
    }
    if (this.editNeedsFocus && this.tasksComponent?.editInput) {
      this.tasksComponent.editInput.nativeElement.focus();
      this.editNeedsFocus = false;
    }
    if (this.searchNeedsFocus && this.searchInput) {
      this.searchInput.nativeElement.focus();
      this.searchNeedsFocus = false;
    }
    if (this.padEditorNeedsContent && this.padEditor) {
      this.padEditor.nativeElement.innerHTML = this.padContent;
      this.padText = this.padEditor.nativeElement.innerText || '';
      this.updateLineNumbers();
      this.padEditorNeedsContent = false;
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

    // Modal check – if any major modal is open, we stop here (delegated to components)
    if (this.showSearch || this.showBin || this.showHelp || this.showFontSettings) {
      return;
    }

    // --- List Navigation & Focus ---

    // Ctrl + L: Focus List / Select first note
    if (event.ctrlKey && event.key.toLowerCase() === "l") {
      event.preventDefault();
      this.showHelp = false;
      const list = this.notes;
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
      return;
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
      return;
    }

    if (
      this.selectedNoteId !== null &&
      this.editingNoteId === null &&
      this.isConfirmingDeleteId === null
    ) {
      const list = this.notes;
      const currentIndex = list.findIndex((n) => n.id === this.selectedNoteId);

      if (currentIndex !== -1) {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          const nextIndex = (currentIndex + 1) % list.length;
          this.selectedNoteId = list[nextIndex].id;
          this.scrollSelectedIntoView();
        }

        if (event.key === "ArrowUp") {
          event.preventDefault();
          const prevIndex = (currentIndex - 1 + list.length) % list.length;
          this.selectedNoteId = list[prevIndex].id;
          this.scrollSelectedIntoView();
        }
      }
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
    this.selectedPadText = "";

    if (section === "tasks") {
      this.triggerFocus();
    } else {
      // The notepad DOM is destroyed/recreated by *ngIf; re-hydrate editor content
      this.padEditorNeedsContent = true;
      this.triggerPadEditorFocus();
    }
  }

  async unlockVault(password: string) {
    if (!password.trim()) return;
    try {
      this.errorMessage = "";
      await this.vaultService.unlock(password);
      this.authStatus = "Unlocked";
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
    await this.notesService.loadNotes();
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
    if (!this.tasksComponent?.noteInput) return;
    const content = this.tasksComponent.noteInput.nativeElement.innerHTML.trim();
    if (!content) return;
    try {
      await this.notesService.addNote(content);
      this.tasksComponent.noteInput.nativeElement.innerHTML = "";
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
      this.autoStartEnabled = await this.settingsService.toggleAutoStart(this.autoStartEnabled);
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
    if (this.editingNoteId === null || !this.tasksComponent?.editInput) return;
    const content = this.tasksComponent.editInput.nativeElement.innerHTML.trim();
    try {
      await this.notesService.updateNote(this.editingNoteId, content);
      this.editingNoteId = null;
    } catch (err) {
      console.error(err);
    }
  }

  async deleteNote(id: number) {
    // Find index before deleting
    const index = this.notes.findIndex((n) => n.id === id);

    try {
      await this.notesService.deleteNote(id);
      this.isConfirmingDeleteId = null;

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
    return this.searchService.getFilteredNotes(this.notes);
  }

  selectSearchResult(note: Note) {
    this.showSearch = false;
    this.selectedNoteId = note.id;
    this.scrollSelectedIntoView();
  }

  async togglePin(id: number) {
    try {
      await this.notesService.togglePin(id);
    } catch (err) {
      console.error(err);
    }
  }

  // ===== Notepad Methods =====

  async loadPads() {
    await this.padsService.loadPads();
  }

  async createPad() {
    try {
      const id = await this.padsService.addPad('Untitled', '');
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
      await this.padsService.deletePad(padId);

      const padToDelete = this.pads.find(p => p.id === padId);
      if (padToDelete && padToDelete.is_open) {
        this.forceCloseTabUI(padId);
      } else {
        await this.loadPads();
      }
    } catch (err) {
      console.error(err);
    }
  }

  async openTab(padId: number, skipMetadata = false) {
    const pad = this.pads.find((p) => p.id === padId);
    if (!pad) return;

    if (!skipMetadata) {
      await this.padsService.updatePadMetadata(padId, {
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
        this.padText = this.padEditor.nativeElement.innerText || '';
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

  onTabDragStart(event: DragEvent, padId: number) {
    this.draggedTabId = padId;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', padId.toString());
    }
  }

  onTabDragOver(event: DragEvent) {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  }

  onTabDragEnter(event: DragEvent, padId: number) {
    event.preventDefault();
    this.dragEnterId = padId;
  }

  onTabDragLeave(event: DragEvent) {
    this.dragEnterId = null;
  }

  onTabDragEnd() {
    this.draggedTabId = null;
    this.dragEnterId = null;
  }

  async onTabDrop(event: DragEvent, targetPadId: number) {
    event.preventDefault();
    this.dragEnterId = null;
    
    if (this.draggedTabId === null || this.draggedTabId === targetPadId) {
      this.draggedTabId = null;
      return;
    }

    const tabs = [...this.openOrderedTabs];
    const draggedIdx = tabs.findIndex(t => t.id === this.draggedTabId);
    const targetIdx = tabs.findIndex(t => t.id === targetPadId);

    if (draggedIdx === -1 || targetIdx === -1) {
      this.draggedTabId = null;
      return;
    }

    const [draggedTab] = tabs.splice(draggedIdx, 1);
    tabs.splice(targetIdx, 0, draggedTab);

    tabs.forEach((tab, index) => {
      tab.tab_index = index;
      const originalPad = this.pads.find(p => p.id === tab.id);
      if (originalPad) originalPad.tab_index = index;
    });

    this.pads = [...this.pads];

    const updates = tabs.map((tab, index) => {
      return this.padsService.updatePadMetadata(tab.id, { tab_index: index });
    });

    this.draggedTabId = null;
    
    try {
      await Promise.all(updates);
      await this.loadPads();
    } catch (err) {
      console.error("Failed to update tab order in DB:", err);
    }
  }

  closeTab(padId: number, event?: MouseEvent) {
    if (event) event.stopPropagation();
    this.isConfirmingPadCloseId = padId;
  }

  async handlePadCloseModalAction(action: 'save' | 'delete' | 'force' | 'cancel') {
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
    } else if (action === 'force') {
      this.isConfirmingPadCloseId = null;
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

      await this.padsService.updatePadMetadata(padId, { is_open: false, is_active: false });
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
      await this.padsService.updatePadMetadata(padId, { is_open: false });
      await this.loadPads();
    }
  }

  async downloadPadToLocal(padId: number, closeTabAfter: boolean) {
    const pad = this.pads.find((p) => p.id === padId);
    if (!pad) return;

    let contentToSave = pad.content;
    const titleToSave = this.getPadTabTitle(pad);
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
        await this.vaultService.saveFileToLocal(filePath, contentToSave);
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
    this.selectedPadText = "";
    if (this.activePad) {
      this.savePadNow();
    }
    await this.openTab(padId);
  }

  handlePadPaste(event: ClipboardEvent) {
    event.preventDefault();
    const text = event.clipboardData?.getData('text/plain');
    if (text) {
      document.execCommand('insertText', false, text);
      this.onPadInput();
    }
  }

  onPadInput() {
    if (this.padEditor) {
      this.padContent = this.padEditor.nativeElement.innerHTML;
      this.padText = this.padEditor.nativeElement.innerText || '';
      this.onPadContentChange();
    }
  }

  onPadSelect() {
    const sel = window.getSelection();
    this.selectedPadText = sel ? sel.toString() : "";
  }

  toggleBase64() {
    if (!this.selectedPadText) return;

    if (this.isBase64(this.selectedPadText)) {
      try {
        const decoded = decodeURIComponent(atob(this.selectedPadText).split('').map((c) => {
          return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
        this.replaceSelectionClean(decoded);
        return;
      } catch (e) {
        // Fall through to encode
      }
    }

    try {
      const encoded = btoa(encodeURIComponent(this.selectedPadText).replace(/%([0-9A-F]{2})/g,
        (match, p1) => String.fromCharCode(parseInt(p1, 16))));
      this.replaceSelectionClean(encoded);
    } catch (e) {
      console.error('Base64 operation failed', e);
    }
  }

  toggleJSON() {
    if (!this.selectedPadText) return;
    try {
      const obj = JSON.parse(this.selectedPadText);
      const hasNewlines = this.selectedPadText.includes('\n');
      const result = hasNewlines ? JSON.stringify(obj) : JSON.stringify(obj, null, 2);
      this.replaceSelectionClean(result);
    } catch (e) {
      console.error('JSON toggle failed', e);
    }
  }

  /**
   * Replace the current selectedPadText in the editor with newText, then
   * rebuild the editor's innerHTML cleanly (one <div> per line) to avoid
   * orphaned block elements left by contenteditable's execCommand.
   */
  private replaceSelectionClean(newText: string) {
    if (!this.padEditor) return;
    const el = this.padEditor.nativeElement;

    // Get full plain text, strip the phantom trailing \n browsers append
    const full = (el.innerText || '').replace(/\n$/, '');
    const selected = this.selectedPadText.replace(/\n$/, ''); // strip trailing too

    const idx = full.indexOf(selected);
    let rebuilt: string;
    if (idx !== -1) {
      rebuilt = full.slice(0, idx) + newText + full.slice(idx + selected.length);
    } else {
      // Fallback: append replacement (shouldn't normally happen)
      rebuilt = full + newText;
    }

    // Work out which line the cursor should land on after insertion
    const targetLine = (full.slice(0, idx !== -1 ? idx : full.length) + newText).split('\n').length - 1;

    // Rebuild innerHTML with exactly one <div> per logical line
    const lines = rebuilt.split('\n');
    el.innerHTML = lines
      .map(line => `<div>${this.htmlEscape(line) || '<br>'}</div>`)
      .join('');

    this.selectedPadText = '';
    this.onPadInput();
    setTimeout(() => this.setCaretToLine(el, targetLine));
  }

  private htmlEscape(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  private isBase64(str: string): boolean {
    if (!str || str.trim() === "" || str.length % 4 !== 0) return false;
    try {
      return btoa(atob(str)) === str.trim();
    } catch (err) {
      return false;
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

  get padStats(): { w: number; c: number; l: number } {
    const trimmed = this.padText ? this.padText.replace(/\n$/, '') : '';
    const words = trimmed.trim() ? trimmed.trim().split(/\s+/).length : 0;
    const chars = trimmed.length;
    const lines = trimmed ? trimmed.split('\n').length : 1;
    return { w: words, c: chars, l: lines };
  }

  updateLineNumbers() {
    // Use padText (plain-text mirror of the editor) — consistent with padStats
    const trimmed = this.padText ? this.padText.replace(/\n$/, '') : '';
    const count = trimmed ? trimmed.split('\n').length : 1;
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


  /** Returns the 0-based line index the cursor/caret is on inside a contenteditable element. */
  private getCaretLineIndex(el: HTMLElement): number {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return 0;
    const range = sel.getRangeAt(0).cloneRange();
    range.collapse(true);
    // Measure characters before the caret using innerText split by newlines
    const preRange = document.createRange();
    preRange.selectNodeContents(el);
    preRange.setEnd(range.startContainer, range.startOffset);
    const pre = preRange.toString();
    return pre.split('\n').length - 1;
  }

  /** Places the caret at the beginning of a given 0-based line index in a contenteditable element. */
  private setCaretToLine(el: HTMLElement, lineIndex: number) {
    el.focus();
    const text = el.innerText;
    const lines = text.split('\n');
    let charOffset = 0;
    for (let i = 0; i < lineIndex && i < lines.length; i++) {
      charOffset += lines[i].length + 1; // +1 for the newline
    }
    // Walk text nodes to find the right position
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node: Text | null = null;
    let remaining = charOffset;
    while (walker.nextNode()) {
      const t = walker.currentNode as Text;
      if (remaining <= t.length) {
        node = t;
        break;
      }
      remaining -= t.length;
    }
    if (node) {
      const range = document.createRange();
      const sel = window.getSelection()!;
      range.setStart(node, remaining);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }

  duplicateLine(direction: string, editor: HTMLElement) {
    const text = editor.innerText;
    const lines = text.split('\n');
    const currentLine = this.getCaretLineIndex(editor);

    if (direction === 'ArrowDown') {
      lines.splice(currentLine + 1, 0, lines[currentLine]);
    } else {
      lines.splice(currentLine, 0, lines[currentLine]);
    }

    this.padContent = lines.join('\n');
    editor.innerHTML = this.padContent;
    this.onPadContentChange();

    const targetLine = direction === 'ArrowDown' ? currentLine + 1 : currentLine;
    setTimeout(() => this.setCaretToLine(editor, targetLine));
  }

  moveLine(direction: string, editor: HTMLElement) {
    const text = editor.innerText;
    const lines = text.split('\n');
    const currentLine = this.getCaretLineIndex(editor);

    if (direction === 'ArrowUp') {
      if (currentLine === 0) return;
      // Swap current line with the one above
      [lines[currentLine - 1], lines[currentLine]] = [lines[currentLine], lines[currentLine - 1]];
      this.padContent = lines.join('\n');
      editor.innerHTML = this.padContent;
      this.onPadContentChange();
      setTimeout(() => this.setCaretToLine(editor, currentLine - 1));
    } else {
      if (currentLine >= lines.length - 1) return;
      // Swap current line with the one below
      [lines[currentLine], lines[currentLine + 1]] = [lines[currentLine + 1], lines[currentLine]];
      this.padContent = lines.join('\n');
      editor.innerHTML = this.padContent;
      this.onPadContentChange();
      setTimeout(() => this.setCaretToLine(editor, currentLine + 1));
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
      await this.padsService.updatePad(
        this.activePad.id,
        title,
        this.padContent,
      );

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

  async onBinItemRestored(item: { id: number; type: "task" | "pad" }) {
    if (item.type === 'pad') {
      this.openTab(item.id);
    }
  }

  async clearBin() {
    await this.binService.clearBin();
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
      const filePath = await this.fontService.openFontDialog();
      if (!filePath) return;

      const fileName = filePath.split('\\').pop()?.split('/').pop() || '';
      const name = fileName.replace(/\.(ttf|otf)$/i, '') || 'CustomFont';

      await this.fontService.uploadCustomFont(name, filePath);
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
      const fonts = await this.fontService.getCustomFonts();

      // Remove existing custom fonts from list to avoid duplicates
      this.availableFonts = this.availableFonts.filter(f => !f.isCustom);

      if (!fonts || fonts.length === 0) {
        localStorage.removeItem('customFontsCache');
        return;
      }

      const fontCache: Record<string, string> = {};

      for (const font of fonts) {
        // Rust tuples serialize as arrays: [name, path]
        const name = font[0] || font.name;
        const path = font[1] || font.path;
        if (!name || !path) continue;

        const familyName = await this.fontService.registerFontFace(name, path);

        // Store for cache (use convertFileSrc via service would be needed for URL)
        fontCache[familyName] = path;

        this.availableFonts.push({
          name: name,
          family: `"${familyName}", monospace`,
          isCustom: true
        });
      }

      // Cache custom fonts to immediately load them on next startup before Tauri initializes
      localStorage.setItem('customFontsCache', JSON.stringify(fontCache));

    } catch (err) {
      console.error('Failed to load custom fonts:', err);
    }
  }

  async deleteCustomFont(fontName: string, event: MouseEvent) {
    event.stopPropagation();
    try {
      await this.fontService.deleteCustomFont(fontName);

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
    this.settingsService.setSpellCheck(this.spellCheckEnabled);
  }
}

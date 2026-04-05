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
import { TauriService } from "./services/tauri.service";
import { Pad, PadVersion, AuthStatus, AppShortcut, BinItem } from "./models/app.models";

@Component({
  selector: "app-root",
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: "./app.component.html",
  styleUrl: "./app.component.css",
})
export class AppComponent implements AfterViewChecked, OnInit, OnDestroy {
  constructor(private tauri: TauriService) {}
  autoStartEnabled = false;
  showHelp = false;
  showBin = false;
  showSplash = true;
  splashFading = false;
  binItems: {
    id: number;
    type: "pad";
    content: string;
    timestamp: string;
  }[] = [];
  selectedBinItemId: { id: number; type: "pad" } | null = null;
  isConfirmingBinDeleteId: { id: number; type: "pad" } | null = null;
  isConfirmingRestoreId: { id: number; type: "pad" } | null = null;
  isConfirmingClearAll = false;
  @ViewChild("searchInput") searchInput?: ElementRef;
  @ViewChild("padEditor") padEditor?: ElementRef<HTMLDivElement>;
  private searchNeedsFocus = false;
  private padEditorNeedsFocus = false;
  private padEditorNeedsContent = false;
  isConfirmingPadCloseId: number | null = null;


  // Notepad state
  pads: Pad[] = [];
  activeTabId: number | null = null;
  activePad: Pad | null = null;
  padContent = "";
  padText = ""; // plain-text mirror, always in sync with padEditor.innerText
  lineNumbers: number[] = [1];
  selectedPadText = ""; // currently selected text in the pad editor
  private autoSaveTimer: any = null;

  // Version History (Time Travel Notebook)
  showVersionHistory = false;
  padVersions: PadVersion[] = [];
  selectedVersionId: number | null = null;
  previewingVersion: PadVersion | null = null;
  showVersionDiff = false;
  versionDiffLines: { type: 'same' | 'added' | 'removed'; text: string }[] = [];
  editingLabelId: number | null = null;
  editingLabelText = '';
  private versionSaveTimer: any = null;
  private lastVersionContent = '';

  // Find & Replace
  showFindReplace = false;
  searchTerm = '';
  replaceTerm = '';
  matchCase = false;
  matchWholeWord = false;
  findMatches: { start: number; end: number; range: Range }[] = [];
  currentFindIndex = 0;
  @ViewChild('findInputRef') findInputRef?: ElementRef<HTMLInputElement>;

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
  appVersion = "1.2.0";
  isSticky = false;

  async toggleStickyMode() {
    this.isSticky = !this.isSticky;
    try {
      await this.tauri.setAlwaysOnTop(this.isSticky);
    } catch (e) {
      console.error("Failed to toggle sticky mode:", e);
    }
  }

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

  // Customizable Keyboard Shortcuts
  shortcuts: AppShortcut[] = [
    { id: 'app.search', label: 'Global Search', category: 'Global Navigation', defaultKeyStr: 'Ctrl + F', currentKeyStr: 'Ctrl + F' },
    { id: 'app.history', label: 'History / Bin', category: 'Global Navigation', defaultKeyStr: 'Ctrl + Shift + B', currentKeyStr: 'Ctrl + Shift + B' },
    { id: 'app.help', label: 'Keyboard Shortcuts', category: 'Global Navigation', defaultKeyStr: 'Ctrl + H', currentKeyStr: 'Ctrl + H' },

    { id: 'notepad.new_tab', label: 'New Tab', category: 'Notepad', defaultKeyStr: 'Ctrl + N', currentKeyStr: 'Ctrl + N' },
    { id: 'notepad.save', label: 'Save Tab', category: 'Notepad', defaultKeyStr: 'Ctrl + S', currentKeyStr: 'Ctrl + S' },
    { id: 'notepad.cycle_tabs', label: 'Cycle Tabs', category: 'Notepad', defaultKeyStr: 'Ctrl + Space', currentKeyStr: 'Ctrl + Space' },
    { id: 'notepad.delete_tab', label: 'Delete Tab', category: 'Notepad', defaultKeyStr: 'Ctrl + Shift + D', currentKeyStr: 'Ctrl + Shift + D' },
    { id: 'notepad.time_travel', label: 'Version History', category: 'Notepad', defaultKeyStr: 'Ctrl + T', currentKeyStr: 'Ctrl + T' },
    { id: 'notepad.bold', label: 'Bold', category: 'Notepad', defaultKeyStr: 'Ctrl + B', currentKeyStr: 'Ctrl + B' },
    { id: 'notepad.italic', label: 'Italic', category: 'Notepad', defaultKeyStr: 'Ctrl + I', currentKeyStr: 'Ctrl + I' },
    { id: 'notepad.underline', label: 'Underline', category: 'Notepad', defaultKeyStr: 'Ctrl + U', currentKeyStr: 'Ctrl + U' },
    { id: 'notepad.dup_line', label: 'Duplicate Line', category: 'Notepad', defaultKeyStr: 'Alt + Shift + Up', currentKeyStr: 'Alt + Shift + Up' },
    { id: 'notepad.move_line', label: 'Move Line', category: 'Notepad', defaultKeyStr: 'Alt + Up', currentKeyStr: 'Alt + Up' }
  ];
  editingShortcutId: string | null = null;
  capturedKeyString: string = '';
  shortcutSearchTerm = '';
  isConfirmingResetShortcuts = false;
  shortcutConflictMessage: string | null = null;

  async ngOnInit() {
    await this.loadCustomFonts();
    this.loadShortcuts();
    try {
      this.autoStartEnabled = await this.tauri.isAutostartEnabled();
    } catch (err) {
      console.warn("Autostart plugin not available:", err);
    }

    try {
      this.authStatus = await this.tauri.checkAuthStatus();

      if (this.authStatus === "Unlocked") {
        await this.loadPads();
        this.loadSession();
        this.triggerPadEditorFocus();
      }

      // Dismiss splash screen
      setTimeout(() => {
        this.splashFading = true;
        setTimeout(() => {
          this.showSplash = false;
        }, 600);
      }, 1400);

      this.startIdleDetection();

      const win = this.tauri.getWindow();

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

      win.onFocusChanged(({ payload }: { payload: boolean }) => {
        if (payload && this.authStatus === "Unlocked") {
          this.triggerPadEditorFocus();
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
      document.documentElement.classList.add("dark-mode");
    }
  }

  toggleDarkMode() {
    this.isDarkMode = !this.isDarkMode;
    localStorage.setItem("darkMode", this.isDarkMode.toString());
    if (this.isDarkMode) {
      document.documentElement.classList.add("dark-mode");
    } else {
      document.documentElement.classList.remove("dark-mode");
    }
  }

  ngAfterViewChecked() {
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

    // Notepad shortcuts
    if (this.matchShortcut(event, 'notepad.save')) {
      event.preventDefault();
      if (this.activeTabId) {
        this.downloadPadToLocal(this.activeTabId, false);
      }
      return;
    }

    if (this.matchShortcut(event, 'notepad.time_travel')) {
      event.preventDefault();
      this.toggleVersionHistory();
      return;
    }

    if (this.matchShortcut(event, 'notepad.cycle_tabs')) {
      event.preventDefault();
      this.cycleTab();
      return;
    }

    if (this.matchShortcut(event, 'notepad.new_tab')) {
      event.preventDefault();
      this.createPad();
      return;
    }

    if (this.matchShortcut(event, 'notepad.delete_tab')) {
      event.preventDefault();
      if (this.activeTabId) {
        this.closeTab(this.activeTabId);
      }
      return;
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

    if (this.showVersionHistory) {
      const activeTagName = document.activeElement?.tagName.toLowerCase();
      const isInputOrEditor = activeTagName === 'input' || activeTagName === 'textarea' || document.activeElement?.classList.contains('pad-content-editor');

      if (!isInputOrEditor && this.padVersions.length > 0) {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          const currentIndex = this.padVersions.findIndex(v => v.id === this.selectedVersionId);
          const nextIndex = currentIndex < this.padVersions.length - 1 ? currentIndex + 1 : this.padVersions.length - 1;
          this.selectVersion(this.padVersions[nextIndex]);
          setTimeout(() => {
            document.querySelector('.version-item.selected')?.scrollIntoView({ block: 'nearest' });
          }, 0);
          return;
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          const currentIndex = this.padVersions.findIndex(v => v.id === this.selectedVersionId);
          const prevIndex = currentIndex > 0 ? currentIndex - 1 : 0;
          this.selectVersion(this.padVersions[prevIndex]);
          setTimeout(() => {
            document.querySelector('.version-item.selected')?.scrollIntoView({ block: 'nearest' });
          }, 0);
          return;
        } else if (event.key.toLowerCase() === "d" && this.selectedVersionId) {
          event.preventDefault();
          if (this.previewingVersion && !this.showVersionDiff) {
            this.showDiff(this.previewingVersion);
          } else if (this.showVersionDiff) {
            this.closeDiff();
          }
          return;
        } else if (event.key.toLowerCase() === "r" && this.selectedVersionId) {
          event.preventDefault();
          if (this.previewingVersion) {
            this.restoreVersion(this.previewingVersion);
          }
          return;
        }
      }
    }

    // Toggle Help (Ctrl + H)
    if (this.matchShortcut(event, 'app.help')) {
      event.preventDefault();
      this.showHelp = !this.showHelp;
    }

    // Toggle Bin (Ctrl + Shift + B)
    if (this.matchShortcut(event, 'app.history')) {
      event.preventDefault();
      this.showBin = !this.showBin;
      if (this.showBin) {
        this.showHelp = false;
        this.isConfirmingBinDeleteId = null;
        this.isConfirmingRestoreId = null;
        this.isConfirmingClearAll = false;
        this.loadBinItems();
      }
      return;
    }

    // Toggle Search (Ctrl + F)
    if (this.matchShortcut(event, 'app.search')) {
      event.preventDefault();
      this.toggleFindReplace();
      return;
    }

    // Reset Shortcuts Confirmation
    if (this.isConfirmingResetShortcuts) {
      if (event.key === "Enter") {
        event.preventDefault();
        this.confirmResetAllShortcuts();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        this.isConfirmingResetShortcuts = false;
        return;
      }
      event.preventDefault();
      return;
    }

    // Shortcut Conflict Dialog
    if (this.shortcutConflictMessage) {
      if (event.key === "Enter" || event.key === "Escape") {
        event.preventDefault();
        this.shortcutConflictMessage = null;
        return;
      }
      event.preventDefault();
      return;
    }

    // Pad Close Confirmation Handler
    if (this.isConfirmingPadCloseId !== null) {
      if (event.ctrlKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        this.handlePadCloseModalAction('saveAndDelete');
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
      if (this.showVersionHistory) {
        this.closeVersionHistory();
        event.preventDefault();
        return;
      }
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
        this.showBin ||
        this.isConfirmingPadCloseId
      ) {
        this.showHelp = false;
        this.showBin = false;
        this.isConfirmingPadCloseId = null;
        event.preventDefault();
        return;
      }
    }

    }
  

  private scrollSelectedBinIntoView() {
    setTimeout(() => {
      const element = document.querySelector(".bin-item.selected");
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

  async unlockVault() {
    if (!this.password.trim()) return;
    try {
      this.errorMessage = "";
      await this.tauri.unlockVault(this.password);
      this.authStatus = "Unlocked";
      this.password = "";
      this.lastActivity = Date.now();
      this.startIdleDetection();
      await this.loadPads();
      this.loadSession();
      this.triggerPadEditorFocus();
    } catch (err: any) {
      this.errorMessage = err.toString();
    }
  }

  async lockVault() {
    // Manual locking is disabled as per user request to 'never ask again'.
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



  handleEditKeyDown(event: KeyboardEvent) {
    if (event.ctrlKey) {
      const key = event.key.toLowerCase();
      if (key === 'b' || key === 'i' || key === 'u') {
        event.preventDefault();
        const command = key === 'b' ? 'bold' : key === 'i' ? 'italic' : 'underline';
        document.execCommand(command, false);
        return;
      }
    }

  }

  async toggleAutoStart() {
    try {
      if (this.autoStartEnabled) await this.tauri.disableAutostart();
      else await this.tauri.enableAutostart();
      this.autoStartEnabled = await this.tauri.isAutostartEnabled();
    } catch (err) {
      console.error(err);
    }
  }


  // ===== Notepad Methods =====

  async loadPads() {
    try {
      const dbPads = await this.tauri.getPads();
      // Preserve isDirty state for existing pads
      this.pads = dbPads.map((dbPad: Pad) => {
        const existing = this.pads.find(p => p.id === dbPad.id);
        return {
          ...dbPad,
          isDirty: existing ? existing.isDirty : false
        };
      });
    } catch (err) {
      console.error(err);
    }
  }

  async createPad() {
    try {
      const id = await this.tauri.addPad("Untitled", "");
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
      await this.tauri.deletePadToBin(padId);

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
      await this.tauri.openPadTab(padId);
      await this.loadPads();
    }

    this.activeTabId = padId;
    this.activePad = { ...pad };
    this.padContent = pad.content;
    this.activePad.isDirty = pad.isDirty || false;

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

  async closeTab(padId: number, event?: MouseEvent) {
    if (event) event.stopPropagation();

    const pad = this.pads.find(p => p.id === padId);
    if (pad && pad.isDirty) {
      // Has unsaved changes — ask if they want to save to file first
      this.isConfirmingPadCloseId = padId;
    } else {
      // Clean — move directly to bin (same as old behavior)
      await this.deletePad(padId);
    }
  }

  async handlePadCloseModalAction(action: 'delete' | 'saveAndDelete' | 'cancel') {
    if (!this.isConfirmingPadCloseId) return;
    const padId = this.isConfirmingPadCloseId;

    if (action === 'cancel') {
      this.isConfirmingPadCloseId = null;
      return;
    }

    if (action === 'delete') {
      // Move to bin without saving to file
      this.isConfirmingPadCloseId = null;
      await this.deletePad(padId);
    } else if (action === 'saveAndDelete') {
      // Save to file first, then move to bin
      const success = await this.savePadToFile(padId);
      if (success) {
        this.isConfirmingPadCloseId = null;
        await this.deletePad(padId);
      }
    }
  }

  private async _closeTabInternal(padId: number) {
    // 1. Snapshot current open tabs for next-tab calculation
    const tabs = this.openOrderedTabs;
    const closedTabIdx = tabs.findIndex(t => t.id === padId);
    let nextTabId: number | null = null;
    
    if (this.activeTabId === padId && tabs.length > 1) {
      if (closedTabIdx < tabs.length - 1) {
        nextTabId = tabs[closedTabIdx + 1].id;
      } else {
        nextTabId = tabs[closedTabIdx - 1].id;
      }
    }

    // 2. Use dedicated command — no Options, guaranteed to execute
    await this.tauri.closePadTab(padId);

    // 3. Reload from DB
    await this.loadPads();

    // 4. Handle UI redirection
    if (this.activeTabId === padId) {
      if (nextTabId) {
        await this.openTab(nextTabId);
      } else {
        this.activeTabId = null;
        this.activePad = null;
        this.padContent = "";
        if (this.openOrderedTabs.length === 0) {
          await this.createPad();
        }
      }
    }
  }

  async savePadToFile(padId: number): Promise<boolean> {
    const pad = this.pads.find((p) => p.id === padId);
    if (!pad) return false;

    let contentToSave = pad.content;
    let titleToSave = this.getPadTabTitle(pad);
    if (this.activeTabId === padId) {
      contentToSave = this.padContent;
    }

    try {
      let filePath = pad.file_path;

      if (!filePath) {
        filePath = await this.tauri.saveDialog({
          filters: [{ name: "Text Document", extensions: ["txt", "md"] }],
          defaultPath: `${titleToSave}.txt`,
          title: "Save Pad to Local Computer",
        });
      }

      if (filePath) {
        await this.tauri.saveFileToLocal(filePath, contentToSave);

        // Update pad state
        pad.file_path = filePath;
        pad.isDirty = false;
        if (this.activePad && this.activePad.id === padId) {
          this.activePad.file_path = filePath;
          this.activePad.isDirty = false;
        }

        // Persist filePath to database with dedicated command
        await this.tauri.updatePadFilePath(padId, filePath);

        return true;
      }
    } catch (err) {
      console.error(err);
    }
    return false;
  }

  async downloadPadToLocal(padId: number, closeTabAfter: boolean) {
    // Re-use savePadToFile
    const success = await this.savePadToFile(padId);
    if (success && closeTabAfter) {
      this._closeTabInternal(padId);
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
    this.showVersionHistory = false;
    this.previewingVersion = null;
    this.selectedVersionId = null;
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

      const pad = this.pads.find(p => p.id === this.activeTabId);
      if (pad) {
        pad.isDirty = true;
      }
      if (this.activePad) {
        this.activePad.isDirty = true;
      }

      this.onPadContentChange();
      this.scheduleVersionSave();

      if (this.showFindReplace && this.searchTerm) {
        this.updateFindMatches();
      }
    }
  }

  onPadSelect() {
    const sel = window.getSelection();
    this.selectedPadText = sel ? sel.toString() : "";
  }




  private htmlEscape(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
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
      this.showBin ||
      this.isConfirmingPadCloseId !== null
    ) {
      event.preventDefault();
      return;
    }

    if (this.matchShortcut(event, 'notepad.bold')) {
      event.preventDefault();
      document.execCommand('bold', false);
      this.onPadInput();
      return;
    }
    if (this.matchShortcut(event, 'notepad.italic')) {
      event.preventDefault();
      document.execCommand('italic', false);
      this.onPadInput();
      return;
    }
    if (this.matchShortcut(event, 'notepad.underline')) {
      event.preventDefault();
      document.execCommand('underline', false);
      this.onPadInput();
      return;
    }

    if (
      this.matchShortcut(event, 'notepad.dup_line') || 
      (event.altKey && event.shiftKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown'))
    ) {
      event.preventDefault();
      const dir = (event.key === "ArrowUp" || event.key === "ArrowDown") ? event.key : "ArrowDown";
      this.duplicateLine(dir, editor);
      return;
    }

    if (
      this.matchShortcut(event, 'notepad.move_line') ||
      (event.altKey && !event.shiftKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown'))
    ) {
      event.preventDefault();
      const dir = (event.key === "ArrowUp" || event.key === "ArrowDown") ? event.key : "ArrowDown";
      this.moveLine(dir, editor);
      return;
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
      await this.tauri.updatePad(this.activePad.id, title, this.padContent);

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
      const pads = await this.tauri.getBinPads();

      this.binItems = pads.map((p: Pad) => ({
        id: p.id,
        type: "pad" as const,
        content: this.getPadTabTitle(p),
        timestamp: p.updated_at,
      })).sort(
        (a: BinItem, b: BinItem) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      );

      if (this.binItems.length > 0 && this.selectedBinItemId === null) {
        this.selectedBinItemId = {
          id: this.binItems[0].id,
          type: "pad",
        };
      }
    } catch (err) {
      console.error(err);
    }
  }

  async restoreItem(item: { id: number; type: "pad" }) {
    try {
      await this.tauri.restorePad(item.id);
      await this.loadPads();

      // Re-open the tab if it's a pad so it's visible to the user immediately
      this.openTab(item.id);

      await this.loadBinItems();
    } catch (err) {
      console.error(err);
    }
  }

  async permanentDeleteItem(item: { id: number; type: "pad" }) {
    try {
      await this.tauri.permanentDeletePad(item.id);
      await this.loadBinItems();
    } catch (err) {
      console.error(err);
    }
  }

  async clearBin() {
    try {
      await this.tauri.clearBin();
      await this.loadBinItems();
    } catch (err) {
      console.error(err);
    }
  }

  async minimize() {
    await this.tauri.minimizeWindow();
  }
  async maximize() {
    try {
      await this.tauri.toggleMaximize();
    } catch (err) {
      console.error(err);
    }
  }
  async close() {
    await this.tauri.closeWindow();
  }

  formatContent(content: string): string {
    if (!content) return '';

    // If it already contains HTML tags (from contenteditable), we want to preserve them.

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
      const selected = await this.tauri.openDialog({
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

      const result = await this.tauri.uploadCustomFont(name, filePath);
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
      const fonts = await this.tauri.getCustomFonts();
      console.log('Custom fonts from backend:', fonts);

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

        const familyName = `Custom-${name}`;
        const assetUrl = this.tauri.convertAssetUrl(path);
        console.log('Loading font:', name, 'from:', assetUrl);

        fontCache[familyName] = assetUrl;

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

      // Cache custom fonts to immediately load them on next startup before Tauri initializes
      localStorage.setItem('customFontsCache', JSON.stringify(fontCache));

    } catch (err) {
      console.error('Failed to load custom fonts:', err);
    }
  }

  async deleteCustomFont(fontName: string, event: MouseEvent) {
    event.stopPropagation();
    try {
      await this.tauri.deleteCustomFont(fontName);

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

  // ================= FIND & REPLACE LOGIC =================
  
  toggleFindReplace() {
    this.showFindReplace = !this.showFindReplace;
    if (this.showFindReplace) {
      setTimeout(() => {
        this.findInputRef?.nativeElement.focus();
        if (this.selectedPadText) {
          this.searchTerm = this.selectedPadText;
        }
        this.updateFindMatches();
      });
    } else {
      this.closeFindReplace();
    }
  }

  closeFindReplace() {
    this.showFindReplace = false;
    this.clearHighlights();
    this.triggerPadEditorFocus();
  }

  onSearchInput() {
    this.updateFindMatches();
  }

  toggleMatchCase() {
    this.matchCase = !this.matchCase;
    this.updateFindMatches();
    setTimeout(() => this.findInputRef?.nativeElement.focus());
  }

  toggleWholeWord() {
    this.matchWholeWord = !this.matchWholeWord;
    this.updateFindMatches();
    setTimeout(() => this.findInputRef?.nativeElement.focus());
  }

  updateFindMatches() {
    this.clearHighlights();
    if (!this.searchTerm || !this.padEditor || !this.padEditor.nativeElement) {
      this.findMatches = [];
      this.currentFindIndex = 0;
      return;
    }

    let textContent = '';
    const textNodes: { node: Node; start: number; end: number }[] = [];
    
    // Walk DOM to build clean view-model text representations and track physical nodes
    const walk = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE && node.nodeValue) {
        const start = textContent.length;
        textContent += node.nodeValue;
        textNodes.push({ node, start, end: textContent.length });
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const tag = (node as Element).tagName.toLowerCase();
        // Assume block breaks on structural elements to prevent word merging (e.g., hello</div><div>world)
        if (tag === 'div' || tag === 'br' || tag === 'p') {
          textContent += '\n';
        }
        for (let i = 0; i < node.childNodes.length; i++) {
          walk(node.childNodes[i]);
        }
      }
    };
    walk(this.padEditor.nativeElement);

    let escapedSearch = this.searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    let pattern = this.matchWholeWord ? `\\b${escapedSearch}\\b` : escapedSearch;
    const regex = new RegExp(pattern, this.matchCase ? 'g' : 'gi');

    this.findMatches = [];
    let match;
    
    while ((match = regex.exec(textContent)) !== null) {
      const matchStart = match.index;
      const matchEnd = match.index + match[0].length;
      
      let startNode: Node | null = null, startOff = 0;
      let endNode: Node | null = null, endOff = 0;

      for (const info of textNodes) {
        if (!startNode && matchStart >= info.start && matchStart < info.end) {
          startNode = info.node;
          startOff = matchStart - info.start;
        }
        if (matchEnd > info.start && matchEnd <= info.end) {
          endNode = info.node;
          endOff = matchEnd - info.start;
        }
      }

      if (startNode && endNode) {
        const range = document.createRange();
        range.setStart(startNode, startOff);
        range.setEnd(endNode, endOff);
        this.findMatches.push({ start: matchStart, end: matchEnd, range });
      }
    }

    if (this.findMatches.length > 0) {
      if (this.currentFindIndex >= this.findMatches.length) {
        this.currentFindIndex = 0;
      }
      this.applyHighlights();
      this.scrollToMatch();
    } else {
      this.currentFindIndex = 0;
    }
  }

  clearHighlights() {
    try {
      const win = window as any;
      if (win.CSS && win.CSS.highlights) {
        win.CSS.highlights.delete("search-results");
        win.CSS.highlights.delete("search-active");
      }
    } catch (e) {}
  }

  applyHighlights() {
    try {
      const win = window as any;
      if (win.CSS && win.CSS.highlights && win.Highlight) {
        const allRanges = this.findMatches.map(m => m.range);
        win.CSS.highlights.set("search-results", new win.Highlight(...allRanges));

        const activeRange = this.findMatches[this.currentFindIndex]?.range;
        if (activeRange) {
          win.CSS.highlights.set("search-active", new win.Highlight(activeRange));
        }
      }
    } catch (e) {
      console.warn("Highlights API error", e);
    }
  }

  nextMatch() {
    if (this.findMatches.length > 0) {
      this.currentFindIndex = (this.currentFindIndex + 1) % this.findMatches.length;
      this.applyHighlights();
      this.scrollToMatch();
      this.findInputRef?.nativeElement.focus();
    }
  }

  prevMatch() {
    if (this.findMatches.length > 0) {
      this.currentFindIndex = (this.currentFindIndex - 1 + this.findMatches.length) % this.findMatches.length;
      this.applyHighlights();
      this.scrollToMatch();
      this.findInputRef?.nativeElement.focus();
    }
  }

  scrollToMatch() {
    const activeRange = this.findMatches[this.currentFindIndex]?.range;
    if (activeRange && this.padEditor) {
      const rect = activeRange.getBoundingClientRect();
      const editor = this.padEditor.nativeElement;
      const editorRect = editor.getBoundingClientRect();
      
      // Calculate active scroll constraints dynamically
      if (rect.top < editorRect.top || rect.bottom > editorRect.bottom) {
        editor.scrollTop += rect.top - editorRect.top - (editorRect.height / 2);
      }
    }
  }

  replaceMatch() {
    if (this.findMatches.length === 0) return;
    const match = this.findMatches[this.currentFindIndex];
    if (match && match.range) {
      match.range.deleteContents();
      match.range.insertNode(document.createTextNode(this.replaceTerm));
      
      this.syncEditorContent();
      
      // Preserve current index to replace next match falling into place
      const oldIndex = this.currentFindIndex;
      this.updateFindMatches(); 
      if (this.findMatches.length > 0) {
         this.currentFindIndex = Math.min(oldIndex, this.findMatches.length - 1);
         this.applyHighlights();
         this.scrollToMatch();
      }
    }
  }

  replaceAllMatches() {
    if (this.findMatches.length === 0) return;
    
    // Replace heavily from the back to preserve the DOM structure of earlier nodes
    for (let i = this.findMatches.length - 1; i >= 0; i--) {
      const match = this.findMatches[i];
      match.range.deleteContents();
      match.range.insertNode(document.createTextNode(this.replaceTerm));
    }
    
    this.syncEditorContent();
    this.updateFindMatches();
  }

  syncEditorContent() {
    if (this.padEditor) {
      this.padContent = this.padEditor.nativeElement.innerHTML;
      this.padText = this.padEditor.nativeElement.innerText || '';
      
      // Mark as un-saved
      const pad = this.pads.find(p => p.id === this.activeTabId);
      if (pad) pad.isDirty = true;
      if (this.activePad) this.activePad.isDirty = true;
      
      this.onPadContentChange();
    }
  }

  // ================= TIME TRAVEL / VERSION HISTORY =================

  toggleVersionHistory() {
    this.showVersionHistory = !this.showVersionHistory;
    if (this.showVersionHistory) {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      this.previewingVersion = null;
      this.selectedVersionId = null;
      this.showVersionDiff = false;
      this.editingLabelId = null;
      if (this.activeTabId) {
        this.loadVersions(this.activeTabId).then(() => {
          if (this.padVersions.length > 0 && !this.selectedVersionId) {
            this.selectVersion(this.padVersions[0]);
          }
        });
      }
    } else {
      this.triggerPadEditorFocus();
    }
  }

  closeVersionHistory() {
    this.showVersionHistory = false;
    this.previewingVersion = null;
    this.selectedVersionId = null;
    this.showVersionDiff = false;
    this.editingLabelId = null;
    this.triggerPadEditorFocus();
  }

  async loadVersions(padId: number) {
    try {
      this.padVersions = await this.tauri.getPadVersions(padId);
    } catch (err) {
      console.error('Failed to load versions:', err);
      this.padVersions = [];
    }
  }

  private scheduleVersionSave() {
    if (this.versionSaveTimer) clearTimeout(this.versionSaveTimer);
    this.versionSaveTimer = setTimeout(() => {
      this.autoSaveVersion();
    }, 1000);
  }

  private async autoSaveVersion() {
    if (!this.activePad || !this.padEditor) return;
    const plainText = this.padEditor.nativeElement.innerText || '';
    if (!plainText.trim()) return;
    // Skip if content hasn't changed from last version save
    if (plainText === this.lastVersionContent) return;

    try {
      const result = await this.tauri.savePadVersion(this.activePad.id, plainText, null);
      if (result !== -1) {
        this.lastVersionContent = plainText;
        // Refresh if panel is open
        if (this.showVersionHistory && this.activeTabId) {
          this.loadVersions(this.activeTabId);
        }
      }
    } catch (err) {
      console.error('Failed to save version:', err);
    }
  }

  async createCheckpoint() {
    if (!this.activePad || !this.padEditor) return;
    const plainText = this.padEditor.nativeElement.innerText || '';
    if (!plainText.trim()) return;

    const label = prompt('Checkpoint name (optional):') || 'Checkpoint';
    try {
      await this.tauri.savePadVersion(this.activePad.id, plainText, label);
      this.lastVersionContent = plainText;
      if (this.activeTabId) {
        await this.loadVersions(this.activeTabId);
      }
    } catch (err) {
      console.error('Failed to create checkpoint:', err);
    }
  }

  selectVersion(version: PadVersion) {
    this.selectedVersionId = version.id;
    this.previewingVersion = version;
    this.showVersionDiff = false;
  }

  async restoreVersion(version: PadVersion) {
    if (!this.padEditor || !this.activePad) return;
    const el = this.padEditor.nativeElement;

    // Rebuild innerHTML with one <div> per line
    const lines = version.content.split('\n');
    el.innerHTML = lines
      .map((line: string) => `<div>${this.htmlEscape(line) || '<br>'}</div>`)
      .join('');

    this.padContent = el.innerHTML;
    this.padText = el.innerText || '';
    this.lastVersionContent = this.padText;
    this.updateLineNumbers();
    this.onPadContentChange();

    // Mark as dirty
    const pad = this.pads.find(p => p.id === this.activeTabId);
    if (pad) pad.isDirty = true;
    if (this.activePad) this.activePad.isDirty = true;

    this.previewingVersion = null;
    this.selectedVersionId = null;
    this.closeVersionHistory();
  }

  showDiff(version: PadVersion) {
    if (!this.padEditor) return;
    const currentText = this.padEditor.nativeElement.innerText || '';
    this.versionDiffLines = this.computeDiff(version.content, currentText);
    this.showVersionDiff = true;
  }

  closeDiff() {
    this.showVersionDiff = false;
    this.versionDiffLines = [];
  }

  private computeDiff(
    oldText: string,
    newText: string
  ): { type: 'same' | 'added' | 'removed'; text: string }[] {
    const oldLines = oldText.split('\n');
    const newLines = newText.replace(/\n$/, '').split('\n');
    const result: { type: 'same' | 'added' | 'removed'; text: string }[] = [];

    // Simple LCS-based diff
    const m = oldLines.length;
    const n = newLines.length;
    const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (oldLines[i - 1] === newLines[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
    }

    // Backtrack
    let i = m, j = n;
    const stack: { type: 'same' | 'added' | 'removed'; text: string }[] = [];
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
        stack.push({ type: 'same', text: oldLines[i - 1] });
        i--; j--;
      } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
        stack.push({ type: 'added', text: newLines[j - 1] });
        j--;
      } else {
        stack.push({ type: 'removed', text: oldLines[i - 1] });
        i--;
      }
    }
    stack.reverse();
    return stack;
  }

  async deleteVersion(version: PadVersion, event: MouseEvent) {
    event.stopPropagation();
    try {
      await this.tauri.deletePadVersion(version.id);
      if (this.selectedVersionId === version.id) {
        this.selectedVersionId = null;
        this.previewingVersion = null;
      }
      if (this.activeTabId) {
        await this.loadVersions(this.activeTabId);
      }
    } catch (err) {
      console.error('Failed to delete version:', err);
    }
  }

  startEditLabel(version: PadVersion, event: MouseEvent) {
    event.stopPropagation();
    this.editingLabelId = version.id;
    this.editingLabelText = version.label || '';
  }

  async saveLabel(version: PadVersion) {
    try {
      const label = this.editingLabelText.trim() || null;
      await this.tauri.updateVersionLabel(version.id, label);
      version.label = label;
      this.editingLabelId = null;
    } catch (err) {
      console.error('Failed to update label:', err);
    }
  }

  cancelEditLabel() {
    this.editingLabelId = null;
    this.editingLabelText = '';
  }

  timeAgo(dateStr: string): string {
    if (!dateStr) return '';
    try {
      const date = new Date(dateStr.replace(' ', 'T') + 'Z');
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffSec = Math.floor(diffMs / 1000);
      const diffMin = Math.floor(diffSec / 60);
      const diffHr = Math.floor(diffMin / 60);
      const diffDay = Math.floor(diffHr / 24);

      if (diffSec < 10) return 'just now';
      if (diffSec < 60) return `${diffSec}s ago`;
      if (diffMin < 60) return `${diffMin}m ago`;
      if (diffHr < 24) return `${diffHr}h ago`;
      if (diffDay < 7) return `${diffDay}d ago`;
      return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
    } catch {
      return dateStr;
    }
  }

  getVersionPreviewLines(content: string): string {
    const lines = content.split('\n');
    const preview = lines.slice(0, 3).join('\n');
    return preview + (lines.length > 3 ? '...' : '');
  }

  // ================= KEYBOARD SHORTCUT SYSTEM =================

  loadShortcuts() {
    const saved = localStorage.getItem('bilet_shortcuts');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        this.shortcuts.forEach(s => {
          if (parsed[s.id]) {
            s.currentKeyStr = parsed[s.id];
          }
        });
      } catch (e) {}
    }
  }

  saveShortcuts() {
    const toSave: any = {};
    this.shortcuts.forEach(s => toSave[s.id] = s.currentKeyStr);
    localStorage.setItem('bilet_shortcuts', JSON.stringify(toSave));
  }

  matchShortcut(event: KeyboardEvent, shortcutId: string): boolean {
    const shortcut = this.shortcuts.find(s => s.id === shortcutId);
    if (!shortcut) return false;
    return this.isKeyMatch(event, shortcut.currentKeyStr);
  }

  private isKeyMatch(event: KeyboardEvent, keyStr: string): boolean {
    const parts = keyStr.toLowerCase().split('+').map(p => p.trim());
    const needsCtrl = parts.includes('ctrl') || parts.includes('control');
    const needsShift = parts.includes('shift');
    const needsAlt = parts.includes('alt');
    const needsMeta = parts.includes('meta') || parts.includes('cmd');
    
    const keyPart = parts.find(p => !['ctrl', 'shift', 'alt', 'meta', 'control', 'cmd'].includes(p));
    
    if (event.ctrlKey !== needsCtrl) return false;
    if (event.shiftKey !== needsShift) return false;
    if (event.altKey !== needsAlt) return false;
    if (event.metaKey !== needsMeta) return false;

    if (!keyPart) return true;

    const eventKey = event.key.toLowerCase();
    const eventCode = event.code.toLowerCase();

    if (keyPart === 'space' && eventCode === 'space') return true;
    if (keyPart === 'esc' && eventKey === 'escape') return true;
    if (keyPart === 'up' && eventKey === 'arrowup') return true;
    if (keyPart === 'down' && eventKey === 'arrowdown') return true;
    
    return eventKey === keyPart;
  }

  get shortcutCategories(): string[] {
    const cats = Array.from(new Set(this.shortcuts.map(s => s.category)));
    return cats.filter(c => this.getShortcutsByCategory(c).length > 0);
  }

  getShortcutsByCategory(cat: string): AppShortcut[] {
    const search = this.shortcutSearchTerm.toLowerCase();
    return this.shortcuts.filter(s => s.category === cat && 
      (s.label.toLowerCase().includes(search) || s.currentKeyStr.toLowerCase().includes(search)));
  }

  startEditShortcut(sc: AppShortcut) {
    this.editingShortcutId = sc.id;
    this.capturedKeyString = sc.currentKeyStr;
  }

  cancelEditShortcut() {
    this.editingShortcutId = null;
    this.capturedKeyString = '';
  }

  captureShortcut(event: KeyboardEvent, sc: AppShortcut) {
    if (this.shortcutConflictMessage) {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Enter" || event.key === "Escape") {
        this.shortcutConflictMessage = null;
      }
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    
    const key = event.key;
    if (key === 'Escape') {
      this.cancelEditShortcut();
      return;
    }
    
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(key)) {
      return;
    }

    const parts = [];
    if (event.ctrlKey) parts.push('Ctrl');
    if (event.altKey) parts.push('Alt');
    if (event.shiftKey) parts.push('Shift');
    if (event.metaKey) parts.push('Meta');
    
    let keyName = key.length === 1 ? key.toUpperCase() : key;
    if (event.code === 'Space') keyName = 'Space';
    if (keyName === 'ArrowUp') keyName = 'Up';
    if (keyName === 'ArrowDown') keyName = 'Down';
    
    parts.push(keyName);
    const newKeyStr = parts.join(' + ');

    const conflict = this.shortcuts.find(s => s.id !== sc.id && s.currentKeyStr === newKeyStr);
    if (conflict) {
      this.shortcutConflictMessage = `Shortcut "${newKeyStr}" is already assigned to "${conflict.label}".`;
      return;
    }

    sc.currentKeyStr = newKeyStr;
    this.saveShortcuts();
    this.editingShortcutId = null;
  }

  resetAllShortcuts() {
    this.isConfirmingResetShortcuts = true;
  }

  confirmResetAllShortcuts() {
    this.shortcuts.forEach(s => s.currentKeyStr = s.defaultKeyStr);
    this.saveShortcuts();
    this.isConfirmingResetShortcuts = false;
  }

}

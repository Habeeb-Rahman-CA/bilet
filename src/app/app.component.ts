import {
  Component,
  HostListener,
  ViewChild,
  ElementRef,
  AfterViewChecked,
  OnInit,
  OnDestroy,
  Pipe,
  PipeTransform,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { RouterOutlet } from "@angular/router";
import { FormsModule } from "@angular/forms";
import { TauriService } from "./services/tauri.service";
import { Pad, PadVersion, AuthStatus, AppShortcut, BinItem } from "./models/app.models";

import { EditorState, Compartment, EditorSelection } from "@codemirror/state";
import {
  EditorView,
  lineNumbers as cmLineNumbers,
  highlightActiveLineGutter,
  highlightSpecialChars,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
  highlightActiveLine,
  keymap,
  placeholder as cmPlaceholder,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  copyLineUp,
  copyLineDown,
  moveLineUp,
  moveLineDown,
} from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { oneDark } from "@codemirror/theme-one-dark";

@Pipe({
  name: "formatContent",
  standalone: true,
  pure: true,
})
export class FormatContentPipe implements PipeTransform {
  transform(content: string): string {
    if (!content) return "";
    let result = content;
    result = result.replace(/\*\*(.*?)\*\*/g, "<b>$1</b>");
    result = result.replace(/\*(.*?)\*/g, "<i>$1</i>");
    if (!result.includes("<br>") && !result.includes("<div>")) {
      result = result.replace(/\n/g, "<br>");
    }
    return result;
  }
}

@Component({
  selector: "app-root",
  standalone: true,
  imports: [CommonModule, FormsModule, FormatContentPipe],
  templateUrl: "./app.component.html",
  styleUrl: "./app.component.css",
})
export class AppComponent implements AfterViewChecked, OnInit, OnDestroy {
  constructor(private tauri: TauriService) { }
  autoStartEnabled = false;
  showHelp = false;
  activeHelpTab: 'guide' | 'shortcuts' = 'guide';
  showBin = false;
  showSettings = false;
  skipSplashScreen = localStorage.getItem('skipSplashScreen') === 'true';
  showSplash = localStorage.getItem('skipSplashScreen') !== 'true';
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
  @ViewChild("cmEditorContainer") cmEditorContainer?: ElementRef<HTMLDivElement>;
  private searchNeedsFocus = false;
  private cmEditorView?: EditorView;
  private cmThemeCompartment = new Compartment();
  private cmWrapCompartment = new Compartment();
  private cmFontCompartment = new Compartment();
  private isUpdatingEditorFromApp = false;
  isConfirmingPadCloseId: number | null = null;
  isConfirmingClearVersions = false;
  appDataDirPath = '';


  // Notepad state
  pads: Pad[] = [];
  activeTabId: number | null = null;
  activePad: Pad | null = null;
  padContent = "";
  padText = ""; // plain-text mirror, always in sync with padEditor.innerText
  lineNumbers: number[] = [1];
  get exactLineHeight(): number {
    const fs = this.fontSize || 13;
    const lh = this.lineHeight || 1.7;
    return Math.round(fs * lh);
  }
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
  findMatches: { start: number; end: number }[] = [];
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
  authStatus: AuthStatus = "Unlocked";
  errorMessage = "";
  isDarkMode = false;
  appVersion = "1.4.0";
  isSticky = localStorage.getItem('isSticky') === 'true';

  async toggleStickyMode() {
    this.isSticky = !this.isSticky;
    localStorage.setItem('isSticky', String(this.isSticky));
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
  selectedFont = localStorage.getItem('selectedFont') || "Cascadia Code";
  showFontSettings = false;
  focusedFontIndex = 0;
  spellCheckEnabled = localStorage.getItem('spellcheck') === 'true';
  fontSize = Number(localStorage.getItem('fontSize')) || 13;
  lineHeight = Number(localStorage.getItem('lineHeight')) || 1.7;
  wordWrap = localStorage.getItem('wordWrap') !== 'false'; // Default to true
  autoSaveDelay = Number(localStorage.getItem('autoSaveDelay')) || 500;
  versionRetention = Number(localStorage.getItem('versionRetention')) || 50;
  versionAutoSaveInterval = Number(localStorage.getItem('versionAutoSaveInterval')) || 1000;

  // New Appearance & Editor settings
  accentColor = localStorage.getItem('accentColor') || '#ffffffff';
  showStatusBar = localStorage.getItem('showStatusBar') !== 'false';
  minimizeToTray = localStorage.getItem('minimizeToTray') !== 'false';
  animationSpeed = (localStorage.getItem('animationSpeed') as 'none' | 'reduced' | 'normal') || 'normal';
  openCustomSelect: 'animationSpeed' | 'versionRetention' | null = null;

  toggleCustomSelect(name: 'animationSpeed' | 'versionRetention', event?: MouseEvent) {
    if (event) event.stopPropagation();
    this.openCustomSelect = this.openCustomSelect === name ? null : name;
  }

  selectAnimationSpeed(val: 'none' | 'reduced' | 'normal') {
    this.updateAnimationSpeed(val);
    this.openCustomSelect = null;
  }

  selectVersionRetention(val: number) {
    this.updateVersionRetention(val);
    this.openCustomSelect = null;
  }

  getAnimationSpeedLabel(): string {
    if (this.animationSpeed === 'none') return 'None';
    if (this.animationSpeed === 'reduced') return 'Reduced';
    return 'Normal';
  }

  getVersionRetentionLabel(): string {
    return `${this.versionRetention} vers.`;
  }
  activeLineIndex = 0;
  private currentCaretLine = 0;


  // Customizable Keyboard Shortcuts
  shortcuts: AppShortcut[] = [
    { id: 'app.workspace_notes', label: 'All Workspace Notes', category: 'Global Navigation', defaultKeyStr: 'Ctrl + O', currentKeyStr: 'Ctrl + O' },
    { id: 'app.search', label: 'Global Search', category: 'Global Navigation', defaultKeyStr: 'Ctrl + F', currentKeyStr: 'Ctrl + F' },
    { id: 'app.history', label: 'History / Bin', category: 'Global Navigation', defaultKeyStr: 'Ctrl + Shift + B', currentKeyStr: 'Ctrl + Shift + B' },
    { id: 'app.help', label: 'Keyboard Shortcuts', category: 'Global Navigation', defaultKeyStr: 'Ctrl + H', currentKeyStr: 'Ctrl + H' },
    { id: 'app.toggle_sticky', label: 'Toggle Always on Top', category: 'Global Navigation', defaultKeyStr: 'Alt + Shift + P', currentKeyStr: 'Alt + Shift + P' },

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
    this.dismissSplashScreen();

    // Intercept Ctrl+P / Cmd+P in capture phase so browser default Print never steals it
    window.addEventListener(
      'keydown',
      (e: KeyboardEvent) => {
        const isP = e.key.toLowerCase() === 'p' || e.code === 'KeyP';
        if ((e.ctrlKey || e.metaKey) && isP && !e.altKey) {
          e.preventDefault();
        }
      },
      { capture: true }
    );

    await this.loadCustomFonts();
    this.loadShortcuts();
    try {
      this.autoStartEnabled = await this.tauri.isAutostartEnabled();
    } catch (err) {
      console.warn("Autostart plugin not available:", err);
    }

    try {
      this.authStatus = await this.tauri.checkAuthStatus();
      await this.loadPads();
      this.loadSession();
      this.triggerPadEditorFocus();

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
    this.applyEditorSettings();
    if (this.isSticky) {
      this.tauri.setAlwaysOnTop(true).catch(e => console.error("Initial sticky failed:", e));
    }
    this.tauri.setMinimizeToTray(this.minimizeToTray).catch(e => console.error("Initial tray setting failed:", e));
  }

  ngOnDestroy() {
    if (this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer);
      this.savePadNow();
    }
    if (this.cmEditorView) {
      this.cmEditorView.destroy();
      this.cmEditorView = undefined;
    }
    this.saveSession();
  }

  @HostListener("window:beforeunload")
  onBeforeUnload() {
    if (this.autoSaveTimer) {
      this.savePadNow();
    }
  }

  toggleSettings() {
    this.showSettings = !this.showSettings;
    if (this.showSettings) {
      this.showVersionHistory = false;
      this.isConfirmingClearVersions = false;
      this.loadAppDataPath();
    } else {
      this.triggerPadEditorFocus();
    }
  }

  async resetSettings() {
    // 1. Reset Appearance
    this.isDarkMode = false;
    localStorage.setItem("darkMode", "false");
    document.documentElement.classList.remove("dark-mode");

    this.selectedFont = "Cascadia Code";
    localStorage.setItem("selectedFont", "Cascadia Code");
    this.setFont("Cascadia Code");

    this.fontSize = 13;
    localStorage.removeItem('fontSize');

    // 2. Reset Editor
    this.wordWrap = true;
    this.showStatusBar = true;
    localStorage.removeItem('wordWrap');
    localStorage.removeItem('showStatusBar');

    // 3. Reset Window
    this.isSticky = false;
    localStorage.setItem('isSticky', 'false');
    await this.tauri.setAlwaysOnTop(false);

    this.applyEditorSettings();
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
    if (saved && (this.availableFonts.some(f => f.name === saved) || saved.startsWith('Custom-'))) {
      this.setFont(saved);
    } else {
      this.setFont("Cascadia Code");
    }
  }

  getCurrentFontFamily(): string {
    const font = this.availableFonts.find((f) => f.name === this.selectedFont);
    return font ? font.family : `'${this.selectedFont}', monospace`;
  }

  getFontTheme(family: string) {
    return EditorView.theme({
      "&": {
        fontFamily: `${family} !important`
      },
      ".cm-scroller": {
        fontFamily: `${family} !important`
      },
      ".cm-content": {
        fontFamily: `${family} !important`
      },
      ".cm-line": {
        fontFamily: `${family} !important`
      },
      ".cm-gutters": {
        fontFamily: `${family} !important`
      },
      ".cm-gutterElement": {
        fontFamily: `${family} !important`
      }
    });
  }

  setFont(fontName: string) {
    this.selectedFont = fontName;
    localStorage.setItem("selectedFont", fontName);
    const font = this.availableFonts.find((f) => f.name === fontName);
    const family = font ? font.family : `'${fontName}', monospace`;
    document.documentElement.style.setProperty("--main-font", family);
    document.body.style.setProperty("--main-font", family);
    if (this.cmEditorContainer?.nativeElement) {
      this.cmEditorContainer.nativeElement.style.setProperty("--main-font", family);
      this.cmEditorContainer.nativeElement.style.fontFamily = family;
    }
    if (this.cmEditorView) {
      this.cmEditorView.dispatch({
        effects: this.cmFontCompartment.reconfigure(this.getFontTheme(family))
      });
      this.cmEditorView.requestMeasure();
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
    this.updateCodeMirrorTheme();
  }

  ngAfterViewChecked() {
    if (this.searchNeedsFocus && this.searchInput) {
      this.searchInput.nativeElement.focus();
      this.searchNeedsFocus = false;
    }
  }

  applyEditorSettings() {
    const fs = this.fontSize || 13;
    const lh = this.lineHeight || 1.7;
    const lhExact = Math.round(fs * lh);
    
    document.documentElement.style.setProperty("--editor-font-size", fs + "px");
    document.documentElement.style.setProperty("--editor-line-height", String(lh));
    document.documentElement.style.setProperty("--editor-line-height-exact", lhExact + "px");
    document.documentElement.style.setProperty("--editor-word-wrap", this.wordWrap ? "pre-wrap" : "pre");
    document.documentElement.style.setProperty("--accent-color", this.accentColor);
    
    let transitionTime = '0.3s';
    if (this.animationSpeed === 'none') transitionTime = '0s';
    if (this.animationSpeed === 'reduced') transitionTime = '0.1s';
    document.documentElement.style.setProperty("--transition-speed", transitionTime);
    setTimeout(() => this.updateLineNumbers(), 0);
  }

  updateFontSize(size: any) {
    this.fontSize = Number(size);
    localStorage.setItem('fontSize', String(this.fontSize));
    this.applyEditorSettings();
  }

  updateLineHeight(height: any) {
    this.lineHeight = Number(height);
    localStorage.setItem('lineHeight', String(this.lineHeight));
    this.applyEditorSettings();
  }

  toggleWordWrap() {
    this.wordWrap = !this.wordWrap;
    localStorage.setItem('wordWrap', String(this.wordWrap));
    this.applyEditorSettings();
    this.updateCodeMirrorWordWrap();
  }

  updateAutoSaveDelay(ms: any) {
    this.autoSaveDelay = Number(ms);
    localStorage.setItem('autoSaveDelay', String(this.autoSaveDelay));
  }

  updateVersionRetention(count: any) {
    this.versionRetention = Number(count);
    localStorage.setItem('versionRetention', String(this.versionRetention));
  }

  updateVersionAutoSaveInterval(ms: any) {
    this.versionAutoSaveInterval = Number(ms);
    localStorage.setItem('versionAutoSaveInterval', String(this.versionAutoSaveInterval));
  }

  updateAccentColor(color: string) {
    this.accentColor = color;
    localStorage.setItem('accentColor', color);
    this.applyEditorSettings();
  }

  toggleStatusBar() {
    this.showStatusBar = !this.showStatusBar;
    localStorage.setItem('showStatusBar', String(this.showStatusBar));
  }

  toggleSkipSplash() {
    this.skipSplashScreen = !this.skipSplashScreen;
    localStorage.setItem('skipSplashScreen', String(this.skipSplashScreen));
  }

  dismissSplashScreen() {
    if (this.skipSplashScreen || !this.showSplash) {
      this.showSplash = false;
      this.splashFading = false;
      return;
    }

    setTimeout(() => {
      this.splashFading = true;
      setTimeout(() => {
        this.showSplash = false;
      }, 500);
    }, 700);
  }

  dismissSplashScreenImmediately() {
    this.splashFading = true;
    setTimeout(() => {
      this.showSplash = false;
    }, 150);
  }

  updateAnimationSpeed(speed: any) {
    this.animationSpeed = speed;
    localStorage.setItem('animationSpeed', speed);
    this.applyEditorSettings();
  }

  toggleMinimizeToTray() {
    this.minimizeToTray = !this.minimizeToTray;
    localStorage.setItem('minimizeToTray', String(this.minimizeToTray));
    this.tauri.setMinimizeToTray(this.minimizeToTray).catch(console.error);
  }

  async checkForUpdates() {
    try {
      await this.tauri.checkForUpdates();
    } catch (e) {
      console.error("Update check failed:", e);
    }
  }



  // --- Data Management Methods ---
  async loadAppDataPath() {
    try {
      this.appDataDirPath = await this.tauri.getAppDataDir();
    } catch (e) {
      console.error("Failed to load app data path:", e);
    }
  }

  async clearAllVersionHistory() {
    if (!this.isConfirmingClearVersions) {
      this.isConfirmingClearVersions = true;
      return;
    }
    
    try {
      await this.tauri.clearAllVersionHistory();
      this.isConfirmingClearVersions = false;
      this.showSettings = false; // Close settings to show it worked? Or just stay?
      // Reload versions if open
      if (this.showVersionHistory && this.activeTabId) {
        this.loadVersions(this.activeTabId);
      }
    } catch (e) {
      console.error("Failed to clear version history:", e);
    }
  }

  async startBulkExport() {
    try {
      const selected = await this.tauri.openDialog({
        directory: true,
        multiple: false,
        title: 'Select Destination for Export'
      });
      
      if (selected && typeof selected === 'string') {
        const res = await this.tauri.exportAllPads(selected);
        alert(res); // Simple feedback
      }
    } catch (e) {
      console.error("Bulk export failed:", e);
    }
  }

  async openAppDataDir() {
    if (this.appDataDirPath) {
      try {
        await this.tauri.openPath(this.appDataDirPath);
      } catch (e) {
        console.error("Failed to open app data dir:", e);
      }
    }
  }


  triggerPadEditorFocus() {
    setTimeout(() => {
      if (this.cmEditorView) {
        this.cmEditorView.focus();
      }
    }, 0);
  }

  clearHighlights() {
    this.findMatches = [];
  }

  getCleanPlainText(content: string): string {
    if (!content) return '';
    if (content.includes('<div>') || content.includes('<p>') || content.includes('<br>')) {
      const temp = document.createElement('div');
      temp.innerHTML = content;
      return (temp.innerText || temp.textContent || '').replace(/\r\n/g, '\n');
    }
    return content;
  }

  initCodeMirrorEditor() {
    if (!this.cmEditorContainer || !this.cmEditorContainer.nativeElement) return;
    const parentEl = this.cmEditorContainer.nativeElement;

    if (this.cmEditorView) {
      this.cmEditorView.destroy();
      this.cmEditorView = undefined;
    }

    const initialText = this.getCleanPlainText(this.padContent);
    this.padText = initialText;

    const baseTheme = EditorView.theme({
      "&": {
        height: "100%",
        fontSize: "var(--editor-font-size, 13px)",
        fontFamily: "var(--main-font, monospace)",
        backgroundColor: "var(--bg-color, #0d0d0d)",
        color: "var(--text-color, #f0f0f0)"
      },
      "&.cm-focused": {
        outline: "none"
      },
      ".cm-scroller": {
        fontFamily: "inherit",
        lineHeight: "var(--editor-line-height-exact, 24px)"
      },
      ".cm-content": {
        fontFamily: "inherit",
        padding: "16px 24px 60px 24px",
        caretColor: "var(--text-color, #f0f0f0)"
      },
      ".cm-line": {
        fontFamily: "inherit"
      },
      ".cm-gutters": {
        backgroundColor: "#000000 !important",
        color: "#ffffff !important",
        borderRight: "1px solid var(--border-color, #1e1e1e) !important",
        minWidth: "44px !important",
        flexShrink: "0 !important"
      },
      ".cm-lineNumbers": {
        minWidth: "44px !important"
      },
      ".cm-gutterElement": {
        color: "#ffffff !important",
        opacity: "0.85",
        fontFamily: "inherit",
        minWidth: "38px !important",
        textAlign: "right !important",
        padding: "0 10px 0 6px !important",
        boxSizing: "border-box !important",
        fontVariantNumeric: "tabular-nums !important"
      },
      ".cm-activeLineGutter": {
        backgroundColor: "transparent !important",
        color: "#ffffff !important",
        opacity: "1 !important",
        fontWeight: "700"
      },
      ".cm-activeLine": {
        backgroundColor: "transparent !important"
      },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
        backgroundColor: "var(--selection-bg, rgba(255, 255, 255, 0.22)) !important"
      },
      ".cm-selectionMatch": {
        backgroundColor: "var(--selection-match-bg, rgba(255, 255, 255, 0.12)) !important"
      },
      ".cm-content ::selection, .cm-line ::selection": {
        backgroundColor: "var(--selection-bg, rgba(255, 255, 255, 0.22)) !important",
        color: "var(--selection-color, #ffffff) !important"
      }
    });

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged && !this.isUpdatingEditorFromApp) {
        const newText = update.state.doc.toString();
        this.padText = newText;
        this.padContent = newText;

        const pad = this.pads.find(p => p.id === this.activeTabId);
        if (pad) pad.isDirty = true;
        if (this.activePad) this.activePad.isDirty = true;

        this.onPadContentChange();
        this.scheduleVersionSave();

        if (this.showFindReplace && this.searchTerm) {
          this.updateFindMatches();
        }
      }

      if (update.selectionSet) {
        const ranges = update.state.selection.ranges;
        if (ranges && ranges.length > 0) {
          const main = ranges[0];
          this.selectedPadText = update.state.sliceDoc(main.from, main.to);
          const line = update.state.doc.lineAt(main.head);
          this.activeLineIndex = line.number - 1;
        }
      }
    });

    const startState = EditorState.create({
      doc: initialText,
      extensions: [
        cmLineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        drawSelection(),
        dropCursor(),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        markdown(),
        cmPlaceholder("Start writing notes, thoughts, or code..."),
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          indentWithTab,
          { key: "Alt-ArrowUp", run: moveLineUp },
          { key: "Alt-ArrowDown", run: moveLineDown },
          { key: "Shift-Alt-ArrowUp", run: copyLineUp },
          { key: "Shift-Alt-ArrowDown", run: copyLineDown },
          { key: "Mod-b", run: () => this.toggleMarkdownWrap("**") },
          { key: "Mod-i", run: () => this.toggleMarkdownWrap("*") },
          { key: "Mod-u", run: () => this.toggleMarkdownWrap("<u>", "</u>") },
        ]),
        this.cmThemeCompartment.of(this.isDarkMode ? oneDark : []),
        this.cmWrapCompartment.of(this.wordWrap ? EditorView.lineWrapping : []),
        this.cmFontCompartment.of(this.getFontTheme(this.getCurrentFontFamily())),
        baseTheme,
        updateListener
      ]
    });

    this.cmEditorView = new EditorView({
      state: startState,
      parent: parentEl
    });

    this.updateLineNumbers();
  }

  updateCodeMirrorEditorContent(newText: string) {
    if (!this.cmEditorView) return;
    const currentDoc = this.cmEditorView.state.doc.toString();
    if (currentDoc === newText) return;

    this.isUpdatingEditorFromApp = true;
    this.cmEditorView.dispatch({
      changes: { from: 0, to: currentDoc.length, insert: newText }
    });
    this.isUpdatingEditorFromApp = false;
    this.padText = newText;
    this.padContent = newText;
    this.updateLineNumbers();
  }

  updateCodeMirrorTheme() {
    if (!this.cmEditorView) return;
    this.cmEditorView.dispatch({
      effects: this.cmThemeCompartment.reconfigure(this.isDarkMode ? oneDark : [])
    });
  }

  updateCodeMirrorWordWrap() {
    if (!this.cmEditorView) return;
    this.cmEditorView.dispatch({
      effects: this.cmWrapCompartment.reconfigure(this.wordWrap ? EditorView.lineWrapping : [])
    });
  }

  @HostListener("window:keydown", ["$event"])
  handleGlobalKeys(event: KeyboardEvent) {
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

    if (this.activeTabId && this.cmEditorView) {
      if (this.matchShortcut(event, 'notepad.bold')) {
        event.preventDefault();
        this.toggleMarkdownWrap('**');
        return;
      }
      if (this.matchShortcut(event, 'notepad.italic')) {
        event.preventDefault();
        this.toggleMarkdownWrap('*');
        return;
      }
      if (this.matchShortcut(event, 'notepad.underline')) {
        event.preventDefault();
        this.toggleMarkdownWrap('<u>', '</u>');
        return;
      }
      if (this.matchShortcut(event, 'notepad.dup_line')) {
        event.preventDefault();
        copyLineDown(this.cmEditorView);
        return;
      }
      if (this.matchShortcut(event, 'notepad.move_line')) {
        event.preventDefault();
        moveLineDown(this.cmEditorView);
        return;
      }
    }

    if (this.matchShortcut(event, 'app.workspace_notes')) {
      event.preventDefault();
      this.toggleDocumentDrawer();
      return;
    }

    if (this.matchShortcut(event, 'app.toggle_sticky')) {
      event.preventDefault();
      this.toggleStickyMode();
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
      const isInputOrEditor = activeTagName === 'input' || activeTagName === 'textarea' || document.activeElement?.classList.contains('cm-content') || !!document.activeElement?.closest('.cm-editor');

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

    if (this.showBin) {
      const activeTagName = document.activeElement?.tagName.toLowerCase();
      const isInputOrEditor = activeTagName === 'input' || activeTagName === 'textarea' || document.activeElement?.classList.contains('cm-content') || !!document.activeElement?.closest('.cm-editor');

      if (!isInputOrEditor && this.binItems.length > 0) {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          const currentIndex = this.binItems.findIndex(v => v.id === this.selectedBinItemId?.id && v.type === this.selectedBinItemId?.type);
          const nextIndex = currentIndex < this.binItems.length - 1 ? currentIndex + 1 : this.binItems.length - 1;
          this.selectedBinItemId = { id: this.binItems[nextIndex].id, type: this.binItems[nextIndex].type };
          this.scrollSelectedBinIntoView();
          return;
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          const currentIndex = this.binItems.findIndex(v => v.id === this.selectedBinItemId?.id && v.type === this.selectedBinItemId?.type);
          const prevIndex = currentIndex > 0 ? currentIndex - 1 : 0;
          this.selectedBinItemId = { id: this.binItems[prevIndex].id, type: this.binItems[prevIndex].type };
          this.scrollSelectedBinIntoView();
          return;
        } else if (event.ctrlKey && event.key.toLowerCase() === "r" && this.selectedBinItemId) {
          event.preventDefault();
          this.isConfirmingRestoreId = { ...this.selectedBinItemId };
          this.isConfirmingBinDeleteId = null;
          this.isConfirmingClearAll = false;
          return;
        } else if (event.ctrlKey && event.key.toLowerCase() === "d" && this.selectedBinItemId) {
          event.preventDefault();
          this.isConfirmingBinDeleteId = { ...this.selectedBinItemId };
          this.isConfirmingRestoreId = null;
          this.isConfirmingClearAll = false;
          return;
        } else if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "c") {
          event.preventDefault();
          this.isConfirmingClearAll = true;
          this.isConfirmingBinDeleteId = null;
          this.isConfirmingRestoreId = null;
          return;
        } else if (event.key === "Enter") {
          if (this.isConfirmingRestoreId && this.selectedBinItemId) {
            event.preventDefault();
            this.restoreItem(this.selectedBinItemId);
            this.isConfirmingRestoreId = null;
          } else if (this.isConfirmingBinDeleteId && this.selectedBinItemId) {
            event.preventDefault();
            this.permanentDeleteItem(this.selectedBinItemId);
            this.isConfirmingBinDeleteId = null;
          } else if (this.isConfirmingClearAll) {
            event.preventDefault();
            this.clearBin();
            this.isConfirmingClearAll = false;
          }
          return;
        }
      }
    }

    // Help modal Tab key switching
    if (this.showHelp) {
      if (event.key === "Tab") {
        if (!this.editingShortcutId) {
          event.preventDefault();
          this.activeHelpTab = this.activeHelpTab === 'guide' ? 'shortcuts' : 'guide';
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
      if (this.openCustomSelect) {
        this.openCustomSelect = null;
        event.preventDefault();
        return;
      }
      if (this.showVersionHistory) {
        this.closeVersionHistory();
        event.preventDefault();
        return;
      }
      if (this.showSettings) {
        this.showSettings = false;
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
        this.showDrawer ||
        this.isConfirmingPadCloseId
      ) {
        this.showHelp = false;
        this.showBin = false;
        this.showDrawer = false;
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

  @HostListener("window:click")
  onWindowClick() {
    this.openCustomSelect = null;
  }

  async startBackup() {
    try {
      const dest = await this.tauri.saveDialog({
        defaultPath: "bilet_backup.db",
        filters: [{ name: "Bilet Database", extensions: ["db"] }]
      });
      if (dest) {
        await this.tauri.backupVault(dest);
      }
    } catch (err) {
      console.error("Backup failed:", err);
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
      this.updateOpenOrderedTabs();
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
    const raw = (pad.title && !pad.title.includes('<')) ? pad.title : pad.content;
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = raw;
    const text = (tempDiv.innerText || tempDiv.textContent || '').replace(/\r\n/g, '\n').trim();
    const firstLine = text.split("\n")[0]?.replace(/<[^>]*>/g, '').trim();
    return firstLine || "Untitled";
  }

  async deletePad(padId: number, event?: MouseEvent) {
    if (event) event.stopPropagation();

    try {
      await this.tauri.deletePadToBin(padId);

      const padToDelete = this.pads.find(p => p.id === padId);
      if (padToDelete && padToDelete.is_open) {
        await this.forceCloseTabUI(padId);
      } else {
        await this.loadPads();
      }

      if (this.showBin) {
        await this.loadBinItems();
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
      this.initCodeMirrorEditor();
      this.triggerPadEditorFocus();
    });
  }

  openOrderedTabs: Pad[] = [];

  updateOpenOrderedTabs() {
    this.openOrderedTabs = this.pads
      .filter((p) => p.is_open && !p.is_deleted)
      .sort((a, b) => a.tab_index - b.tab_index);
  }

  showDrawer = false;

  toggleDocumentDrawer() {
    this.showDrawer = !this.showDrawer;
  }

  get allNonDeletedPads(): Pad[] {
    return this.pads.filter(p => !p.is_deleted);
  }

  async reopenPadFromDrawer(padId: number) {
    this.showDrawer = false;
    await this.openTab(padId);
  }

  async closeTab(padId: number, event?: MouseEvent) {
    if (event) event.stopPropagation();

    const pad = this.pads.find(p => p.id === padId);
    if (pad && pad.isDirty) {
      // Has unsaved changes — ask if they want to save to file first
      this.isConfirmingPadCloseId = padId;
    } else {
      // Clean — close tab view without deleting document to bin
      await this._closeTabInternal(padId);
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
      // Discard unsaved changes and close tab view
      this.isConfirmingPadCloseId = null;
      await this._closeTabInternal(padId);
    } else if (action === 'saveAndDelete') {
      // Save to file first, then close tab view
      const success = await this.savePadToFile(padId);
      if (success) {
        this.isConfirmingPadCloseId = null;
        await this._closeTabInternal(padId);
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
      const text = this.padText || '';
      const firstLine = text.split("\n")[0]?.replace(/<[^>]*>/g, '').trim();
      pad.title = firstLine || "Untitled";
    }
    this.schedulePadAutoSave();
  }

  get padStats(): { w: number; c: number; l: number } {
    const trimmed = this.padText ? this.padText.trim() : '';
    const words = trimmed ? trimmed.split(/\s+/).length : 0;
    const chars = this.padText ? this.padText.length : 0;
    const lines = this.lineNumbers.length;
    return { w: words, c: chars, l: lines };
  }

  updateLineNumbers() {
    const text = this.padText || '';
    const normalized = text.replace(/\r\n/g, '\n');

    let count = 1;
    if (normalized.length > 0) {
      count = normalized.split('\n').length;
    }
    count = Math.max(1, count);
    this.lineNumbers = Array.from({ length: count }, (_, i) => i + 1);
  }

  toggleMarkdownWrap(before: string, after: string = before): boolean {
    if (!this.cmEditorView) return false;
    const view = this.cmEditorView;
    const changes = view.state.changeByRange((range) => {
      const text = view.state.sliceDoc(range.from, range.to);
      if (text.startsWith(before) && text.endsWith(after) && text.length >= before.length + after.length) {
        const unwrapped = text.slice(before.length, text.length - after.length);
        return {
          changes: { from: range.from, to: range.to, insert: unwrapped },
          range: EditorSelection.range(range.from, range.from + unwrapped.length)
        };
      }
      const wrapped = before + text + after;
      return {
        changes: { from: range.from, to: range.to, insert: wrapped },
        range: EditorSelection.range(range.from + before.length, range.to + before.length)
      };
    });
    view.dispatch(changes);
    return true;
  }

  @HostListener('window:resize')
  onWindowResize() {
    this.updateLineNumbers();
  }

  private schedulePadAutoSave() {
    if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
    this.autoSaveTimer = setTimeout(() => {
      this.savePadNow();
    }, this.autoSaveDelay);
  }

  private async savePadNow() {
    if (!this.activePad) return;
    const text = this.padText || '';
    const firstLine = text.split("\n")[0]?.replace(/<[^>]*>/g, '').trim();
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
      if (item.type === "pad") {
        await this.tauri.restoreBinItem(item.id);
      }
      this.selectedBinItemId = null;
      this.isConfirmingRestoreId = null;
      await this.loadBinItems();
      await this.loadPads();

      // Automatically open the restored pad as a tab and focus it
      if (item.type === "pad") {
        await this.openTab(item.id);
        this.showBin = false; // Redirect user to the editor
      }
    } catch (err) {
      console.error(err);
    }
  }

  async permanentDeleteItem(item: { id: number; type: "pad" }) {
    try {
      if (item.type === "pad") {
        await this.tauri.deletePermanently(item.id);
      }
      this.selectedBinItemId = null;
      this.isConfirmingBinDeleteId = null;
      await this.loadBinItems();
    } catch (err) {
      console.error(err);
    }
  }

  async clearBin() {
    try {
      await this.tauri.clearBin();
      this.selectedBinItemId = null;
      this.isConfirmingClearAll = false;
      await this.loadBinItems();
    } catch (err) {
      console.error(err);
    }
  }

  startWindowDrag(event: MouseEvent) {
    if (event.button === 0) {
      const target = event.target as HTMLElement;
      if (!target.closest('button') && !target.closest('input') && !target.closest('.no-drag')) {
        this.tauri.startDragging().catch(err => console.error("Dragging failed:", err));
      }
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
      document.fonts.ready.then(() => {
        if (this.cmEditorView) {
          this.cmEditorView.requestMeasure();
        }
      });
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

        // Dedicated style injection for guaranteed WebKitGTK / browser font engine rendering
        const styleId = `custom-font-style-${name}`;
        let styleEl = document.getElementById(styleId);
        if (!styleEl) {
          styleEl = document.createElement('style');
          styleEl.id = styleId;
          document.head.appendChild(styleEl);
        }
        styleEl.textContent = `@font-face { font-family: "${familyName}"; src: url("${assetUrl}"); font-display: swap; }`;

        try {
          // Register @font-face dynamically in FontFaceSet
          const fontFace = new FontFace(familyName, `url("${assetUrl}")`);
          await fontFace.load();
          (document.fonts as any).add(fontFace);
          console.log('Font loaded successfully:', familyName);
        } catch (fontErr) {
          console.warn('FontFace load note:', fontErr);
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

      const styleEl = document.getElementById(`custom-font-style-${fontName}`);
      if (styleEl) styleEl.remove();

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
    this.findMatches = [];
    if (!this.searchTerm || !this.cmEditorView) {
      this.currentFindIndex = 0;
      return;
    }

    const docText = this.cmEditorView.state.doc.toString();
    const query = this.matchCase ? this.searchTerm : this.searchTerm.toLowerCase();
    const target = this.matchCase ? docText : docText.toLowerCase();

    let pos = 0;
    while (pos < target.length) {
      const idx = target.indexOf(query, pos);
      if (idx === -1) break;

      if (this.matchWholeWord) {
        const prevChar = idx > 0 ? target[idx - 1] : ' ';
        const nextChar = idx + query.length < target.length ? target[idx + query.length] : ' ';
        const isWordBoundary = /\W/.test(prevChar) && /\W/.test(nextChar);
        if (!isWordBoundary) {
          pos = idx + query.length;
          continue;
        }
      }

      this.findMatches.push({ start: idx, end: idx + query.length });
      pos = idx + query.length;
    }

    if (this.findMatches.length > 0) {
      if (this.currentFindIndex >= this.findMatches.length) {
        this.currentFindIndex = 0;
      }
      this.scrollToMatch();
    } else {
      this.currentFindIndex = 0;
    }
  }

  nextMatch() {
    if (this.findMatches.length > 0) {
      this.currentFindIndex = (this.currentFindIndex + 1) % this.findMatches.length;
      this.scrollToMatch();
      this.findInputRef?.nativeElement.focus();
    }
  }

  prevMatch() {
    if (this.findMatches.length > 0) {
      this.currentFindIndex = (this.currentFindIndex - 1 + this.findMatches.length) % this.findMatches.length;
      this.scrollToMatch();
      this.findInputRef?.nativeElement.focus();
    }
  }

  scrollToMatch() {
    if (!this.cmEditorView || this.findMatches.length === 0) return;
    const match = this.findMatches[this.currentFindIndex];
    if (!match) return;

    this.cmEditorView.dispatch({
      selection: { anchor: match.start, head: match.end },
      scrollIntoView: true
    });
  }

  replaceMatch() {
    if (!this.cmEditorView || this.findMatches.length === 0) return;
    const match = this.findMatches[this.currentFindIndex];
    if (!match) return;

    this.cmEditorView.dispatch({
      changes: { from: match.start, to: match.end, insert: this.replaceTerm },
      selection: { anchor: match.start, head: match.start + this.replaceTerm.length },
      scrollIntoView: true
    });

    const oldIndex = this.currentFindIndex;
    this.updateFindMatches();
    if (this.findMatches.length > 0) {
      this.currentFindIndex = Math.min(oldIndex, this.findMatches.length - 1);
      this.scrollToMatch();
    }
  }

  replaceAllMatches() {
    if (!this.cmEditorView || this.findMatches.length === 0) return;

    const changes = this.findMatches.map(m => ({
      from: m.start,
      to: m.end,
      insert: this.replaceTerm
    }));

    this.cmEditorView.dispatch({ changes });
    this.updateFindMatches();
  }

  toggleVersionHistory() {
    this.showVersionHistory = !this.showVersionHistory;
    if (this.showVersionHistory) {
      this.showSettings = false;
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
    }, this.versionAutoSaveInterval);
  }

  private async autoSaveVersion() {
    if (!this.activePad) return;
    const plainText = this.padText || '';
    if (!plainText.trim()) return;
    // Skip if content hasn't changed from last version save
    if (plainText === this.lastVersionContent) return;

    try {
      const result = await this.tauri.savePadVersion(this.activePad.id, plainText, null, this.versionRetention);
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
    if (!this.activePad) return;
    const plainText = this.padText || '';
    if (!plainText.trim()) return;

    try {
      const savedId = await this.tauri.savePadVersion(this.activePad.id, plainText, 'Checkpoint', this.versionRetention);
      this.lastVersionContent = plainText;
      if (this.activeTabId) {
        await this.loadVersions(this.activeTabId);
        if (savedId && savedId !== -1) {
          const matched = this.padVersions.find(v => v.id === savedId);
          if (matched) {
            this.selectVersion(matched);
          } else if (this.padVersions.length > 0) {
            this.selectVersion(this.padVersions[0]);
          }
        } else if (this.padVersions.length > 0) {
          this.selectVersion(this.padVersions[0]);
        }
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
    if (!this.activePad) return;
    const cleanText = this.getCleanPlainText(version.content || '');

    this.updateCodeMirrorEditorContent(cleanText);
    this.padContent = cleanText;
    this.padText = cleanText;
    this.lastVersionContent = cleanText;
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
    const versionText = this.getCleanPlainText(version.content || '');
    const currentText = this.padText || '';
    this.versionDiffLines = this.computeDiff(versionText, currentText);
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

    let start = 0;
    while (
      start < oldLines.length &&
      start < newLines.length &&
      oldLines[start] === newLines[start]
    ) {
      start++;
    }

    let oldEnd = oldLines.length - 1;
    let newEnd = newLines.length - 1;
    while (
      oldEnd >= start &&
      newEnd >= start &&
      oldLines[oldEnd] === newLines[newEnd]
    ) {
      oldEnd--;
      newEnd--;
    }

    const prefix: { type: 'same'; text: string }[] = [];
    for (let k = 0; k < start; k++) {
      prefix.push({ type: 'same', text: oldLines[k] });
    }

    const suffix: { type: 'same'; text: string }[] = [];
    for (let k = oldEnd + 1; k < oldLines.length; k++) {
      suffix.push({ type: 'same', text: oldLines[k] });
    }

    const midOld = oldLines.slice(start, oldEnd + 1);
    const midNew = newLines.slice(start, newEnd + 1);

    const m = midOld.length;
    const n = midNew.length;

    let midResult: { type: 'same' | 'added' | 'removed'; text: string }[] = [];

    if (m * n > 250000 || m > 1000 || n > 1000) {
      for (const line of midOld) {
        midResult.push({ type: 'removed', text: line });
      }
      for (const line of midNew) {
        midResult.push({ type: 'added', text: line });
      }
    } else if (m === 0) {
      for (const line of midNew) {
        midResult.push({ type: 'added', text: line });
      }
    } else if (n === 0) {
      for (const line of midOld) {
        midResult.push({ type: 'removed', text: line });
      }
    } else {
      const dp = new Int32Array((m + 1) * (n + 1));
      const getDp = (r: number, c: number) => dp[r * (n + 1) + c];
      const setDp = (r: number, c: number, v: number) => { dp[r * (n + 1) + c] = v; };

      for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
          if (midOld[i - 1] === midNew[j - 1]) {
            setDp(i, j, getDp(i - 1, j - 1) + 1);
          } else {
            const top = getDp(i - 1, j);
            const left = getDp(i, j - 1);
            setDp(i, j, top > left ? top : left);
          }
        }
      }

      let i = m, j = n;
      const stack: { type: 'same' | 'added' | 'removed'; text: string }[] = [];
      while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && midOld[i - 1] === midNew[j - 1]) {
          stack.push({ type: 'same', text: midOld[i - 1] });
          i--; j--;
        } else if (j > 0 && (i === 0 || getDp(i, j - 1) >= getDp(i - 1, j))) {
          stack.push({ type: 'added', text: midNew[j - 1] });
          j--;
        } else {
          stack.push({ type: 'removed', text: midOld[i - 1] });
          i--;
        }
      }
      stack.reverse();
      midResult = stack;
    }

    return [...prefix, ...midResult, ...suffix];
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
    this.editingLabelText = version.label || 'Checkpoint';
    setTimeout(() => {
      const input = document.querySelector('.version-label-input') as HTMLInputElement;
      if (input) {
        input.focus();
        input.select();
      }
    }, 50);
  }

  async saveLabel(version: PadVersion) {
    if (this.editingLabelId !== version.id) return;
    try {
      const trimmed = this.editingLabelText.trim();
      const label = trimmed.length > 0 ? trimmed : 'Checkpoint';
      await this.tauri.updateVersionLabel(version.id, label);
      version.label = label;
      this.editingLabelId = null;
    } catch (err) {
      console.error('Failed to update label:', err);
    }
  }

  async removeCheckpoint(version: PadVersion, event: MouseEvent) {
    event.stopPropagation();
    try {
      await this.tauri.updateVersionLabel(version.id, null);
      version.label = null;
      if (this.editingLabelId === version.id) {
        this.editingLabelId = null;
      }
    } catch (err) {
      console.error('Failed to remove checkpoint:', err);
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
      } catch (e) { }
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

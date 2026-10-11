<div align="center">
  <img src="./src-tauri/icons/bilet-icon.png" width="128" height="128" alt="bilet icon">
  <h1>bilet</h1>
  <p><strong>A clean, distraction-free desktop notepad and code scratchpad.</strong></p>
</div>

---

## Overview

Bilet is a minimalist desktop editor designed for focused writing and coding. Built with a zero-distraction philosophy, it provides a quiet workspace with instant startup, pure monochromatic aesthetics, and keyboard-centric navigation.

All notes and history remain strictly on your local machine. There are no cloud accounts, no third-party telemetry, and no external network calls.

---

## Key Highlights

### Focused Writing and Code Editing
- Monochromatic interface designed for high focus in both light and dark themes.
- Bundled offline developer typefaces: Cascadia Code, Fira Code, and JetBrains Mono.
- Support for uploading custom font files (.ttf and .otf) directly from disk.
- Fixed-width tabular line numbers that never cause horizontal editor jitter.
- High-contrast text selection with clear word match highlights.
- Line manipulation shortcuts for moving and duplicating lines without a mouse.
- Instant Find and Replace with match counts, case sensitivity, and whole-word matching.

### Multi-Tab Workspace
- Multi-tab management for switching between active drafts.
- Unsaved change indicator on tabs to track pending edits.
- All Workspace Notes drawer (Ctrl + O) to quickly search and switch between active documents.
- Fast tab cycling and keyboard shortcuts to open, save, or close notes.

### Version History and Milestones
- Automatic background snapshots recorded continuously as you write.
- Named milestone checkpoints for tagging major revisions.
- Visual line-by-line diff comparison to review exact additions and removals.
- One-click version restoration to roll back to any past state.
- Floating overlay drawer that opens without resizing or shifting the editor.

### Safety and History Archival
- Closed tabs are safely archived in History instead of being permanently erased.
- Clean search and chronological list for archived notes.
- One-click note restoration back to active tabs.
- Option to permanently delete or clear history at any time.

### Fully Offline and Private
- Local-first architecture: all data is stored on your machine.
- Zero network dependencies, tracking, analytics, or third-party sync services.
- Bulk export feature to back up all workspace notes to your local filesystem.

---

## Keyboard Shortcuts

Bilet is designed for keyboard-driven navigation. Every shortcut can be customized via the Help and Shortcuts modal (`Ctrl + H`).

### Global and Navigation
| Shortcut | Action |
|:---|:---|
| `Ctrl + O` | Open All Workspace Notes |
| `Ctrl + F` | Toggle Find and Replace |
| `Ctrl + Shift + B` | Open History and Archive |
| `Ctrl + H` | Open Help and Keyboard Shortcuts |
| `Alt + Shift + P` | Toggle Always on Top (Sticky Window) |
| `Esc` | Close Active Modal or Drawer |

### Editor and Tabs
| Shortcut | Action |
|:---|:---|
| `Ctrl + N` | Create New Note Tab |
| `Ctrl + S` | Save Current Note to Disk |
| `Ctrl + Space` | Cycle to Next Open Tab |
| `Ctrl + Shift + D` | Close Current Tab |
| `Ctrl + T` | Toggle Version History Drawer |
| `Alt + ↑ / ↓` | Move Current Line Up or Down |
| `Alt + Shift + ↑ / ↓` | Duplicate Current Line Up or Down |
| `Ctrl + B` | Format Selection Bold |
| `Ctrl + I` | Format Selection Italic |
| `Ctrl + U` | Format Selection Underline |

### Timeline and Modal Navigation
| Shortcut | Action |
|:---|:---|
| `↑ / ↓` | Navigate Lists (Fonts, History, Versions) |
| `Enter` | Confirm Selection |
| `D` | Toggle Line Diff (in Version History) |
| `R` | Restore Selected Version (in Version History) |
| `Ctrl + R` | Restore Archived Note (in History) |
| `Ctrl + Shift + C` | Clear All History (in History) |
| `Tab` | Switch Tabs (in Help Modal) |

---

## Configuration and Preferences

Access the Settings drawer by clicking the gear icon in the top header:
- **Theme**: Toggle between Dark Mode and Light Mode.
- **Typography**: Select between bundled monospace typefaces or your custom uploaded fonts.
- **Font Sizing**: Adjust editor text size from 11px to 22px with live preview.
- **Editor Behavior**: Toggle Word Wrap, the bottom Status Bar (word, character, and line metrics), and Always on Top mode.
- **Storage**: Export all workspace notes locally or purge historical version checkpoints.

---

## Author

**Habrmnc** — [habrhmnc.dev](https://habrhmnc.dev)

---

## License

This project is private and proprietary.

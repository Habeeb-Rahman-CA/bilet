<div align="center">
  <img src="./src-tauri/icons/bilet-icon.png" width="128" height="128" alt="bilet icon">
  <h1>bilet</h1>
  <p><strong>A secure, privacy-first desktop productivity suite for managing thoughts and tasks.</strong></p>
</div>

---

## 🔒 Privacy at its Core
**bilet** is designed with a "zero-trust" philosophy. Your data belongs to you, and it never leaves your machine.

- **End-to-End Encryption**: Every note and pad is encrypted at rest using **AES-256-GCM**.
- **Secure Vault**: Access is guarded by a master password verified with **Argon2id** (the industry standard for password hashing).
- **Inactivity Protection**: The app automatically locks itself after periods of inactivity, ensuring your data remains private even if you step away.
- **Local-Only**: No cloud, no tracking, no telemetry. Just a local SQLite database that stays on your disk.

---

## ✨ Features

### 📝 Tasks (Quick Notes)
- **Pin & Organize**: Keep urgent tasks at the top with pinning.
- **Rich Formatting**: Inline support for bold, italic, and underline using standard shortcuts.
- **Instant Search**: Find any task instantly with a powerful local search (`Ctrl + F`).
- **Safety Net**: Deleted tasks go to the **Bin**, allowing for easy recovery.

### 📄 Rich Notepad (Tabbed Editor)
- **Browser-Style Tabs**: Manage multiple documents simultaneously with a sleek tab bar.
- **Code-Ready Navigation**: Line numbers, bookmarking, and IDE-like line manipulation (`Alt + Up/Down`).
- **Auto-Save & Persistence**: Never lose a word. The app restores your open tabs and cursor position on relaunch.
- **Sync to Disk**: Optionally save any tab directly to a local file for external usage.

### 🎨 Premium Aesthetics
- **Apple-Inspired Design**: A high-fidelity UI featuring **Glassmorphism**, noise textures, and smooth blur effects.
- **Minimalist UX**: A clean black-and-white palette that minimizes distractions.
- **Custom Typography**: Support for **Cascadia Code**, **Fira Code**, **JetBrains Mono**, and even your own custom `.ttf`/`.otf` font uploads.
- **Native Performance**: Frameless window with Mac-style controls and zero FOUC (Flash of Unstyled Content).

### ⚡ Productivity Workflow
- **Global Summon**: Bring the app to focus from anywhere with `Ctrl + Shift + N`.
- **Keyboard First**: Designed to be fully usable without touching the mouse.
- **System Integration**: Runs in the tray for quick access and supports auto-start.

---

## ⌨️ Keyboard Shortcuts

### Navigation & Global
| Shortcut | Action |
|:---:|---|
| `Ctrl + Shift + Space` | Toggle between Tasks and Notepad |
| `Ctrl + Shift + N` | Summon/Hide App (Global) |
| `Ctrl + F` | Global Search |
| `Ctrl + Shift + B` | Open History / Bin |
| `Ctrl + H` | Help & Documentation |
| `Esc` | Close Modals / Exit Context |

### Notepad Editor
| Shortcut | Action |
|:---:|---|
| `Ctrl + N` | Create New Tab |
| `Ctrl + S` | Save Current Pad to File |
| `Ctrl + Space` | Cycle through Open Tabs |
| `Ctrl + Shift + D` | Delete Current Tab |
| `Alt + ↑ / ↓` | Move Current Line Up/Down |
| `Alt + Shift + ↑ / ↓` | Duplicate Current Line |

---

## 👤 Author

**Habrmnc** — [habrhmnc.dev](https://habrhmnc.dev)
*Crafted with precision for private productivity.*

---

## 📄 License

This project is private and proprietary.

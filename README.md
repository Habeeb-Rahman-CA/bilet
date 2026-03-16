# bilet

A secure, privacy-first desktop productivity app for managing quick tasks and rich notepads — built with **Angular 17**, **Tauri 2**, and **Rust**.

All your data is encrypted at rest using **AES-256-GCM**, behind a master password verified with **Argon2id**. Nothing leaves your machine.

---

## ✨ Features

### 🔐 Vault Security
- **Master password** setup with Argon2id hashing and verification
- **AES-256-GCM** encryption for all stored notes and pads
- **Auto-lock** after 10 minutes of inactivity
- **Lock on demand** via the titlebar lock button

### 📝 Tasks (Quick Notes)
- Create, edit, and delete short task-style notes
- **Rich Text Formatting** (Bold, Italic, Underline) via shortcuts
- **Pin** important notes to keep them at the top
- Inline editing with auto-save
- **Search** across all tasks with `Ctrl + F`
- Soft delete with **History / Trash** for recovery

### 📄 Notepad (Tabbed Editor)
- Multi-tab notepad with a browser-style tab bar
- **Line numbers** with clickable line bookmarks/markers
- **Auto-save** with debounced writes to the database
- **Save to local file** via native file dialog (`Ctrl + S`)
- **Rich Text Formatting** inline capabilities built-in
- **Built-in Spell Checker** with browser native support (Toggle via header button)
- Code-editor-style shortcuts:
  - `Alt + ↑/↓` to move lines
  - `Alt + Shift + ↑/↓` to duplicate lines
- Tab cycling with `Ctrl + Space`
- Close tab confirmation with save/delete/cancel options
- Session persistence — open tabs and active tab restored on relaunch

### 🎨 Customization
- **Minimalist Splash Screen** — Clean, aesthetic loading screen with zero FOUC (Flash of Unstyled Content)
- **Dark & Light Mode** toggle instantly, cached securely for seamless reloads
- **Built-in fonts**: Cascadia Code, Fira Code, JetBrains Mono
- **Custom Font Uploads**: Add your own `.ttf` or `.otf` fonts and delete them as needed
- Advanced caching instantly applies themes and custom fonts before the app even renders
- Clean, minimalist black-and-white design with Mac-style window controls

### ⚡ Productivity
- **Global shortcut** `Ctrl + Shift + N` to summon the app from anywhere
- **Launch at startup** toggle (via Tauri autostart plugin)
- **System tray** with quick Show/Quit actions
- Full **keyboard-driven** workflow — every action has a shortcut

### 🗑️ History / Trash
- Unified trash bin for both tasks and pads
- Restore or permanently delete individual items
- Bulk clear all history with `Ctrl + Shift + C`
- Keyboard navigation within the trash bin

### 🔄 Auto Updater
- Built-in update checking via `@tauri-apps/plugin-updater`
- Signed updates with minisign public key verification

---

## ⌨️ Keyboard Shortcuts

### App Navigation
| Shortcut | Action |
|---|---|
| `Ctrl + Shift + Space` | Switch between Tasks and Notepad |
| `Ctrl + F` | Search |
| `Ctrl + Shift + B` | History / Bin |
| `Ctrl + H` | Help |
| `Esc` | Close modal |

### Notepad & Global Formatting
| Shortcut | Action |
|---|---|
| `Ctrl + N` | New tab |
| `Ctrl + S` | Save to file |
| `Ctrl + Space` | Cycle tabs |
| `Ctrl + Shift + D` | Delete current tab |
| `Ctrl + B` | Bold |
| `Ctrl + I` | Italic |
| `Ctrl + U` | Underline |
| `Alt + Shift + ↑/↓` | Duplicate line |
| `Alt + ↑/↓` | Move line |

### Tasks
| Shortcut | Action |
|---|---|
| `Ctrl + A` | Focus input |
| `Ctrl + L` | Focus list |
| `↑ / ↓` | Navigate |
| `Enter` | Select / Confirm |
| `Ctrl + E` | Edit |
| `Ctrl + S` | Save |
| `Ctrl + D` | Delete |
| `Ctrl + P` | Pin / Unpin |
| `Ctrl + R` | Restore item |
| `Ctrl + Shift + C` | Clear all history |

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | Angular 17 (standalone components) |
| **Backend** | Rust (Tauri 2) |
| **Database** | SQLite via `rusqlite` (bundled) |
| **Encryption** | AES-256-GCM (`aes-gcm`) + Argon2id (`argon2`) |
| **Styling** | Vanilla CSS with CSS variables |
| **Fonts** | Google Fonts + Fontsource |
| **Plugins** | Autostart, Dialog, File System, Global Shortcut, Updater |

---

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v18+)
- [Rust](https://www.rust-lang.org/tools/install) (latest stable)
- [Tauri CLI](https://v2.tauri.app/start/prerequisites/)

### Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run tauri dev
```

### Build

```bash
# Build for production
npm run tauri build
```

The installer will be generated at:
```
src-tauri/target/release/bundle/nsis/bilet_<version>_x64-setup.exe
```

---

## 📁 Project Structure

```
first-tauri-app/
├── src/                        # Angular frontend
│   └── app/
│       ├── app.component.ts    # Main application logic
│       ├── app.component.html  # UI template
│       └── app.component.css   # Styles and design system
├── src-tauri/                  # Rust backend
│   ├── src/
│   │   └── main.rs             # Tauri commands, encryption, DB logic
│   ├── icons/                  # App icons (all platforms)
│   ├── tauri.conf.json         # Tauri configuration
│   └── Cargo.toml              # Rust dependencies
└── package.json
```

---

## 👤 Author

**Habrmnc** — [habrhmnc.dev](https://habrhmnc.dev)

---

## 📄 License

This project is private.

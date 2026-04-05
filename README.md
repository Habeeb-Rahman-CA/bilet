<div align="center">
  <img src="./src-tauri/icons/bilet-icon.png" width="128" height="128" alt="bilet icon">
  <h1>bilet</h1>
  <p><strong>A secure, privacy-focused desktop productivity suite for managing thoughts and tasks.</strong></p>
</div>

---

## Privacy at its Core
**bilet** is developed with a zero-trust philosophy. All data is processed locally, ensuring user information remains private and secure.

- **End-to-End Encryption**: All notes and documents are encrypted at rest using AES-256-GCM.
- **Secure Vault**: Access is protected by a master password, verified using the Argon2id password hashing standard.
- **Inactivity Protection**: The application includes an automatic locking mechanism to secure data during periods of inactivity.
- **Local Storage**: Data is stored in a local SQLite database. There is no cloud synchronization, tracking, or telemetry.

---

## Features

### Tasks and Quick Notes
- **Organization**: Pin urgent tasks for immediate visibility and organized management.
- **Rich Formatting**: Support for standard formatting shortcuts including bold, italic, and underline.
- **Instant Search**: Efficient local search functionality accessible via `Ctrl + F`.
- **Data Recovery**: A dedicated Bin for deleted tasks allows for secure recovery.

### Rich Notepad
- **Tabbed Management**: A multi-document interface with a streamlined tab bar for efficient document handling.
- **Advanced Navigation**: Features include line numbering, bookmarking, and IDE-style line manipulation.
- **Persistence**: Automatic saving ensures document state, including tab positions and cursor location, is restored upon relaunch.
- **Export Options**: Support for saving individual tabs directly to the local filesystem.

### Design and Aesthetics
- **Professional UI**: A high-fidelity interface featuring minimalist design elements and smooth visual transitions.
- **Enhanced Readability**: A clean, high-contrast palette designed to minimize distractions and improve focus.
- **Custom Typography**: Support for industry-standard monospaced fonts and custom font uploads.
- **Optimized Performance**: Built for native performance with a seamless, frameless window architecture.

### Productivity Workflow
- **Global Access**: Quickly toggle application visibility from any context using a global shortcut.
- **Keyboard-Centric Design**: Optimized for full functionality through keyboard interaction.
- **System Integration**: Tray integration and optional auto-start support for streamlined access.

---

## Keyboard Shortcuts

### Navigation and Global
| Shortcut | Action |
|:---:|---|
| `Ctrl + Shift + Space` | Toggle between Tasks and Notepad |
| `Ctrl + Shift + N` | Toggle Application Visibility (Global) |
| `Ctrl + F` | Global Search |
| `Ctrl + Shift + B` | Open History / Bin |
| `Ctrl + H` | Help & Documentation |
| `Esc` | Close Modals / Exit Context |

### Notepad Editor
| Shortcut | Action |
|:---:|---|
| `Ctrl + N` | Create New Tab |
| `Ctrl + S` | Save Current Content to File |
| `Ctrl + Space` | Cycle through Open Tabs |
| `Ctrl + Shift + D` | Delete Current Tab |
| `Alt + ↑ / ↓` | Move Current Line Up or Down |
| `Alt + Shift + ↑ / ↓` | Duplicate Current Line |

---

## Author

**Habrmnc** — [habrhmnc.dev](https://habrhmnc.dev)
*Precision-crafted tools for private productivity.*

---

## License

This project is private and proprietary.

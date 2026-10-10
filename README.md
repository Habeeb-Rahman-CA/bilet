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

### Rich Notepad & Document Management
- **Tabbed Workspace**: Multi-document interface with a streamlined tab bar and Document Drawer (`Ctrl + O`) for opening closed pads.
- **Line Editing**: Advanced editor functionality including line numbering, caret tracking, and IDE-style line move/duplication (`Alt + ↑/↓`, `Alt + Shift + ↑/↓`).
- **Rich Text & Code Formatting**: Support for bold, italic, underline annotations alongside uncorrupted code snippet editing (`<T>`, `a < b`).
- **Instant Find & Replace**: Full-text find and replace within active notes (`Ctrl + F`).
- **Version History & Checkpoints**: Automatic background snapshots and manual checkpoints with line-by-line diff viewing and one-click restoration.
- **Trash Bin**: Safe note deletion to Trash Bin with full recovery capability (`Ctrl + Shift + B`).

### Security & Privacy
- **End-to-End Encryption**: All notes and version snapshots are encrypted at rest using AES-256-GCM.
- **Zero-Trust Master Vault**: Access protected by Master Password hashed with Argon2id and per-installation random salt.
- **In-Memory Zeroization**: Cryptographic keys and passphrases are zeroized in RAM immediately upon locking or dropping locks.
- **Idle Auto-Lock**: Configurable automatic inactivity locking with pre-lock in-flight edit persistence.
- **100% Local Privacy**: Stored in a local encrypted SQLite database with zero external CDN dependencies or cloud telemetry.

---

## Keyboard Shortcuts

### Application & Navigation
| Shortcut | Action |
|:---:|---|
| `Ctrl + Shift + N` | Toggle Application Visibility (Global) |
| `Ctrl + O` | Open Document Drawer |
| `Ctrl + F` | Find & Replace |
| `Ctrl + Shift + B` | Open Trash Bin |
| `Esc` | Close Modals / Exit Context |

### Notepad Editor
| Shortcut | Action |
|:---:|---|
| `Ctrl + N` | Create New Tab |
| `Ctrl + S` | Save Current Content |
| `Ctrl + Space` | Cycle through Open Tabs |
| `Ctrl + Shift + D` | Close Current Tab |
| `Alt + ↑ / ↓` | Move Current Line Up or Down |
| `Alt + Shift + ↑ / ↓` | Duplicate Current Line |

---

## Author

**Habrmnc** — [habrhmnc.dev](https://habrhmnc.dev)
*Precision-crafted tools for private productivity.*

---

## License

This project is private and proprietary.

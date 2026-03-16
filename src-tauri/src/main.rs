#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use rand::RngCore;
use rand_core::OsRng;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::fs;
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Manager, State};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};

#[derive(Serialize, Deserialize)]
struct Note {
    id: i64,
    content: String,
    timestamp: String,
    is_pinned: bool,
    is_deleted: bool,
}

#[derive(Serialize, Deserialize)]
struct Pad {
    id: i64,
    title: String,
    content: String,
    created_at: String,
    updated_at: String,
    is_deleted: bool,
    is_open: bool,
    is_active: bool,
    tab_index: i32,
}

#[derive(Serialize, Deserialize)]
struct Session {
    active_tab_id: Option<i64>,
    open_tabs: String, // JSON string of OpenTab objects
}

// Internal structure to handle DB + Key
struct DbState(Mutex<Option<(Connection, [u8; 32])>>);

#[derive(Serialize, Deserialize)]
enum AuthStatus {
    SetupRequired,
    Locked,
    Unlocked,
}

#[tauri::command]
async fn check_auth_status(
    app_handle: tauri::AppHandle,
    state: State<'_, DbState>,
) -> Result<AuthStatus, String> {
    let app_dir = app_handle.path().app_data_dir().unwrap();
    let master_path = app_dir.join("vault_master.txt");
    let persistent_path = app_dir.join("vault_persistent.txt");

    // Check if already unlocked in state
    {
        let db_lock = state.0.lock().unwrap();
        if db_lock.is_some() {
            return Ok(AuthStatus::Unlocked);
        }
    }

    if !master_path.exists() {
        Ok(AuthStatus::SetupRequired)
    } else {
        // Try auto-unlock if persistent password exists
        if persistent_path.exists() {
            if let Ok(password) = fs::read_to_string(&persistent_path) {
                if unlock_db_internal(password, state, app_handle).await.is_ok() {
                    return Ok(AuthStatus::Unlocked);
                }
            }
        }
        Ok(AuthStatus::Locked)
    }
}

fn derive_key(password: &str, salt_str: &str) -> Result<[u8; 32], String> {
    let mut key = [0u8; 32];
    let argon2 = Argon2::default();
    argon2
        .hash_password_into(password.as_bytes(), salt_str.as_bytes(), &mut key)
        .map_err(|e| format!("Key derivation failed: {}", e))?;
    Ok(key)
}

async fn unlock_db_internal(
    password: String,
    state: State<'_, DbState>,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    let app_dir = app_handle.path().app_data_dir().unwrap();
    fs::create_dir_all(&app_dir).map_err(|e| e.to_string())?;

    let master_path = app_dir.join("vault_master.txt");
    let db_path = app_dir.join("notes_encrypted.db");

    let argon2 = Argon2::default();

    // Verify or setup master password
    if !master_path.exists() {
        let salt = SaltString::generate(&mut OsRng);
        let password_hash = argon2
            .hash_password(password.as_bytes(), &salt)
            .map_err(|e| e.to_string())?
            .to_string();
        fs::write(&master_path, password_hash).map_err(|e| e.to_string())?;
    } else {
        let stored_hash = fs::read_to_string(&master_path).map_err(|e| e.to_string())?;
        let parsed_hash = PasswordHash::new(&stored_hash).map_err(|e| e.to_string())?;
        argon2
            .verify_password(password.as_bytes(), &parsed_hash)
            .map_err(|_| "Incorrect password".to_string())?;
    }

    // Derive the actual AES key from the password
    let key = derive_key(&password, "fixed-derivation-salt-123")?;

    // Open DB and ensure table exists
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS secure_notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nonce BLOB NOT NULL,
            ciphertext BLOB NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            is_pinned BOOLEAN DEFAULT 0,
            is_deleted BOOLEAN DEFAULT 0
        )",
        [],
    )
    .map_err(|e| e.to_string())?;

    // Create secure_pads table for notepad feature
    conn.execute(
        "CREATE TABLE IF NOT EXISTS secure_pads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title_nonce BLOB NOT NULL,
            title_ciphertext BLOB NOT NULL,
            content_nonce BLOB NOT NULL,
            content_ciphertext BLOB NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            is_deleted BOOLEAN DEFAULT 0,
            is_open BOOLEAN DEFAULT 0,
            is_active BOOLEAN DEFAULT 0,
            tab_index INTEGER DEFAULT 0
        )",
        [],
    )
    .map_err(|e| e.to_string())?;

    // Drop secure_session table if it exists
    let _ = conn.execute("DROP TABLE IF EXISTS secure_session", []);

    // Migration logic
    {
        let mut has_is_pinned = false;
        let mut has_created_at = false;
        let mut has_is_deleted = false;
        {
            let mut stmt = conn
                .prepare("PRAGMA table_info(secure_notes)")
                .map_err(|e| e.to_string())?;
            let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
            while let Some(row) = rows.next().map_err(|e| e.to_string())? {
                let name: String = row.get(1).map_err(|e| e.to_string())?;
                if name == "is_pinned" {
                    has_is_pinned = true;
                }
                if name == "created_at" {
                    has_created_at = true;
                }
                if name == "is_deleted" {
                    has_is_deleted = true;
                }
            }
        }
        if !has_created_at {
            let _ = conn.execute("ALTER TABLE secure_notes ADD COLUMN created_at DATETIME", []);
            let _ = conn.execute("UPDATE secure_notes SET created_at = CURRENT_TIMESTAMP WHERE created_at IS NULL", []);
        }
        if !has_is_pinned {
            let _ = conn.execute("ALTER TABLE secure_notes ADD COLUMN is_pinned BOOLEAN DEFAULT 0", []);
        }
        if !has_is_deleted {
            let _ = conn.execute("ALTER TABLE secure_notes ADD COLUMN is_deleted BOOLEAN DEFAULT 0", []);
        }

        let mut has_is_open = false;
        let mut has_is_active = false;
        let mut has_tab_index = false;
        {
            let mut stmt = conn
                .prepare("PRAGMA table_info(secure_pads)")
                .map_err(|e| e.to_string())?;
            let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
            while let Some(row) = rows.next().map_err(|e| e.to_string())? {
                let name: String = row.get(1).map_err(|e| e.to_string())?;
                if name == "is_open" {
                    has_is_open = true;
                }
                if name == "is_active" {
                    has_is_active = true;
                }
                if name == "tab_index" {
                    has_tab_index = true;
                }
            }
        }
        if !has_is_open {
            let _ = conn.execute("ALTER TABLE secure_pads ADD COLUMN is_open BOOLEAN DEFAULT 0", []);
        }
        if !has_is_active {
            let _ = conn.execute("ALTER TABLE secure_pads ADD COLUMN is_active BOOLEAN DEFAULT 0", []);
        }
        if !has_tab_index {
            let _ = conn.execute("ALTER TABLE secure_pads ADD COLUMN tab_index INTEGER DEFAULT 0", []);
        }
    }

    let mut db_lock = state.0.lock().unwrap();
    *db_lock = Some((conn, key));

    Ok("Unlocked".to_string())
}

#[tauri::command]
async fn unlock_db(
    password: String,
    state: State<'_, DbState>,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    let res = unlock_db_internal(password.clone(), state, app_handle.clone()).await?;

    // On successful manual unlock, save it for future auto-unlock
    let app_dir = app_handle.path().app_data_dir().unwrap();
    let persistent_path = app_dir.join("vault_persistent.txt");
    let _ = fs::write(persistent_path, password);

    Ok(res)
}

#[tauri::command]
fn get_notes(state: State<'_, DbState>) -> Result<Vec<Note>, String> {
    let db_lock = state.0.lock().unwrap();
    let (conn, key) = db_lock.as_ref().ok_or("Vault is locked")?;

    let cipher = Aes256Gcm::new(key.into());

    let mut stmt = conn
        .prepare(
            "SELECT id, nonce, ciphertext, created_at, is_pinned, is_deleted FROM secure_notes WHERE is_deleted = 0 ORDER BY is_pinned DESC, created_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let note_iter = stmt
        .query_map(params![], |row| {
            let id: i64 = row.get(0)?;
            let nonce_bytes: Vec<u8> = row.get(1)?;
            let ciphertext: Vec<u8> = row.get(2)?;
            let timestamp: String = row.get(3).unwrap_or_default();
            let is_pinned: bool = row.get(4).unwrap_or(false);
            let is_deleted: bool = row.get(5).unwrap_or(false);

            let nonce = Nonce::from_slice(&nonce_bytes);
            let decrypted = cipher
                .decrypt(nonce, ciphertext.as_ref())
                .map_err(|_| rusqlite::Error::InvalidQuery)?;

            let content =
                String::from_utf8(decrypted).map_err(|_| rusqlite::Error::InvalidQuery)?;

            Ok(Note {
                id,
                content,
                timestamp,
                is_pinned,
                is_deleted,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut notes = Vec::new();
    for note in note_iter {
        notes.push(note.map_err(|e| format!("Decryption error: {}", e))?);
    }
    Ok(notes)
}

#[tauri::command]
fn get_bin_notes(state: State<'_, DbState>) -> Result<Vec<Note>, String> {
    let db_lock = state.0.lock().unwrap();
    let (conn, key) = db_lock.as_ref().ok_or("Vault is locked")?;

    let cipher = Aes256Gcm::new(key.into());

    let mut stmt = conn
        .prepare("SELECT id, nonce, ciphertext, created_at, is_pinned, is_deleted FROM secure_notes WHERE is_deleted = 1 ORDER BY created_at DESC")
        .map_err(|e| e.to_string())?;

    let note_iter = stmt
        .query_map(params![], |row| {
            let id: i64 = row.get(0)?;
            let nonce_bytes: Vec<u8> = row.get(1)?;
            let ciphertext: Vec<u8> = row.get(2)?;
            let timestamp: String = row.get(3).unwrap_or_default();
            let is_pinned: bool = row.get(4).unwrap_or(false);
            let is_deleted: bool = row.get(5).unwrap_or(false);

            let nonce = Nonce::from_slice(&nonce_bytes);
            let decrypted = cipher
                .decrypt(nonce, ciphertext.as_ref())
                .map_err(|_| rusqlite::Error::InvalidQuery)?;
            let content =
                String::from_utf8(decrypted).map_err(|_| rusqlite::Error::InvalidQuery)?;

            Ok(Note {
                id,
                content,
                timestamp,
                is_pinned,
                is_deleted,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut notes = Vec::new();
    for note in note_iter {
        notes.push(note.map_err(|e| e.to_string())?);
    }
    Ok(notes)
}

#[tauri::command]
fn add_note(content: String, state: State<'_, DbState>) -> Result<String, String> {
    let db_lock = state.0.lock().unwrap();
    let (conn, key) = db_lock.as_ref().ok_or("Vault is locked")?;

    let cipher = Aes256Gcm::new(key.into());
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, content.as_bytes())
        .map_err(|e| format!("Encryption failed: {}", e))?;

    conn.execute(
        "INSERT INTO secure_notes (nonce, ciphertext, created_at) VALUES (?1, ?2, CURRENT_TIMESTAMP)",
        params![nonce_bytes.to_vec(), ciphertext],
    )
    .map_err(|e| e.to_string())?;

    Ok("Added".to_string())
}

#[tauri::command]
fn update_note(id: i64, content: String, state: State<'_, DbState>) -> Result<String, String> {
    let db_lock = state.0.lock().unwrap();
    let (conn, key) = db_lock.as_ref().ok_or("Vault is locked")?;

    let cipher = Aes256Gcm::new(key.into());
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, content.as_bytes())
        .map_err(|e| format!("Encryption failed: {}", e))?;

    conn.execute(
        "UPDATE secure_notes SET nonce = ?1, ciphertext = ?2 WHERE id = ?3",
        params![nonce_bytes.to_vec(), ciphertext, id],
    )
    .map_err(|e| e.to_string())?;

    Ok("Updated".to_string())
}

#[tauri::command]
fn delete_note(id: i64, state: State<'_, DbState>) -> Result<String, String> {
    let db_lock = state.0.lock().unwrap();
    let (conn, _) = db_lock.as_ref().ok_or("Vault is locked")?;

    conn.execute(
        "UPDATE secure_notes SET is_deleted = 1 WHERE id = ?1",
        params![id],
    )
    .map_err(|e| e.to_string())?;
    Ok("Deleted to Bin".to_string())
}

#[tauri::command]
fn restore_note(id: i64, state: State<'_, DbState>) -> Result<String, String> {
    let db_lock = state.0.lock().unwrap();
    let (conn, _) = db_lock.as_ref().ok_or("Vault is locked")?;

    conn.execute(
        "UPDATE secure_notes SET is_deleted = 0 WHERE id = ?1",
        params![id],
    )
    .map_err(|e| e.to_string())?;
    Ok("Restored".to_string())
}

#[tauri::command]
fn permanent_delete_note(id: i64, state: State<'_, DbState>) -> Result<String, String> {
    let db_lock = state.0.lock().unwrap();
    let (conn, _) = db_lock.as_ref().ok_or("Vault is locked")?;

    conn.execute("DELETE FROM secure_notes WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok("Permanently Deleted".to_string())
}

#[tauri::command]
fn clear_bin(state: State<'_, DbState>) -> Result<String, String> {
    let db_lock = state.0.lock().unwrap();
    let (conn, _) = db_lock.as_ref().ok_or("Vault is locked")?;

    conn.execute("DELETE FROM secure_notes WHERE is_deleted = 1", [])
        .map_err(|e| e.to_string())?;
    Ok("Bin Cleared".to_string())
}

#[tauri::command]
fn toggle_pin(id: i64, state: State<'_, DbState>) -> Result<String, String> {
    let db_lock = state.0.lock().unwrap();
    let (conn, _) = db_lock.as_ref().ok_or("Vault is locked")?;

    conn.execute(
        "UPDATE secure_notes SET is_pinned = NOT is_pinned WHERE id = ?1",
        params![id],
    )
    .map_err(|e| e.to_string())?;

    Ok("Toggled".to_string())
}

// ===== Notepad Commands =====

#[tauri::command]
fn get_pads(state: State<'_, DbState>) -> Result<Vec<Pad>, String> {
    let db_lock = state.0.lock().unwrap();
    let (conn, key) = db_lock.as_ref().ok_or("Vault is locked")?;
    let cipher = Aes256Gcm::new(key.into());

    let mut stmt = conn
        .prepare("SELECT id, title_nonce, title_ciphertext, content_nonce, content_ciphertext, created_at, updated_at, is_deleted, is_open, is_active, tab_index FROM secure_pads WHERE is_deleted = 0 ORDER BY tab_index ASC")
        .map_err(|e| e.to_string())?;

    let pad_iter = stmt
        .query_map(params![], |row| {
            let id: i64 = row.get(0)?;
            let title_nonce_bytes: Vec<u8> = row.get(1)?;
            let title_ciphertext: Vec<u8> = row.get(2)?;
            let content_nonce_bytes: Vec<u8> = row.get(3)?;
            let content_ciphertext: Vec<u8> = row.get(4)?;
            let created_at: String = row.get(5).unwrap_or_default();
            let updated_at: String = row.get(6).unwrap_or_default();
            let is_deleted: bool = row.get(7).unwrap_or(false);
            let is_open: bool = row.get(8).unwrap_or(false);
            let is_active: bool = row.get(9).unwrap_or(false);
            let tab_index: i32 = row.get(10).unwrap_or(0);

            let title_nonce = Nonce::from_slice(&title_nonce_bytes);
            let title_dec = cipher
                .decrypt(title_nonce, title_ciphertext.as_ref())
                .map_err(|_| rusqlite::Error::InvalidQuery)?;
            let title = String::from_utf8(title_dec).map_err(|_| rusqlite::Error::InvalidQuery)?;

            let content_nonce = Nonce::from_slice(&content_nonce_bytes);
            let content_dec = cipher
                .decrypt(content_nonce, content_ciphertext.as_ref())
                .map_err(|_| rusqlite::Error::InvalidQuery)?;
            let content =
                String::from_utf8(content_dec).map_err(|_| rusqlite::Error::InvalidQuery)?;

            Ok(Pad {
                id,
                title,
                content,
                created_at,
                updated_at,
                is_deleted,
                is_open,
                is_active,
                tab_index,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut pads = Vec::new();
    for pad in pad_iter {
        pads.push(pad.map_err(|e| format!("Decryption error: {}", e))?);
    }
    Ok(pads)
}

#[tauri::command]
fn add_pad(title: String, content: String, state: State<'_, DbState>) -> Result<i64, String> {
    let db_lock = state.0.lock().unwrap();
    let (conn, key) = db_lock.as_ref().ok_or("Vault is locked")?;
    let cipher = Aes256Gcm::new(key.into());

    let mut tn = [0u8; 12];
    OsRng.fill_bytes(&mut tn);
    let title_ct = cipher
        .encrypt(Nonce::from_slice(&tn), title.as_bytes())
        .map_err(|e| format!("Encryption failed: {}", e))?;

    let mut cn = [0u8; 12];
    OsRng.fill_bytes(&mut cn);
    let content_ct = cipher
        .encrypt(Nonce::from_slice(&cn), content.as_bytes())
        .map_err(|e| format!("Encryption failed: {}", e))?;

    // Unset other active pads
    let _ = conn.execute("UPDATE secure_pads SET is_active = 0", []);

    conn.execute(
        "INSERT INTO secure_pads (title_nonce, title_ciphertext, content_nonce, content_ciphertext, created_at, updated_at, is_open, is_active, tab_index) VALUES (?1, ?2, ?3, ?4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1, 1, (SELECT COALESCE(MAX(tab_index), 0) + 1 FROM secure_pads))",
        params![tn.to_vec(), title_ct, cn.to_vec(), content_ct],
    ).map_err(|e| e.to_string())?;

    let id = conn.last_insert_rowid();
    Ok(id)
}

#[tauri::command]
fn update_pad(
    id: i64,
    title: String,
    content: String,
    state: State<'_, DbState>,
) -> Result<String, String> {
    let db_lock = state.0.lock().unwrap();
    let (conn, key) = db_lock.as_ref().ok_or("Vault is locked")?;
    let cipher = Aes256Gcm::new(key.into());

    let mut tn = [0u8; 12];
    OsRng.fill_bytes(&mut tn);
    let title_ct = cipher
        .encrypt(Nonce::from_slice(&tn), title.as_bytes())
        .map_err(|e| format!("Encryption failed: {}", e))?;

    let mut cn = [0u8; 12];
    OsRng.fill_bytes(&mut cn);
    let content_ct = cipher
        .encrypt(Nonce::from_slice(&cn), content.as_bytes())
        .map_err(|e| format!("Encryption failed: {}", e))?;

    conn.execute(
        "UPDATE secure_pads SET title_nonce = ?1, title_ciphertext = ?2, content_nonce = ?3, content_ciphertext = ?4, updated_at = CURRENT_TIMESTAMP WHERE id = ?5",
        params![tn.to_vec(), title_ct, cn.to_vec(), content_ct, id],
    ).map_err(|e| e.to_string())?;

    Ok("Updated".to_string())
}

#[tauri::command]
fn delete_pad(id: i64, state: State<'_, DbState>) -> Result<String, String> {
    let db_lock = state.0.lock().unwrap();
    let (conn, _) = db_lock.as_ref().ok_or("Vault is locked")?;

    conn.execute(
        "UPDATE secure_pads SET is_deleted = 1 WHERE id = ?1",
        params![id],
    )
    .map_err(|e| e.to_string())?;
    Ok("Deleted".to_string())
}

#[tauri::command]
fn get_bin_pads(state: State<'_, DbState>) -> Result<Vec<Pad>, String> {
    let db_lock = state.0.lock().unwrap();
    let (conn, key) = db_lock.as_ref().ok_or("Vault is locked")?;
    let cipher = Aes256Gcm::new(key.into());

    let mut stmt = conn
        .prepare("SELECT id, title_nonce, title_ciphertext, content_nonce, content_ciphertext, created_at, updated_at, is_deleted, is_open, is_active, tab_index FROM secure_pads WHERE is_deleted = 1 ORDER BY updated_at DESC")
        .map_err(|e| e.to_string())?;

    let pad_iter = stmt
        .query_map(params![], |row| {
            let id: i64 = row.get(0)?;
            let title_nonce_bytes: Vec<u8> = row.get(1)?;
            let title_ciphertext: Vec<u8> = row.get(2)?;
            let content_nonce_bytes: Vec<u8> = row.get(3)?;
            let content_ciphertext: Vec<u8> = row.get(4)?;
            let created_at: String = row.get(5).unwrap_or_default();
            let updated_at: String = row.get(6).unwrap_or_default();
            let is_deleted: bool = row.get(7).unwrap_or(false);
            let is_open: bool = row.get(8).unwrap_or(false);
            let is_active: bool = row.get(9).unwrap_or(false);
            let tab_index: i32 = row.get(10).unwrap_or(0);

            let title_nonce = Nonce::from_slice(&title_nonce_bytes);
            let title_dec = cipher
                .decrypt(title_nonce, title_ciphertext.as_ref())
                .map_err(|_| rusqlite::Error::InvalidQuery)?;
            let title = String::from_utf8(title_dec).map_err(|_| rusqlite::Error::InvalidQuery)?;

            let content_nonce = Nonce::from_slice(&content_nonce_bytes);
            let content_dec = cipher
                .decrypt(content_nonce, content_ciphertext.as_ref())
                .map_err(|_| rusqlite::Error::InvalidQuery)?;
            let content =
                String::from_utf8(content_dec).map_err(|_| rusqlite::Error::InvalidQuery)?;

            Ok(Pad {
                id,
                title,
                content,
                created_at,
                updated_at,
                is_deleted,
                is_open,
                is_active,
                tab_index,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut pads = Vec::new();
    for pad in pad_iter {
        pads.push(pad.map_err(|e| format!("Decryption error: {}", e))?);
    }
    Ok(pads)
}

#[tauri::command]
fn restore_pad(id: i64, state: State<'_, DbState>) -> Result<String, String> {
    let db_lock = state.0.lock().unwrap();
    let (conn, _) = db_lock.as_ref().ok_or("Vault is locked")?;

    conn.execute(
        "UPDATE secure_pads SET is_deleted = 0 WHERE id = ?1",
        params![id],
    )
    .map_err(|e| e.to_string())?;
    Ok("Restored".to_string())
}

#[tauri::command]
fn permanent_delete_pad(id: i64, state: State<'_, DbState>) -> Result<String, String> {
    let db_lock = state.0.lock().unwrap();
    let (conn, _) = db_lock.as_ref().ok_or("Vault is locked")?;

    conn.execute("DELETE FROM secure_pads WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok("Deleted Forever".to_string())
}

#[tauri::command]
fn clear_pad_bin(state: State<'_, DbState>) -> Result<String, String> {
    let db_lock = state.0.lock().unwrap();
    let (conn, _) = db_lock.as_ref().ok_or("Vault is locked")?;

    conn.execute("DELETE FROM secure_pads WHERE is_deleted = 1", [])
        .map_err(|e| e.to_string())?;
    Ok("Bin Cleared".to_string())
}

#[tauri::command]
fn toggle_maximize(window: tauri::Window) -> Result<(), String> {
    if window.is_maximized().unwrap_or(false) {
        window.unmaximize().map_err(|e| e.to_string())?;
    } else {
        window.maximize().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn save_file_to_local(path: String, content: String) -> Result<String, String> {
    std::fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok("Saved".to_string())
}

#[tauri::command]
fn lock_vault(state: State<'_, DbState>, app_handle: tauri::AppHandle) -> Result<String, String> {
    let mut db_lock = state.0.lock().unwrap();
    *db_lock = None;

    // Delete persistent password on manual lock
    let app_dir = app_handle.path().app_data_dir().unwrap();
    let persistent_path = app_dir.join("vault_persistent.txt");
    if persistent_path.exists() {
        let _ = fs::remove_file(persistent_path);
    }

    Ok("Locked".to_string())
}

#[tauri::command]
fn update_pad_metadata(
    id: i64,
    is_open: Option<bool>,
    is_active: Option<bool>,
    tab_index: Option<i32>,
    state: State<'_, DbState>,
) -> Result<String, String> {
    let db_lock = state.0.lock().unwrap();
    let (conn, _) = db_lock.as_ref().ok_or("Vault is locked")?;

    if let Some(active) = is_active {
        if active {
            // Unset other active pads
            conn.execute("UPDATE secure_pads SET is_active = 0", [])
                .map_err(|e| e.to_string())?;
        }
    }

    let mut query = String::from("UPDATE secure_pads SET ");
    let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
    let mut updates = Vec::new();

    if let Some(open) = is_open {
        updates.push("is_open = ?");
        params_vec.push(Box::new(open));
    }
    if let Some(active) = is_active {
        updates.push("is_active = ?");
        params_vec.push(Box::new(active));
    }
    if let Some(index) = tab_index {
        updates.push("tab_index = ?");
        params_vec.push(Box::new(index));
    }

    if updates.is_empty() {
        return Ok("No updates".to_string());
    }

    query.push_str(&updates.join(", "));
    query.push_str(" WHERE id = ?");
    params_vec.push(Box::new(id));

    // Convert Vec<Box<dyn ToSql>> to something rusqlite accepts
    let params_refs: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|b| b.as_ref()).collect();

    conn.execute(&query, rusqlite::params_from_iter(params_refs))
        .map_err(|e| e.to_string())?;

    Ok("Metadata Updated".to_string())
}

#[tauri::command]
fn save_session(_session: Session, _state: State<'_, DbState>) -> Result<String, String> {
    // Deprecated - metadata is now in pads table
    Ok("Deprecated".to_string())
}

#[tauri::command]
fn get_session(_state: State<'_, DbState>) -> Result<Option<Session>, String> {
    // Deprecated - metadata is now in pads table
    Ok(None)
}

#[tauri::command]
fn upload_custom_font(app_handle: tauri::AppHandle, name: String, src_path: String) -> Result<String, String> {
    let app_dir = app_handle.path().app_data_dir().unwrap();
    let fonts_dir = app_dir.join("custom_fonts");
    fs::create_dir_all(&fonts_dir).map_err(|e| e.to_string())?;

    let dest_path = fonts_dir.join(format!("{}.ttf", name));
    fs::copy(&src_path, &dest_path).map_err(|e| e.to_string())?;

    Ok(dest_path.to_string_lossy().to_string())
}

#[tauri::command]
fn get_custom_fonts(app_handle: tauri::AppHandle) -> Result<Vec<(String, String)>, String> {
    let app_dir = app_handle.path().app_data_dir().unwrap();
    let fonts_dir = app_dir.join("custom_fonts");
    
    if !fonts_dir.exists() {
        return Ok(vec![]);
    }

    let mut fonts = Vec::new();
    for entry in fs::read_dir(fonts_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()).map(|e| e == "ttf" || e == "otf").unwrap_or(false) {
            let name = path.file_stem().unwrap().to_string_lossy().to_string();
            fonts.push((name, path.to_string_lossy().to_string()));
        }
    }
    Ok(fonts)
}

#[tauri::command]
fn delete_custom_font(app_handle: tauri::AppHandle, name: String) -> Result<String, String> {
    let app_dir = app_handle.path().app_data_dir().unwrap();
    let fonts_dir = app_dir.join("custom_fonts");

    // Try both .ttf and .otf
    let ttf_path = fonts_dir.join(format!("{}.ttf", name));
    let otf_path = fonts_dir.join(format!("{}.otf", name));

    if ttf_path.exists() {
        fs::remove_file(ttf_path).map_err(|e| e.to_string())?;
    }
    if otf_path.exists() {
        fs::remove_file(otf_path).map_err(|e| e.to_string())?;
    }

    Ok("Deleted".to_string())
}

fn main() {
    tauri::Builder::default()
        .manage(DbState(Mutex::new(None)))
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            check_auth_status,
            unlock_db,
            save_file_to_local,
            lock_vault,
            get_notes,
            get_bin_notes,
            add_note,
            update_note,
            delete_note,
            toggle_pin,
            restore_note,
            permanent_delete_note,
            clear_bin,
            toggle_maximize,
            get_pads,
            add_pad,
            update_pad,
            delete_pad,
            get_bin_pads,
            restore_pad,
            permanent_delete_pad,
            clear_pad_bin,
            save_session,
            get_session,
            update_pad_metadata,
            upload_custom_font,
            get_custom_fonts,
            delete_custom_font
        ])
        .setup(|app| {
            let ctrl_shift_n =
                Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyN);
            let _ = app.global_shortcut().on_shortcut(ctrl_shift_n, move |app, _shortcut, event| {
                if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            });

            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let show_i = MenuItem::with_id(app, "show", "Show App", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        app.exit(0);
                    }
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                window.hide().unwrap();
                api.prevent_close();
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

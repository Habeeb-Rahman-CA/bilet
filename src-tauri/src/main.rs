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
use zeroize::Zeroize;

#[derive(Serialize, Deserialize)]
struct Note {
    id: i64,
    content: String,
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
fn check_auth_status(app_handle: tauri::AppHandle) -> AuthStatus {
    let app_dir = app_handle.path().app_data_dir().unwrap();
    let master_path = app_dir.join("vault_master.txt");
    if !master_path.exists() {
        AuthStatus::SetupRequired
    } else {
        AuthStatus::Locked
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

#[tauri::command]
async fn unlock_db(
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
    // We use a fixed salt-suffix for derivation that is distinct from the verification hash salt
    let key = derive_key(&password, "fixed-derivation-salt-123")?;

    // Open DB and ensure table exists
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS secure_notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nonce BLOB NOT NULL,
            ciphertext BLOB NOT NULL
        )",
        [],
    )
    .map_err(|e| e.to_string())?;

    let mut db_lock = state.0.lock().unwrap();
    *db_lock = Some((conn, key));

    Ok("Unlocked".to_string())
}

#[tauri::command]
fn get_notes(state: State<'_, DbState>) -> Result<Vec<Note>, String> {
    let db_lock = state.0.lock().unwrap();
    let (conn, key) = db_lock.as_ref().ok_or("Vault is locked")?;

    let cipher = Aes256Gcm::new(key.into());

    let mut stmt = conn
        .prepare("SELECT id, nonce, ciphertext FROM secure_notes")
        .map_err(|e| e.to_string())?;

    let note_iter = stmt
        .query_map(params![], |row| {
            let id: i64 = row.get(0)?;
            let nonce_bytes: Vec<u8> = row.get(1)?;
            let ciphertext: Vec<u8> = row.get(2)?;

            let nonce = Nonce::from_slice(&nonce_bytes);
            let decrypted = cipher
                .decrypt(nonce, ciphertext.as_ref())
                .map_err(|_| rusqlite::Error::InvalidQuery)?;

            let content =
                String::from_utf8(decrypted).map_err(|_| rusqlite::Error::InvalidQuery)?;

            Ok(Note { id, content })
        })
        .map_err(|e| e.to_string())?;

    let mut notes = Vec::new();
    for note in note_iter {
        notes.push(note.map_err(|e| format!("Decryption error: {}", e))?);
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
        "INSERT INTO secure_notes (nonce, ciphertext) VALUES (?1, ?2)",
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

    conn.execute("DELETE FROM secure_notes WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;

    Ok("Deleted".to_string())
}

#[tauri::command]
fn lock_vault(state: State<'_, DbState>) -> Result<String, String> {
    let mut db_lock = state.0.lock().unwrap();
    *db_lock = None;
    Ok("Locked".to_string())
}

fn main() {
    tauri::Builder::default()
        .manage(DbState(Mutex::new(None)))
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            check_auth_status,
            unlock_db,
            lock_vault,
            get_notes,
            add_note,
            update_note,
            delete_note
        ])
        .setup(|app| {
            let ctrl_shift_n =
                Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyN);
            app.global_shortcut()
                .on_shortcut(ctrl_shift_n, move |app, _shortcut, event| {
                    if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })?;

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

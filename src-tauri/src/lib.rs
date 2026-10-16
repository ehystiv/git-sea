pub mod cache;
pub mod commands;
pub mod error;
pub mod git;
pub mod graph;
pub mod session;
pub mod watcher;

use tauri::menu::{Menu, MenuItemBuilder, SubmenuBuilder};
use tauri::{Emitter, Manager};
use tauri_specta::{Builder, collect_commands};

fn specta_builder() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new().commands(collect_commands![
        commands::open_repo,
        commands::close_repo,
        commands::load_commits,
        commands::commit_details,
        commands::file_diff,
        commands::list_stashes,
        commands::search_commits
    ])
}

/// Event the native menu sends to the frontend; the payload is the id of the menu item.
const MENU_EVENT: &str = "menu";

/// The standard macOS menus, with "Open" and "Close Tab" in the File menu. The default menu binds
/// ⌘W to "Close Window", which would close the app instead of the current tab.
fn build_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let open = MenuItemBuilder::with_id("open_repo", "Apri repository…")
        .accelerator("CmdOrCtrl+O")
        .build(app)?;
    let close = MenuItemBuilder::with_id("close_tab", "Chiudi tab")
        .accelerator("CmdOrCtrl+W")
        .build(app)?;

    let app_menu = SubmenuBuilder::new(app, "git-sea")
        .about(None)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;
    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&open)
        .item(&close)
        .build()?;
    // Without an Edit menu, ⌘C / ⌘V / ⌘A do not work in text fields on macOS.
    let edit_menu = SubmenuBuilder::new(app, "Modifica")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    let window_menu = SubmenuBuilder::new(app, "Finestra")
        .minimize()
        .maximize()
        .fullscreen()
        .build()?;

    Menu::with_items(app, &[&app_menu, &file_menu, &edit_menu, &window_menu])
}

/// The window is transparent (see `tauri.conf.json`); this gives it the macOS "sidebar" material,
/// which shows through wherever the page is transparent. The same effect is in the config, but
/// applying it here too makes a refusal visible in the log instead of silent.
fn apply_sidebar_vibrancy(app: &tauri::AppHandle) {
    use tauri::window::{Effect, EffectState, EffectsBuilder};

    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let effects = EffectsBuilder::new()
        .effect(Effect::Sidebar)
        .state(EffectState::FollowsWindowActiveState)
        .build();
    match window.set_effects(effects) {
        Ok(()) => tracing::info!("sidebar vibrancy applied"),
        Err(err) => tracing::warn!(%err, "could not apply the sidebar vibrancy"),
    }
}

/// Writes the generated TypeScript bindings. Only in debug builds and tests: release builds ship
/// the already-generated file.
#[cfg(any(debug_assertions, test))]
fn write_bindings(builder: &Builder<tauri::Wry>) {
    builder
        .export(
            specta_typescript::Typescript::default(),
            "../src/lib/bindings.ts",
        )
        .expect("failed to export TypeScript bindings");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "git_sea_lib=info".into()),
        )
        .init();

    let builder = specta_builder();

    #[cfg(debug_assertions)]
    write_bindings(&builder);

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .menu(build_menu)
        .on_menu_event(|app, event| {
            // The frontend decides what "close tab" or "open" means: it owns the tabs.
            let _ = app.emit(MENU_EVENT, event.id().as_ref());
        })
        .invoke_handler(builder.invoke_handler())
        .setup(move |app| {
            builder.mount_events(app);
            let cache_dir = app
                .path()
                .app_cache_dir()
                .unwrap_or_else(|_| std::env::temp_dir().join("git-sea"));
            app.manage(session::AppState::new(cache_dir));
            apply_sidebar_vibrancy(app.handle());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Regenerates `src/lib/bindings.ts` without launching the app: `cargo test export_bindings`.
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn export_bindings() {
        write_bindings(&specta_builder());
    }
}

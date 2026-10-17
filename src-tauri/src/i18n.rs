//! The language of the text the backend produces: the native menu and the messages it sends to
//! the frontend. The frontend decides the language (system default or the user's choice in the
//! settings) and tells the backend with the `set_language` command.

use std::sync::atomic::{AtomicU8, Ordering};

use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum Language {
    En,
    It,
}

/// English until the frontend says otherwise.
static CURRENT: AtomicU8 = AtomicU8::new(0);

pub fn set(language: Language) {
    CURRENT.store(language as u8, Ordering::Relaxed);
}

pub fn current() -> Language {
    match CURRENT.load(Ordering::Relaxed) {
        1 => Language::It,
        _ => Language::En,
    }
}

/// The text in the current language.
pub fn tr(en: &str, it: &str) -> String {
    pick(current(), en, it).to_owned()
}

pub fn pick<'a>(language: Language, en: &'a str, it: &'a str) -> &'a str {
    match language {
        Language::En => en,
        Language::It => it,
    }
}

/// The user's system language (a BCP 47 tag such as "it-IT"), if the system reports one.
pub fn system_locale() -> Option<String> {
    sys_locale::get_locale()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picks_the_text_for_the_language() {
        assert_eq!(pick(Language::En, "Open", "Apri"), "Open");
        assert_eq!(pick(Language::It, "Open", "Apri"), "Apri");
    }

    #[test]
    fn the_language_is_kept_between_calls() {
        set(Language::It);
        assert_eq!(current(), Language::It);
        set(Language::En);
        assert_eq!(current(), Language::En);
    }
}

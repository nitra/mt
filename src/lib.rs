//! Специфікація протоколу MT, вбудована в бінарник як Rust-крейт.
//!
//! Каталог `docs/` цього репозиторію (`nitra/mt`) вшивається на етапі
//! компіляції через [`include_dir`], тож споживачі (наприклад,
//! `nitra/mt-rust`) отримують корпус специфікації без ручного копіювання
//! чи мережевого доступу під час білду.

use include_dir::{include_dir, Dir};

/// Вшитий у бінарник каталог `docs/` — корпус специфікації протоколу MT.
pub static DOCS: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/docs");

/// Повертає вміст файлу специфікації за відносним шляхом (наприклад,
/// `"index.md"` або `"architecture/overview.md"`), якщо він існує у
/// вшитому корпусі `docs/` і є коректним UTF-8.
pub fn get(path: &str) -> Option<&'static str> {
    DOCS.get_file(path)?.contents_utf8()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn index_md_is_present_and_non_empty() {
        let content = get("index.md").expect("index.md має бути у вшитому docs/ корпусі");
        assert!(!content.is_empty(), "index.md не має бути порожнім");
    }

    #[test]
    fn missing_file_returns_none() {
        assert!(get("no-such-file.md").is_none());
    }

    #[test]
    fn corpus_contains_more_than_a_handful_of_files() {
        let count = DOCS
            .find("**/*.md")
            .expect("glob має бути валідним")
            .count();
        assert!(
            count > 5,
            "очікували більше 5 md-файлів у docs/, знайдено {count}"
        );
    }
}

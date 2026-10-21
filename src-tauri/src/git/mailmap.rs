//! `.mailmap`: the canonical name and email of each author, as `git log` shows them.
//!
//! The mailmap comes from the working copy's `.mailmap` (`HEAD:.mailmap` in a bare repository),
//! `mailmap.blob` and `mailmap.file`. A missing or unreadable one maps nobody.

use std::borrow::Cow;

use gix::bstr::BStr;

pub use gix::mailmap::Snapshot as Mailmap;

/// The repository's mailmap; empty when there is none.
pub fn open(repo: &gix::Repository) -> Mailmap {
    repo.open_mailmap()
}

/// Name and email of `signature` once the mailmap is applied.
pub fn resolve<'a>(
    mailmap: &Mailmap,
    signature: gix::actor::SignatureRef<'a>,
) -> (Cow<'a, BStr>, Cow<'a, BStr>) {
    let resolved = mailmap.resolve_cow(signature);
    (resolved.name, resolved.email)
}

/// Every entry of the mailmap, one line each in a fixed order, to tell whether it changed.
pub fn entries(mailmap: &Mailmap) -> Vec<String> {
    let show = |s: Option<&BStr>| s.map(ToString::to_string).unwrap_or_default();
    mailmap
        .iter()
        .map(|e| {
            format!(
                "{}\0{}\0{}\0{}",
                show(e.new_name()),
                show(e.new_email()),
                show(e.old_name()),
                e.old_email()
            )
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn signature<'a>(name: &'a str, email: &'a str) -> gix::actor::SignatureRef<'a> {
        gix::actor::SignatureRef {
            name: name.into(),
            email: email.into(),
            time: "0 +0000",
        }
    }

    #[test]
    fn maps_names_and_emails() {
        let mailmap = Mailmap::from_bytes(
            b"Anna Rossi <anna@example.com>\nAnna Rossi <anna@example.com> <anna@old.example>\n",
        );
        let (name, email) = resolve(&mailmap, signature("anna", "anna@example.com"));
        assert_eq!(
            (name.as_ref(), email.as_ref()),
            ("Anna Rossi".into(), "anna@example.com".into())
        );
        let (name, email) = resolve(&mailmap, signature("A. Rossi", "anna@old.example"));
        assert_eq!(
            (name.as_ref(), email.as_ref()),
            ("Anna Rossi".into(), "anna@example.com".into())
        );
        let (name, _) = resolve(&mailmap, signature("Bruno", "bruno@example.com"));
        assert_eq!(name.as_ref(), BStr::new("Bruno"));
    }

    #[test]
    fn entries_change_with_the_mailmap() {
        let empty = Mailmap::default();
        let one = Mailmap::from_bytes(b"Anna <anna@example.com>\n");
        let other = Mailmap::from_bytes(b"Anna R <anna@example.com>\n");
        assert!(entries(&empty).is_empty());
        assert_eq!(entries(&one).len(), 1);
        assert_ne!(entries(&one), entries(&other));
    }
}

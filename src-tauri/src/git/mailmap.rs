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

/// The `Co-authored-by:` trailers of a commit message, as (name, email) once the mailmap is
/// applied, in the order they are written and each person once. Values that are not
/// `Name <email>` are skipped.
pub fn co_authors(
    mailmap: &Mailmap,
    message: &gix::objs::commit::MessageRef<'_>,
) -> Vec<(String, String)> {
    let Some(body) = message.body() else {
        return Vec::new();
    };
    let mut found: Vec<(String, String)> = Vec::new();
    for trailer in body.trailers() {
        if !trailer.token.eq_ignore_ascii_case(b"co-authored-by") {
            continue;
        }
        let Ok(identity) = gix::actor::IdentityRef::from_bytes(trailer.value.as_ref()) else {
            continue;
        };
        if identity.name.is_empty() && identity.email.is_empty() {
            continue;
        }
        let signature = gix::actor::SignatureRef {
            name: identity.name,
            email: identity.email,
            time: "0 +0000",
        };
        let (name, email) = resolve(mailmap, signature);
        let person = (name.to_string(), email.to_string());
        if !found.contains(&person) {
            found.push(person);
        }
    }
    found
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

    fn message(text: &str) -> gix::objs::commit::MessageRef<'_> {
        gix::objs::commit::MessageRef::from_bytes(text.as_bytes())
    }

    #[test]
    fn reads_co_authors_from_the_trailers() {
        let mailmap = Mailmap::from_bytes(b"Anna Rossi <anna@example.com> <anna@old.example>\n");
        let text = "Fix the login\n\nLonger text.\n\nSigned-off-by: Bruno <bruno@example.com>\nCo-authored-by: A. Rossi <anna@old.example>\nco-authored-by: Carla <carla@example.com>\nCo-Authored-By: Carla <carla@example.com>\nCo-authored-by: nobody\n";
        assert_eq!(
            co_authors(&mailmap, &message(text)),
            [
                ("Anna Rossi".to_owned(), "anna@example.com".to_owned()),
                ("Carla".to_owned(), "carla@example.com".to_owned()),
            ]
        );
    }

    #[test]
    fn a_trailer_in_the_middle_of_the_body_is_not_one() {
        let mailmap = Mailmap::default();
        assert!(co_authors(&mailmap, &message("Fix\n")).is_empty());
        let text = "Fix\n\nCo-authored-by: Anna <anna@example.com>\n\nMore text after it.\n";
        assert!(co_authors(&mailmap, &message(text)).is_empty());
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

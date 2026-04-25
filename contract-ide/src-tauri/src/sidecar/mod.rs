//! Sidecar .md file handling — parsing and writing the YAML frontmatter
//! that is the source of truth for contract identity (DATA-01).
//!
//! The `.contracts/<uuid>.md` filename is human-readable metadata only.
//! The canonical UUID lives in the `uuid:` frontmatter field — rename the
//! .md file and identity is preserved (DATA-04).

pub mod backend_section_validator;
pub mod frontmatter;
pub mod jsx_align_validator;
pub mod section_parser;

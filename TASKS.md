# Job Application Assistant — Project Tasks

## In Progress / Next Up

- [ ] Resume-only answering: when no JD is active, use smarter resume-only prompt (mentioned as future work)

## Completed

- [x] Skip already-filled fields (2026-08-05)
  First pass (pattern-matching) and fillSelectElements now skip inputs/selects with non-empty values. AI second pass already did this. Fixes Greenhouse overwriting pre-filled name/email/phone.

- [x] JD History Queue (2026-08-05)
  Replace single Active Job with 10-entry queue. chrome.storage.local for list, session for active selection (deselects on browser close). Dedup by text hash. Click to select, ✕ to remove, hover = full JD tooltip. No auto-select on +JD.

- [x] Projects section in resume (2026-08-05)
  New Project interface, Projects section in options page, included in Claude context.

- [x] AI text quality improvements (2026-08-05)
  Consolidated HUMAN_RULES, cleanGeneratedText() post-processor (strips markdown headers, rewrites em/en dashes). max_tokens bumped to 600 for general answers.

- [x] Clipboard fallback for cross-origin iframes (2026-08-05)
  execCommand fallback + clipboardWrite permission for iframed ATS forms.

- [x] Selection toolbar: Copy + Format on textarea/contentEditable (fc9b55c)
  Works including iframed ATS forms.

## Backlog / Ideas

- [ ] Smarter resume-only mode (use profile summary, skills, and work history to infer best answers without a JD)
- [ ] JD list: allow manual title edit per entry
- [ ] Form fill: wire active JD from session storage into the fill flow (currently popup fill ignores sidebar JD)
- [ ] Workday support improvements (partial currently)

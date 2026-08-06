# Job Application Assistant — Project Tasks

## In Progress / Known Issues

- [ ] Custom React date pickers (e.g. Greenhouse "Ideal start date in office") — controlled components ignore DOM value injection; user must select manually
- [ ] Verify "hear about us" / referral source fills correctly on live forms (pattern added, not yet confirmed)
- [ ] Resume-only answering: when no JD is active, use smarter resume-only prompt (mentioned as future work)

## Completed

- [x] Full UI redesign — light theme (2026-08-05)
  Complete visual overhaul of all three surfaces using indigo accent, warm neutral palette, and system font. Popup: single "Fill this application" primary button, two secondary tiles (Check match / Cover letter), footer text links, detected-job chip with ✕ clear. Sidebar: persistent match card with SVG circular progress ring, tab renamed to "Fill Progress", progress summary bar + "Needs attention" group first + filled fields as wrapping chips. Options/Settings: left nav switches content sections (no more scroll), Resume section has two clearly separated PDF mechanism cards (parse vs. attach), 8 sub-tabs for resume fields, Projects promoted to its own nav section.

- [x] Dark mode (2026-08-05)
  Full dark theme using `data-theme="dark"` on `<html>`. CSS vars overridden in popup.css, sidebar.css, and options.html inline styles. Toggle in Settings → Preferences persists to `chrome.storage.local` (`jae_theme`). Popup, sidebar, and options all read theme on load — all three surfaces stay in sync.

- [x] AI answer quality improvements (2026-08-05)
  Switched answer generation and cover letters to `claude-sonnet-4-6` (Haiku remains for PDF parsing and formatting tasks). Rewrote open-ended prompt: Claude now reads the question carefully, draws from ALL resume sections + common questions + Q&A bank, uses the Q&A bank as the primary voice/style guide, avoids verbatim copying of the profile summary, and scales answer length to question depth. Why-interested prompt updated to require specific company/role knowledge from the JD.

- [x] Fill Progress empty state with fill button (2026-08-05)
  Fill Progress tab now shows a centered "Fill this application" button when no fill has run yet. Clicking it dispatches `jae_fill_triggered` via sidebarHost to content.ts, which runs the full fill sequence (resume from storage, active JD from session). Fill logic extracted into `runFill()` shared by the message handler and the new window event listener.

- [x] Location autocomplete (2026-08-05)
  After sync fill sets the city text, `fillLocationAutocompletes` re-triggers the Typeahead/autocomplete dropdown and clicks the best city+state match. Avoids wrong selections like "Austintown" when typing "Austin". Also added city/location patterns to `getKnownFieldValue` so combobox-style location fields are handled via `activateCustomSelect` without AI.

- [x] Yes/No button groups (2026-08-05)
  New `fillButtonGroups()` handles Greenhouse-style segmented `<button>` Yes/No controls. `fillRadioGroups` also updated to click the associated `<label>` after setting `.checked` — fixes Greenhouse's visually-hidden radio pattern where React listens to label clicks.

- [x] "Hear about us" defaults to LinkedIn (2026-08-05)
  Added referral source pattern to `getKnownFieldValue` matching label text ("how did you hear about us") AND field name attributes (`referral_source`, `referral`). Fills native `<select>` and custom dropdowns.

- [x] Available Start Date field (2026-08-05)
  New `availableStartDate` field in `CommonQuestions` type and Options → Common Questions. Mapped to date-picker inputs matching patterns like "ideal start date", "when can you start", "availability".

- [x] Sidebar live fill progress (2026-08-05)
  Two-tab sidebar: Workspace + Fields. Fields tab shows a live feed as the form is filled — each field appears with ⟳ while AI thinks, updates in-place to ✓/✗. Fill progress streamed via `window.top.postMessage({ __jae_fill: true })` from any iframe → sidebarHost → sidebar.

- [x] Popup dark theme + fire-and-close (2026-08-05)
  Full dark theme restyle (CSS vars). "Fill Form" closes popup immediately; sidebar opens and shows live progress.

- [x] Stored resume PDF + auto-attach (2026-08-05)
  Upload PDF once in Options → saved to `chrome.storage.local` as base64 (`jae_resume_pdf`). On Fill Form, silently injected into file upload inputs via DataTransfer API. Added `unlimitedStorage` manifest permission.

- [x] Resume PDF parse & fill (2026-08-05)
  Upload PDF → Claude API (native PDF document block, `anthropic-beta: pdfs-2024-09-25`) extracts structured resume data → populates the options form. Separate from stored PDF flow.

- [x] Options page nav scroll-spy + styling (2026-08-05)
  Smooth `scrollIntoView` on nav clicks; scroll event updates active nav item. Color-coded section borders. Nicer entry card styling.

- [x] Q&A Bank improvements (2026-08-05)
  `max_tokens` raised 2000 → 8192 (was silently truncating). Errors propagated to UI. Fixed preview panel not showing. Per-card Save/Discard buttons.

- [x] Personal Q&A Bank (2026-08-05)
  Free-flow entry → Claude parses into structured Q&A pairs → preview with similarity warnings → save. Stored in jae_qa_bank (separate from resume). Injected into generateAnswer and generateCoverLetter prompts automatically. Inline edit/delete. Migrates old 'questions' data on first load.

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

- [ ] Multiple stored resumes (max 3) with a "default" selection — discussed, explicitly deferred
- [ ] Smarter resume-only mode (use profile summary, skills, and work history to infer best answers without a JD)
- [ ] JD list: allow manual title edit per entry
- [ ] Form fill: wire active JD from session storage into the fill flow (currently popup fill ignores sidebar JD)
- [ ] Workday cascading dropdowns (country → state → city) — currently skipped intentionally to avoid form corruption
- [ ] Multi-step application forms: detect page transitions and re-trigger fill on next page

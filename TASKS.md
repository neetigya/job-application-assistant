# Job Application Assistant — Project Tasks

## In Progress / Known Issues

- [ ] Custom React date pickers (e.g. Greenhouse "Ideal start date in office") — controlled components ignore DOM value injection; user must select manually
- [ ] Verify "hear about us" / referral source fills correctly on live forms (pattern added, not yet confirmed)
- [ ] Resume-only answering: when no JD is active, use smarter resume-only prompt (mentioned as future work)

## In Progress — Design Handoff (2026-08-06)

Second design pass (`design_handoff_settings_redesign/`) reviewed against the live codebase. Verdict: the base visual redesign (README.md — popup, sidebar, settings tokens/layout, dual resume mechanism, JD select/remove split) was already fully implemented in the prior phase; only gap found was the theme toggle missing from popup/sidebar headers, now fixed. Sequencing agreed with design: ship visual redesign (done) before Smart Fill (new runtime capability, not yet started).

- [x] Theme toggle in popup + sidebar headers (2026-08-06)
  Sun/moon icon button added next to the settings gear in both `popup.html`/`popup.ts` and `sidebar.html`/`sidebar.ts`, reusing the existing `jae_theme` storage key and toggle logic already shipped in `options.ts`. Verified with a scripted Playwright pass against the built `dist/` extension (loaded unpacked, popup + sidebar screenshotted in both themes) — confirms toggling in one surface is picked up by another surface on next load.

- [x] Fix false-positive "filled" status on Ashby (and likely other resume-autofill ATS) forms (2026-08-06)
  Live bug caught on a Higharc/Ashby application: sidebar showed "Why Higharc?" as filled (green check) but the textarea was actually empty on the page. Root cause (user's diagnosis, confirmed by code read): `runFill()` in `content.ts` filled text fields (including AI-generated open-ended answers) *before* attaching the stored resume PDF; Ashby's own resume-upload autofill then re-rendered the form and wiped fields we'd already written, after we'd already reported them filled. `fillOpenEndedWithAI` also set `filled = true` unconditionally with no read-back check.
  Fix: reordered `runFill()` to attach the resume PDF **first**, wait `RESUME_AUTOFILL_SETTLE_MS` (1.5s) for any site-triggered autofill to settle, *then* run the rest of the fill sequence — so our writes land last. Existing "skip already-filled fields" logic means this doesn't clobber anything the site's own autofill got right. Not a full fix for every ATS/timing combination (a site with a longer resume-parse delay than 1.5s could still exhibit this) — a proper fix needs the read-back verification from the Smart Fill milestone below.
  Also added a "Refill" button to the sidebar's Fill Progress header (visible once a fill completes, disabled while filling) — previously the only re-fill trigger was the empty-state button, which disappeared after the first fill, so there was no way to re-run a fill from the sidebar once one had already happened. Reuses the existing `triggerFill` message path unchanged.

- [x] On-page fix icon + read-back "unconfirmed" state (2026-08-06)
  Scoped-down version of Smart Fill: option 3 of the three below ("icon + read-back, no candidate ranking"), picked to fix the actual false-green-checkmark bug (hit twice on Higharc/Ashby) without building the larger candidate-ranking system. New `src/content/fieldFixOverlay.ts` module (mirrors `selectionToolbar.ts`'s page-injection pattern: inline-styled elements on `document.documentElement`, works in iframed ATS forms). Scope: applies only to plain text/textarea AI-generated answers in `fillOpenEndedWithAI` — NOT custom-dropdown answers (click-driven via `activateCustomSelect`, not a controlled-input write, no observed failures there).
  - **Read-back check**: ~500ms after writing an AI answer, re-reads the field's value and compares. Mismatch → field flips to `unconfirmed` status, both in the on-page icon and the sidebar (new amber "May not have saved" group in Fill Progress, between "Needs attention" and the filled chips).
  - **On-page icon**: appears on focus of any AI-written text/textarea field (amber if unconfirmed, neutral otherwise). Click opens a small popup: **Regenerate** (re-asks Claude with the same field context) or **Write custom** (free-text edit). Both paths re-run the read-back check and propagate the new status/value back to the sidebar via a new `field_update` fill-progress message type (relayed through `sidebarHost.ts` alongside the existing `field`/`ai_thinking`/`pdf` types).
  - Sidebar's unconfirmed group is informational only (no remote-focus-the-page-field action) — the on-page icon is the sole interactive fix entry point, per the chosen scope.
  - **Not yet live-tested** against a real ATS (Workday/Greenhouse/Ashby) — `npm run build` + typecheck are clean, but the actual read-back timing/false-positive rate on a controlled-component framework hasn't been verified on a live posting yet. Do that before trusting the unconfirmed signal.

- [x] Fix icon not appearing on live test (2026-08-06)
  User tested the fix icon on a live posting right after building it — icon never showed. Found a likely root cause by re-reading `fieldFixOverlay.ts`: focusing a field very often triggers the browser's own native scroll-into-view, firing a `scroll` event immediately after `focusin` — and the overlay's scroll handler was calling `hideIcon()`, so the icon could show for a single frame and vanish the instant the field was focused. Changed `onScroll` to reposition the icon/popup instead of hiding them. Also switched focus detection from `e.target` to `e.composedPath()[0]` (correct behavior if a field ever lives inside a shadow root — `e.target` gets retargeted to the shadow host and would never match the registered element) and added `logger.debug` calls at registration and at focus-miss so a future report can be diagnosed from the console (flip `DEBUG` in `src/utils/logger.ts`) instead of guessing blind.
  **Still needs a live re-test** — the scroll-hide bug is the most likely explanation found by code review, not confirmed live.

- [x] Split Refill from resume re-attach (2026-08-06)
  "Refill" used to always re-run `injectResumePDF()` first, which could re-trigger the site's own resume-upload autofill and disturb fields the user had just manually fixed. Refill now skips PDF attach entirely (`runFill(..., attachPdf: false)`); the very first fill (empty-state button / popup "Fill this application") still attaches it. Added a separate "Reupload" button next to Refill in the Fill Progress header (`sidebar.html`/`sidebar.ts`) that does only the PDF attach, via a new `jae_reupload_triggered` window event (relayed by `sidebarHost.ts`'s new `triggerReupload` action) — doesn't touch any other field, and patches the sidebar's existing "Documents" chip in place rather than re-running the whole fill-progress view.

- [ ] **Smart Fill (confidence-based autofill)** — not started, next milestone. **NEXT SESSION: resolve scope question below before writing any code.**
  Addendum doc: `design_handoff_settings_redesign/02-smart-fill-workflow.md`. Replaces binary filled/needs-attention with three states: `needs_input` / `unconfirmed` ("may not have saved" — value written but read-back didn't confirm it stuck, common on React/Angular-controlled Workday fields) / `filled`. Adds a unified field-fix popup (ranked candidates, "Use selected" / "Write custom…") reachable from the sidebar Fill Progress list or an on-page icon on the focused field. Needs a real-world spike against Workday/Greenhouse forms first to nail read-back timing and match logic before locking the UI — flagged as a genuinely open question, not a spec gap. Candidate-ranking (the AI matching behind the picker) is the largest single piece of net-new work in the whole handoff — size it on its own before committing to a build estimate.

  **2026-08-06 follow-up:** user hit the on-page icon's absence directly (screenshot of the "Why Higharc?" field on the live Higharc/Ashby posting, no icon present) and asked to scope building it now rather than waiting for the full spike-first plan above. I proposed three options and asked the user to pick one via AskUserQuestion — **the user did not answer; they interrupted the tool call and asked to end the session instead.** Nothing was decided. Options offered, still open:
  1. **Minimal icon now** — on-page icon on the focused field, click opens a small popup with "Regenerate" (re-ask AI) + "Write custom" (free text). No candidate ranking, no read-back detection, no unconfirmed state. Smallest change, directly closes the gap that's now been hit twice.
  2. **Full Smart Fill milestone** — the complete original spec (three-state model, read-back verification, ranked candidate list, both entry points). Needs the live-ATS spike first.
  3. **Icon + read-back, no candidate ranking** — on-page icon, plus an actual read-back check so false "filled" green checkmarks stop happening (the amber `unconfirmed` state), but the fix popup just offers regenerate/custom text rather than a ranked candidate list.
  Start the next session on Smart Fill by re-asking this scope question — don't assume an answer.

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

// Selection Toolbar — injected into every page via the existing content script.
// Shows Copy + Explain ▾ (always), Format ▾ (editable only), capture buttons (read-only only).
// All styles are inline to survive hostile host-page CSS.

declare global {
  interface Window { __jaeToolbarLoaded?: boolean }
}

// Caller passes in the single shared writer so there is no circular import.
export type FieldWriterOpts = { range?: Range; selectionStart?: number; selectionEnd?: number };
export type FieldWriter = (el: HTMLElement, val: string, opts?: FieldWriterOpts) => void;

// ── Inline style constants ────────────────────────────────────────────────────
const S = {
  surface:   '#202124',
  border:    'rgba(255,255,255,0.10)',
  shadow:    '0 4px 16px rgba(0,0,0,0.28)',
  neutral:   '#e8eaed',   // Copy — plain action
  workspace: '#8ab4f8',   // Explain / +JD / Add as Question — opens sidebar
  format:    '#c8a2ff',   // Format — write action, visually distinct
  hairline:  'rgba(255,255,255,0.12)',
  hover:     'rgba(255,255,255,0.08)',
  font:      '-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif',
} as const;

// ── Format prompts ────────────────────────────────────────────────────────────
const HUMAN_RULES =
  '\n\nStyle rules: no em-dashes, no "delve/leverage/utilize/in the realm of", ' +
  'active voice, short sentences, no corporate filler.';

const FORMAT_PROMPTS: Record<string, string> = {
  bullets:
    'Convert the following text into concise bullet points. Start each bullet with "• ". ' +
    'Preserve all key information.' + HUMAN_RULES + '\n\nReturn only the bullet points.\n\nText:\n',
  clean:
    'Fix grammar, spelling, and punctuation in the following text. ' +
    'Keep the original meaning and approximate length.' + HUMAN_RULES +
    '\n\nReturn only the corrected text.\n\nText:\n',
  rephrase:
    'Rephrase the following text to improve clarity and flow while keeping the same meaning.' +
    HUMAN_RULES + '\n\nReturn only the rephrased text.\n\nText:\n',
  rephbullets:
    'Rephrase the following text and format it as bullet points. Start each bullet with "• ". ' +
    'Preserve all key information.' + HUMAN_RULES + '\n\nReturn only the bullet points.\n\nText:\n',
  condense:
    'Condense the following text to roughly half its length while keeping all key information.' +
    HUMAN_RULES + '\n\nReturn only the condensed text.\n\nText:\n',
  humanize:
    'Rewrite the following text to sound natural, warm, and human. ' +
    'Remove corporate jargon and AI-sounding phrases.' + HUMAN_RULES +
    '\n\nReturn only the rewritten text.\n\nText:\n',
};

// ── Explain length options ────────────────────────────────────────────────────
const EXPLAIN_LENGTHS: [string, string][] = [
  ['default',  'Default (2–3 sentences)'],
  ['oneliner', 'One-liner'],
  ['medium',   'Medium paragraph'],
  ['detailed', 'Detailed'],
];

// ── Module state ──────────────────────────────────────────────────────────────
let toolbarEl:  HTMLElement | null = null;
let dropdownEl: HTMLElement | null = null;
let pillEl:     HTMLElement | null = null;
let pillTimer:  ReturnType<typeof setTimeout> | null = null;
let writeField: FieldWriter | null = null;

// Cached active job label for capture button (loaded at init, kept fresh via storage listener)
let activeJobLabel = '';

interface SavedSel {
  editableEl: HTMLElement | null;
  text:       string;
  selStart?:  number;
  selEnd?:    number;
  range?:     Range;
}
let savedSel: SavedSel | null = null;

// ── getEditableTarget ─────────────────────────────────────────────────────────
// Used only for the contentEditable / read-only Range branch.
// INPUT/TEXTAREA selections are NOT detected here — they bypass this function
// entirely via document.activeElement in checkSelection().
//
// CRITICAL: do NOT use closest('[contenteditable="true"]') — that only matches
// the literal attribute value "true".  Editors like Quill/ProseMirror/Gmail
// use contenteditable="" or the bare attribute, both of which yield
// isContentEditable===true but are invisible to the CSS selector.
function getEditableTarget(): HTMLElement | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;

  const range  = sel.getRangeAt(0);
  const anchor = range.commonAncestorContainer;
  const startEl: Element | null =
    anchor.nodeType === Node.ELEMENT_NODE
      ? (anchor as Element)
      : anchor.parentElement;
  if (!startEl) return null;

  // Walk up looking for the nearest element that EXPLICITLY declares contenteditable
  // (any value except "false" — catches "", "true", and bare attribute).
  let node: Element | null = startEl;
  while (node && node !== document.body) {
    if (node instanceof HTMLElement) {
      const ce = node.getAttribute('contenteditable');
      if (ce !== null && ce !== 'false') return node;
    }
    node = node.parentElement;
  }
  return null;
}

// ── Selection caching ─────────────────────────────────────────────────────────
// For INPUT/TEXTAREA: read from the element's own selectionStart/selectionEnd.
// For contentEditable: clone the DOM Range from window.getSelection().
// Called from onContextMenu; NOT called from the main checkSelection path
// (that path sets savedSel directly before calling showToolbar).
function cacheSelection(editableEl: HTMLElement | null): void {
  if (editableEl instanceof HTMLInputElement || editableEl instanceof HTMLTextAreaElement) {
    const start = editableEl.selectionStart;
    const end   = editableEl.selectionEnd;
    if (start == null || end == null || end <= start) { savedSel = null; return; }
    const text = editableEl.value.substring(start, end).trim();
    if (!text) { savedSel = null; return; }
    savedSel = { editableEl, text, selStart: start, selEnd: end };
    return;
  }
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const text = sel.toString();
  if (!text.trim()) { savedSel = null; return; }
  if (editableEl?.isContentEditable) {
    savedSel = { editableEl, text, range: sel.getRangeAt(0).cloneRange() };
  } else {
    savedSel = { editableEl: null, text };
  }
}

// ── Status pill ───────────────────────────────────────────────────────────────
// Appended to document.documentElement (not document.body) so it works inside
// iframes where the host page sets overflow:hidden on <body>.
function showPill(anchor: HTMLElement, msg: string, isError = false): void {
  hidePill();
  const rect = anchor.getBoundingClientRect();
  const pill = document.createElement('div');
  pill.id = '__jae-pill';
  pill.style.cssText = [
    'position:fixed',
    `left:${Math.max(8, rect.left)}px`,
    `top:${rect.bottom + 6}px`,
    `background:${isError ? '#3a1b1b' : S.surface}`,
    `border:1px solid ${isError ? '#f44336' : S.hairline}`,
    `color:${S.neutral}`,
    `font-family:${S.font}`,
    'font-size:12px',
    'padding:4px 10px',
    'border-radius:6px',
    'z-index:2147483646',
    'box-shadow:0 2px 8px rgba(0,0,0,.5)',
    'pointer-events:none',
    'white-space:nowrap',
  ].join(';');
  pill.textContent = msg;
  document.documentElement.appendChild(pill);
  pillEl = pill;
}

function hidePill(): void {
  pillEl?.remove();
  pillEl = null;
  if (pillTimer) { clearTimeout(pillTimer); pillTimer = null; }
}

// ── Toolbar helpers ───────────────────────────────────────────────────────────
type BtnColor = 'neutral' | 'workspace' | 'format';
function makeBtn(label: string, color: BtnColor = 'neutral'): HTMLButtonElement {
  const colorMap: Record<BtnColor, string> = {
    neutral:   S.neutral,
    workspace: S.workspace,
    format:    S.format,
  };
  const btn = document.createElement('button');
  btn.textContent = label;
  btn.style.cssText = [
    'all:unset',
    `color:${colorMap[color]}`,
    `font-family:${S.font}`,
    'font-size:13px',
    `font-weight:${color === 'neutral' ? '400' : '500'}`,
    'padding:4px 10px',
    'cursor:pointer',
    'border-radius:6px',
    'line-height:1.4',
    'white-space:nowrap',
    'display:inline-block',
  ].join(';');
  btn.addEventListener('mouseenter', () => { btn.style.background = S.hover; });
  btn.addEventListener('mouseleave', () => { btn.style.background = 'transparent'; });
  return btn;
}

function hideToolbar(): void {
  toolbarEl?.remove();  toolbarEl  = null;
  dropdownEl?.remove(); dropdownEl = null;
}

function positionToolbar(tb: HTMLElement, anchorRect: DOMRect): void {
  const tbW = tb.offsetWidth  || 180;
  const tbH = tb.offsetHeight || 36;
  let x = anchorRect.left + anchorRect.width / 2 - tbW / 2;
  let y = anchorRect.top  - tbH - 8;
  x = Math.max(8, Math.min(x, window.innerWidth - tbW - 8));
  if (y < 8) y = anchorRect.bottom + 8;
  tb.style.left = `${x}px`;
  tb.style.top  = `${y}px`;
}

function showExplainDropdown(explainBtn: HTMLElement): void {
  if (dropdownEl) { dropdownEl.remove(); dropdownEl = null; return; }

  const rect = explainBtn.getBoundingClientRect();
  const dd = document.createElement('div');
  dd.id = '__jae-dropdown';
  dd.style.cssText = [
    'position:fixed',
    `left:${rect.left}px`,
    `top:${rect.bottom + 4}px`,
    `background:${S.surface}`,
    `border:1px solid ${S.hairline}`,
    'border-radius:8px',
    'padding:4px 0',
    'z-index:2147483646',
    'box-shadow:0 8px 24px rgba(0,0,0,.6)',
    'min-width:190px',
    `font-family:${S.font}`,
  ].join(';');

  for (const [length, label] of EXPLAIN_LENGTHS) {
    const item = document.createElement('div');
    item.textContent = label;
    item.style.cssText = [
      `color:${S.neutral}`, 'font-size:13px', 'padding:7px 14px', 'cursor:pointer', 'white-space:nowrap',
    ].join(';');
    item.addEventListener('mouseenter', () => { item.style.background = S.hairline; });
    item.addEventListener('mouseleave', () => { item.style.background = ''; });
    item.addEventListener('mousedown',  e => e.preventDefault());
    item.addEventListener('click', () => {
      dd.remove(); dropdownEl = null;
      void applyExplainCmd(length);
    });
    dd.appendChild(item);
  }

  document.documentElement.appendChild(dd);
  dropdownEl = dd;
}

function showDropdown(fmtBtn: HTMLElement, editableEl: HTMLElement): void {
  if (dropdownEl) { dropdownEl.remove(); dropdownEl = null; return; }

  const fmtRect = fmtBtn.getBoundingClientRect();
  const dd = document.createElement('div');
  dd.id = '__jae-dropdown';
  dd.style.cssText = [
    'position:fixed',
    `left:${fmtRect.left}px`,
    `top:${fmtRect.bottom + 4}px`,
    `background:${S.surface}`,
    `border:1px solid ${S.hairline}`,
    'border-radius:8px',
    'padding:4px 0',
    'z-index:2147483646',
    'box-shadow:0 8px 24px rgba(0,0,0,.6)',
    'min-width:170px',
    `font-family:${S.font}`,
  ].join(';');

  const ITEMS: [string, string][] = [
    ['bullets',     'Bullet points'],
    ['clean',       'Clean up'],
    ['rephrase',    'Rephrase'],
    ['rephbullets', 'Rephrase + bullets'],
    ['condense',    'Condense'],
    ['humanize',    'Humanize'],
  ];

  for (const [fmt, label] of ITEMS) {
    const item = document.createElement('div');
    item.textContent = label;
    item.setAttribute('data-fmt', fmt);
    item.style.cssText = [
      `color:${S.neutral}`,
      'font-size:13px',
      'padding:7px 14px',
      'cursor:pointer',
      'white-space:nowrap',
    ].join(';');
    item.addEventListener('mouseenter', () => { item.style.background = S.hairline; });
    item.addEventListener('mouseleave', () => { item.style.background = ''; });
    item.addEventListener('mousedown', e => e.preventDefault());
    item.addEventListener('click', () => {
      dd.remove();
      dropdownEl = null;
      void applyFormatCmd(fmt, editableEl);
    });
    dd.appendChild(item);
  }

  document.documentElement.appendChild(dd);
  dropdownEl = dd;
}

// ── showToolbar ───────────────────────────────────────────────────────────────
// anchorRect is provided by the caller — either the field's getBoundingClientRect()
// (form-control branch) or the Range's getBoundingClientRect() (Range branch).
// savedSel MUST be set by the caller before calling this.
function showToolbar(editableEl: HTMLElement | null, anchorRect: DOMRect): void {
  if (!savedSel?.text.trim()) return;

  hideToolbar();

  const tb = document.createElement('div');
  tb.id = '__jae-toolbar';
  tb.style.cssText = [
    'position:fixed',
    'left:0', 'top:0',
    `background:${S.surface}`,
    `border:1px solid ${S.border}`,
    'border-radius:10px',
    'padding:3px 4px',
    'display:flex',
    'align-items:center',
    'gap:2px',
    'z-index:2147483646',
    `box-shadow:${S.shadow}`,
    'user-select:none',
    '-webkit-user-select:none',
  ].join(';');

  // ── Copy button (always shown)
  const copyBtn = makeBtn('Copy', 'neutral');
  copyBtn.addEventListener('mousedown', e => e.preventDefault());
  copyBtn.addEventListener('click', () => {
    const text = savedSel?.text || '';
    if (!text) return;
    const finish = (ok: boolean) => {
      copyBtn.textContent = ok ? '✓ Copied' : '✕ Failed';
      setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1400);
    };
    // navigator.clipboard is blocked inside cross-origin iframes by Permissions Policy.
    // Fall back to execCommand which is not subject to that restriction.
    const execFallback = (): boolean => {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0;pointer-events:none;';
        document.documentElement.appendChild(ta);
        ta.focus(); ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return ok;
      } catch { return false; }
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(() => finish(true), () => finish(execFallback()));
    } else {
      finish(execFallback());
    }
  });
  tb.appendChild(copyBtn);

  const addDivider = () => {
    const d = document.createElement('div');
    d.style.cssText = `width:1px;height:18px;background:${S.hairline};flex-shrink:0;`;
    tb.appendChild(d);
  };

  // ── Explain ▾ (always shown, both editable and read-only)
  addDivider();
  const explainBtn = makeBtn('Explain ▾', 'workspace');
  explainBtn.id = '__jae-explain-btn';
  explainBtn.addEventListener('mousedown', e => e.preventDefault());
  explainBtn.addEventListener('click', e => {
    e.stopPropagation();
    showExplainDropdown(explainBtn);
  });
  tb.appendChild(explainBtn);

  if (editableEl) {
    // ── Format ▾ (editable selections only)
    addDivider();
    const fmtBtn = makeBtn('Format ▾', 'format');
    fmtBtn.id = '__jae-format-btn';
    fmtBtn.addEventListener('mousedown', e => e.preventDefault());
    fmtBtn.addEventListener('click', e => {
      e.stopPropagation();
      showDropdown(fmtBtn, editableEl);
    });
    tb.appendChild(fmtBtn);
  } else {
    // ── Capture buttons (read-only selections only)
    addDivider();

    const jdLabel = activeJobLabel
      ? `+ JD (${activeJobLabel.slice(0, 22)}…)`
      : 'Add to Job Description';
    const jdBtn = makeBtn(jdLabel, 'workspace');
    jdBtn.id = '__jae-jd-btn';
    jdBtn.addEventListener('mousedown', e => e.preventDefault());
    jdBtn.addEventListener('click', () => {
      const text = savedSel?.text || '';
      if (!text) return;
      hideToolbar();
      showPill(document.documentElement, '✏ Saving to history…');
      chrome.runtime.sendMessage(
        { action: 'jae_capture_jd', text, url: window.location.href },
        (res) => {
          hidePill();
          if (res?.ok) {
            showPill(document.documentElement, '✓ Saved to JD history');
          } else {
            showPill(document.documentElement, '✕ Could not add', true);
          }
          pillTimer = setTimeout(hidePill, 2200);
        }
      );
    });
    tb.appendChild(jdBtn);

    addDivider();
    const qBtn = makeBtn('Add as Question', 'workspace');
    qBtn.id = '__jae-q-btn';
    qBtn.addEventListener('mousedown', e => e.preventDefault());
    qBtn.addEventListener('click', () => {
      const text = savedSel?.text || '';
      if (!text) return;
      hideToolbar();
      chrome.runtime.sendMessage({ action: 'jae_capture_question', text });
    });
    tb.appendChild(qBtn);
  }

  // Append to documentElement (not body) — works in iframes with overflow:hidden on body
  document.documentElement.appendChild(tb);
  toolbarEl = tb;
  positionToolbar(tb, anchorRect);
}

// ── Format execution ──────────────────────────────────────────────────────────
async function applyFormatCmd(formatType: string, editableEl: HTMLElement): Promise<void> {
  if (!savedSel?.text.trim()) return;

  let text = savedSel.text;
  let truncated = false;
  if (text.length > 6000) { text = text.slice(0, 6000); truncated = true; }

  hideToolbar();
  showPill(editableEl, truncated ? '⚠ Selection capped at 6000 chars — formatting…' : '✏ Formatting…');

  const response = await new Promise<{ ok: boolean; text?: string; error?: string }>((resolve) => {
    chrome.runtime.sendMessage({ action: 'formatText', text, formatType }, (res) => {
      if (chrome.runtime.lastError) resolve({ ok: false, error: 'extension_error' });
      else resolve(res || { ok: false, error: 'no_response' });
    });
  });

  hidePill();

  if (!response?.ok) {
    const errMsg = response?.error === 'no_key'
      ? '✕ No API key — open Settings'
      : `✕ ${response?.error || 'Error'}`;
    showPill(editableEl, errMsg, true);
    pillTimer = setTimeout(hidePill, 4000);
    return;
  }

  const formatted = (response.text || '').trim();
  if (!formatted) {
    showPill(editableEl, '✕ Empty response', true);
    pillTimer = setTimeout(hidePill, 3000);
    return;
  }

  // Route through the single shared writer — no second write path here
  if (editableEl instanceof HTMLInputElement || editableEl instanceof HTMLTextAreaElement) {
    writeField!(editableEl, formatted, {
      selectionStart: savedSel.selStart,
      selectionEnd:   savedSel.selEnd,
    });
  } else if (editableEl.isContentEditable) {
    writeField!(editableEl, formatted, { range: savedSel.range });
  }

  showPill(editableEl, '✓ Done');
  pillTimer = setTimeout(hidePill, 2000);
}

// ── Explain execution ─────────────────────────────────────────────────────────
async function applyExplainCmd(length: string): Promise<void> {
  if (!savedSel?.text.trim()) return;
  let text = savedSel.text;
  if (text.length > 6000) text = text.slice(0, 6000);

  hideToolbar();
  showPill(document.documentElement, '✏ Explaining…');

  const response = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
    chrome.runtime.sendMessage({ action: 'jae_explain', text, length }, (res) => {
      if (chrome.runtime.lastError) resolve({ ok: false, error: 'extension_error' });
      else resolve(res || { ok: false, error: 'no_response' });
    });
  });

  hidePill();

  if (!response?.ok) {
    showPill(document.documentElement,
      response?.error === 'no_key' ? '✕ No API key — open Settings' : `✕ ${response?.error || 'Error'}`,
      true
    );
    pillTimer = setTimeout(hidePill, 4000);
  }
  // Result is delivered to the sidebar by the background→top-frame relay
}

// ── checkSelection — the unified selection reader ─────────────────────────────
// BRANCH 1 (checked first): TEXTAREA / INPUT
//   Selection lives in selectionStart/selectionEnd, NOT in the DOM Range tree.
//   window.getSelection() for a textarea returns a range whose
//   commonAncestorContainer is the surrounding container DIV, not the textarea.
// BRANCH 2: contentEditable / read-only text
//   Selection lives in window.getSelection() → getRangeAt(0).
function checkSelection(): void {
  // ── TEMPORARY DIAGNOSTIC PROBE — remove after diagnosis ──────────────────
  const _s = window.getSelection();
  const _n = _s && _s.rangeCount ? _s.getRangeAt(0).commonAncestorContainer : null;
  const _el = _n && _n.nodeType === 1 ? _n as HTMLElement : (_n as ChildNode | null)?.parentElement as HTMLElement | undefined;
  console.log('[JAE probe]',
    'selText:', JSON.stringify(_s?.toString().slice(0, 20)),
    'anchorTag:', _el?.tagName,
    'contenteditable-attr:', _el?.getAttribute?.('contenteditable'),
    'isContentEditable:', _el?.isContentEditable,
    'activeEl:', document.activeElement?.tagName,
    'activeEl-type:', document.activeElement?.getAttribute?.('type'),
    'inIframe:', window.top !== window.self,
    'closest-editable:', _el?.closest?.('input,textarea,[contenteditable]')?.tagName
  );
  // ─────────────────────────────────────────────────────────────────────────

  // ── BRANCH 1: TEXTAREA / INPUT ──────────────────────────────────────────
  const active = document.activeElement;
  if (
    (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement) &&
    !active.readOnly &&
    !active.disabled &&
    active.selectionStart != null &&
    (active.selectionEnd ?? 0) > (active.selectionStart ?? 0)
  ) {
    const selText = active.value
      .substring(active.selectionStart!, active.selectionEnd!)
      .trim();
    if (selText) {
      savedSel = {
        editableEl: active,
        text:       selText,
        selStart:   active.selectionStart!,
        selEnd:     active.selectionEnd!,
      };
      // Anchor the toolbar to the field's bounding rect (top-left of field),
      // mirroring the reference's form-control positioning.
      showToolbar(active, active.getBoundingClientRect());
      return;
    }
  }

  // ── BRANCH 2: contentEditable / read-only ───────────────────────────────
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.toString().trim()) return;
  const range   = sel.getRangeAt(0);
  const selRect = range.getBoundingClientRect();
  if (!selRect.width && !selRect.height) return;

  const editTarget = getEditableTarget();
  const selText2   = sel.toString();

  if (editTarget?.isContentEditable) {
    savedSel = { editableEl: editTarget, text: selText2, range: range.cloneRange() };
  } else {
    savedSel = { editableEl: null, text: selText2 };
  }

  console.log(
    '[JAE toolbar] getEditableTarget:', editTarget,
    ' tagName:', editTarget?.tagName,
    ' isContentEditable:', editTarget?.isContentEditable,
    ' hasFormat:', !!editTarget
  );

  showToolbar(editTarget, selRect);
}

// ── Document event handlers ───────────────────────────────────────────────────
function onMouseUp(e: MouseEvent): void {
  const target = e.target as Element | null;
  if (target?.closest('#__jae-toolbar,#__jae-dropdown,#__jae-pill')) return;
  setTimeout(checkSelection, 10);
}

function onKeyUp(e: KeyboardEvent): void {
  if ((e.key === 'a' || e.key === 'A') && (e.metaKey || e.ctrlKey)) {
    setTimeout(checkSelection, 10);
  }
}

function onMouseDown(e: MouseEvent): void {
  const target = e.target as Element | null;
  if (target?.closest('#__jae-toolbar,#__jae-dropdown')) return;
  hideToolbar();
}

function onScroll(): void {
  hideToolbar();
}

function onContextMenu(): void {
  // Cache selection at right-click time — still valid at contextmenu fire.
  // Check activeElement first so textareas use selectionStart/selectionEnd.
  const active = document.activeElement;
  if (
    (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement) &&
    !active.readOnly && !active.disabled
  ) {
    cacheSelection(active as HTMLElement);
    return;
  }
  cacheSelection(getEditableTarget());
}

// ── Active-job label helpers ──────────────────────────────────────────────────
const JD_HISTORY_KEY = 'jae_jd_history';
const JD_ACTIVE_KEY  = 'jae_active_jd_id';

let jdHistoryCache: Array<{ id: string; jobTitle: string; company: string }> = [];
let activeJdIdCache: string | null = null;

function refreshJobLabel(): void {
  const entry = activeJdIdCache
    ? jdHistoryCache.find(e => e.id === activeJdIdCache)
    : null;
  if (!entry) { activeJobLabel = ''; return; }
  if (entry.jobTitle && entry.company) { activeJobLabel = `${entry.jobTitle} — ${entry.company}`; return; }
  if (entry.jobTitle) { activeJobLabel = entry.jobTitle; return; }
  if (entry.company)  { activeJobLabel = entry.company;  return; }
  activeJobLabel = 'current job';
}

// ── Init (called once from content.ts) ───────────────────────────────────────
export function initSelectionToolbar(writer: FieldWriter): void {
  if (window.__jaeToolbarLoaded) return;
  window.__jaeToolbarLoaded = true;
  writeField = writer;

  // Load active JD label for the +JD capture button
  chrome.storage.local.get([JD_HISTORY_KEY], r => {
    jdHistoryCache = (r[JD_HISTORY_KEY] as typeof jdHistoryCache) || [];
    try {
      chrome.storage.session.get([JD_ACTIVE_KEY], r2 => {
        activeJdIdCache = r2[JD_ACTIVE_KEY] || null;
        refreshJobLabel();
      });
    } catch { refreshJobLabel(); }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[JD_HISTORY_KEY]) {
      jdHistoryCache = changes[JD_HISTORY_KEY].newValue || [];
      refreshJobLabel();
    }
    if (area === 'session' && changes[JD_ACTIVE_KEY]) {
      activeJdIdCache = changes[JD_ACTIVE_KEY].newValue || null;
      refreshJobLabel();
    }
  });

  document.addEventListener('mouseup',     onMouseUp);
  document.addEventListener('keyup',       onKeyUp);
  document.addEventListener('mousedown',   onMouseDown);
  document.addEventListener('contextmenu', onContextMenu);
  document.addEventListener('scroll',      onScroll, { capture: true, passive: true });
}

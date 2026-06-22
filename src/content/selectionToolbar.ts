// Selection Toolbar — injected into every page via the existing content script.
// Shows a floating Copy button (always) + Format ▾ dropdown (editable selections only).
// All styles are inline to survive hostile host-page CSS.

declare global {
  interface Window { __jaeToolbarLoaded?: boolean }
}

// Caller passes in the single shared writer so there is no circular import.
export type FieldWriterOpts = { range?: Range; selectionStart?: number; selectionEnd?: number };
export type FieldWriter = (el: HTMLElement, val: string, opts?: FieldWriterOpts) => void;

// ── Inline style constants ────────────────────────────────────────────────────
const S = {
  surface:  '#1c1c1e',
  text:     '#f2f2f7',
  muted:    '#8e8e93',
  hairline: 'rgba(255,255,255,0.08)',
  accent:   '#1a73e8',
  font:     '-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif',
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

// ── Module state ──────────────────────────────────────────────────────────────
let toolbarEl:  HTMLElement | null = null;
let dropdownEl: HTMLElement | null = null;
let pillEl:     HTMLElement | null = null;
let pillTimer:  ReturnType<typeof setTimeout> | null = null;
let writeField: FieldWriter | null = null;

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
    `color:${S.text}`,
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
function makeBtn(label: string, isAccent = false): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.textContent = label;
  btn.style.cssText = [
    'all:unset',
    `color:${isAccent ? S.accent : S.text}`,
    `font-family:${S.font}`,
    'font-size:13px',
    `font-weight:${isAccent ? '500' : '400'}`,
    'padding:4px 10px',
    'cursor:pointer',
    'border-radius:6px',
    'line-height:1.4',
    'white-space:nowrap',
    'display:inline-block',
  ].join(';');
  btn.addEventListener('mouseenter', () => { btn.style.background = S.hairline; });
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
      `color:${S.text}`,
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
    `border:1px solid ${S.hairline}`,
    'border-radius:10px',
    'padding:3px 4px',
    'display:flex',
    'align-items:center',
    'gap:2px',
    'z-index:2147483646',
    'box-shadow:0 4px 16px rgba(0,0,0,.55)',
    'user-select:none',
    '-webkit-user-select:none',
  ].join(';');

  // ── Copy button (always shown)
  const copyBtn = makeBtn('Copy');
  copyBtn.addEventListener('mousedown', e => e.preventDefault());
  copyBtn.addEventListener('click', () => {
    const text = savedSel?.text || '';
    navigator.clipboard.writeText(text).then(() => {
      copyBtn.textContent = '✓ Copied';
      setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1400);
    }).catch(() => {
      copyBtn.textContent = '✕ Failed';
      setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1400);
    });
  });
  tb.appendChild(copyBtn);

  // ── Format ▾ (only for editable selections)
  if (editableEl) {
    const divider = document.createElement('div');
    divider.style.cssText = `width:1px;height:16px;background:${S.hairline};flex-shrink:0;`;
    tb.appendChild(divider);

    const fmtBtn = makeBtn('Format ▾', true);
    fmtBtn.id = '__jae-format-btn';
    fmtBtn.addEventListener('mousedown', e => e.preventDefault());
    fmtBtn.addEventListener('click', e => {
      e.stopPropagation();
      showDropdown(fmtBtn, editableEl);
    });
    tb.appendChild(fmtBtn);
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

// ── Init (called once from content.ts) ───────────────────────────────────────
export function initSelectionToolbar(writer: FieldWriter): void {
  if (window.__jaeToolbarLoaded) return;
  window.__jaeToolbarLoaded = true;
  writeField = writer;

  document.addEventListener('mouseup',     onMouseUp);
  document.addEventListener('keyup',       onKeyUp);
  document.addEventListener('mousedown',   onMouseDown);
  document.addEventListener('contextmenu', onContextMenu);
  document.addEventListener('scroll',      onScroll, { capture: true, passive: true });
}

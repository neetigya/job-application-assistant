// Field fix overlay — on-page icon + popup for AI-written text/textarea answers.
// Injected into every page via the existing content script (mirrors selectionToolbar.ts:
// inline styles appended to document.documentElement so it survives hostile host-page CSS
// and works inside iframed ATS forms).

import { logger } from '../utils/logger';

export interface AiFieldMeta {
  label:          string;
  richHint:       string;
  hint:           string;
  resumeContent:  string;
  jobDescription: string;
  companyName:    string;
}

export type FieldStatus = 'filled' | 'unconfirmed';
export type RewriteSource = 'regenerate' | 'custom';

export type FieldWriter = (el: HTMLElement, val: string) => void;

export type Requester = (params: {
  fieldLabel:     string;
  fieldHint:      string;
  resumeContent:  string;
  jobDescription: string;
  companyName:    string;
}) => Promise<{ answer: string; questionType: string; confidence: number } | null>;

export type OnRewritten = (id: number, value: string, status: FieldStatus, source: RewriteSource) => void;

type TextEl = HTMLInputElement | HTMLTextAreaElement;

interface FieldEntry {
  el:     TextEl;
  meta:   AiFieldMeta;
  status: FieldStatus;
  value:  string;
}

// ── Inline style constants (matches selectionToolbar.ts) ─────────────────────
const S = {
  surface: '#202124',
  hairline: 'rgba(255,255,255,0.12)',
  hover: 'rgba(255,255,255,0.08)',
  neutral: '#e8eaed',
  workspace: '#8ab4f8',
  warning: '#e0a531',
  shadow: '0 4px 16px rgba(0,0,0,0.28)',
  font: '-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif',
} as const;

// ── Module state ──────────────────────────────────────────────────────────────
const registry = new Map<number, FieldEntry>();
const elToId = new WeakMap<HTMLElement, number>();
let nextId = 1;

let writeField: FieldWriter | null = null;
let requestAnswer: Requester | null = null;
let onRewritten: OnRewritten | null = null;

let iconEl: HTMLElement | null = null;
let popupEl: HTMLElement | null = null;
let currentIconId: number | null = null;
let popupOpen = false;
let blurTimer: ReturnType<typeof setTimeout> | null = null;

// ── verifyFieldWrite — the one read-back primitive, used both by content.ts's
// initial AI write and internally here for regenerate/custom writes ──────────
export function verifyFieldWrite(el: TextEl, expectedValue: string, delayMs = 500): Promise<boolean> {
  return new Promise(resolve => {
    setTimeout(() => {
      resolve(el.value.trim() === expectedValue.trim());
    }, delayMs);
  });
}

// ── Registry ──────────────────────────────────────────────────────────────────
export function registerAiField(el: TextEl, meta: AiFieldMeta, value: string, status: FieldStatus): number {
  const id = nextId++;
  registry.set(id, { el, meta, status, value });
  elToId.set(el, id);
  logger.debug(`[fieldFixOverlay] registered field #${id} "${meta.label.slice(0, 40)}"`, el);
  return id;
}

export function updateFieldStatus(id: number, status: FieldStatus, value?: string): void {
  const entry = registry.get(id);
  if (!entry) return;
  entry.status = status;
  if (value !== undefined) entry.value = value;
  if (currentIconId === id) applyIconAppearance(status);
  if (popupOpen && currentIconId === id) renderPopupBody(id);
}

// ── Icon ──────────────────────────────────────────────────────────────────────
function buildIcon(): HTMLElement {
  const btn = document.createElement('div');
  btn.id = '__jae-fix-icon';
  btn.style.cssText = [
    'position:fixed',
    'width:22px', 'height:22px',
    'border-radius:50%',
    `background:${S.surface}`,
    `border:1px solid ${S.hairline}`,
    'display:none',
    'align-items:center',
    'justify-content:center',
    'font-size:12px',
    'cursor:pointer',
    'z-index:2147483646',
    `box-shadow:${S.shadow}`,
    'user-select:none',
  ].join(';');
  btn.textContent = '✎';
  btn.addEventListener('mousedown', e => e.preventDefault());
  btn.addEventListener('click', onIconClick);
  document.documentElement.appendChild(btn);
  return btn;
}

function applyIconAppearance(status: FieldStatus): void {
  if (!iconEl) return;
  iconEl.style.color = status === 'unconfirmed' ? S.warning : S.neutral;
  iconEl.style.borderColor = status === 'unconfirmed' ? S.warning : S.hairline;
}

function positionIcon(el: TextEl): void {
  if (!iconEl) return;
  const rect = el.getBoundingClientRect();
  const x = Math.min(window.innerWidth - 26, rect.right - 11);
  const y = Math.max(4, rect.top - 8);
  iconEl.style.left = `${x}px`;
  iconEl.style.top = `${y}px`;
}

function showIconFor(id: number, el: TextEl): void {
  currentIconId = id;
  if (!iconEl) iconEl = buildIcon();
  positionIcon(el);
  applyIconAppearance(registry.get(id)!.status);
  iconEl.style.display = 'flex';
}

function hideIcon(): void {
  if (popupOpen) return;
  if (iconEl) iconEl.style.display = 'none';
  currentIconId = null;
}

function onIconClick(e: MouseEvent): void {
  e.stopPropagation();
  if (popupOpen) { closePopup(); return; }
  if (currentIconId != null) openPopup(currentIconId);
}

// ── Popup ─────────────────────────────────────────────────────────────────────
function closePopup(): void {
  popupEl?.remove();
  popupEl = null;
  popupOpen = false;
}

function positionPopup(): void {
  if (!popupEl || !iconEl) return;
  const iconRect = iconEl.getBoundingClientRect();
  const w = popupEl.offsetWidth || 230;
  let x = iconRect.right - w;
  let y = iconRect.bottom + 6;
  x = Math.max(8, Math.min(x, window.innerWidth - w - 8));
  if (y + popupEl.offsetHeight > window.innerHeight - 8) {
    y = iconRect.top - (popupEl.offsetHeight || 140) - 6;
  }
  popupEl.style.left = `${x}px`;
  popupEl.style.top = `${y}px`;
}

function makePopupBtn(label: string, color: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.textContent = label;
  btn.style.cssText = [
    'all:unset', `color:${color}`, `font-family:${S.font}`, 'font-size:12.5px',
    'font-weight:500', 'padding:6px 10px', 'cursor:pointer', 'border-radius:6px',
    'display:block', 'width:100%', 'box-sizing:border-box', 'text-align:left',
  ].join(';');
  btn.addEventListener('mouseenter', () => { btn.style.background = S.hover; });
  btn.addEventListener('mouseleave', () => { btn.style.background = 'transparent'; });
  btn.addEventListener('mousedown', e => e.preventDefault());
  return btn;
}

function renderPopupBody(id: number): void {
  if (!popupEl) return;
  const entry = registry.get(id);
  if (!entry) return;
  popupEl.innerHTML = '';

  if (entry.status === 'unconfirmed') {
    const warn = document.createElement('div');
    warn.textContent = '⚠ This answer may not have saved';
    warn.style.cssText = [
      `color:${S.warning}`, `font-family:${S.font}`, 'font-size:11.5px',
      'padding:6px 10px 8px', 'line-height:1.4',
    ].join(';');
    popupEl.appendChild(warn);
  }

  const regenBtn = makePopupBtn('↻ Regenerate', S.workspace);
  regenBtn.addEventListener('click', () => void onRegenerate(id));
  popupEl.appendChild(regenBtn);

  const customBtn = makePopupBtn('✎ Write custom…', S.neutral);
  customBtn.addEventListener('click', () => showCustomEditor(id));
  popupEl.appendChild(customBtn);
}

function showCustomEditor(id: number): void {
  if (!popupEl) return;
  const entry = registry.get(id);
  if (!entry) return;
  popupEl.innerHTML = '';

  const ta = document.createElement('textarea');
  ta.value = entry.value;
  ta.style.cssText = [
    'width:100%', 'box-sizing:border-box', 'min-height:80px', 'resize:vertical',
    `background:${S.surface}`, `border:1px solid ${S.hairline}`, 'border-radius:6px',
    `color:${S.neutral}`, `font-family:${S.font}`, 'font-size:12.5px', 'padding:6px 8px',
    'margin:6px 0',
  ].join(';');
  ta.addEventListener('mousedown', e => e.stopPropagation());
  ta.addEventListener('click', e => e.stopPropagation());
  popupEl.appendChild(ta);

  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:4px;';

  const saveBtn = makePopupBtn('Save', S.workspace);
  saveBtn.style.width = 'auto';
  saveBtn.style.flex = '1';
  saveBtn.addEventListener('click', () => onWriteCustomSave(id, ta.value));

  const cancelBtn = makePopupBtn('Cancel', S.neutral);
  cancelBtn.style.width = 'auto';
  cancelBtn.style.flex = '1';
  cancelBtn.addEventListener('click', () => renderPopupBody(id));

  row.appendChild(saveBtn);
  row.appendChild(cancelBtn);
  popupEl.appendChild(row);
  ta.focus();
}

function openPopup(id: number): void {
  const entry = registry.get(id);
  if (!entry) return;
  closePopup();
  popupOpen = true;

  const p = document.createElement('div');
  p.id = '__jae-fix-popup';
  p.style.cssText = [
    'position:fixed', 'left:0', 'top:0', 'width:230px',
    `background:${S.surface}`, `border:1px solid ${S.hairline}`, 'border-radius:10px',
    'padding:4px', 'z-index:2147483647', `box-shadow:${S.shadow}`,
  ].join(';');
  p.addEventListener('mousedown', e => e.stopPropagation());

  document.documentElement.appendChild(p);
  popupEl = p;
  renderPopupBody(id);
  positionPopup();
}

// ── Regenerate / custom write handlers ────────────────────────────────────────
function setPopupNote(text: string, color: string): void {
  if (!popupEl) return;
  const note = document.createElement('div');
  note.textContent = text;
  note.style.cssText = [`color:${color}`, `font-family:${S.font}`, 'font-size:11.5px', 'padding:4px 10px 6px'].join(';');
  popupEl.appendChild(note);
}

async function onRegenerate(id: number): Promise<void> {
  const entry = registry.get(id);
  if (!entry || !requestAnswer || !writeField) return;

  if (popupEl) {
    popupEl.innerHTML = '';
    setPopupNote('Thinking…', S.workspace);
  }

  const res = await requestAnswer({
    fieldLabel:     entry.meta.richHint.slice(0, 200),
    fieldHint:      entry.meta.hint,
    resumeContent:  entry.meta.resumeContent,
    jobDescription: entry.meta.jobDescription,
    companyName:    entry.meta.companyName,
  });

  if (!res?.answer) {
    renderPopupBody(id);
    if (popupEl) setPopupNote('✕ No answer generated', S.warning);
    return;
  }

  writeField(entry.el, res.answer);
  entry.value = res.answer;
  entry.status = 'filled';
  renderPopupBody(id);
  applyIconAppearance('filled');
  onRewritten?.(id, res.answer, 'filled', 'regenerate');

  const ok = await verifyFieldWrite(entry.el, res.answer);
  if (!ok) {
    entry.status = 'unconfirmed';
    applyIconAppearance('unconfirmed');
    if (popupOpen && currentIconId === id) renderPopupBody(id);
    onRewritten?.(id, res.answer, 'unconfirmed', 'regenerate');
  }
}

function onWriteCustomSave(id: number, text: string): void {
  const entry = registry.get(id);
  if (!entry || !writeField) return;
  const trimmed = text.trim();
  if (!trimmed) return;

  writeField(entry.el, trimmed);
  entry.value = trimmed;
  entry.status = 'filled';
  renderPopupBody(id);
  applyIconAppearance('filled');
  onRewritten?.(id, trimmed, 'filled', 'custom');

  verifyFieldWrite(entry.el, trimmed).then(ok => {
    if (!ok) {
      entry.status = 'unconfirmed';
      applyIconAppearance('unconfirmed');
      if (popupOpen && currentIconId === id) renderPopupBody(id);
      onRewritten?.(id, trimmed, 'unconfirmed', 'custom');
    }
  });
}

// ── Document-level listeners ──────────────────────────────────────────────────
function onFocusIn(e: FocusEvent): void {
  if (blurTimer) { clearTimeout(blurTimer); blurTimer = null; }
  // Use composedPath()[0] rather than e.target — if the field lives inside a
  // shadow root, e.target gets retargeted to the shadow host and would never
  // match the WeakMap key we registered (the actual inner input/textarea).
  const path = e.composedPath();
  const target = (path[0] as HTMLElement) || (e.target as HTMLElement);
  const id = elToId.get(target);
  if (id == null) {
    logger.debug('[fieldFixOverlay] focusin on unregistered element', target);
    if (!popupOpen) hideIcon();
    return;
  }
  showIconFor(id, target as TextEl);
}

function onFocusOut(): void {
  blurTimer = setTimeout(() => { if (!popupOpen) hideIcon(); }, 150);
}

function onDocMouseDown(e: MouseEvent): void {
  const target = e.target as Element | null;
  if (target?.closest('#__jae-fix-icon,#__jae-fix-popup')) return;
  closePopup();
}

function onDocKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Escape') closePopup();
}

// Reposition (don't hide) on scroll — focusing a field very often triggers the
// browser's own scroll-into-view, which fires a scroll event right after focusin.
// Hiding here would make the icon flash and disappear the instant a field is focused.
function onScroll(): void {
  if (currentIconId != null && iconEl && iconEl.style.display !== 'none') {
    const entry = registry.get(currentIconId);
    if (entry) positionIcon(entry.el);
  }
  if (popupOpen) positionPopup();
}

// ── Init (called once from content.ts) ───────────────────────────────────────
declare global {
  interface Window { __jaeFieldFixLoaded?: boolean }
}

export function initFieldFixOverlay(writer: FieldWriter, requester: Requester, rewriteCb: OnRewritten): void {
  if (window.__jaeFieldFixLoaded) return;
  window.__jaeFieldFixLoaded = true;

  writeField = writer;
  requestAnswer = requester;
  onRewritten = rewriteCb;

  document.addEventListener('focusin', onFocusIn);
  document.addEventListener('focusout', onFocusOut);
  document.addEventListener('mousedown', onDocMouseDown);
  document.addEventListener('keydown', onDocKeyDown);
  document.addEventListener('scroll', onScroll, { capture: true, passive: true });
}

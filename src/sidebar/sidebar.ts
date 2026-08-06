// Sidebar page — runs inside the injected iframe.
// All Claude API calls go via postMessage to the content script → background.
// Never calls the Claude API directly.

const MSG_DOWN = 'JAE_SIDEBAR';
const MSG_UP   = 'JAE_SIDEBAR_REQ';

interface JDEntry {
  id:             string;
  jobTitle:       string;
  company:        string;
  jobDescription: string;
  sourceUrl:      string | null;
  addedAt:        number;
}

// ── State ─────────────────────────────────────────────────────────────────────
let jdHistory: JDEntry[]      = [];
let activeJdId: string | null = null;
let hasResume  = false;
let resumeText = '';
let currentPageUrl = '';
let reqCounter = 0;
let pendingReqId: number | null = null;

function getActiveEntry(): JDEntry | null {
  return activeJdId ? (jdHistory.find(e => e.id === activeJdId) ?? null) : null;
}

function jdEntryLabel(e: JDEntry): string {
  if (e.jobTitle && e.company) return `${e.jobTitle} — ${e.company}`;
  if (e.jobTitle) return e.jobTitle;
  if (e.company)  return e.company;
  if (e.sourceUrl) {
    try { return new URL(e.sourceUrl).hostname; } catch {}
  }
  return 'Untitled';
}

// ── Resume formatter (mirrors popup.ts; sidebar is self-contained) ────────────
function formatResume(resume: any): string {
  if (!resume?.personal) return '';
  const lines: string[] = [];
  const p = resume.personal;
  const name = p.preferredName
    ? `${p.firstName} "${p.preferredName}" ${p.lastName}`
    : `${p.firstName} ${p.lastName}`;
  lines.push('=== PERSONAL INFORMATION ===');
  lines.push(`Name: ${name}`, `Email: ${p.email}`, `Phone: ${p.phone}`);
  const loc = typeof p.location === 'object'
    ? [p.location.city, p.location.state, p.location.country].filter(Boolean).join(', ')
    : (p.location || '');
  if (loc) lines.push(`Location: ${loc}`);
  lines.push('');
  if (resume.workHistory?.length) {
    lines.push('=== WORK HISTORY ===');
    for (const j of resume.workHistory) {
      const period = j.isPresent ? `${j.startDate} – Present` : `${j.startDate} – ${j.endDate}`;
      lines.push(`${j.jobTitle} at ${j.company} (${period})`);
      if (j.description)  lines.push(`  ${j.description}`);
      if (j.achievements) lines.push(`  ${j.achievements}`);
    }
    lines.push('');
  }
  if (resume.projects?.length) {
    lines.push('=== PROJECTS ===');
    for (const pr of resume.projects) {
      const period = pr.isPresent
        ? `${pr.startDate} – Present`
        : `${pr.startDate}${pr.endDate ? ' – ' + pr.endDate : ''}`;
      lines.push(`${pr.name} (${period})`);
      if (pr.description) lines.push(`  ${pr.description}`);
      if (pr.techStack)   lines.push(`  Tech: ${pr.techStack}`);
      if (pr.url)         lines.push(`  ${pr.url}`);
    }
    lines.push('');
  }
  if (resume.education?.length) {
    lines.push('=== EDUCATION ===');
    for (const e of resume.education) {
      const df = [e.degree, e.fieldOfStudy].filter(Boolean).join(' in ');
      lines.push(`${e.school}${df ? ' — ' + df : ''} (${e.graduationDate})`);
    }
    lines.push('');
  }
  const s = resume.skills || {};
  const sp: string[] = [];
  if (s.backend)   sp.push(`Backend: ${s.backend}`);
  if (s.frontend)  sp.push(`Frontend: ${s.frontend}`);
  if (s.databases) sp.push(`Databases: ${s.databases}`);
  if (s.devops)    sp.push(`DevOps: ${s.devops}`);
  if (s.other)     sp.push(`Other: ${s.other}`);
  if (sp.length)   { lines.push('=== SKILLS ===', ...sp, ''); }
  if (resume.profileSummary) { lines.push('=== SUMMARY ===', resume.profileSummary, ''); }
  return lines.join('\n');
}

// ── Text post-processor ───────────────────────────────────────────────────────
function cleanGeneratedText(raw: string): string {
  let text = raw.replace(/^(#{1,6}\s[^\n]*\n+)+/, '');
  text = text.replace(/[—–]/g, ', ');
  return text.trim();
}

// ── DOM helper ────────────────────────────────────────────────────────────────
const $ = (id: string) => document.getElementById(id)!;

// ── postMessage to parent (content script) ───────────────────────────────────
function sendUp(action: string, data?: unknown, reqId?: number): void {
  window.parent.postMessage({ type: MSG_UP, action, data, reqId }, '*');
}

// ── API request via content → background ─────────────────────────────────────
function apiRequest(action: string, data: Record<string, unknown>): Promise<any> {
  return new Promise(resolve => {
    const id = ++reqCounter;
    const handler = (e: MessageEvent) => {
      if (e.data?.type === MSG_DOWN && e.data.action === 'response' && e.data.reqId === id) {
        window.removeEventListener('message', handler);
        resolve(e.data.data);
      }
    };
    window.addEventListener('message', handler);
    sendUp(action, data, id);
    setTimeout(() => { window.removeEventListener('message', handler); resolve(null); }, 60_000);
  });
}

// ── UI helpers ────────────────────────────────────────────────────────────────

function updateContextIndicator(): void {
  const el = $('context-indicator');
  const active = getActiveEntry();
  if (!hasResume) {
    el.textContent = 'No resume saved — open Settings to add one';
    el.className = 'warn';
  } else if (active) {
    const label = active.jobTitle || active.company || 'job description';
    el.textContent = `Using: resume + ${label}`;
    el.className = '';
  } else {
    el.textContent = 'No active job — answers will use resume only';
    el.className = '';
  }
  ($('generate-answer-btn') as HTMLButtonElement).disabled = !hasResume;
  ($('cover-letter-btn')    as HTMLButtonElement).disabled = !hasResume;
}

function renderJDList(): void {
  const listEl     = $('jd-list');
  const actionBtns = $('jd-action-btns');
  const active     = getActiveEntry();

  listEl.innerHTML = '';

  if (jdHistory.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'jd-empty';
    empty.textContent = 'No JDs saved yet. Select text on a job page and click + JD.';
    listEl.appendChild(empty);
    actionBtns.classList.add('hidden');
    updateContextIndicator();
    return;
  }

  actionBtns.classList.toggle('hidden', !active);

  jdHistory.forEach(entry => {
    const isActive = entry.id === activeJdId;
    const item = document.createElement('div');
    item.className = 'jd-item' + (isActive ? ' active' : '');
    item.title = entry.jobDescription;

    const top = document.createElement('div');
    top.className = 'jd-item-top';

    const label = document.createElement('span');
    label.className = 'jd-item-label';
    label.textContent = jdEntryLabel(entry);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'jd-item-remove';
    removeBtn.textContent = '✕';
    removeBtn.title = 'Remove from history';
    removeBtn.addEventListener('click', ev => {
      ev.stopPropagation();
      sendUp('removeJd', { id: entry.id });
    });

    top.appendChild(label);
    top.appendChild(removeBtn);

    const preview = document.createElement('div');
    preview.className = 'jd-item-preview';
    const previewText = entry.jobDescription.slice(0, 90).replace(/\s+/g, ' ');
    preview.textContent = entry.jobDescription.length > 90 ? previewText + '…' : previewText;

    item.appendChild(top);
    item.appendChild(preview);

    if (!isActive) {
      item.addEventListener('click', () => sendUp('selectJd', { id: entry.id }));
    } else {
      // active item: clicking again deselects
      item.addEventListener('click', () => sendUp('deselectJd'));
    }

    listEl.appendChild(item);
  });

  // Update header subtitle when a job is active
  updateHeaderSubtitle();
  updateContextIndicator();
}

function updateHeaderSubtitle(): void {
  const active = getActiveEntry();
  const subtitle = $('header-subtitle');
  if (active && (active.jobTitle || active.company)) {
    subtitle.textContent = [active.company, active.jobTitle].filter(Boolean).join(' · ');
    subtitle.classList.remove('hidden');
  } else {
    subtitle.classList.add('hidden');
  }
}

function showResult(text: string): void {
  const clean = cleanGeneratedText(text);
  const sec  = $('result-section');
  const area = $('result-area');
  area.textContent = clean;
  sec.classList.remove('hidden');
  sec.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  copyToClipboard(clean);
}

function showExplainResult(text: string): void {
  const clean = cleanGeneratedText(text);
  const sec  = $('explain-section');
  const area = $('explain-area');
  area.textContent = clean;
  sec.classList.remove('hidden');
  sec.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function copyToClipboard(text: string): Promise<void> {
  return navigator.clipboard.writeText(text).catch(() => {});
}

function flashBtn(btn: HTMLButtonElement, msg: string, ms = 1400): void {
  const orig = btn.textContent || '';
  btn.textContent = msg;
  setTimeout(() => { btn.textContent = orig; }, ms);
}

function errorHtml(status: number | string): string {
  if (status === 401 || String(status).includes('401')) return 'Invalid API key — open Settings';
  if (status === 429 || String(status).includes('429')) return 'Rate limited — try again in a moment';
  if (String(status).includes('network'))               return 'Network error — check your connection';
  if (String(status).includes('no_key'))                return 'No API key — open Settings';
  return `Error: ${status}`;
}

// ── Match card ────────────────────────────────────────────────────────────────

let matchAnalysisText = '';

function showMatchCard(pct: number, label: string, reason: string, analysisText: string): void {
  matchAnalysisText = analysisText;

  // Progress ring: circumference for r=16 is ~100.5
  const circumference = 100.53; // 2 * pi * 16
  const offset = circumference - (pct / 100) * circumference;
  const ringFill = $('match-ring-fill');
  ringFill.setAttribute('stroke-dashoffset', String(offset));

  $('match-pct-label').textContent = `${pct}%`;

  const labelEl = $('match-label');
  labelEl.textContent = label || `${pct}% match`;
  labelEl.classList.remove('match-placeholder');

  const reasonEl = $('match-reason');
  reasonEl.textContent = reason || '';
  reasonEl.classList.toggle('hidden', !reason);

  const detailsBtn = $('match-details-btn');
  if (analysisText) {
    detailsBtn.classList.remove('hidden');
  } else {
    detailsBtn.classList.add('hidden');
  }
}

function initMatchCard(): void {
  let expanded = false;
  $('match-details-btn').addEventListener('click', () => {
    const panel = $('match-analysis-expanded');
    expanded = !expanded;
    if (expanded) {
      panel.textContent = matchAnalysisText;
      panel.classList.remove('hidden');
      ($('match-details-btn') as HTMLButtonElement).textContent = 'Hide';
    } else {
      panel.classList.add('hidden');
      ($('match-details-btn') as HTMLButtonElement).textContent = 'Details';
    }
  });
}

// ── Generate ──────────────────────────────────────────────────────────────────
async function runGenerate(type: 'answer' | 'coverLetter'): Promise<void> {
  if (!hasResume) return;

  const myReqId = ++reqCounter;
  pendingReqId = myReqId;

  const active     = getActiveEntry();
  const question   = ($('question-input') as HTMLTextAreaElement).value.trim();
  const resultArea = $('result-area');
  const resultSec  = $('result-section');

  resultSec.classList.remove('hidden');
  resultArea.innerHTML = '<span class="loading-text">Generating…</span>';

  let response: any;
  if (type === 'answer') {
    response = await apiRequest('generateAnswer', {
      fieldLabel:     question || 'General answer',
      fieldHint:      '',
      resumeContent:  resumeText,
      jobDescription: active?.jobDescription || '',
      companyName:    active?.company || '',
    });
  } else {
    response = await apiRequest('generateCoverLetter', {
      resumeContent:  resumeText,
      jobDescription: active?.jobDescription || '',
      companyName:    active?.company || '',
      jobTitle:       active?.jobTitle || '',
      question:       question || '',
    });
  }

  if (pendingReqId !== myReqId) return; // superseded
  pendingReqId = null;

  if (!response) {
    resultArea.textContent = 'No response — check your API key';
    return;
  }

  const rawText: string = type === 'answer'
    ? (response.answer || '')
    : (response.coverLetter || '');

  if (!rawText) {
    resultArea.textContent = response.error ? errorHtml(response.error) : 'Empty response';
    return;
  }

  showResult(rawText);
}

// ── Tab switching ─────────────────────────────────────────────────────────────

function switchTab(tab: 'workspace' | 'fields'): void {
  (['workspace', 'fields'] as const).forEach(t => {
    document.getElementById(`tab-btn-${t}`)!.classList.toggle('active', t === tab);
    const panel = document.getElementById(`panel-${t}`)!;
    panel.style.display = t === tab ? 'flex' : 'none';
  });
}

// ── Fill progress (new grouped layout) ───────────────────────────────────────

interface FillFieldEntry {
  label: string;
  filled: boolean;
  value?: string;
  reason?: string;
  type?: string; // 'pdf' | 'field'
}

const allFillEntries: FillFieldEntry[] = [];
const thinkingEntries = new Map<string, HTMLElement>();

function esc(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function inferGroup(label: string): 'personal' | 'documents' | 'other' {
  const l = label.toLowerCase();
  if (/name|email|phone|city|state|country|address|location/.test(l)) return 'personal';
  if (/pdf|resume|cv|upload|file/.test(l)) return 'documents';
  return 'other';
}

function checkmarkSvg(): string {
  return `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
}

function renderFillComplete(filledCount: number, totalCount: number): void {
  const feed = $('fill-feed');
  feed.innerHTML = '';

  // Progress bar
  const progressBar = $('fill-progress-bar');
  progressBar.classList.remove('hidden');
  ($('fill-count-num') as HTMLElement).textContent = String(filledCount);
  ($('fill-count-denom') as HTMLElement).textContent = `/${totalCount}`;
  const pct = totalCount > 0 ? Math.round((filledCount / totalCount) * 100) : 0;
  ($('fill-track-fill') as HTMLElement).style.width = `${pct}%`;

  // Partition entries
  const attention  = allFillEntries.filter(e => !e.filled && e.type !== 'pdf');
  const filledFields = allFillEntries.filter(e => e.filled && e.type !== 'pdf');
  const pdfEntries  = allFillEntries.filter(e => e.type === 'pdf');

  // Needs attention
  if (attention.length > 0) {
    const groupLabel = document.createElement('div');
    groupLabel.className = 'fill-group-label danger';
    groupLabel.textContent = 'Needs attention';
    feed.appendChild(groupLabel);

    attention.forEach(entry => {
      const item = document.createElement('div');
      item.className = 'fill-attention-item';
      const row = document.createElement('div');
      row.className = 'fill-attention-row';
      const name = document.createElement('span');
      name.className = 'fill-attention-name';
      name.textContent = entry.label;
      const action = document.createElement('span');
      action.className = 'fill-attention-action';
      action.textContent = 'Fill manually';
      row.appendChild(name);
      row.appendChild(action);
      item.appendChild(row);
      if (entry.reason) {
        const reason = document.createElement('div');
        reason.className = 'fill-attention-reason';
        reason.textContent = entry.reason;
        item.appendChild(reason);
      }
      feed.appendChild(item);
    });
  }

  // Filled — group by type
  const groups: Record<string, FillFieldEntry[]> = {
    personal:  filledFields.filter(e => inferGroup(e.label) === 'personal'),
    documents: [...pdfEntries, ...filledFields.filter(e => inferGroup(e.label) === 'documents')],
    other:     filledFields.filter(e => inferGroup(e.label) === 'other'),
  };

  const groupNames: Record<string, string> = {
    personal:  'Personal info',
    documents: 'Documents',
    other:     'Other fields',
  };

  for (const key of ['personal', 'documents', 'other'] as const) {
    const group = groups[key];
    if (!group.length) continue;

    const groupLabel = document.createElement('div');
    groupLabel.className = 'fill-group-label success';
    groupLabel.textContent = groupNames[key];
    feed.appendChild(groupLabel);

    const chipsWrap = document.createElement('div');
    chipsWrap.className = 'fill-chips-wrap';

    group.forEach(entry => {
      const chip = document.createElement('div');
      chip.className = 'fill-chip';
      const labelText = entry.type === 'pdf'
        ? 'Stored resume PDF attached (file-upload copy)'
        : entry.label;
      chip.innerHTML = checkmarkSvg() + `<span>${esc(labelText)}</span>`;
      chipsWrap.appendChild(chip);
    });

    feed.appendChild(chipsWrap);
  }
}

function appendFeedEntry(opts: { label: string; icon: string; cls: string; value?: string }): HTMLElement {
  const feed = $('fill-feed');
  const el   = document.createElement('div');
  el.className = `feed-entry ${opts.cls}`;
  el.dataset.label = opts.label;
  el.innerHTML =
    `<span class="feed-icon">${opts.icon}</span>` +
    `<span class="feed-label" title="${esc(opts.label)}">${esc(opts.label)}</span>` +
    (opts.value ? `<span class="feed-value" title="${esc(opts.value)}">${esc(opts.value)}</span>` : '');
  feed.appendChild(el);
  feed.scrollTop = feed.scrollHeight;
  return el;
}

function handleFillStart(): void {
  switchTab('fields');
  fillHasStarted = true;
  setFillEmptyState(false);
  thinkingEntries.clear();
  allFillEntries.length = 0;
  $('fill-feed').innerHTML = '';
  $('fill-progress-bar').classList.add('hidden');
  $('fill-feed-header').textContent = 'Filling form…';
}

function handleFillProgress(data: any): void {
  if (data.type === 'ai_thinking') {
    const el = appendFeedEntry({ label: data.label, icon: '↻', cls: 'fe-thinking', value: 'Generating…' });
    thinkingEntries.set(data.label, el);
    return;
  }
  if (data.type === 'field') {
    allFillEntries.push({ label: data.label, filled: data.filled, value: data.value, reason: data.reason, type: 'field' });

    const existing = thinkingEntries.get(data.label);
    if (existing) {
      thinkingEntries.delete(data.label);
      existing.className = `feed-entry ${data.filled ? 'fe-filled' : 'fe-failed'}`;
      existing.querySelector<HTMLElement>('.feed-icon')!.textContent = data.filled ? '✓' : '✗';
      const valEl = existing.querySelector<HTMLElement>('.feed-value');
      if (valEl && data.value) valEl.textContent = String(data.value).slice(0, 45);
    } else {
      appendFeedEntry({
        label: data.label,
        icon:  data.filled ? '✓' : '✗',
        cls:   data.filled ? 'fe-filled' : 'fe-failed',
        value: data.value ? String(data.value).slice(0, 45) : undefined,
      });
    }
    return;
  }
  if (data.type === 'pdf') {
    allFillEntries.push({ label: 'Resume PDF', filled: data.filled, type: 'pdf' });
    appendFeedEntry({ label: 'Resume PDF', icon: '📎', cls: 'fe-pdf',
      value: data.filled ? 'Attached' : 'No file field found' });
  }
}

function handleFillComplete(data: any): void {
  $('fill-feed-header').textContent = 'Fill complete';
  const filledCount = data.filledCount ?? 0;
  const totalCount  = data.totalCount  ?? allFillEntries.length;
  renderFillComplete(filledCount, totalCount);
}

// ── Fill empty state ──────────────────────────────────────────────────────────
let fillHasStarted = false;

function setFillEmptyState(empty: boolean): void {
  const emptyEl = $('fill-empty-state');
  const progressEl = $('fill-progress-bar');
  const feedEl = $('fill-feed');
  const headerEl = $('fill-feed-header');
  emptyEl.style.display    = empty ? '' : 'none';
  progressEl.style.display = empty ? 'none' : '';
  feedEl.style.display     = empty ? 'none' : '';
  headerEl.style.display   = empty ? 'none' : '';
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init(): Promise<void> {
  // Apply theme from storage
  chrome.storage.local.get(['jae_theme'], (res: any) => {
    document.documentElement.setAttribute('data-theme', res.jae_theme || 'light');
  });

  const stored = await new Promise<any>(resolve => {
    chrome.storage.local.get(['resume'], r => resolve(r.resume || null));
  });
  if (stored?.personal) {
    hasResume  = true;
    resumeText = formatResume(stored);
  }

  setFillEmptyState(true); // show empty state until a fill starts
  renderJDList();
  initMatchCard();

  $('close-btn').addEventListener('click', () => sendUp('hideSidebar'));
  $('settings-btn').addEventListener('click', () => chrome.runtime.openOptionsPage());

  // Fill this application button in empty state
  $('fill-empty-trigger-btn').addEventListener('click', () => {
    sendUp('triggerFill');
  });

  $('copy-jd-btn').addEventListener('click', () => {
    const active = getActiveEntry();
    if (!active) return;
    copyToClipboard(active.jobDescription);
    flashBtn($('copy-jd-btn') as HTMLButtonElement, 'Copied');
  });

  $('deselect-jd-btn').addEventListener('click', () => {
    sendUp('deselectJd');
  });

  $('generate-answer-btn').addEventListener('click', () => runGenerate('answer'));
  $('cover-letter-btn').addEventListener('click',    () => runGenerate('coverLetter'));

  $('copy-result-btn').addEventListener('click', () => {
    copyToClipboard($('result-area').textContent || '');
    flashBtn($('copy-result-btn') as HTMLButtonElement, 'Copied');
  });
  $('copy-explain-btn').addEventListener('click', () => {
    copyToClipboard($('explain-area').textContent || '');
    flashBtn($('copy-explain-btn') as HTMLButtonElement, 'Copied');
  });

  // Tab switching
  $('tab-btn-workspace').addEventListener('click', () => switchTab('workspace'));
  $('tab-btn-fields').addEventListener('click',   () => switchTab('fields'));

  sendUp('sidebarReady');
}

// ── Messages from host ────────────────────────────────────────────────────────
window.addEventListener('message', (e: MessageEvent) => {
  if (e.data?.type !== MSG_DOWN) return;
  const { action, data } = e.data as { action: string; data: any };

  if (action === 'init') {
    jdHistory      = data?.history    ?? [];
    activeJdId     = data?.activeJdId ?? null;
    currentPageUrl = data?.url        ?? '';
    renderJDList();
    return;
  }

  if (action === 'historyUpdated') {
    jdHistory  = data?.history    ?? [];
    activeJdId = data?.activeJdId ?? null;
    renderJDList();
    return;
  }

  if (action === 'setQuestion') {
    ($('question-input') as HTMLTextAreaElement).value = (data as any).text || '';
    $('question-input').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    ($('question-input') as HTMLTextAreaElement).focus();
    return;
  }

  if (action === 'fillStart')    { handleFillStart();        return; }
  if (action === 'fillProgress') { handleFillProgress(data);  return; }
  if (action === 'fillComplete') { handleFillComplete(data);  return; }

  if (action === 'response') {
    // Match analysis results come through the response handler in apiRequest.
    // But if the result contains a match percentage, update the match card.
    if (data && typeof data.percentage === 'number') {
      const label = data.percentage >= 80 ? 'Exceptional match'
                  : data.percentage >= 60 ? 'Strong match'
                  : data.percentage >= 40 ? 'Partial match'
                  : 'Weak match';
      const reason = data.analysis ? data.analysis.split('.')[0].trim() : '';
      showMatchCard(data.percentage, label, reason, data.analysis || '');
    }
    return;
  }

  if (action === 'showExplain') {
    const result = data as { ok: boolean; text?: string; error?: string };
    if (result.ok && result.text) {
      showExplainResult(result.text);
    } else {
      const sec  = $('explain-section');
      const area = $('explain-area');
      area.textContent = errorHtml(result.error || 'unknown');
      sec.classList.remove('hidden');
    }
    return;
  }
});

document.addEventListener('DOMContentLoaded', init);

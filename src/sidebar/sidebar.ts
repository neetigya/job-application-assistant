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
    el.textContent = '⚠ No resume saved — open Settings to add one';
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
    item.title = entry.jobDescription; // native browser tooltip = full JD on hover

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
    }

    listEl.appendChild(item);
  });

  updateContextIndicator();
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
  if (status === 401 || String(status).includes('401')) return '✕ Invalid API key — open Settings';
  if (status === 429 || String(status).includes('429')) return '✕ Rate limited — try again in a moment';
  if (String(status).includes('network'))               return '✕ Network error — check your connection';
  if (String(status).includes('no_key'))                return '✕ No API key — open Settings';
  return `✕ Error: ${status}`;
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
    resultArea.textContent = '✕ No response — check your API key';
    return;
  }

  const rawText: string = type === 'answer'
    ? (response.answer || '')
    : (response.coverLetter || '');

  if (!rawText) {
    resultArea.textContent = response.error ? errorHtml(response.error) : '✕ Empty response';
    return;
  }

  showResult(rawText);
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init(): Promise<void> {
  const stored = await new Promise<any>(resolve => {
    chrome.storage.local.get(['resume'], r => resolve(r.resume || null));
  });
  if (stored?.personal) {
    hasResume  = true;
    resumeText = formatResume(stored);
  }

  renderJDList();

  $('close-btn').addEventListener('click', () => sendUp('hideSidebar'));
  $('settings-btn').addEventListener('click', () => chrome.runtime.openOptionsPage());

  $('copy-jd-btn').addEventListener('click', () => {
    const active = getActiveEntry();
    if (!active) return;
    copyToClipboard(active.jobDescription);
    flashBtn($('copy-jd-btn') as HTMLButtonElement, 'Copied ✓');
  });

  $('deselect-jd-btn').addEventListener('click', () => {
    sendUp('deselectJd');
  });

  $('generate-answer-btn').addEventListener('click', () => runGenerate('answer'));
  $('cover-letter-btn').addEventListener('click',    () => runGenerate('coverLetter'));

  $('copy-result-btn').addEventListener('click', () => {
    copyToClipboard($('result-area').textContent || '');
    flashBtn($('copy-result-btn') as HTMLButtonElement, 'Copied ✓');
  });
  $('copy-explain-btn').addEventListener('click', () => {
    copyToClipboard($('explain-area').textContent || '');
    flashBtn($('copy-explain-btn') as HTMLButtonElement, 'Copied ✓');
  });

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

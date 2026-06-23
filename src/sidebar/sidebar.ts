// Sidebar page — runs inside the injected iframe.
// All Claude API calls go via postMessage to the content script → background.
// Never calls the Claude API directly.

const MSG_DOWN = 'JAE_SIDEBAR';
const MSG_UP   = 'JAE_SIDEBAR_REQ';

interface ActiveJob {
  jobDescription: string;
  jobTitle:       string;
  company:        string;
  sourceUrl:      string | null;
  questions:   Array<{ question: string; answer: string; ts: number }>;
  coverLetters: Array<{ text: string; ts: number }>;
}

function emptyJob(): ActiveJob {
  return { jobDescription: '', jobTitle: '', company: '', sourceUrl: null, questions: [], coverLetters: [] };
}

// ── State ─────────────────────────────────────────────────────────────────────
let activeJob: ActiveJob = emptyJob();
let hasResume  = false;
let resumeText = '';
let currentPageUrl = '';
let reqCounter = 0;
let pendingReqId: number | null = null;

// ── Formatting helper (mirrors popup.ts; keeps sidebar self-contained) ────────
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

// ── cleanGeneratedText ────────────────────────────────────────────────────────
// Shared post-processor for all three output types: answers, cover letters, explanations.
// 1. Strip any leading markdown header line(s) (lines starting with #) + trailing blank line.
// 2. Replace em-dash (—) and en-dash (–) with ", " as belt-and-suspenders on top of the prompt rule.
function cleanGeneratedText(raw: string): string {
  // Remove leading "# Heading\n" or "## Heading\n\n" blocks (one or more)
  let text = raw.replace(/^(#{1,6}\s[^\n]*\n+)+/, '');
  // Em-dash (U+2014) and en-dash (U+2013) → comma-space
  text = text.replace(/[—–]/g, ', ');
  return text.trim();
}

// ── DOM references ────────────────────────────────────────────────────────────
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
    // Timeout safety
    setTimeout(() => {
      window.removeEventListener('message', handler);
      resolve(null);
    }, 60_000);
  });
}

// ── UI helpers ────────────────────────────────────────────────────────────────
function jobLabel(): string {
  if (activeJob.jobTitle && activeJob.company) return `${activeJob.jobTitle} — ${activeJob.company}`;
  if (activeJob.jobTitle) return activeJob.jobTitle;
  if (activeJob.company)  return activeJob.company;
  if (activeJob.sourceUrl) {
    try { return new URL(activeJob.sourceUrl).hostname; } catch { return 'Untitled job'; }
  }
  return 'No job loaded';
}

function updateJobDisplay(): void {
  ($('job-title-display') as HTMLElement).textContent = jobLabel();
  const preview = activeJob.jobDescription.slice(0, 60).replace(/\s+/g, ' ');
  ($('job-preview') as HTMLElement).textContent = preview + (activeJob.jobDescription.length > 60 ? '…' : '');
  ($('jd-textarea') as HTMLTextAreaElement).value = activeJob.jobDescription;
  updateContextIndicator();
  checkStaleWarning();
}

function updateContextIndicator(): void {
  const el = $('context-indicator');
  if (!hasResume) {
    el.textContent = '⚠ No resume saved — open Settings to add one';
    el.className = 'warn';
  } else if (activeJob.jobDescription) {
    el.textContent = 'Using: resume + job description';
    el.className = '';
  } else {
    el.textContent = 'Using: resume only (no job description captured yet)';
    el.className = '';
  }
  const generateBtn = $('generate-answer-btn') as HTMLButtonElement;
  const clBtn       = $('cover-letter-btn')    as HTMLButtonElement;
  generateBtn.disabled = !hasResume;
  clBtn.disabled       = !hasResume;
}

function checkStaleWarning(): void {
  const warningEl = $('stale-warning');
  if (!activeJob.sourceUrl || !activeJob.jobDescription || !currentPageUrl) {
    warningEl.classList.add('hidden');
    return;
  }
  try {
    const captured  = new URL(activeJob.sourceUrl).hostname;
    const current   = new URL(currentPageUrl).hostname;
    if (captured !== current) {
      warningEl.classList.remove('hidden');
      ($('stale-msg') as HTMLElement).textContent =
        `JD captured from ${captured}. You are on ${current}.`;
    } else {
      warningEl.classList.add('hidden');
    }
  } catch {
    warningEl.classList.add('hidden');
  }
}

function showResult(text: string): void {
  const clean = cleanGeneratedText(text);
  const sec = $('result-section');
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

  const question = ($('question-input') as HTMLTextAreaElement).value.trim();
  const resultArea = $('result-area');
  const resultSec  = $('result-section');

  resultSec.classList.remove('hidden');
  resultArea.innerHTML = '<span class="loading-text">Generating…</span>';

  let response: any;
  if (type === 'answer') {
    response = await apiRequest('generateAnswer', {
      fieldLabel:    question || 'General answer',
      fieldHint:     '',
      resumeContent: resumeText,
      jobDescription: activeJob.jobDescription,
      companyName:   activeJob.company,
    });
  } else {
    response = await apiRequest('generateCoverLetter', {
      resumeContent: resumeText,
      jobDescription: activeJob.jobDescription,
      companyName:   activeJob.company,
      jobTitle:      activeJob.jobTitle,
      question:      question || '',
    });
  }

  if (pendingReqId !== myReqId) return; // superseded by newer request
  pendingReqId = null;

  if (!response) {
    resultArea.textContent = '✕ No response — check your API key';
    return;
  }

  const rawText: string = type === 'answer'
    ? (response.answer || '')
    : (response.coverLetter || '');

  if (!rawText) {
    const errText = response.error ? errorHtml(response.error) : '✕ Empty response';
    resultArea.textContent = errText;
    return;
  }

  showResult(rawText); // showResult calls cleanGeneratedText internally
  const cleanText = cleanGeneratedText(rawText);

  // Persist the cleaned text
  if (type === 'answer') {
    const entry = { question: question || '(no question)', answer: cleanText, ts: Date.now() };
    activeJob.questions.push(entry);
    sendUp('appendQuestion', entry);
  } else {
    const entry = { text: cleanText, ts: Date.now() };
    activeJob.coverLetters.push(entry);
    if (activeJob.coverLetters.length > 2) activeJob.coverLetters = activeJob.coverLetters.slice(-2);
    sendUp('appendCoverLetter', entry);
  }
}

// ── Expand/collapse JD ────────────────────────────────────────────────────────
let jdExpanded = false;
function toggleJdExpand(): void {
  jdExpanded = !jdExpanded;
  $('jd-expanded').classList.toggle('hidden', !jdExpanded);
  ($('expand-jd-btn') as HTMLElement).textContent = jdExpanded
    ? '▾ Collapse job description'
    : '▸ Edit job description';
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init(): Promise<void> {
  // Load resume from storage
  const stored = await new Promise<any>(resolve => {
    chrome.storage.local.get(['resume'], r => resolve(r.resume || null));
  });
  if (stored?.personal) {
    hasResume  = true;
    resumeText = formatResume(stored);
  }

  updateJobDisplay();

  // Wire up buttons
  $('close-btn').addEventListener('click', () => sendUp('hideSidebar'));
  $('settings-btn').addEventListener('click', () => chrome.runtime.openOptionsPage());

  $('expand-jd-btn').addEventListener('click', toggleJdExpand);
  $('save-jd-btn').addEventListener('click', () => {
    activeJob.jobDescription = ($('jd-textarea') as HTMLTextAreaElement).value;
    sendUp('saveJobMeta', { jobDescription: activeJob.jobDescription });
    updateJobDisplay();
    toggleJdExpand();
  });

  $('copy-jd-btn').addEventListener('click', () => {
    copyToClipboard(activeJob.jobDescription);
    flashBtn($('copy-jd-btn') as HTMLButtonElement, 'Copied ✓');
  });

  $('clear-job-btn').addEventListener('click', () => {
    $('clear-confirm').classList.remove('hidden');
    $('job-header-btns').classList.add('hidden');
  });
  $('clear-confirm-no').addEventListener('click', () => {
    $('clear-confirm').classList.add('hidden');
    $('job-header-btns').classList.remove('hidden');
  });
  $('clear-confirm-yes').addEventListener('click', () => {
    $('clear-confirm').classList.add('hidden');
    $('job-header-btns').classList.remove('hidden');
    sendUp('clearActiveJob');
    activeJob = emptyJob();
    updateJobDisplay();
    $('result-section').classList.add('hidden');
  });

  $('generate-answer-btn').addEventListener('click', () => runGenerate('answer'));
  $('cover-letter-btn').addEventListener('click', () => runGenerate('coverLetter'));

  $('copy-result-btn').addEventListener('click', () => {
    copyToClipboard($('result-area').textContent || '');
    flashBtn($('copy-result-btn') as HTMLButtonElement, 'Copied ✓');
  });
  $('copy-explain-btn').addEventListener('click', () => {
    copyToClipboard($('explain-area').textContent || '');
    flashBtn($('copy-explain-btn') as HTMLButtonElement, 'Copied ✓');
  });

  // Stale warning buttons
  $('stale-keep').addEventListener('click', () => $('stale-warning').classList.add('hidden'));
  $('stale-clear').addEventListener('click', () => {
    sendUp('clearActiveJob');
    activeJob = emptyJob();
    updateJobDisplay();
  });
  $('stale-redetect').addEventListener('click', () => {
    // Re-request job data from current page via parent
    sendUp('redetectJobData');
    $('stale-warning').classList.add('hidden');
  });

  // Announce ready to host
  sendUp('sidebarReady');
}

// ── Messages from host ────────────────────────────────────────────────────────
window.addEventListener('message', (e: MessageEvent) => {
  if (e.data?.type !== MSG_DOWN) return;
  const { action, data } = e.data as { action: string; data: any };

  if (action === 'init') {
    if (data?.activeJob) {
      activeJob = data.activeJob as ActiveJob;
    }
    currentPageUrl = data?.url || '';
    updateJobDisplay();
    return;
  }

  if (action === 'activeJobUpdated') {
    activeJob = data as ActiveJob;
    updateJobDisplay();
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
      showExplainResult(result.text); // showExplainResult calls cleanGeneratedText internally
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

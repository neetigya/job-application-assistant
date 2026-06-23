// Sidebar host — runs in content script (all frames), but builds/manages the iframe
// only in the top frame. Child frames capture via background relay.

const SIDEBAR_WIDTH = 390;
const MSG_DOWN = 'JAE_SIDEBAR';      // host  → sidebar iframe
const MSG_UP   = 'JAE_SIDEBAR_REQ';  // sidebar → host

export interface ActiveJob {
  jobDescription: string;
  jobTitle:       string;
  company:        string;
  sourceUrl:      string | null;
  questions:   Array<{ question: string; answer: string; ts: number }>;
  coverLetters: Array<{ text: string; ts: number }>;
}

const STORAGE_KEY = 'jae_active_job';

const emptyJob = (): ActiveJob => ({
  jobDescription: '',
  jobTitle: '',
  company: '',
  sourceUrl: null,
  questions: [],
  coverLetters: [],
});

// Module state (top frame only)
let activeJob: ActiveJob   = emptyJob();
let sidebarIframe: HTMLIFrameElement | null = null;
let sidebarReady  = false;
let sidebarVisible = false;
let pendingMsgs: Array<{ action: string; data?: unknown }> = [];
let pushActive    = false;
let jobDataGetter: (() => { title?: string; company?: string } | null) | null = null;

// ── Storage ───────────────────────────────────────────────────────────────────

function loadActiveJob(): Promise<void> {
  return new Promise(resolve => {
    chrome.storage.local.get([STORAGE_KEY], result => {
      if (result[STORAGE_KEY]) activeJob = result[STORAGE_KEY] as ActiveJob;
      resolve();
    });
  });
}

function saveActiveJob(): void {
  chrome.storage.local.set({ [STORAGE_KEY]: activeJob });
}

// ── Iframe lifecycle ──────────────────────────────────────────────────────────

function buildSidebar(): void {
  if (document.getElementById('__jae-sidebar-root')) return;

  const root = document.createElement('div');
  root.id = '__jae-sidebar-root';
  root.style.cssText = [
    'position:fixed', 'top:0',
    `right:-${SIDEBAR_WIDTH + 10}px`,
    `width:${SIDEBAR_WIDTH}px`,
    'height:100%',
    'z-index:2147483647',
    'transition:right 0.28s cubic-bezier(0.4,0,0.2,1)',
    'overflow:hidden',
    'box-shadow:-4px 0 24px rgba(0,0,0,.18)',
  ].join(';');

  const iframe = document.createElement('iframe');
  iframe.src = chrome.runtime.getURL('sidebar/sidebar.html');
  iframe.style.cssText = 'width:100%;height:100%;border:none;display:block;background:#f7f8fa;';
  iframe.allow = 'clipboard-write';

  root.appendChild(iframe);
  document.documentElement.appendChild(root);
  sidebarIframe = iframe;
}

export function showSidebar(): void {
  if (window !== window.top) return;
  buildSidebar();
  const root = document.getElementById('__jae-sidebar-root') as HTMLElement | null;
  if (!root) return;
  if (!pushActive) {
    document.documentElement.style.marginRight = `${SIDEBAR_WIDTH}px`;
    document.documentElement.style.transition = 'margin-right 0.28s cubic-bezier(0.4,0,0.2,1)';
    pushActive = true;
  }
  // Micro-delay so the transition fires after the element is in the DOM
  requestAnimationFrame(() => { root.style.right = '0px'; });
  sidebarVisible = true;
}

export function hideSidebar(): void {
  if (window !== window.top) return;
  const root = document.getElementById('__jae-sidebar-root') as HTMLElement | null;
  if (!root) return;
  root.style.right = `-${SIDEBAR_WIDTH + 10}px`;
  sidebarVisible = false;
  if (pushActive) {
    document.documentElement.style.marginRight = '';
    pushActive = false;
  }
}

// ── Messaging ─────────────────────────────────────────────────────────────────

export function postToSidebar(action: string, data?: unknown): void {
  if (!sidebarReady) {
    pendingMsgs.push({ action, data });
    buildSidebar(); // ensure it's being built
    return;
  }
  sidebarIframe?.contentWindow?.postMessage({ type: MSG_DOWN, action, data }, '*');
}

function deliverPending(): void {
  const batch = pendingMsgs.splice(0);
  for (const m of batch) {
    sidebarIframe?.contentWindow?.postMessage({ type: MSG_DOWN, action: m.action, data: m.data }, '*');
  }
}

// ── Capture actions (top frame only) ─────────────────────────────────────────

export function captureAsJD(text: string): void {
  if (window !== window.top) return;

  activeJob.jobDescription = activeJob.jobDescription
    ? activeJob.jobDescription + '\n\n' + text
    : text;

  if (!activeJob.sourceUrl) activeJob.sourceUrl = window.location.href;

  // Populate title/company from page if blank
  if ((!activeJob.jobTitle || !activeJob.company) && jobDataGetter) {
    const jd = jobDataGetter();
    if (jd?.title   && !activeJob.jobTitle) activeJob.jobTitle = jd.title;
    if (jd?.company && !activeJob.company)  activeJob.company  = jd.company;
  }

  saveActiveJob();
  showSidebar();
  postToSidebar('activeJobUpdated', activeJob);
}

export function captureAsQuestion(text: string): void {
  if (window !== window.top) return;
  showSidebar();
  postToSidebar('setQuestion', { text });
}

// ── Message listeners (top frame only) ───────────────────────────────────────

function initListeners(): void {
  // Messages from sidebar iframe (upward postMessage)
  window.addEventListener('message', (e: MessageEvent) => {
    if (e.data?.type !== MSG_UP) return;
    const { action, data, reqId } = e.data as { action: string; data: any; reqId?: number };

    if (action === 'sidebarReady') {
      sidebarReady = true;
      deliverPending();
      postToSidebar('init', { activeJob, url: window.location.href });
      return;
    }
    if (action === 'hideSidebar') { hideSidebar(); return; }

    if (action === 'clearActiveJob') {
      activeJob = emptyJob();
      saveActiveJob();
      postToSidebar('activeJobUpdated', activeJob);
      return;
    }
    if (action === 'saveJobMeta') {
      activeJob = { ...activeJob, ...(data as Partial<ActiveJob>) };
      saveActiveJob();
      return;
    }
    if (action === 'appendQuestion') {
      activeJob.questions.push(data as ActiveJob['questions'][0]);
      saveActiveJob();
      return;
    }
    if (action === 'appendCoverLetter') {
      activeJob.coverLetters.push(data as ActiveJob['coverLetters'][0]);
      if (activeJob.coverLetters.length > 2) activeJob.coverLetters = activeJob.coverLetters.slice(-2);
      saveActiveJob();
      return;
    }

    // Any other action = API request → relay to background
    chrome.runtime.sendMessage({ action, ...(data as object || {}) }, (response) => {
      sidebarIframe?.contentWindow?.postMessage(
        { type: MSG_DOWN, action: 'response', reqId, data: response }, '*'
      );
    });
  });

  // Messages relayed from background (originally from any frame)
  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (window !== window.top) return;

    if (request.action === 'jae_capture_jd') {
      captureAsJD(request.text || '');
      sendResponse({ ok: true });
      return;
    }
    if (request.action === 'jae_capture_question') {
      captureAsQuestion(request.text || '');
      sendResponse({ ok: true });
      return;
    }
    if (request.action === 'jae_open_sidebar') {
      showSidebar();
      if (sidebarReady) postToSidebar('init', { activeJob, url: window.location.href });
      sendResponse({ ok: true });
      return;
    }
    if (request.action === 'jae_sidebar_show_explain') {
      showSidebar();
      postToSidebar('showExplain', request.result);
      sendResponse({ ok: true });
      return;
    }
  });
}

// ── Init (called from content.ts) ─────────────────────────────────────────────

export async function initSidebarHost(
  getJobData: () => { title?: string; company?: string } | null
): Promise<void> {
  if (window !== window.top) return; // sub-frames skip entirely
  jobDataGetter = getJobData;
  await loadActiveJob();
  initListeners();
}

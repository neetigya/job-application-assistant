// Sidebar host — runs in content script (all frames), but builds/manages the iframe
// only in the top frame. Child frames capture via background relay.

const SIDEBAR_WIDTH = 390;
const MSG_DOWN = 'JAE_SIDEBAR';      // host  → sidebar iframe
const MSG_UP   = 'JAE_SIDEBAR_REQ';  // sidebar → host

export interface JDEntry {
  id:             string;
  jobTitle:       string;
  company:        string;
  jobDescription: string;
  sourceUrl:      string | null;
  addedAt:        number;
}

const JD_HISTORY_KEY = 'jae_jd_history';   // chrome.storage.local  — persists across restarts
const JD_ACTIVE_KEY  = 'jae_active_jd_id'; // chrome.storage.session — cleared on browser close
const JD_MAX = 10;

// Module state (top frame only)
let jdHistory: JDEntry[]      = [];
let activeJdId: string | null = null;
let sidebarIframe: HTMLIFrameElement | null = null;
let sidebarReady   = false;
let sidebarVisible = false;
let pendingMsgs: Array<{ action: string; data?: unknown }> = [];
let pushActive     = false;
let jobDataGetter: (() => { title?: string; company?: string } | null) | null = null;

// ── Helpers ───────────────────────────────────────────────────────────────────

function hashJD(text: string): string {
  let h = 5381;
  const len = Math.min(text.length, 3000);
  for (let i = 0; i < len; i++) {
    h = ((h << 5) + h) + text.charCodeAt(i);
    h = h & h;
  }
  return (h >>> 0).toString(36);
}

// ── Storage ───────────────────────────────────────────────────────────────────

async function loadJDState(): Promise<void> {
  const local = await new Promise<any>(r => chrome.storage.local.get([JD_HISTORY_KEY], r));
  jdHistory = (local[JD_HISTORY_KEY] as JDEntry[]) ?? [];
  try {
    const session = await new Promise<any>(r => chrome.storage.session.get([JD_ACTIVE_KEY], r));
    activeJdId = session[JD_ACTIVE_KEY] ?? null;
  } catch {
    activeJdId = null;
  }
}

function saveHistory(): void {
  chrome.storage.local.set({ [JD_HISTORY_KEY]: jdHistory });
}

function saveActiveId(): void {
  try {
    chrome.storage.session.set({ [JD_ACTIVE_KEY]: activeJdId });
  } catch {}
}

function addToHistory(text: string): void {
  const id = hashJD(text);
  const existingIdx = jdHistory.findIndex(e => e.id === id);
  let entry: JDEntry;
  if (existingIdx >= 0) {
    // Duplicate — move to top and refresh timestamp
    [entry] = jdHistory.splice(existingIdx, 1);
    entry.addedAt = Date.now();
  } else {
    entry = {
      id,
      jobTitle:       '',
      company:        '',
      jobDescription: text,
      sourceUrl:      window.location.href,
      addedAt:        Date.now(),
    };
    if (jobDataGetter) {
      const jd = jobDataGetter();
      if (jd?.title)   entry.jobTitle = jd.title;
      if (jd?.company) entry.company  = jd.company;
    }
  }
  jdHistory.unshift(entry);
  if (jdHistory.length > JD_MAX) jdHistory = jdHistory.slice(0, JD_MAX);
  saveHistory();
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
    buildSidebar();
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
  addToHistory(text);
  showSidebar();
  postToSidebar('historyUpdated', { history: jdHistory, activeJdId });
}

export function captureAsQuestion(text: string): void {
  if (window !== window.top) return;
  showSidebar();
  postToSidebar('setQuestion', { text });
}

// ── Message listeners (top frame only) ───────────────────────────────────────

function initListeners(): void {
  window.addEventListener('message', (e: MessageEvent) => {
    // Fill progress streamed from content.ts via window.top.postMessage
    if (e.data?.__jae_fill === true) {
      const { type } = e.data as { type: string };
      if (type === 'start') {
        showSidebar();
        postToSidebar('fillStart', {});
      } else if (type === 'field' || type === 'ai_thinking' || type === 'pdf') {
        postToSidebar('fillProgress', e.data);
      } else if (type === 'complete') {
        postToSidebar('fillComplete', e.data);
      }
      return;
    }

    if (e.data?.type !== MSG_UP) return;
    const { action, data, reqId } = e.data as { action: string; data: any; reqId?: number };

    if (action === 'sidebarReady') {
      sidebarReady = true;
      deliverPending();
      postToSidebar('init', { history: jdHistory, activeJdId, url: window.location.href });
      return;
    }
    if (action === 'hideSidebar') { hideSidebar(); return; }
    if (action === 'triggerFill') {
      window.dispatchEvent(new CustomEvent('jae_fill_triggered'));
      return;
    }

    if (action === 'selectJd') {
      const id = (data as any)?.id as string;
      if (id && jdHistory.some(e => e.id === id)) {
        activeJdId = id;
        saveActiveId();
        postToSidebar('historyUpdated', { history: jdHistory, activeJdId });
      }
      return;
    }
    if (action === 'deselectJd') {
      activeJdId = null;
      saveActiveId();
      postToSidebar('historyUpdated', { history: jdHistory, activeJdId });
      return;
    }
    if (action === 'removeJd') {
      const id = (data as any)?.id as string;
      jdHistory = jdHistory.filter(e => e.id !== id);
      if (activeJdId === id) {
        activeJdId = null;
        saveActiveId();
      }
      saveHistory();
      postToSidebar('historyUpdated', { history: jdHistory, activeJdId });
      return;
    }

    // Any other action = API request → relay to background
    chrome.runtime.sendMessage({ action, ...(data as object || {}) }, (response) => {
      sidebarIframe?.contentWindow?.postMessage(
        { type: MSG_DOWN, action: 'response', reqId, data: response }, '*'
      );
    });
  });

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
      if (sidebarReady) postToSidebar('init', { history: jdHistory, activeJdId, url: window.location.href });
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
  if (window !== window.top) return;
  jobDataGetter = getJobData;
  await loadJDState();
  initListeners();
}

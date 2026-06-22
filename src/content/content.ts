// Content script - runs on job posting pages
import { detectQuestionType, isLikelyOpenQuestion } from '../utils/questionAnswerer';
import { JobData, FieldLogEntry } from '../types/resume';
import { logger } from '../utils/logger';
import { isDev, getDevConfig } from '../config/devMode';
import { initSelectionToolbar } from './selectionToolbar';

interface FillResult {
  fields: FieldLogEntry[];
  jobTitle: string;
  company: string;
  boardType: string;
}

function first(...candidates: (string | null | undefined)[]): string {
  for (const c of candidates) {
    const t = c?.trim();
    if (t) return t;
  }
  return '';
}

function getText(selector: string): string {
  return document.querySelector(selector)?.textContent?.trim() || '';
}

// ─── New content-based detection ────────────────────────────────────────────

interface JobDetectionResult {
  isJobPosting: boolean;
  confidence: number; // 0-100
  signals: {
    jobDetails: number;
    applicationForm: number;
    either: number;
  };
  jobData?: JobData;
}

function scoreJobDescriptionContent(): number {
  let score = 0;
  const bodyText = document.body.textContent?.toLowerCase() || '';
  const fullText = document.body.textContent || '';

  // URL-based boost: known job board patterns are strong signals
  const url = window.location.href;
  if (url.includes('ashby_jid') || url.includes('jobs.ashbyhq.com') ||
      url.includes('jobs.lever.co') || url.includes('greenhouse.io') ||
      url.includes('linkedin.com/jobs') || url.includes('indeed.com/viewjob') ||
      url.includes('workday.com') || url.includes('pinpointhq.com')) {
    score += 10;
  }

  // Signal 1: Job title heading + location (10 pts)
  const headings = document.querySelectorAll('h1, h2');
  const hasJobTitle = Array.from(headings).some(
    h => (h.textContent?.length ?? 0) > 5 && (h.textContent?.length ?? 0) < 150
  );
  if (hasJobTitle) score += 5;

  if (bodyText.includes('location') || bodyText.includes('based in') || /remote|on-site|hybrid/i.test(bodyText)) {
    score += 5;
  }

  // Signal 2: Job description keywords — also match curly apostrophe variant (15 pts)
  // Broad list covers standard boards AND branded language (Tesla "What to Expect",
  // Google "Minimum qualifications", etc.)
  const descKeywords = [
    'responsibilities', 'you will', "what you'll do", "what you\u2019ll do",
    'requirements', 'qualifications', 'about the role',
    'about this position', 'job description', 'what you will do',
    'employment type', 'department', 'compensation',
    // Broader section headers used by in-house career sites
    'what to expect', 'your role', 'the role', 'about you',
    'we are looking for', 'minimum qualifications', 'basic qualifications',
    'preferred qualifications', 'what we offer', 'job type', 'full-time',
    'req. id', 'req id',
  ];
  const found = descKeywords.filter(k => bodyText.includes(k)).length;
  if (found >= 3) score += 15;
  else if (found >= 2) score += 10;
  else if (found >= 1) score += 5;

  // Signal 3: Content length (10 pts)
  const wordCount = fullText.split(/\s+/).length;
  if (wordCount > 500) score += 10;
  else if (wordCount > 300) score += 5;

  // Signal 4: Multiple sections (5 pts)
  const sections = document.querySelectorAll('h2, h3, [class*="section"]');
  if (sections.length >= 2) score += 5;

  return Math.min(score, 40);
}

function scoreApplicationForm(): number {
  let score = 0;
  const bodyText = document.body.textContent?.toLowerCase() || '';

  // Primary: querySelector for visible form fields
  const formFields = document.querySelectorAll(
    'input[type="text"], input[type="email"], input[type="tel"], textarea, select, input[type="file"], input[type="checkbox"], input[type="radio"]'
  );

  if (formFields.length > 0) {
    score += 20;
  } else {
    // Fallback: Ashby and other SPAs sometimes render fields in Shadow DOM or
    // async. Detect by visible text labels that only appear on an application form.
    const formTextSignals = ['type here', 'upload file', 'drag and drop', 'upload resume', 'autofill from resume'];
    const hasFormText = formTextSignals.some(s => bodyText.includes(s));
    if (hasFormText) score += 20;
    else return 0; // no form evidence at all
  }

  const appKeywords = ['why interested', 'cover letter', 'resume', 'portfolio', 'additional information', 'why apply'];
  if (appKeywords.some(k => bodyText.includes(k))) score += 10;

  const buttons = document.querySelectorAll('button, a[role="button"]');
  const hasApplyBtn = Array.from(buttons).some(btn => /apply|submit|send/i.test(btn.textContent || ''));
  if (hasApplyBtn) score += 10;

  return Math.min(score, 40);
}

function detectTabs(): { hasTabs: boolean; tabNames: string[] } {
  const tabSelectors = ['[role="tab"]', '[class*="tab"]', 'button[data-tab]', '[class*="panel"]'];
  let tabs: NodeListOf<Element> | Element[] = [];
  for (const sel of tabSelectors) {
    tabs = document.querySelectorAll(sel);
    if (tabs.length > 0) break;
  }
  if (!tabs.length) return { hasTabs: false, tabNames: [] };
  const tabNames = Array.from(tabs).map(t => t.textContent?.trim()).filter(Boolean) as string[];
  logger.debug('Found tabs:', tabNames);
  return { hasTabs: true, tabNames };
}

function detectJobPosting(): JobDetectionResult {
  logger.debug('Starting detection...');

  detectTabs(); // logs tab info for debugging

  const jobDetails = scoreJobDescriptionContent();
  const applicationForm = scoreApplicationForm();
  const either = (jobDetails > 0 || applicationForm > 0) ? 20 : 0;
  const confidence = jobDetails + applicationForm + either;

  logger.debug(`Scores — details:${jobDetails} form:${applicationForm} bonus:${either} total:${confidence}% → ${confidence > 70 ? 'JOB POSTING' : 'NOT A JOB POSTING'}`);

  let jobData: JobData | undefined;
  if (jobDetails > 10) {
    const extracted = extractJobData();
    if (extracted) jobData = extracted;
    logger.debug('Job data extracted:', jobData);
  }

  return {
    isJobPosting: confidence > 70,
    confidence,
    signals: { jobDetails, applicationForm, either },
    jobData,
  };
}

// Extract job data using platform-specific (then generic) extractors
function extractJobData(): JobData | null {
  const url = window.location.href;
  let result: JobData | null = null;

  if (url.includes('linkedin.com/jobs')) {
    result = extractLinkedInJob();
  } else if (url.includes('indeed.com')) {
    result = extractIndeedJob();
  } else if (url.includes('glassdoor.com')) {
    result = extractGlassdoorJob();
  } else if (url.includes('jobs.lever.co')) {
    result = extractLeverJob();
  } else if (url.includes('jobs.ashbyhq.com') || url.includes('ashby_jid')) {
    result = extractAshbyJob();
  } else if (url.includes('pinpointhq.com')) {
    result = extractPinpointJob();
  } else if (url.includes('greenhouse.io')) {
    result = extractGreenhouseJob();
  }

  if (!result || (!result.title && !result.description)) {
    result = extractGenericJob();
  }

  if (!result || (!result.title && !result.description)) {
    logger.debug('No job data found on this page');
    return null;
  }

  logger.info('Detected job:', result.title, 'at', result.company);
  return result;
}

function detectBoardType(url: string): string {
  if (url.includes('ashbyhq.com') || url.includes('ashby_jid')) return 'Ashby';
  if (url.includes('jobs.lever.co')) return 'Lever';
  if (url.includes('greenhouse.io') || url.includes('boards.greenhouse.io')) return 'Greenhouse';
  if (url.includes('workday.com')) return 'Workday';
  if (url.includes('linkedin.com')) return 'LinkedIn';
  if (url.includes('indeed.com')) return 'Indeed';
  if (url.includes('glassdoor.com')) return 'Glassdoor';
  if (url.includes('pinpointhq.com')) return 'Pinpoint';
  return 'Unknown';
}

// LinkedIn extraction — selectors updated for 2024/2025 DOM
function extractLinkedInJob(): JobData | null {
  try {
    const title = first(
      getText('.job-details-jobs-unified-top-card__job-title h1'),
      getText('h1.t-24'),
      getText('[data-test-id="top-card-title"]'),
      getText('.topcard__title'),
      getText('h1')
    );
    const company = first(
      getText('.job-details-jobs-unified-top-card__company-name a'),
      getText('.job-details-jobs-unified-top-card__primary-description-without-tagline a'),
      getText('[data-test-id="top-card-company-name"]'),
      getText('.topcard__org-name-link'),
      getText('.topcard__flavor a')
    );
    const description = first(
      getText('#job-details'),
      getText('.jobs-description-content__text'),
      getText('.show-more-less-html__markup'),
      getText('.jobs-box__html-content')
    );

    if (!title && !description) return null;
    return { title, company, description, url: window.location.href };
  } catch (e) {
    return null;
  }
}

// Indeed extraction
function extractIndeedJob(): JobData | null {
  try {
    const title = first(
      getText('h1[data-testid="jobsearch-JobInfoHeader-title"]'),
      getText('h1.jobsearch-JobInfoHeader-title'),
      getText('h1')
    );
    const company = first(
      getText('[data-testid="jobsearch-JobInfoHeader-companyName"]'),
      getText('[data-testid="inlineHeader-companyName"]'),
      getText('.jobsearch-InlineCompanyRating a')
    );
    const description = first(
      getText('#jobDescriptionText'),
      getText('.jobsearch-jobDescriptionText')
    );

    if (!title && !description) return null;
    return { title, company, description, url: window.location.href };
  } catch (e) {
    return null;
  }
}

// Glassdoor extraction
function extractGlassdoorJob(): JobData | null {
  try {
    const title = first(
      getText('[data-test="job-title"]'),
      getText('h1[data-test="job-title"]'),
      getText('h1')
    );
    const company = first(
      getText('[data-test="employer-name"]'),
      getText('[data-test="employerName"]')
    );
    const description = first(
      getText('[data-test="job-description"]'),
      getText('[data-test="description"]'),
      getText('.jobDescriptionContent')
    );

    if (!title && !description) return null;
    return { title, company, description, url: window.location.href };
  } catch (e) {
    return null;
  }
}

// Lever extraction
function extractLeverJob(): JobData | null {
  try {
    const title = first(
      getText('h2[data-qa="posting-name"]'),
      getText('[data-qa="posting-name"]'),
      getText('h2')
    );
    const company = first(
      getText('[data-qa="posting-team-name"]'),
      // Company name is usually in the page title for Lever
      document.title.split('·')[1]
    );
    const description = first(
      getText('[data-qa="posting-description"]'),
      getText('.posting-description')
    );

    if (!title && !description) return null;
    return { title, company, description, url: window.location.href };
  } catch (e) {
    return null;
  }
}

// Ashby extraction — handles both jobs.ashbyhq.com and company-hosted pages with ?ashby_jid=
function extractAshbyJob(): JobData | null {
  try {
    const title = first(
      getText('h1'),
      getText('[class*="JobTitle"]'),
      getText('[class*="job-title"]')
    );
    const company = first(
      getText('[data-test="company-name"]'),
      getText('[class*="CompanyName"]'),
      getText('[class*="company-name"]'),
      // Company name is often in the page title: "Role | Company | Ashby"
      document.title.split('|')[1]
    );
    const description = first(
      getText('[data-test="job-description"]'),
      getText('[class*="JobDescription"]'),
      getText('[class*="job-description"]'),
      getText('.ashby-job-posting-brief-description'),
      // Company-hosted Ashby pages often render description inside <main> or a content wrapper
      getText('[class*="posting-content"]'),
      getText('[class*="PostingContent"]'),
      getText('[class*="content"]'),
      getText('main')
    );

    if (!title && !description) return null;
    return { title, company: company?.trim() || '', description, url: window.location.href };
  } catch (e) {
    return null;
  }
}

// Pinpoint HQ extraction
function extractPinpointJob(): JobData | null {
  try {
    const title = first(
      getText('h1[data-qa="job-title"]'),
      getText('h1.posting-headline'),
      getText('h1')
    );
    const company = first(
      getText('[data-qa="company-name"]'),
      getText('.company-name'),
      // Company name is often in the page title: "Role at Company | Pinpoint"
      document.title.split(' at ')[1]?.split('|')[0]
    );
    const description = first(
      getText('[data-qa="job-description"]'),
      getText('.posting-description'),
      getText('[class*="description"]'),
      getText('main')
    );

    if (!title && !description) return null;
    return { title, company: company?.trim() || '', description, url: window.location.href };
  } catch (e) {
    return null;
  }
}

// Greenhouse extraction — handles job-boards.greenhouse.io and boards.greenhouse.io
// HTML structure (2024+): <main class="main job-post"> with <h1 class="section-header">
// inside .job__title, and description in <div class="job__description body">
function extractGreenhouseJob(): JobData | null {
  try {
    const title = first(
      getText('.job__title h1'),
      getText('.job__title'),
      getText('h1.app-title'),
      getText('.app-title'),
      getText('h1')
    );
    // Logo alt text: "Headspace Logo" → strip " Logo"
    const logoAlt = (document.querySelector('.logo img, img[alt*="Logo"]') as HTMLImageElement)?.alt || '';
    const logoCompany = logoAlt.replace(/\s*logo\s*/i, '').trim();
    // Page title: "Role at Company - Greenhouse" or "Role | Company | Greenhouse"
    const rawTitle = document.title || '';
    const fromTitle = rawTitle.match(/ at ([^|–\-]+?)(?:\s*[-–|]|\s*$)/i)?.[1]?.trim() || '';
    const company = first(logoCompany, fromTitle, getText('.company-name'));
    const description = first(
      getText('.job__description'),          // 2024+ Greenhouse: class="job__description body"
      getText('#content'),                   // older Greenhouse
      getText('.job-post__description'),
      getText('[class*="job-description"]'),
      getText('main')
    );
    if (!title && !description) return null;
    return { title, company: company || '', description, url: window.location.href };
  } catch (e) {
    return null;
  }
}

// Generic fallback — works on most job boards
function extractGenericJob(): JobData | null {
  try {
    // 1. JSON-LD structured data — most reliable when present
    const jsonLd = document.querySelector('script[type="application/ld+json"]');
    if (jsonLd) {
      try {
        const data = JSON.parse(jsonLd.textContent || '');
        const job = Array.isArray(data) ? data.find((d: any) => d['@type'] === 'JobPosting') : data;
        if (job?.['@type'] === 'JobPosting') {
          return {
            title: job.title || '',
            company: job.hiringOrganization?.name || '',
            description: job.description?.replace(/<[^>]+>/g, ' ').trim() || '',
            url: window.location.href
          };
        }
      } catch {}
    }

    // 2. Title — class-name hints first, plain h1 as fallback
    const title = first(
      getText('h1[class*="job"]'),
      getText('h1[class*="title"]'),
      getText('h1[class*="position"]'),
      getText('h1')
    );

    // 3. Description — class-name hints → semantic HTML containers → structural heuristic.
    //    Sites like Tesla use utility/CSS-in-JS class names that don't contain "description",
    //    so we must not rely solely on class names.
    const description = first(
      getText('[class*="job-description"]'),
      getText('[class*="jobDescription"]'),
      getText('[id*="job-description"]'),
      getText('[id*="jobDescription"]'),
      getText('[class*="description"]'),
      getText('[role="main"]'),          // ARIA landmark — reliable across frameworks
      getText('main'),                   // HTML5 semantic — covers most modern sites
      getText('article'),                // sometimes used for job postings
      extractRichestContentBlock()       // last resort: content-density heuristic
    );

    if (!title && !description) return null;
    return { title, company: '', description, url: window.location.href };
  } catch (e) {
    return null;
  }
}

// Finds the most specific DOM element that is the primary content container,
// without returning a page-level wrapper that includes nav/header/footer noise.
// Strategy: score elements by <p>+<li> density, then descend to the most specific
// child that retains ≥80% of the parent score.
function extractRichestContentBlock(): string {
  const CHROME_SELECTOR = 'nav, header, footer, [role="navigation"], [role="banner"], [role="contentinfo"], [aria-hidden="true"]';

  function score(el: Element): number {
    if (el.closest(CHROME_SELECTOR)) return 0;
    const text = el.textContent?.trim() || '';
    if (text.length < 200) return 0;
    return el.querySelectorAll('p').length * 2 + el.querySelectorAll('li').length * 3;
  }

  // Start from the highest-scoring semantic container, or body as fallback
  let best: Element = document.body;
  let bestScore = 0;
  Array.from(document.querySelectorAll('main, article, section, [role="main"]')).forEach(el => {
    const s = score(el);
    if (s > bestScore) { bestScore = s; best = el; }
  });
  // If no semantic container beat body, scan all divs/sections
  if (best === document.body) {
    Array.from(document.querySelectorAll('section, div')).forEach(el => {
      const s = score(el);
      if (s > bestScore) { bestScore = s; best = el; }
    });
  }

  // Descend: prefer a child that retains ≥80% of the score (more specific = better)
  let changed = true;
  while (changed) {
    changed = false;
    Array.from(best.children).some(child => {
      const s = score(child);
      if (s >= bestScore * 0.8 && s > 0) {
        best = child; bestScore = s; changed = true; return true;
      }
      return false;
    });
  }

  if (best === document.body) return '';
  return best.textContent?.trim().replace(/\s+/g, ' ').slice(0, 10_000) || '';
}

function detectPageType(): 'jobPosting' | 'applicationForm' | 'unknown' {
  const result = detectJobPosting();

  logger.debug(`Page detection — confidence:${result.confidence}% details:${result.signals.jobDetails} form:${result.signals.applicationForm}`);

  // Strong job posting with extracted description
  if (result.confidence > 50 && result.jobData) {
    return 'jobPosting';
  }

  // Form clearly present
  if (result.signals.applicationForm > 15) {
    return 'applicationForm';
  }

  // Low-confidence either signal — let user provide description
  if (result.confidence > 50 && result.signals.applicationForm > 0) {
    return 'applicationForm';
  }

  return 'unknown';
}

// Returns true if this text input is the typing element inside a custom select component.
// React Select and similar libraries put role="combobox", aria-haspopup, aria-expanded
// directly on the typing input (not on a container), so we check both the input itself
// AND walk up ancestors for structural indicators.
function isCustomSelectInput(input: HTMLInputElement): boolean {
  if (input.getAttribute('aria-hidden') === 'true') return false;
  // Signals directly on the input (React Select, Downshift, Headless UI)
  if (
    input.getAttribute('role') === 'combobox' ||
    input.getAttribute('aria-haspopup') !== null ||
    input.hasAttribute('aria-expanded')
  ) return true;
  // Structural signal: nearest ancestor contains a dropdown indicator
  let ancestor: Element | null = input.parentElement;
  for (let depth = 0; depth < 8 && ancestor && ancestor !== document.body; depth++) {
    if (ancestor.hasAttribute('aria-expanded')) return true;
    if (ancestor.getAttribute('role') === 'combobox') return true;
    if (ancestor.querySelector('[class*="indicator"]:not([aria-hidden="true"])')) return true;
    ancestor = ancestor.parentElement;
  }
  return false;
}

// Walk up from a text input to find the best clickable container for the custom select.
// Falls back to the nearest parent element if no decorated container is found.
function findCustomSelectContainer(input: HTMLInputElement): Element | null {
  if (input.getAttribute('aria-hidden') === 'true') return null;
  if (!isCustomSelectInput(input)) return null;

  let ancestor: Element | null = input.parentElement;
  for (let depth = 0; depth < 8 && ancestor && ancestor !== document.body; depth++) {
    if (ancestor.hasAttribute('aria-expanded')) return ancestor;
    if (ancestor.getAttribute('role') === 'combobox') return ancestor;
    if (ancestor.querySelector('[class*="indicator"]:not([aria-hidden="true"])')) return ancestor;
    ancestor = ancestor.parentElement;
  }
  // Input has combobox signals but no decorated container — use its direct parent.
  return input.parentElement;
}

// Returns all [role="option"] elements that are currently visible on screen.
function getVisibleRoleOptions(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).filter(opt => {
    if (opt.getAttribute('aria-hidden') === 'true') return false;
    const rect = opt.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
}

// Open a custom select dropdown and click the best-matching option.
// Takes the typing input directly so we can use keyboard events (most reliable for React Select).
// Falls back to mousedown on the container if keyboard doesn't open the menu.
// keywords: ordered list — tries each against visible options, picks the first hit.
async function activateCustomSelect(
  typingInput: HTMLInputElement,
  container: Element,
  keywords: string[]
): Promise<boolean> {

  // Attempt 1: focus the input and press ArrowDown — this is how React Select
  // opens the menu in response to keyboard input (isTrusted is not required here).
  typingInput.focus();
  typingInput.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'ArrowDown', keyCode: 40, which: 40, bubbles: true, cancelable: true,
  }));

  await new Promise(r => setTimeout(r, 500));
  let options = getVisibleRoleOptions();

  if (!options.length) {
    // Attempt 2: mousedown on the container (React Select also opens on mousedown).
    // Fire mousedown BEFORE click — wrong order would open then immediately close.
    container.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true, cancelable: true, view: window,
    }));
    container.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, view: window }));

    await new Promise(r => setTimeout(r, 500));
    options = getVisibleRoleOptions();
  }

  if (!options.length) {
    typingInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    typingInput.blur();
    return false;
  }

  let match: HTMLElement | undefined;
  for (const kw of keywords) {
    match = options.find(opt => matchesKeyword((opt.textContent || '').trim(), kw));
    if (match) break;
  }
  if (match) {
    match.click();
    return true;
  }

  // No match — close the dropdown cleanly.
  typingInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  typingInput.blur();
  return false;
}

// ─── Shared option-matching helpers ──────────────────────────────────────────

// Fuzzy option text matching used by both native <select> and custom dropdowns.
// Tries: exact → starts-with → contains → "prefer not" synonym group.
function matchesKeyword(optionText: string, keyword: string): boolean {
  const text = optionText.toLowerCase().trim();
  const k = keyword.toLowerCase().trim();
  if (!k || !text) return false;
  if (text === k) return true;
  if (text.startsWith(k)) return true;
  if (text.includes(k)) return true;
  // All "prefer not / decline / don't wish" variants are treated as equivalent
  if (/^(prefer.?not|decline|i.?don.?t wish|do not wish|choose not|not wish|i prefer not)/i.test(k)) {
    return /prefer.?not|decline|don.?t wish|do not wish|choose not|not wish to|i prefer not/i.test(text);
  }
  return false;
}

// Convert a stored resume value to the keyword used for option matching.
function toMatchKeyword(value: string): string {
  if (!value) return '';
  const v = value.toLowerCase().trim();
  if (v === 'prefer_not_to_say') return 'prefer not to say';
  return v;
}

// ─── Compliance keyword maps ──────────────────────────────────────────────────
// Each stored enum value maps to ordered keyword phrases. The filling logic tries
// them in priority order; the first option text that includes the phrase wins.

const VETERAN_KEYWORDS: Record<string, string[]> = {
  not_a_veteran:               ['not a protected veteran', 'not a veteran', 'i am not'],
  protected_veteran:           ['one or more classifications', 'i identify as', 'protected veteran'],
  disabled_veteran:            ['disabled veteran'],
  recently_separated_veteran:  ['recently separated'],
  active_duty_wartime_veteran: ['active duty wartime', 'campaign badge'],
  armed_forces_medal_veteran:  ['armed forces service medal', 'service medal'],
  prefer_not_to_say:           ["don't wish", 'do not wish', 'prefer not', 'decline', 'i don\'t want'],
};

const DISABILITY_KEYWORDS: Record<string, string[]> = {
  yes_have_disability: ['yes, i have', 'have had one', 'i have a disability'],
  no_disability:       ["i don't have", 'i do not have', 'no, i do not', "no, i don't"],
  prefer_not_to_say:   ["don't wish", 'do not wish', 'prefer not', 'decline'],
};

const GENDER_KEYWORDS: Record<string, string[]> = {
  male:              ['male', 'man'],
  female:            ['female', 'woman'],
  non_binary:        ['non-binary', 'nonbinary', 'non binary', 'gender non-conforming', 'genderqueer'],
  prefer_not_to_say: ['decline', 'prefer not', "don't wish", 'do not wish', 'withhold'],
  self_describe:     ['self-describe', 'self describe', 'other (describe)', 'write in'],
};

const RACE_KEYWORDS: Record<string, string[]> = {
  american_indian_alaskan_native:   ['american indian', 'alaskan native', 'alaska native'],
  asian:                            ['asian'],
  black_african_american:           ['black', 'african american'],
  hispanic_latino:                  ['hispanic', 'latino', 'latina'],
  white:                            ['white', 'caucasian'],
  native_hawaiian_pacific_islander: ['native hawaiian', 'pacific islander'],
  two_or_more_races:                ['two or more', 'multiracial', 'mixed'],
  prefer_not_to_say:                ['decline', 'prefer not', "don't wish", 'do not wish'],
};

const LGBTQ_KEYWORDS: Record<string, string[]> = {
  heterosexual:    ['heterosexual', 'straight'],
  gay_lesbian:     ['gay', 'lesbian'],
  bisexual:        ['bisexual'],
  prefer_not_to_say: ['decline', 'prefer not', "don't wish"],
};

// Returns the fill target for well-known demographic/legal fields, or null if unknown.
// Keywords is an ordered array — callers try each in sequence and use the first match.
// Returning null means "skip this field entirely" (e.g., LGBTQ when user opted out).
function getKnownFieldValue(hint: string, resumeData: any): { keywords: string[]; label: string } | null {
  const c = resumeData?.compliance;
  const p = resumeData?.personal;
  const vd = resumeData?.voluntaryDisclosure;

  // ── Work Authorization ───────────────────────────────────────────────────────
  // Combined "authorized AND no sponsorship needed" question (rare)
  if (/authoriz.*work|work.*authoriz|legally.*work|legal.*right.*work/i.test(hint) &&
      /sponsor/i.test(hint)) {
    const auth = c?.workAuthorization?.isAuthorized ?? p?.workAuthorization ?? true;
    const reqNow = c?.workAuthorization?.requiresSponsorshipNow ?? p?.requiresSponsorship ?? false;
    const answer = (auth && !reqNow) ? 'yes' : 'no';
    return { keywords: [answer], label: 'Work Auth (combined)' };
  }

  if (/authoriz.*work|work.*authoriz|legally.*work|legal.*right.*work|right.?to.?work|work.?permit|eligible.*work|work.?eligib|permitted.*work|can.*legally.*work|able.*legally.*work/i.test(hint)) {
    const val = c?.workAuthorization?.isAuthorized ?? p?.workAuthorization ?? true;
    return { keywords: [val ? 'yes' : 'no'], label: 'Work Authorization' };
  }

  // ── Visa Sponsorship ─────────────────────────────────────────────────────────
  // "now" or "currently" → use requiresSponsorshipNow; "future" → requiresSponsorshipFuture
  if (/(?:visa|employment|work|immigration).*sponsor|sponsor.*(?:visa|employment|work)|require.*sponsor|need.*sponsor|sponsorship.*(?:employ|work|visa)/i.test(hint)) {
    const isFuture = /future|will.*need|anticipat/i.test(hint);
    const isNow    = /now|current|presently/i.test(hint);
    let val: boolean;
    if (isFuture && !isNow) {
      val = c?.workAuthorization?.requiresSponsorshipFuture ?? p?.requiresSponsorship ?? false;
    } else {
      val = c?.workAuthorization?.requiresSponsorshipNow ?? p?.requiresSponsorship ?? false;
    }
    return { keywords: [val ? 'yes' : 'no'], label: 'Visa Sponsorship' };
  }

  // ── Veteran Status ────────────────────────────────────────────────────────────
  if (/veteran|military.?status|protected.?veteran|armed.?force|vevraa|military.?service|served.*u\.?s|have.*served/i.test(hint)) {
    const status = c?.veteranStatus ?? (vd?.veteranStatus ? 'not_a_veteran' : null);
    if (!status) return null;
    return { keywords: VETERAN_KEYWORDS[status] ?? ['prefer not'], label: 'Veteran Status' };
  }

  // ── Disability Status ─────────────────────────────────────────────────────────
  if (/disabilit|differently.?able|physical.*mental.*impairment|section.?503|ada.*disabilit/i.test(hint)) {
    const status = c?.disabilityStatus ?? (vd?.disabilityStatus === 'yes' ? 'yes_have_disability' : vd?.disabilityStatus === 'no' ? 'no_disability' : c ? 'prefer_not_to_say' : null);
    if (!status) return null;
    return { keywords: DISABILITY_KEYWORDS[status] ?? ['prefer not'], label: 'Disability Status' };
  }

  // ── Gender ────────────────────────────────────────────────────────────────────
  if (/\bgender\b|\bgender.?identity\b|\bsex\b/i.test(hint) && !/sex.*offend|sex.*harass/i.test(hint)) {
    const gender = c?.genderIdentity ?? (vd?.gender ? (vd.gender === 'non-binary' ? 'non_binary' : vd.gender) : null);
    if (!gender) return null;
    return { keywords: GENDER_KEYWORDS[gender] ?? ['prefer not'], label: 'Gender' };
  }

  // ── Hispanic / Latino ─────────────────────────────────────────────────────────
  if (/hispanic|latina?o|spanish.?origin/i.test(hint)) {
    if (c) {
      const val = c.isHispanicLatino;
      if (val === undefined) return null;
      return { keywords: [val ? 'yes' : 'no'], label: 'Hispanic/Latino' };
    }
    if (vd?.hispanicLatino) {
      return { keywords: [toMatchKeyword(vd.hispanicLatino)], label: 'Hispanic/Latino' };
    }
    return null;
  }

  // ── Race / Ethnicity ──────────────────────────────────────────────────────────
  if (/\brace\b|\bracial\b|\bethnicity\b|\bethnic\b/i.test(hint) && !/hispanic|latino/i.test(hint)) {
    const race = c?.raceEthnicity ?? (vd?.race ? 'prefer_not_to_say' : null);
    if (!race) return null;
    return { keywords: RACE_KEYWORDS[race] ?? ['prefer not'], label: 'Race/Ethnicity' };
  }

  // ── LGBTQ+ / Sexual Orientation ───────────────────────────────────────────────
  if (/sexual.?orientation|lgbtq/i.test(hint)) {
    // null means user chose to skip — return null so the field is not filled
    if (!c || c.lgbtqIdentity === null || c.lgbtqIdentity === undefined) return null;
    return { keywords: LGBTQ_KEYWORDS[c.lgbtqIdentity] ?? ['prefer not'], label: 'Sexual Orientation' };
  }

  // ── Relocation / Commute ──────────────────────────────────────────────────────
  if (/relocat/i.test(hint)) return { keywords: [p?.willingToRelocate ? 'yes' : 'no'], label: 'Relocation' };
  if (/commut/i.test(hint)) return { keywords: [p?.ableToCommute ? 'yes' : 'no'], label: 'Commute' };

  return null;
}

// Fill native <select> elements using the known-field registry plus resume data.
function fillSelectElements(resumeData: any): FieldLogEntry[] {
  const logs: FieldLogEntry[] = [];
  const selects = document.querySelectorAll<HTMLSelectElement>('select');

  selects.forEach(select => {
    if (select.disabled) return;
    const hint = getFieldHint(select);
    const label = getFieldLabel(select);

    const known = getKnownFieldValue(hint, resumeData);
    if (!known) {
      logs.push({ fieldName: select.name, fieldType: 'select', fieldLabel: label, fieldHint: hint.slice(0, 120), filled: false, value: null, reason: 'No matching pattern for select' });
      return;
    }

    let matchingOption: HTMLOptionElement | undefined;
    for (const kw of known.keywords) {
      matchingOption = Array.from(select.options).find(o => matchesKeyword(o.text, kw));
      if (matchingOption) break;
    }

    if (matchingOption) {
      select.value = matchingOption.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      logger.debug(`✓ Select "${label}" (${known.label}) → "${matchingOption.text}"`);
      logs.push({ fieldName: select.name, fieldType: 'select', fieldLabel: label, fieldHint: hint.slice(0, 120), filled: true, value: matchingOption.text, reason: null });
    } else {
      logs.push({ fieldName: select.name, fieldType: 'select', fieldLabel: label, fieldHint: hint.slice(0, 120), filled: false, value: null, reason: `No option matched [${known.keywords.join(', ')}] for ${known.label}` });
    }
  });

  return logs;
}

// The ONE function that writes text into any page field.
// INPUT/TEXTAREA: uses the prototype value-setter so React/Vue synthetic events fire.
//   opts.selectionStart + selectionEnd: splice-replace the selected region (toolbar format-in-place).
//   No opts: replace the entire value (form-fill path).
// contentEditable: restores opts.range then uses execCommand('insertText').
interface ApplyValueOpts { range?: Range; selectionStart?: number; selectionEnd?: number }
function applyValueToField(el: HTMLElement, value: string, opts?: ApplyValueOpts): void {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    let finalValue = value;
    if (opts?.selectionStart !== undefined && opts.selectionEnd !== undefined) {
      finalValue =
        el.value.slice(0, opts.selectionStart) + value + el.value.slice(opts.selectionEnd);
    }
    const proto = el instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, finalValue);
    else el.value = finalValue;
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } else if (el.isContentEditable) {
    const sel = window.getSelection();
    if (!sel) return;
    if (opts?.range) {
      sel.removeAllRanges();
      sel.addRange(opts.range);
    }
    document.execCommand('insertText', false, value);
  }
}

// Get a combined "hint" string from all identifiers on a field
function getFieldHint(el: HTMLElement): string {
  const parts: string[] = [];

  // Associated <label>
  const id = el.id;
  if (id) {
    const label = document.querySelector(`label[for="${id}"]`);
    if (label) parts.push(label.textContent || '');
  }
  const parentLabel = el.closest('label');
  if (parentLabel) parts.push(parentLabel.textContent || '');

  // Attributes
  for (const attr of ['aria-label', 'aria-labelledby', 'placeholder', 'name', 'id', 'autocomplete']) {
    const v = el.getAttribute(attr);
    if (v) parts.push(v);
  }

  // Walk up ancestors but ONLY grab <label> child elements — never raw textContent.
  // Raw textContent causes false positives when a container holds all field names.
  let ancestor = el.parentElement;
  for (let i = 0; i < 4 && ancestor; i++) {
    for (const child of Array.from(ancestor.children)) {
      if (child.tagName === 'LABEL' && child !== parentLabel) {
        const t = child.textContent?.trim();
        if (t) parts.push(t);
        break;
      }
    }
    ancestor = ancestor.parentElement;
  }

  return parts.join(' ').toLowerCase().replace(/[*:]/g, ' ');
}

function getFieldLabel(el: HTMLElement): string {
  const id = el.id;
  if (id) {
    const label = document.querySelector(`label[for="${id}"]`);
    if (label?.textContent?.trim()) return label.textContent.trim();
  }
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel;
  // Walk up ancestors to find a label element
  let ancestor = el.parentElement;
  for (let i = 0; i < 4 && ancestor; i++) {
    const label = ancestor.querySelector('label');
    if (label?.textContent?.trim()) return label.textContent.trim();
    ancestor = ancestor.parentElement;
  }
  return el.getAttribute('placeholder') || '';
}

// Fill form fields based on form type detected
function fillApplicationForm(resumeData: any): FillResult {
  const emptyResult: FillResult = { fields: [], jobTitle: '', company: '', boardType: detectBoardType(window.location.href) };
  const p = resumeData?.personal;
  if (!p) {
    showFillNotification(0, 0, 'No resume data — save your resume in settings first.');
    return emptyResult;
  }

  const loc = typeof p.location === 'object' ? p.location : { city: '', state: '', country: '' };
  const fullName = `${p.firstName} ${p.lastName}`.trim();

  const mappings: Array<{ patterns: RegExp; value: string; label: string }> = [
    { patterns: /first.?name|given.?name|fname/,                value: p.firstName,   label: 'First Name' },
    { patterns: /last.?name|family.?name|surname|lname/,         value: p.lastName,    label: 'Last Name' },
    { patterns: /full.?name|your.?name|\bname\b|applicant.?name/, value: fullName,      label: 'Full Name' },
    { patterns: /e.?mail/,                                       value: p.email,       label: 'Email' },
    { patterns: /phone|telephone|mobile|cell|\btel\b/,            value: p.phone,       label: 'Phone' },
    { patterns: /city/,                                          value: loc.city,      label: 'City' },
    { patterns: /\bstate\b|\bprovince\b/,                        value: loc.state,     label: 'State' },
    { patterns: /country/,                                       value: loc.country,   label: 'Country' },
    { patterns: /location|address/,                              value: [loc.city, loc.state, loc.country].filter(Boolean).join(', '), label: 'Location' },
    { patterns: /linkedin/,                                      value: resumeData.onlinePresence?.linkedinUrl || '', label: 'LinkedIn' },
    { patterns: /github/,                                        value: resumeData.onlinePresence?.githubUrl || '',   label: 'GitHub' },
    { patterns: /portfolio|website|personal.?url/,               value: resumeData.onlinePresence?.portfolioUrl || '', label: 'Portfolio' },
    { patterns: /salary|compensation|pay|expected/,              value: resumeData.commonQuestions?.expectedSalary || '', label: 'Expected Salary' },
    { patterns: /notice.?period|start.?date|availability/,       value: resumeData.commonQuestions?.noticePeriod || '', label: 'Notice Period' },
    { patterns: /summary|about.?you|profile|objective/,          value: resumeData.profileSummary || '',             label: 'Profile Summary' },
  ];

  const inputs = document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
    'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=checkbox]):not([type=radio]):not([type=file]):not([type=search]), textarea'
  );

  let filledCount = 0;
  const fieldLogs: FieldLogEntry[] = [];

  const isWorkday = /workday\.com|myworkdayjobs\.com/.test(window.location.hostname);

  const inDevMode = isDev();
  const devConfig = inDevMode ? getDevConfig() : null;

  if (inDevMode) {
    console.log('%c[DEV] Form filling started', 'color:#ff9800;font-weight:bold');
    if (devConfig?.testOnlyField) {
      console.log(`%c[DEV] Filtering to fields matching: "${devConfig.testOnlyField}"`, 'color:#e91e63;font-weight:bold');
    }
    console.log(`[DEV] ${inputs.length} candidate input(s) detected`);
  }

  inputs.forEach((input) => {
    if ((input as HTMLInputElement).readOnly || input.disabled) return;
    // Skip React Select / custom-select typing inputs — these are handled by fillOpenEndedWithAI
    // via the known-field path. Filling them here with applyValueToField produces wrong text.
    if (input instanceof HTMLInputElement && isCustomSelectInput(input)) return;
    const hint = getFieldHint(input);

    // Skip reCAPTCHA and other system fields
    if (/recaptcha|g-recaptcha|captcha/.test(hint)) {
      logger.debug(`Skipping system field — hint: "${hint.slice(0, 60)}"`);
      return;
    }

    // On Workday, skip country/state — these are cascading dropdowns that trigger
    // API calls using the text value as an internal ID, crashing the form when wrong
    if (isWorkday && /\bcountry\b|\bstate\b|\bprovince\b/.test(hint)) {
      logger.debug(`Skipping Workday cascading dropdown — hint: "${hint.slice(0, 60)}"`);
      return;
    }

    // Dev mode: restrict to a single field type for targeted testing
    if (inDevMode && devConfig?.testOnlyField && !hint.includes(devConfig.testOnlyField.toLowerCase())) {
      return;
    }

    const fieldLog: FieldLogEntry = {
      fieldName: (input as any).name || input.id || '',
      fieldType: (input as HTMLInputElement).type || input.tagName.toLowerCase(),
      fieldLabel: getFieldLabel(input),
      fieldHint: input.placeholder || '',
      filled: false,
      value: null,
      reason: null,
    };

    let matched = false;
    for (const { patterns, value, label } of mappings) {
      if (patterns.test(hint)) {
        if (!value) {
          fieldLog.reason = `Pattern matched "${label}" but no value in resume`;
          matched = true; // field was identified, just no data
          logger.debug(`✗ No value — matched "${label}" — hint: "${hint.slice(0, 80)}"`);
          break;
        }
        applyValueToField(input, value);
        filledCount++;
        matched = true;
        fieldLog.filled = true;
        fieldLog.value = value;
        logger.debug(`✓ Filled "${label}" — hint: "${hint.slice(0, 80)}"`);
        break;
      }
    }

    if (!matched) {
      fieldLog.reason = 'No matching pattern';
      logger.debug(`✗ No match — hint: "${hint.slice(0, 120)}"`);
    }

    fieldLogs.push(fieldLog);

    if (inDevMode && devConfig?.showDetectionSignals) {
      if (fieldLog.filled) {
        console.log(`%c  ✓ ${fieldLog.fieldLabel || hint.slice(0, 50)}`, 'color:#4caf50', `→ "${fieldLog.value}"`);
      } else {
        console.log(`%c  ✗ ${fieldLog.fieldLabel || hint.slice(0, 50)}`, 'color:#f44336', `— ${fieldLog.reason}`);
      }
    }
  });

  const totalFields = fieldLogs.length;
  logger.info(`Filled ${filledCount}/${totalFields} fields`);

  if (inDevMode) {
    console.log('%c[DEV] ══════════════════════════════', 'color:#2196f3');
    console.log(`%c[DEV] Filled ${filledCount}/${totalFields} fields`, 'color:#2196f3;font-weight:bold');
    console.log('%c[DEV] ══════════════════════════════', 'color:#2196f3');
    if (devConfig?.saveTestResults) {
      chrome.storage.local.set({ lastDevTestResult: {
        timestamp: new Date().toISOString(),
        testOnlyField: devConfig.testOnlyField,
        filledCount, totalFields,
        fields: fieldLogs.map(f => ({ label: f.fieldLabel, filled: f.filled, value: f.value, reason: f.reason })),
      }});
      console.log('[DEV] Results saved → chrome.storage lastDevTestResult');
    }
  }

  showFillNotification(filledCount, totalFields);

  // Fill radio button groups (sponsorship, work authorization, relocation, etc.)
  const radioLogs = fillRadioGroups(resumeData);

  // Try to get job context for log enrichment
  const jobData = extractJobData();

  return {
    fields: [...fieldLogs, ...radioLogs],
    jobTitle: jobData?.title || '',
    company: jobData?.company || '',
    boardType: detectBoardType(window.location.href),
  };
}

function getRadioGroupHint(radio: HTMLInputElement): string {
  // Prefer fieldset > legend
  const fieldset = radio.closest('fieldset');
  if (fieldset) {
    const legend = fieldset.querySelector('legend');
    if (legend?.textContent?.trim()) return legend.textContent.toLowerCase();
  }
  // Walk up looking for a standalone heading or role="group" label
  let ancestor = radio.parentElement;
  for (let i = 0; i < 6 && ancestor; i++) {
    const heading = ancestor.querySelector(':scope > h1,:scope > h2,:scope > h3,:scope > h4,:scope > legend,[role="group"] > span,[aria-label]');
    if (heading?.textContent?.trim()) return heading.textContent.toLowerCase();
    const ariaLabel = ancestor.getAttribute('aria-label') || ancestor.getAttribute('aria-labelledby');
    if (ariaLabel) return ariaLabel.toLowerCase();
    ancestor = ancestor.parentElement;
  }
  return radio.name.toLowerCase();
}

function fillRadioGroups(resumeData: any): FieldLogEntry[] {
  const p = resumeData?.personal;
  const radioInputs = document.querySelectorAll<HTMLInputElement>('input[type="radio"]');
  const groups = new Map<string, HTMLInputElement[]>();
  const logs: FieldLogEntry[] = [];

  radioInputs.forEach(radio => {
    const name = radio.name || '';
    if (!name) return;
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name)!.push(radio);
  });

  groups.forEach((radios, groupName) => {
    const hint = getRadioGroupHint(radios[0]);
    const label = getFieldLabel(radios[0]) || hint.slice(0, 80);

    let targetValue: 'yes' | 'no' | null = null;
    let matchedReason: string | null = null;

    // Use the shared known-field registry so radio groups stay in sync with
    // select elements and the user's resume data (no more hardcoded defaults).
    const known = getKnownFieldValue(hint, resumeData);
    const yesOrNo = known?.keywords.find(k => k === 'yes' || k === 'no');
    if (yesOrNo) {
      targetValue = yesOrNo as 'yes' | 'no';
    } else {
      matchedReason = 'No matching pattern for radio group';
    }

    if (!targetValue) {
      logs.push({
        fieldName: groupName,
        fieldType: 'radio',
        fieldLabel: label,
        fieldHint: hint.slice(0, 120),
        filled: false,
        value: null,
        reason: matchedReason || 'No matching pattern for radio group',
      });
      return;
    }

    // Find the radio whose value or label text matches yes/no
    const target = radios.find(r => {
      const val = r.value.toLowerCase();
      const labelEl = document.querySelector(`label[for="${r.id}"]`);
      const labelText = (labelEl?.textContent || r.parentElement?.textContent || '').toLowerCase();
      return val === targetValue || val.startsWith(targetValue!) || labelText.includes(targetValue!);
    });

    if (target) {
      target.checked = true;
      target.dispatchEvent(new Event('change', { bubbles: true }));
      target.dispatchEvent(new Event('click', { bubbles: true }));
      logger.debug(`✓ Radio "${groupName}" → "${targetValue}" (hint: "${hint.slice(0, 60)}")`);
      logs.push({
        fieldName: groupName,
        fieldType: 'radio',
        fieldLabel: label,
        fieldHint: hint.slice(0, 120),
        filled: true,
        value: targetValue,
        reason: null,
      });
    } else {
      logger.debug(`✗ Radio "${groupName}" — no option matched "${targetValue}"`);
      logs.push({
        fieldName: groupName,
        fieldType: 'radio',
        fieldLabel: label,
        fieldHint: hint.slice(0, 120),
        filled: false,
        value: null,
        reason: `No radio option matched "${targetValue}"`,
      });
    }
  });

  return logs;
}

function showFillNotification(filled: number, total: number, customMsg?: string) {
  document.getElementById('job-assistant-notif')?.remove();

  const notif = document.createElement('div');
  notif.id = 'job-assistant-notif';
  const success = filled > 0;
  const pct = total > 0 ? Math.round((filled / total) * 100) : 0;

  notif.style.cssText = [
    'position:fixed', 'top:20px', 'right:20px', 'z-index:2147483647',
    `background:${success ? '#1b3a1b' : '#3a1b1b'}`, 'color:#fff',
    'padding:12px 18px', 'border-radius:8px', 'font-size:14px',
    `border:1px solid ${success ? '#4caf50' : '#ff6b6b'}`,
    'box-shadow:0 4px 16px rgba(0,0,0,.4)', 'font-family:sans-serif',
    'max-width:320px', 'line-height:1.4'
  ].join(';');

  notif.textContent = customMsg
    || (success
      ? `✓ Filled ${filled}/${total} fields (${pct}%)`
      : `⚠ No fields could be auto-filled on this page`);

  document.body.appendChild(notif);
  setTimeout(() => notif.remove(), 5000);
}

// Ask background to generate an AI answer for an unfilled open-ended field
function requestAIAnswer(params: {
  fieldLabel: string;
  fieldHint: string;
  resumeContent: string;
  jobDescription: string;
  companyName: string;
}): Promise<{ answer: string; questionType: string; confidence: number } | null> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'generateAnswer', ...params }, (response) => {
      if (chrome.runtime.lastError) {
        logger.warn('generateAnswer error:', chrome.runtime.lastError.message);
        resolve(null);
      } else {
        resolve(response || null);
      }
    });
  });
}

// Second pass: fill any empty textarea/text/combobox fields that look like open-ended questions
async function fillOpenEndedWithAI(
  result: FillResult,
  resumeData: any,
  resumeContent: string,
  jobDescription: string
): Promise<void> {
  // Exclude aria-hidden inputs — these are hidden native backing inputs used by custom
  // select libraries for form submission only. Do NOT also exclude tabindex="-1" because
  // React Select's typing input may legitimately have tabindex="-1" in some configurations.
  const candidates = document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
    'textarea, input[type="text"]:not([aria-hidden="true"]), input:not([type]):not([aria-hidden="true"])'
  );

  for (const el of Array.from(candidates)) {
    if (el.value.trim() || (el as HTMLInputElement).readOnly || el.disabled) continue;
    if (/recaptcha|g-recaptcha|captcha/.test(el.name + el.id)) continue;

    const isInputEl = el instanceof HTMLInputElement;
    // Detect if this input lives inside a custom select/dropdown component
    const selectContainer = isInputEl ? findCustomSelectContainer(el as HTMLInputElement) : null;
    const isDropdown = selectContainer !== null;

    const fieldType = el instanceof HTMLTextAreaElement ? 'textarea' : 'text';
    // Use the rich hint (which includes ancestor label text) for detection
    const richHint = getFieldHint(el);
    const label = getFieldLabel(el) || el.placeholder || richHint.split(' ').slice(0, 8).join(' ');
    const hint = el.placeholder || '';

    // Custom selects: try AI for any labelled question field.
    // Plain text fields: only try if they look like an open question.
    if (!isDropdown && !isLikelyOpenQuestion(richHint, '', fieldType)) continue;

    const detected = detectQuestionType(richHint, '');
    if (!isDropdown && !detected.shouldTryAI) continue;

    // For custom dropdowns: check known fields first (work auth, sponsorship, gender,
    // Hispanic, race, veteran, disability) — no AI call needed for these.
    if (isDropdown && selectContainer) {
      const known = getKnownFieldValue(richHint, resumeData);
      if (known) {
        logger.debug(`Known-field fill (custom-select) "${known.label}": keyword="${known.keyword}"`);
        const filled = await activateCustomSelect(el as HTMLInputElement, selectContainer, known.keywords);
        if (filled) {
          const fieldName = el.name || el.id || '';
          result.fields.push({ fieldName, fieldType: 'select', fieldLabel: label, fieldHint: hint, filled: true, value: known.keyword, reason: `Known field: ${known.label}` });
        } else {
          logger.debug(`✗ Known-field: no matching option for "${known.label}" keyword="${known.keyword}"`);
        }
        continue; // don't call AI for these fields
      }
    }

    logger.debug(`AI attempting${isDropdown ? ' (custom-select)' : ''}: "${richHint.slice(0, 60)}"`);

    const aiResponse = await requestAIAnswer({
      fieldLabel: richHint.slice(0, 200),
      fieldHint: hint,
      resumeContent,
      jobDescription,
      companyName: result.company,
    });

    if (!aiResponse?.answer) {
      logger.debug(`✗ AI returned no answer (type: ${aiResponse?.questionType ?? 'null'})`);
      continue;
    }

    let filled = false;

    if (isDropdown && selectContainer) {
      // Click through the dropdown to select the matching option ("Yes", "No", etc.)
      // rather than typing the full AI-generated paragraph into the search input.
      // For AI answers: extract first keyword (e.g. "Yes, I am authorized" → "yes")
      const aiKeyword = aiResponse.answer.trim().split(/[\s,!.;:]/)[0].toLowerCase();
      filled = await activateCustomSelect(el as HTMLInputElement, selectContainer, [aiKeyword]);
      if (!filled) {
        logger.debug(`✗ Custom-select: no matching option for "${label.slice(0, 60)}"`);
        continue;
      }
    } else {
      applyValueToField(el, aiResponse.answer);
      filled = true;
    }
    // (note: known-field pre-check is handled above before the AI call)

    logger.debug(`✓ AI filled "${label.slice(0, 60)}" (${aiResponse.questionType}, ${aiResponse.confidence}%)`);

    // Update existing log entry if present, otherwise add one
    const fieldName = el.name || el.id || '';
    const existing = result.fields.find(
      f => (f.fieldName === fieldName && fieldName !== '') || f.fieldLabel === label
    );
    if (existing) {
      existing.filled = true;
      existing.value = aiResponse.answer;
      existing.reason = `Generated by Claude (${aiResponse.questionType})`;
      existing.generatedByAI = true;
      existing.confidence = aiResponse.confidence;
    } else {
      result.fields.push({
        fieldName,
        fieldType: isDropdown ? 'select' : fieldType,
        fieldLabel: label,
        fieldHint: hint,
        filled: true,
        value: aiResponse.answer,
        reason: `Generated by Claude (${aiResponse.questionType})`,
        generatedByAI: true,
        confidence: aiResponse.confidence,
      });
    }
  }
}

function requestCoverLetterGeneration(
  resumeContent: string,
  jobDescription: string,
  companyName: string,
  jobTitle: string
): Promise<string> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { action: 'generateCoverLetter', resumeContent, jobDescription, companyName, jobTitle },
      (response) => {
        if (chrome.runtime.lastError) resolve('');
        else resolve(response?.coverLetter || '');
      }
    );
  });
}

// Returns true if el is inside a "Cover Letter" section (not a Resume/CV section).
function isInCoverLetterSection(el: Element): boolean {
  let ancestor: Element | null = el.parentElement;
  let seenCoverLetter = false;
  for (let depth = 0; depth < 15 && ancestor && ancestor !== document.body; depth++) {
    const headings = ancestor.querySelectorAll('h1,h2,h3,h4,h5,h6,label,legend,strong');
    for (const h of Array.from(headings)) {
      const t = (h.textContent || '').toLowerCase();
      if (/cover\s*letter/i.test(t)) seenCoverLetter = true;
      // If a heading explicitly says "resume" or "cv" (but not inside a "cover letter" phrase),
      // this is the resume upload section — bail.
      if (/\bresume\b|\bcv\b|curriculum\s+vitae/i.test(t) && !/cover/i.test(t)) return false;
    }
    ancestor = ancestor.parentElement;
  }
  return seenCoverLetter;
}

// Find the "Enter manually" button that belongs to the Cover Letter section.
function findCoverLetterEnterManuallyButton(): HTMLElement | null {
  const buttons = Array.from(document.querySelectorAll<HTMLElement>(
    'button, [role="button"], a'
  )).filter(el => {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && /enter\s+manually/i.test(el.textContent || '');
  });
  return buttons.find(isInCoverLetterSection) || null;
}

async function fillCoverLetterField(
  result: FillResult,
  resumeContent: string,
  jobDescription: string
): Promise<void> {
  const btn = findCoverLetterEnterManuallyButton();
  if (!btn) return;

  // Snapshot which textareas exist before clicking
  const beforeSet = new Set(Array.from(document.querySelectorAll('textarea')));

  btn.click();
  await new Promise(r => setTimeout(r, 900));

  // Prefer a newly-inserted empty textarea; fall back to any visible empty one
  const allTextareas = Array.from(document.querySelectorAll<HTMLTextAreaElement>('textarea'));
  let ta = allTextareas.find(t => !beforeSet.has(t) && !t.value.trim());
  if (!ta) {
    ta = allTextareas.find(t => {
      if (t.value.trim() || t.disabled || t.readOnly) return false;
      const r = t.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
  }
  if (!ta) return;

  const coverLetter = await requestCoverLetterGeneration(
    resumeContent, jobDescription, result.company, result.jobTitle
  );
  if (!coverLetter) return;

  applyValueToField(ta, coverLetter);

  result.fields.push({
    fieldName: 'cover_letter',
    fieldType: 'textarea',
    fieldLabel: 'Cover Letter',
    fieldHint: '',
    filled: true,
    value: coverLetter.slice(0, 80) + '...',
    reason: 'AI-generated cover letter',
    generatedByAI: true,
    confidence: 85,
  });
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

  if (request.action === 'getJobData') {
    // Only respond from the main frame — iframes on the same tab also receive this
    // message (all_frames:true) and would race to respond first with null job data.
    if (window !== window.top) return;
    const jobData = extractJobData();
    sendResponse({ jobData });

  } else if (request.action === 'detectPageType') {
    if (window !== window.top) return;
    const pageType = detectPageType();
    const jobData = pageType === 'jobPosting' ? extractJobData() : null;
    sendResponse({ context: { type: pageType, jobData } });

  } else if (request.action === 'fillForm') {
    logger.debug('Form filling triggered. Has description:', request.hasDescription || false);
    const resumeData = request.resumeData || request.resume;
    const result = fillApplicationForm(resumeData);
    const selectLogs = fillSelectElements(resumeData);
    result.fields.push(...selectLogs);
    const resumeText: string = request.resume || '';
    const jobDescription: string = request.jobData?.description || '';

    fillOpenEndedWithAI(result, resumeData, resumeText, jobDescription)
      .then(() => fillCoverLetterField(result, resumeText, jobDescription))
      .then(() => {
        const filled = result.fields.filter(f => f.filled).length;
        const total  = result.fields.length;
        showFillNotification(filled, total);
        sendResponse({ success: true, ...result, devMode: isDev(), testOnlyField: getDevConfig().testOnlyField });
      });
    return true; // keep channel open for async response
  }
});

//logger.info('Content script loaded on', window.location.href);

// Initialise the selection toolbar. Must come after all functions are defined
// so applyValueToField is in scope when passed as the writer callback.
initSelectionToolbar(applyValueToField);

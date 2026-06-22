// Simplified popup: 3-button menu, no auto-analysis on open
import { ResumeData, JobData, FieldLogEntry, FormLogEntry } from '../types/resume';

// ── Resume text formatter ─────────────────────────────────────────────────────

function formatResumeAsText(resume: ResumeData): string {
  const lines: string[] = [];
  const p = resume.personal;
  const name = p.preferredName
    ? `${p.firstName} "${p.preferredName}" ${p.lastName}`
    : `${p.firstName} ${p.lastName}`;

  lines.push('=== PERSONAL INFORMATION ===');
  lines.push(`Name: ${name}`);
  lines.push(`Email: ${p.email}`);
  lines.push(`Phone: ${p.phone}`);
  const loc = typeof p.location === 'object'
    ? [p.location.city, p.location.state, p.location.country].filter(Boolean).join(', ')
    : (p.location as any) || '';
  lines.push(`Location: ${loc}`);
  if (p.willingToRelocate !== undefined) lines.push(`Willing to relocate: ${p.willingToRelocate ? 'Yes' : 'No'}`);
  if (p.ableToCommute   !== undefined) lines.push(`Able to commute: ${p.ableToCommute ? 'Yes' : 'No'}`);
  if (p.currentlyEmployed !== undefined) lines.push(`Currently employed: ${p.currentlyEmployed ? 'Yes' : 'No'}`);
  lines.push('');

  if (resume.workHistory.length > 0) {
    lines.push('=== WORK HISTORY ===');
    resume.workHistory.forEach((job) => {
      const period = job.isPresent ? `${job.startDate} – Present` : `${job.startDate} – ${job.endDate}`;
      lines.push(`${job.jobTitle} at ${job.company} (${period})`);
      if (job.description)  lines.push(`  Description: ${job.description}`);
      if (job.achievements) lines.push(`  Achievements: ${job.achievements}`);
    });
    lines.push('');
  }

  if (resume.education.length > 0) {
    lines.push('=== EDUCATION ===');
    resume.education.forEach((edu) => {
      const degreeField = [edu.degree, edu.fieldOfStudy].filter(Boolean).join(' in ');
      lines.push(`${edu.school}${degreeField ? ' — ' + degreeField : ''} (${edu.graduationDate})`);
    });
    lines.push('');
  }

  const s = resume.skills;
  const skillParts: string[] = [];
  if (s.backend)   skillParts.push(`Backend: ${s.backend}`);
  if (s.frontend)  skillParts.push(`Frontend: ${s.frontend}`);
  if (s.databases) skillParts.push(`Databases: ${s.databases}`);
  if (s.devops)    skillParts.push(`DevOps/Infrastructure: ${s.devops}`);
  if (s.other)     skillParts.push(`Other: ${s.other}`);
  if (skillParts.length > 0) {
    lines.push('=== SKILLS ===');
    skillParts.forEach((sp) => lines.push(sp));
    lines.push('');
  }

  return lines.join('\n');
}

// ── Storage helpers ───────────────────────────────────────────────────────────

async function getResume(): Promise<ResumeData | null> {
  return new Promise((resolve) => {
    chrome.storage.local.get(['resume'], (result: { [key: string]: any }) => {
      const stored = result.resume;
      resolve(stored?.personal ? (stored as ResumeData) : null);
    });
  });
}

async function saveFormLog(entry: FormLogEntry): Promise<void> {
  const stored = await chrome.storage.local.get(['formLogs']);
  const logs: FormLogEntry[] = (stored.formLogs as FormLogEntry[]) || [];
  logs.push(entry);
  if (logs.length > 50) logs.splice(0, logs.length - 50);
  await chrome.storage.local.set({ formLogs: logs });
}

// ── Content script / background helpers ──────────────────────────────────────

async function getActiveTabId(): Promise<number | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id ?? null;
}

async function getJobDataFromPage(): Promise<{ jobData: JobData | null; scriptNotLoaded: boolean }> {
  const tabId = await getActiveTabId();
  if (!tabId) return { jobData: null, scriptNotLoaded: false };
  return new Promise((resolve) => {
    // frameId: 0 = main frame only — prevents iframes (reCAPTCHA etc.) from racing
    // to respond first with null job data when all_frames:true is set in the manifest.
    chrome.tabs.sendMessage(tabId, { action: 'getJobData' }, { frameId: 0 }, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ jobData: null, scriptNotLoaded: true });
        return;
      }
      resolve({ jobData: response?.jobData || null, scriptNotLoaded: false });
    });
  });
}

async function requestMatchAnalysis(resumeText: string, jobData: JobData): Promise<{ percentage: number; analysis: string }> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { action: 'analyzeMatch', resume: resumeText, jobData },
      (response) => resolve(response || { percentage: 0, analysis: 'Error analyzing match.' })
    );
  });
}

async function requestCoverLetter(resumeText: string, jobDescription: string, company: string, jobTitle: string, question?: string): Promise<string> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({
      action: 'generateCoverLetter',
      resumeContent: resumeText,
      jobDescription,
      companyName: company,
      jobTitle,
      question,
    }, (response) => resolve(response?.coverLetter || ''));
  });
}

// ── UI state machine ──────────────────────────────────────────────────────────

type View = 'menu' | 'formFill' | 'analysis' | 'coverLetter' | 'error';

function showView(view: View) {
  const map: Record<View, string> = {
    menu:        'buttonContainer',
    formFill:    'formFillContainer',
    analysis:    'analysisContainer',
    coverLetter: 'coverLetterContainer',
    error:       'errorContainer',
  };
  Object.entries(map).forEach(([v, id]) => {
    document.getElementById(id)!.classList.toggle('hidden', v !== view);
  });
}

function showError(message: string) {
  document.getElementById('errorMessage')!.textContent = message;
  showView('error');
}

// ── Form fill helpers ─────────────────────────────────────────────────────────

function resetFormFillView() {
  document.getElementById('jobDescInput')!.classList.add('hidden');
  document.getElementById('jobDescChoices')!.classList.remove('hidden');
  (document.getElementById('hasJobDescBtn') as HTMLButtonElement).style.display = '';
  (document.getElementById('noJobDescBtn')  as HTMLButtonElement).style.display = '';
  (document.getElementById('jobDescriptionText') as HTMLTextAreaElement).value = '';
  document.getElementById('infoMsg')!.textContent = '';
  document.getElementById('fillingStatus')!.classList.add('hidden');
  document.getElementById('fillResult')!.classList.add('hidden');
  document.getElementById('doneFillingBtn')!.classList.add('hidden');
}

function triggerFormFill(resume: ResumeData, jobData: JobData | null, hasDescription: boolean) {
  const resumeText = formatResumeAsText(resume);

  document.getElementById('jobDescInput')!.classList.add('hidden');
  document.getElementById('jobDescChoices')!.classList.add('hidden');
  document.getElementById('fillingStatus')!.classList.remove('hidden');

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]?.id) return;
    const tabUrl = tabs[0].url || '';

    chrome.tabs.sendMessage(tabs[0].id, {
      action: 'fillForm',
      resumeData: resume,
      resume: resumeText,
      jobData,
      hasDescription,
    }, (response) => {
      document.getElementById('fillingStatus')!.classList.add('hidden');

      const fields: FieldLogEntry[] = response?.fields || [];
      const filledCount = fields.filter(f => f.filled).length;
      const totalCount  = fields.length;
      const pct = totalCount > 0 ? Math.round((filledCount / totalCount) * 100) : 0;

      const resultEl = document.getElementById('fillResult')!;
      const filledLabels  = fields.filter(f =>  f.filled).map(f => f.fieldLabel).filter(Boolean);
      const failedLabels  = fields.filter(f => !f.filled).map(f => f.fieldLabel).filter(Boolean);
      const devBadge = response?.devMode
        ? `<div style="background:#fff3cd;border:1px solid #ffc107;border-radius:3px;padding:5px 8px;margin-bottom:6px;font-size:11px;color:#856404;">
            🧪 <strong>DEV MODE</strong> — testing "${response.testOnlyField ?? 'all fields'}" — see F12 console
           </div>`
        : '';
      resultEl.innerHTML = `
        ${devBadge}
        <div style="font-weight:bold;margin-bottom:6px;">✅ Filled ${filledCount}/${totalCount} fields (${pct}%)</div>
        ${filledLabels.length ? `<div style="font-size:12px;margin-bottom:4px;"><strong>Filled:</strong> ${filledLabels.join(', ')}</div>` : ''}
        ${failedLabels.length ? `<div style="font-size:12px;color:#c62828;"><strong>Need attention:</strong> ${failedLabels.join(', ')}</div>` : ''}
      `;
      resultEl.classList.remove('hidden');
      document.getElementById('doneFillingBtn')!.classList.remove('hidden');

      saveFormLog({
        jobTitle:       response?.jobTitle || jobData?.title || '',
        company:        response?.company  || jobData?.company || '',
        boardType:      response?.boardType || 'Unknown',
        timestamp:      new Date().toISOString(),
        url:            tabUrl,
        jobDescription: hasDescription,
        fields,
        summary: {
          totalFields:  totalCount,
          filled:       filledCount,
          failed:       totalCount - filledCount,
          successRate:  pct,
        },
      });
    });
  });
}

// ── Main init ─────────────────────────────────────────────────────────────────

async function initPopup() {
  const resume = await getResume();

  // ── Settings button ────────────────────────────────────────────────────────
  document.getElementById('settingsBtn')?.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // ── Fill Form button — skip job-description dialog, fill immediately ────────
  document.getElementById('fillFormBtn')?.addEventListener('click', () => {
    if (!resume) { showError('No resume configured. Please edit your resume first.'); return; }
    showView('formFill');
    triggerFormFill(resume, null, false);
  });

  // ── Analyze button ─────────────────────────────────────────────────────────
  document.getElementById('analyzeBtn')?.addEventListener('click', async () => {
    if (!resume) { showError('No resume configured. Please edit your resume first.'); return; }

    showView('analysis');
    document.getElementById('matchPercentage')!.textContent = 'Analyzing…';
    document.getElementById('analysis')!.textContent = '';

    const { jobData, scriptNotLoaded } = await getJobDataFromPage();
    if (!jobData?.description) {
      showError(scriptNotLoaded
        ? 'Could not connect to the page. Please reload this tab and try again.'
        : 'No job description found. Make sure you are on a job posting page.');
      return;
    }

    const resumeText = formatResumeAsText(resume);
    const result = await requestMatchAnalysis(resumeText, jobData);

    document.getElementById('matchPercentage')!.textContent = `${result.percentage}%`;
    document.getElementById('analysis')!.textContent = result.analysis;
  });

  // ── Edit Resume button ─────────────────────────────────────────────────────
  document.getElementById('editResumeBtn')?.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // ── Done button (close popup after filling) ────────────────────────────────
  document.getElementById('doneFillingBtn')?.addEventListener('click', () => window.close());

  // ── Back buttons ───────────────────────────────────────────────────────────
  document.getElementById('backToMenuBtn')?.addEventListener('click',   () => showView('menu'));
  document.getElementById('backFromErrorBtn')?.addEventListener('click', () => showView('menu'));
  document.getElementById('backFromFillBtn')?.addEventListener('click',  () => showView('menu'));
  document.getElementById('backFromClBtn')?.addEventListener('click',    () => showView('menu'));

  // ── Cover Letter: shared generation helper ────────────────────────────────
  async function runCoverLetterGeneration(jobData: JobData | null, question: string, hasJD: boolean) {
    const statusEl     = document.getElementById('clStatus')!;
    const statusDetail = document.getElementById('clStatusDetail')!;
    const resultEl     = document.getElementById('clResult')!;
    const resultMsg    = document.getElementById('clResultMsg')!;
    const resultDetail = document.getElementById('clResultDetail')!;
    const errorEl      = document.getElementById('clError')!;
    const errorMsg     = document.getElementById('clErrorMsg')!;

    document.getElementById('clManualInput')!.classList.add('hidden');
    statusEl.classList.remove('hidden');
    resultEl.classList.add('hidden');
    errorEl.classList.add('hidden');

    statusDetail.textContent = hasJD
      ? `Tailoring to ${jobData?.title || 'this role'} at ${jobData?.company || 'this company'}…`
      : 'Generating from your resume…';

    const resumeText  = formatResumeAsText(resume!);
    const coverLetter = await requestCoverLetter(
      resumeText,
      jobData?.description || '',
      jobData?.company     || '',
      jobData?.title       || '',
      question || undefined
    );

    statusEl.classList.add('hidden');

    if (!coverLetter) {
      errorEl.classList.remove('hidden');
      errorMsg.textContent = 'Failed to generate. Check your API key in Settings.';
      return;
    }

    try {
      await navigator.clipboard.writeText(coverLetter);
      resultEl.classList.remove('hidden');
      resultMsg.textContent = '✅ Copied to clipboard!';
      resultDetail.textContent = hasJD
        ? `Tailored to: ${jobData?.title || 'this role'} at ${jobData?.company || 'this company'}`
        : 'Based on your resume — paste a job description for better results';
    } catch {
      errorEl.classList.remove('hidden');
      errorMsg.textContent = 'Generated but could not copy automatically. Try again.';
    }
  }

  // ── Cover Letter button ────────────────────────────────────────────────
  document.getElementById('coverLetterBtn')?.addEventListener('click', async () => {
    if (!resume) { showError('No resume configured. Please edit your resume first.'); return; }

    showView('coverLetter');
    document.getElementById('clManualInput')!.classList.add('hidden');
    document.getElementById('clStatus')!.classList.add('hidden');
    document.getElementById('clResult')!.classList.add('hidden');
    document.getElementById('clError')!.classList.add('hidden');
    (document.getElementById('clJobDesc')  as HTMLTextAreaElement).value = '';
    (document.getElementById('clQuestion') as HTMLTextAreaElement).value = '';
    document.getElementById('clManualInfoMsg')!.textContent = '';

    const { jobData, scriptNotLoaded } = await getJobDataFromPage();
    const hasJD = !!(jobData?.description);

    if (hasJD) {
      await runCoverLetterGeneration(jobData, '', true);
    } else {
      const manualDetail = document.getElementById('clManualDetail')!;
      manualDetail.textContent = scriptNotLoaded
        ? 'Page not connected — paste the job description below for a tailored letter.'
        : 'No job description detected on this page. Paste it below for a tailored letter.';
      document.getElementById('clManualInput')!.classList.remove('hidden');
    }
  });

  // ── Cover Letter: manual generate button ──────────────────────────────────
  document.getElementById('clGenerateBtn')?.addEventListener('click', async () => {
    const jobDesc  = (document.getElementById('clJobDesc')  as HTMLTextAreaElement).value.trim();
    const question = (document.getElementById('clQuestion') as HTMLTextAreaElement).value.trim();
    if (!jobDesc) {
      document.getElementById('clManualInfoMsg')!.textContent = 'Please paste a job description above.';
      return;
    }
    document.getElementById('clManualInfoMsg')!.textContent = '';
    const jobData: JobData = { title: '', company: '', description: jobDesc, url: '' };
    await runCoverLetterGeneration(jobData, question, true);
  });

  // ── Cover Letter: skip JD button ──────────────────────────────────────────
  document.getElementById('clSkipDescBtn')?.addEventListener('click', async () => {
    await runCoverLetterGeneration(null, '', false);
  });

  // ── Form fill: job description flow ───────────────────────────────────────
  document.getElementById('hasJobDescBtn')?.addEventListener('click', () => {
    document.getElementById('jobDescInput')!.classList.remove('hidden');
    (document.getElementById('hasJobDescBtn') as HTMLButtonElement).style.display = 'none';
    (document.getElementById('noJobDescBtn')  as HTMLButtonElement).style.display = 'none';
  });

  document.getElementById('cancelDescBtn')?.addEventListener('click', () => {
    document.getElementById('jobDescInput')!.classList.add('hidden');
    (document.getElementById('hasJobDescBtn') as HTMLButtonElement).style.display = '';
    (document.getElementById('noJobDescBtn')  as HTMLButtonElement).style.display = '';
    (document.getElementById('jobDescriptionText') as HTMLTextAreaElement).value = '';
    document.getElementById('infoMsg')!.textContent = '';
  });

  document.getElementById('analyzeWithDescBtn')?.addEventListener('click', () => {
    const jobDesc = (document.getElementById('jobDescriptionText') as HTMLTextAreaElement).value;
    if (!jobDesc.trim()) {
      document.getElementById('infoMsg')!.textContent = 'Please paste the job description above.';
      return;
    }
    document.getElementById('infoMsg')!.textContent = '';
    const jobData: JobData = { title: 'Job Position', company: 'Company Name', description: jobDesc, url: '' };
    triggerFormFill(resume!, jobData, true);
  });

  document.getElementById('noJobDescBtn')?.addEventListener('click', () => {
    triggerFormFill(resume!, null, false);
  });
}

document.addEventListener('DOMContentLoaded', initPopup);

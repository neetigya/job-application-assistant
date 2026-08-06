// Background service worker - handles Claude API calls and data management
import { JobData } from '../types/resume';
import { logger } from '../utils/logger';

const CLAUDE_MODEL        = 'claude-haiku-4-5-20251001'; // parsing, formatting, analysis
const CLAUDE_ANSWER_MODEL = 'claude-sonnet-4-6';          // answer generation, cover letters

const HUMAN_RULES = `

Writing rules (follow strictly):
- Never use em dashes (—) or en dashes (–). Use commas, periods, or parentheses instead.
- Write naturally and directly, the way a real person speaks. Avoid corporate buzzwords, AI-sounding filler phrases ("I am excited to leverage my passion for..."), and overly formal language.
- Be specific and confident, not generic. Reference concrete details from the candidate's background.
- Do not add a preamble, title, or markdown heading. Output only the requested text.`;

const NO_HEADER_RULE =
  'Output only the text itself. Do not add a title, heading, markdown header (no lines starting with #), or any preamble.';

async function getApiKey(): Promise<string> {
  return new Promise((resolve) => {
    chrome.storage.local.get(['apiKey'], (result: { [key: string]: any }) => {
      resolve(result.apiKey || '');
    });
  });
}

// Call Claude API to analyze job match
async function analyzeJobMatch(resume: string, jobData: JobData): Promise<{percentage: number; analysis: string}> {
  const apiKey = await getApiKey();
  if (!apiKey) {
    return { percentage: 0, analysis: 'No API key set. Please add your Claude API key in the extension options.' };
  }
  try {
    const prompt = `
You are a job application expert. Analyze how well this resume matches the job posting.

RESUME:
${resume}

JOB POSTING:
Title: ${jobData.title}
Company: ${jobData.company}
Description: ${jobData.description}

Please provide:
1. A match percentage (0-100) based on skills alignment, experience level, and job requirements
2. A brief 2-3 sentence analysis of the key matches and gaps

Format your response as:
PERCENTAGE: [number]
ANALYSIS: [your analysis]
`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 16000,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      })
    });

    if (!response.ok) {
      const error = await response.json();
      logger.error('Claude API error:', error);
      const msg = error?.error?.message || JSON.stringify(error);
      return {
        percentage: 0,
        analysis: `API error (${response.status}): ${msg}`
      };
    }

    const data = await response.json();
    const content = data.content[0].text;

    // Parse response
    const percentageMatch = content.match(/PERCENTAGE:\s*(\d+)/);
    const analysisMatch = content.match(/ANALYSIS:\s*(.+?)(?=\n|$)/s);

    const percentage = percentageMatch ? parseInt(percentageMatch[1]) : 0;
    const analysis = analysisMatch ? analysisMatch[1].trim() : content;

    return { percentage, analysis };
  } catch (error) {
    logger.error('Error calling Claude API:', error);
    return {
      percentage: 0,
      analysis: 'Error analyzing match. Please try again.'
    };
  }
}

// Save application record
async function saveApplicationRecord(jobData: JobData, analysis: any, timestamp: Date) {
  return new Promise((resolve) => {
    chrome.storage.local.get(['applications'], (result: { [key: string]: any }) => {
      const applications = result.applications || [];
      
      applications.push({
        jobTitle: jobData.title,
        company: jobData.company,
        jobUrl: jobData.url,
        timestamp: timestamp.toISOString(),
        analysis: analysis,
        status: 'applied' // or 'skipped', 'rejected'
      });

      chrome.storage.local.set({ applications }, () => {
        resolve(applications);
      });
    });
  });
}

// Generate an answer for a detected open-ended question
async function generateAnswerForQuestion(
  fieldLabel: string,
  fieldHint: string,
  resumeContent: string,
  jobDescription: string,
  companyName: string
): Promise<{ answer: string; questionType: string; confidence: number }> {
  const apiKey = await getApiKey();
  if (!apiKey) {
    return { answer: '', questionType: 'unknown', confidence: 0 };
  }

  const qaBank      = await getQABank();
  const qaBankBlock = formatQABankForPrompt(qaBank);

  const isWhyInterested = /why.*(interest|join|work|want|excit)|what.*excit|tell us why|motivated to/i.test(
    fieldLabel + ' ' + fieldHint
  );

  const questionType = isWhyInterested ? 'why_interested' : 'open_ended';

  const prompt = isWhyInterested
    ? `You are helping a job applicant write a genuine answer to this question. Read it carefully.

Question:
"${fieldLabel}"

Write 2-3 sentences that:
- Show specific knowledge of this company and role (use the job description, not generic praise)
- Connect one or two concrete things from the candidate's background to what makes this company/role appealing
- Sound like a real person who has actually read the job posting

CANDIDATE BACKGROUND:
${resumeContent}${qaBankBlock}

JOB DESCRIPTION:
${jobDescription || '(not provided)'}

Company: ${companyName || '(unknown)'}

Reply with only the answer text.` + HUMAN_RULES
    : `You are helping a job applicant write a genuine answer to this application question.

Question:
"${fieldLabel}"

Instructions:
1. Read the question carefully and answer ONLY what it asks — do not give a general career summary unless the question literally asks for one
2. Draw from ALL available information below: work history, skills, education, common questions, and the Q&A bank — pick the most relevant details for this specific question, not just the profile summary
3. Use the Q&A bank as your primary voice and style guide — if similar past answers exist, match their tone, sentence rhythm, and how candid/specific they are
4. Do NOT copy any block of text verbatim; synthesize a fresh answer that sounds like the same person who wrote those Q&A bank answers
5. Scale length to what the question invites: 1-2 sentences for simple factual questions; 2-4 sentences with a specific example or number for detailed "describe your experience" or "tell us about" prompts

CANDIDATE BACKGROUND:
${resumeContent}${qaBankBlock}

JOB DESCRIPTION:
${jobDescription || '(not provided)'}

Company: ${companyName || '(unknown)'}

Reply with only the answer text.` + HUMAN_RULES;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: CLAUDE_ANSWER_MODEL,
        max_tokens: 600,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      logger.error('generateAnswer API error:', err);
      return { answer: '', questionType, confidence: 0 };
    }

    const data = await response.json();
    const answer = cleanGeneratedText(data.content[0].text.trim());
    return { answer, questionType, confidence: 80 };
  } catch (error) {
    logger.error('generateAnswer error:', error);
    return { answer: '', questionType, confidence: 0 };
  }
}

async function generateCoverLetter(
  resumeContent: string,
  jobDescription: string,
  companyName: string,
  jobTitle: string,
  question?: string
): Promise<string> {
  const apiKey = await getApiKey();
  if (!apiKey) return '';

  const qaBank      = await getQABank();
  const qaBankBlock = formatQABankForPrompt(qaBank);

  const taskLine = question?.trim()
    ? `Task: ${question.trim()}`
    : 'Write a professional cover letter body for this job application.';

  const prompt = `${taskLine}

CANDIDATE BACKGROUND:
${resumeContent}${qaBankBlock}

JOB:
Title: ${jobTitle || '(not provided)'}
Company: ${companyName || '(not provided)'}
Description: ${jobDescription || '(not provided)'}

Requirements:
- 3-4 paragraphs, 300-400 words
- Opening: genuine enthusiasm for this specific role/company (no "I am writing to apply")
- Middle: 2-3 accomplishments from the resume that directly match the job requirements
- Closing: professional call to action
- No date, no address block, no "Dear Hiring Manager" salutation, no signature — body paragraphs only

Reply with only the cover letter body text.` + HUMAN_RULES;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: CLAUDE_ANSWER_MODEL,
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!response.ok) return '';
    const data = await response.json();
    return cleanGeneratedText((data.content[0].text || '').trim());
  } catch {
    return '';
  }
}

// ── Shared post-processing ────────────────────────────────────────────────────

function cleanGeneratedText(raw: string): string {
  return raw
    // Strip leading markdown headers
    .replace(/^#{1,6}\s+.+\n?/gm, '')
    // Em/en dash before a capital letter → start new sentence
    .replace(/\s*[—–]\s*([A-Z])/g, '. $1')
    // Remaining em/en dashes → comma
    .replace(/\s*[—–]\s*/g, ', ')
    .trim();
}

// ── Resume PDF Parser ─────────────────────────────────────────────────────────

async function parseResumeFromPDF(base64PDF: string): Promise<{ ok: boolean; data?: any; error?: string }> {
  const apiKey = await getApiKey();
  if (!apiKey) return { ok: false, error: 'no_key' };

  const prompt = `Extract all information from this resume PDF and return ONLY a raw JSON object — no markdown fences, no commentary, nothing else.

Use this exact structure (omit optional url if absent, use empty string for missing text, false for missing booleans, empty arrays for missing lists):

{
  "personal": {
    "firstName": "", "lastName": "", "email": "", "phone": "",
    "location": { "city": "", "state": "", "country": "" },
    "preferredName": "",
    "willingToRelocate": false, "ableToCommute": false, "currentlyEmployed": false,
    "workAuthorization": true, "requiresSponsorship": false
  },
  "profileSummary": "",
  "workHistory": [
    { "jobTitle": "", "company": "", "startDate": "", "endDate": "", "isPresent": false, "description": "", "achievements": "" }
  ],
  "education": [
    { "school": "", "degree": "", "fieldOfStudy": "", "graduationDate": "" }
  ],
  "skills": { "backend": "", "frontend": "", "databases": "", "devops": "", "other": "" },
  "projects": [
    { "name": "", "startDate": "", "endDate": "", "isPresent": false, "description": "", "techStack": "", "url": "" }
  ],
  "onlinePresence": { "portfolioUrl": "", "githubUrl": "", "linkedinUrl": "" }
}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'anthropic-beta': 'pdfs-2024-09-25',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 4096,
        messages: [{
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64PDF } },
            { type: 'text', text: prompt },
          ],
        }],
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return { ok: false, error: `api_${response.status}: ${(err as any)?.error?.message || ''}` };
    }

    const apiData = await response.json();
    const text = (apiData.content[0]?.text || '').trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();

    try {
      return { ok: true, data: JSON.parse(text) };
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) return { ok: true, data: JSON.parse(match[0]) };
      return { ok: false, error: 'parse_failed' };
    }
  } catch {
    return { ok: false, error: 'network' };
  }
}

// ── Personal Q&A Bank ─────────────────────────────────────────────────────────

async function getQABank(): Promise<Array<{ id: string; question: string; answer: string }>> {
  return new Promise(r => chrome.storage.local.get(['jae_qa_bank'], res => r(res.jae_qa_bank || [])));
}

function formatQABankForPrompt(qaBank: Array<{ question: string; answer: string }>): string {
  if (!qaBank.length) return '';
  return '\n\nPERSONAL Q&A REFERENCE — The candidate has previously answered questions like these. ' +
    'Use them as context and draw on them if the current question is similar:\n' +
    qaBank.map(q => `Q: ${q.question}\nA: ${q.answer}`).join('\n\n');
}

async function parsePersonalQA(
  freeText: string,
  existingQA: Array<{ id: string; question: string }>
): Promise<{ pairs: Array<{ question: string; answer: string; similarToId: string | null; similarToQuestion: string | null }>; error?: string }> {
  const apiKey = await getApiKey();
  if (!apiKey) return { pairs: [], error: 'no_key' };

  const existingBlock = existingQA.length > 0
    ? `\nEXISTING Q&A (for similarity detection — include the exact ID if similar):\n` +
      existingQA.map(q => `ID="${q.id}" Q: ${q.question}`).join('\n') + '\n'
    : '';

  const prompt =
    `Extract all question-answer pairs from the text below. The text may be informal or stream-of-consciousness.\n` +
    `\nRules:\n` +
    `- Rewrite each question as a clean, direct interview question\n` +
    `- Rewrite each answer in clean first-person prose, preserving the candidate's real content and examples\n` +
    `- Skip any question that has no associated answer in the text\n` +
    (existingQA.length > 0
      ? `- For each pair, check if it is semantically similar to an existing pair above. If so, set similarToId and similarToQuestion.\n`
      : '') +
    `${existingBlock}` +
    `\nReturn ONLY valid JSON, no markdown fences:\n` +
    `{"pairs":[{"question":"...","answer":"...","similarToId":null,"similarToQuestion":null}]}\n` +
    `\nTEXT:\n${freeText}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 8192,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      const msg = (err as any)?.error?.message || `HTTP ${response.status}`;
      return { pairs: [], error: msg };
    }
    const data = await response.json();
    const raw = (data.content[0].text || '').trim()
      .replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { pairs: [], error: `unexpected_response: ${raw.slice(0, 120)}` };
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      pairs: (parsed.pairs || []).map((p: any) => ({
        question:          String(p.question || ''),
        answer:            String(p.answer   || ''),
        similarToId:       p.similarToId       || null,
        similarToQuestion: p.similarToQuestion || null,
      })),
    };
  } catch (e: any) {
    return { pairs: [], error: e?.message || 'network_error' };
  }
}

// ── Explain text ─────────────────────────────────────────────────────────────

const LENGTH_CFG: Record<string, { instruction: string; maxTokens: number }> = {
  default:  { instruction: `Explain the following text clearly and concisely in 2–3 sentences. ${NO_HEADER_RULE}`, maxTokens: 300 },
  oneliner: { instruction: `Explain the following text in exactly one sentence. ${NO_HEADER_RULE}`, maxTokens: 120 },
  medium:   { instruction: `Explain the following text in a clear paragraph (4–6 sentences). ${NO_HEADER_RULE}`, maxTokens: 600 },
  detailed: { instruction: `Provide a detailed explanation of the following text, covering key concepts, context, and implications. ${NO_HEADER_RULE}`, maxTokens: 1200 },
};

async function explainText(
  text: string,
  length: string
): Promise<{ ok: boolean; text?: string; error?: string }> {
  const apiKey = await getApiKey();
  if (!apiKey) return { ok: false, error: 'no_key' };
  const cfg = LENGTH_CFG[length] ?? LENGTH_CFG.default;
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: cfg.maxTokens,
        messages: [{ role: 'user', content: `${cfg.instruction}\n\nText:\n${text}` }],
      }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return { ok: false, error: `api_${response.status}: ${(err as any)?.error?.message || ''}` };
    }
    const data = await response.json();
    return { ok: true, text: cleanGeneratedText((data.content[0].text || '').trim()) };
  } catch {
    return { ok: false, error: 'network' };
  }
}

// ── Format-in-place ───────────────────────────────────────────────────────────

const FORMAT_PROMPTS: Record<string, string> = {
  bullets:     'Convert the following text into concise bullet points. Start each bullet with "• ". Preserve all key information.' + HUMAN_RULES + '\n\nReturn only the bullet points.\n\nText:\n',
  clean:       'Fix grammar, spelling, and punctuation in the following text. Keep the original meaning and approximate length.' + HUMAN_RULES + '\n\nReturn only the corrected text.\n\nText:\n',
  rephrase:    'Rephrase the following text to improve clarity and flow while keeping the same meaning.' + HUMAN_RULES + '\n\nReturn only the rephrased text.\n\nText:\n',
  rephbullets: 'Rephrase the following text and format it as bullet points. Start each bullet with "• ". Preserve all key information.' + HUMAN_RULES + '\n\nReturn only the bullet points.\n\nText:\n',
  condense:    'Condense the following text to roughly half its length while keeping all key information.' + HUMAN_RULES + '\n\nReturn only the condensed text.\n\nText:\n',
  humanize:    'Rewrite the following text to sound natural, warm, and human. Remove corporate jargon and AI-sounding phrases.' + HUMAN_RULES + '\n\nReturn only the rewritten text.\n\nText:\n',
};

async function formatText(
  text: string,
  formatType: string
): Promise<{ ok: boolean; text?: string; error?: string }> {
  const apiKey = await getApiKey();
  if (!apiKey) return { ok: false, error: 'no_key' };

  const promptBase = FORMAT_PROMPTS[formatType];
  if (!promptBase) return { ok: false, error: 'unknown_format' };

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 2000,
        messages: [{ role: 'user', content: promptBase + text }],
      }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return { ok: false, error: `api_${response.status}: ${(err as any)?.error?.message || ''}` };
    }
    const data = await response.json();
    return { ok: true, text: (data.content[0].text || '').trim() };
  } catch (e) {
    return { ok: false, error: 'network' };
  }
}

// Listen for messages from popup and content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'analyzeMatch') {
    analyzeJobMatch(request.resume, request.jobData).then((result) => {
      sendResponse(result);
      // Optionally save the application record
      saveApplicationRecord(request.jobData, result, new Date());
    });
    return true; // Keep channel open for async response
  }

  if (request.action === 'generateAnswer') {
    generateAnswerForQuestion(
      request.fieldLabel,
      request.fieldHint || '',
      request.resumeContent || '',
      request.jobDescription || '',
      request.companyName || ''
    ).then((result) => sendResponse(result));
    return true; // Keep channel open for async response
  }

  if (request.action === 'generateCoverLetter') {
    generateCoverLetter(
      request.resumeContent || '',
      request.jobDescription || '',
      request.companyName || '',
      request.jobTitle || '',
      request.question || ''
    ).then((coverLetter) => sendResponse({ coverLetter }));
    return true;
  }

  if (request.action === 'formatText') {
    formatText(request.text || '', request.formatType || '').then(sendResponse);
    return true;
  }

  if (request.action === 'parsePersonalQA') {
    parsePersonalQA(request.freeText || '', request.existingQA || []).then(sendResponse);
    return true;
  }

  if (request.action === 'parseResumePDF') {
    parseResumeFromPDF(request.base64PDF || '').then(sendResponse);
    return true;
  }

  // Explain: do API call in background, then relay result to top frame
  if (request.action === 'jae_explain') {
    const tabId = sender.tab?.id;
    if (!tabId) { sendResponse({ ok: false, error: 'no_tab' }); return; }
    explainText(request.text || '', request.length || 'default').then((result) => {
      chrome.tabs.sendMessage(tabId, { action: 'jae_sidebar_show_explain', result }, { frameId: 0 },
        () => chrome.runtime.lastError); // suppress error if top frame not ready
      sendResponse({ ok: result.ok, error: result.error });
    });
    return true;
  }

  // Relay capture / open-sidebar messages from any frame → top frame
  if (
    request.action === 'jae_capture_jd' ||
    request.action === 'jae_capture_question' ||
    request.action === 'jae_open_sidebar'
  ) {
    const tabId = sender.tab?.id;
    if (!tabId) { sendResponse({ ok: true }); return; }
    chrome.tabs.sendMessage(tabId, request, { frameId: 0 }, (res) => {
      chrome.runtime.lastError; // consume error
      sendResponse(res || { ok: true });
    });
    return true;
  }
});

logger.info('Background script loaded');

// Options page script
import { ResumeData, WorkHistory, Education, ComplianceAnswers, Project } from '../types/resume';
import { getTestResumeData } from '../utils/testDataStub';

interface Question {
  id: string;
  question: string;
  answer: string;
}

interface Preferences {
  coverLetterStyle: string;
  emphasisAreas: string;
}

// ─── Resume form state ────────────────────────────────────────────────────────

let jobCount = 1;
let educationCount = 1;
let projectCount = 1;

// ─── Job entry builder ────────────────────────────────────────────────────────

function createJobEntry(index: number, data?: WorkHistory): HTMLElement {
  const entry = document.createElement('div');
  entry.className = 'job-entry';
  entry.dataset.index = String(index);

  entry.innerHTML = `
    <div class="entry-header">
      <h4>Job ${index}</h4>
      <button class="btn-remove" data-type="job">Remove</button>
    </div>

    <div class="form-row">
      <div class="form-group">
        <label>Job Title *</label>
        <input type="text" class="job-title" placeholder="Senior Software Engineer" value="${escapeAttr(data?.jobTitle ?? '')}">
        <span class="field-error" data-field="jobTitle">Job title is required.</span>
      </div>
      <div class="form-group">
        <label>Company *</label>
        <input type="text" class="job-company" placeholder="Acme Corp" value="${escapeAttr(data?.company ?? '')}">
        <span class="field-error" data-field="company">Company is required.</span>
      </div>
    </div>

    <div class="form-row">
      <div class="form-group">
        <label>Start Date *</label>
        <input type="text" class="job-start-date" placeholder="MM/YYYY" value="${escapeAttr(data?.startDate ?? '')}">
        <span class="field-error" data-field="startDate">Start date is required.</span>
      </div>
      <div class="form-group">
        <label>End Date</label>
        <input type="text" class="job-end-date" placeholder="MM/YYYY" value="${escapeAttr(data?.endDate ?? '')}"
          ${data?.isPresent ? 'disabled' : ''}>
      </div>
    </div>

    <div class="checkbox-row">
      <input type="checkbox" class="job-is-present" ${data?.isPresent ? 'checked' : ''}>
      <label>Currently working here</label>
    </div>

    <div class="form-group">
      <label>Description</label>
      <textarea class="job-description" placeholder="Describe your role and responsibilities...">${escapeHTML(data?.description ?? '')}</textarea>
    </div>

    <div class="form-group">
      <label>Key Achievements</label>
      <textarea class="job-achievements" placeholder="Quantifiable wins, notable projects...">${escapeHTML(data?.achievements ?? '')}</textarea>
    </div>
  `;

  // Toggle End Date when "Currently working here" is checked
  const isPresentChk = entry.querySelector<HTMLInputElement>('.job-is-present')!;
  const endDateInput = entry.querySelector<HTMLInputElement>('.job-end-date')!;

  isPresentChk.addEventListener('change', () => {
    endDateInput.disabled = isPresentChk.checked;
    if (isPresentChk.checked) endDateInput.value = '';
  });

  // Remove button
  const removeBtn = entry.querySelector<HTMLButtonElement>('.btn-remove')!;
  removeBtn.addEventListener('click', () => {
    entry.remove();
    refreshJobHeaders();
  });

  return entry;
}

function refreshJobHeaders() {
  const container = document.getElementById('jobEntriesContainer')!;
  const entries = container.querySelectorAll<HTMLElement>('.job-entry');
  entries.forEach((e, i) => {
    const h4 = e.querySelector('h4')!;
    h4.textContent = `Job ${i + 1}`;
    const btn = e.querySelector<HTMLButtonElement>('.btn-remove')!;
    btn.style.display = entries.length === 1 ? 'none' : '';
  });
  jobCount = entries.length;
}

// ─── Education entry builder ──────────────────────────────────────────────────

function createEducationEntry(index: number, data?: Education): HTMLElement {
  const entry = document.createElement('div');
  entry.className = 'education-entry';
  entry.dataset.index = String(index);

  entry.innerHTML = `
    <div class="entry-header">
      <h4>Education ${index}</h4>
      <button class="btn-remove" data-type="education">Remove</button>
    </div>

    <div class="form-row">
      <div class="form-group">
        <label>School / University *</label>
        <input type="text" class="edu-school" placeholder="MIT" value="${escapeAttr(data?.school ?? '')}">
        <span class="field-error" data-field="school">School is required.</span>
      </div>
      <div class="form-group">
        <label>Degree</label>
        <select class="edu-degree">
          <option value="">-- Select --</option>
          <option value="Bachelor's" ${data?.degree === "Bachelor's" ? 'selected' : ''}>Bachelor's</option>
          <option value="Master's" ${data?.degree === "Master's" ? 'selected' : ''}>Master's</option>
          <option value="PhD" ${data?.degree === 'PhD' ? 'selected' : ''}>PhD</option>
          <option value="Associate's" ${data?.degree === "Associate's" ? 'selected' : ''}>Associate's</option>
          <option value="Diploma" ${data?.degree === 'Diploma' ? 'selected' : ''}>Diploma</option>
          <option value="Certificate" ${data?.degree === 'Certificate' ? 'selected' : ''}>Certificate</option>
          <option value="Other" ${data?.degree === 'Other' ? 'selected' : ''}>Other</option>
        </select>
      </div>
    </div>

    <div class="form-row">
      <div class="form-group">
        <label>Field of Study</label>
        <input type="text" class="edu-field" placeholder="Computer Science" value="${escapeAttr(data?.fieldOfStudy ?? '')}">
      </div>
      <div class="form-group">
        <label>Graduation Date *</label>
        <input type="text" class="edu-grad-date" placeholder="MM/YYYY" value="${escapeAttr(data?.graduationDate ?? '')}">
        <span class="field-error" data-field="graduationDate">Graduation date is required.</span>
      </div>
    </div>
  `;

  const removeBtn = entry.querySelector<HTMLButtonElement>('.btn-remove')!;
  removeBtn.addEventListener('click', () => {
    entry.remove();
    refreshEducationHeaders();
  });

  return entry;
}

function refreshEducationHeaders() {
  const container = document.getElementById('educationEntriesContainer')!;
  const entries = container.querySelectorAll<HTMLElement>('.education-entry');
  entries.forEach((e, i) => {
    const h4 = e.querySelector('h4')!;
    h4.textContent = `Education ${i + 1}`;
    const btn = e.querySelector<HTMLButtonElement>('.btn-remove')!;
    btn.style.display = entries.length === 1 ? 'none' : '';
  });
  educationCount = entries.length;
}

// ─── Project entry builder ────────────────────────────────────────────────────

function createProjectEntry(index: number, data?: Project): HTMLElement {
  const entry = document.createElement('div');
  entry.className = 'project-entry';
  entry.dataset.index = String(index);

  entry.innerHTML = `
    <div class="entry-header">
      <h4>Project ${index}</h4>
      <button class="btn-remove" data-type="project">Remove</button>
    </div>

    <div class="form-row">
      <div class="form-group">
        <label>Project Name</label>
        <input type="text" class="proj-name" placeholder="My Awesome App" value="${escapeAttr(data?.name ?? '')}">
      </div>
      <div class="form-group">
        <label>URL</label>
        <input type="text" class="proj-url" placeholder="https://github.com/..." value="${escapeAttr(data?.url ?? '')}">
      </div>
    </div>

    <div class="form-row">
      <div class="form-group">
        <label>Start Date</label>
        <input type="text" class="proj-start-date" placeholder="MM/YYYY" value="${escapeAttr(data?.startDate ?? '')}">
      </div>
      <div class="form-group">
        <label>End Date</label>
        <input type="text" class="proj-end-date" placeholder="MM/YYYY" value="${escapeAttr(data?.endDate ?? '')}"
          ${data?.isPresent ? 'disabled' : ''}>
      </div>
    </div>

    <div class="checkbox-row">
      <input type="checkbox" class="proj-is-present" ${data?.isPresent ? 'checked' : ''}>
      <label>Currently working on this</label>
    </div>

    <div class="form-group">
      <label>Description</label>
      <textarea class="proj-description" placeholder="What does this project do?">${escapeHTML(data?.description ?? '')}</textarea>
    </div>

    <div class="form-group">
      <label>Tech Stack</label>
      <input type="text" class="proj-tech-stack" placeholder="React, TypeScript, Node.js..." value="${escapeAttr(data?.techStack ?? '')}">
    </div>
  `;

  const isPresentChk = entry.querySelector<HTMLInputElement>('.proj-is-present')!;
  const endDateInput = entry.querySelector<HTMLInputElement>('.proj-end-date')!;

  isPresentChk.addEventListener('change', () => {
    endDateInput.disabled = isPresentChk.checked;
    if (isPresentChk.checked) endDateInput.value = '';
  });

  const removeBtn = entry.querySelector<HTMLButtonElement>('.btn-remove')!;
  removeBtn.addEventListener('click', () => {
    entry.remove();
    refreshProjectHeaders();
  });

  return entry;
}

function refreshProjectHeaders() {
  const container = document.getElementById('projectEntriesContainer')!;
  const entries = container.querySelectorAll<HTMLElement>('.project-entry');
  entries.forEach((e, i) => {
    const h4 = e.querySelector('h4')!;
    h4.textContent = `Project ${i + 1}`;
    const btn = e.querySelector<HTMLButtonElement>('.btn-remove')!;
    btn.style.display = entries.length === 1 ? 'none' : '';
  });
  projectCount = entries.length;
}

// ─── Validation ───────────────────────────────────────────────────────────────

function setFieldError(errEl: HTMLElement | null, visible: boolean) {
  if (!errEl) return;
  errEl.classList.toggle('visible', visible);
}

function validateForm(): boolean {
  let valid = true;

  // Personal info
  const fields: Array<{ id: string; errId: string }> = [
    { id: 'firstName', errId: 'err-firstName' },
    { id: 'lastName', errId: 'err-lastName' },
    { id: 'email', errId: 'err-email' },
    { id: 'phone', errId: 'err-phone' },
    { id: 'city', errId: 'err-city' },
    { id: 'state', errId: 'err-state' },
  ];

  for (const { id, errId } of fields) {
    const input = document.getElementById(id) as HTMLInputElement;
    const err = document.getElementById(errId);
    const empty = !input.value.trim();
    setFieldError(err, empty);
    if (empty) valid = false;
  }

  // Radio button validation
  const radioValidations = [
    { name: 'willingToRelocate', errId: 'err-willingToRelocate' },
    { name: 'ableToCommute', errId: 'err-ableToCommute' },
  ];
  for (const { name, errId } of radioValidations) {
    const selected = document.querySelector(`input[name="${name}"]:checked`);
    const err = document.getElementById(errId);
    setFieldError(err, !selected);
    if (!selected) valid = false;
  }

  // Compliance required dropdowns
  const compRequired = [
    { id: 'comp_isAuthorized', errId: 'err-comp_isAuthorized' },
    { id: 'comp_requiresSponsorshipNow', errId: 'err-comp_requiresSponsorshipNow' },
  ];
  for (const { id, errId } of compRequired) {
    const sel = document.getElementById(id) as HTMLSelectElement | null;
    const err = document.getElementById(errId);
    const empty = !sel?.value;
    setFieldError(err, empty);
    if (empty) valid = false;
  }

  // Work history: at least 1 job with title, company, startDate
  const jobContainer = document.getElementById('jobEntriesContainer')!;
  const jobEntries = jobContainer.querySelectorAll<HTMLElement>('.job-entry');

  if (jobEntries.length === 0) {
    valid = false;
  }

  jobEntries.forEach((entry) => {
    const titleInput = entry.querySelector<HTMLInputElement>('.job-title')!;
    const companyInput = entry.querySelector<HTMLInputElement>('.job-company')!;
    const startDateInput = entry.querySelector<HTMLInputElement>('.job-start-date')!;

    const titleErr = entry.querySelector<HTMLElement>('[data-field="jobTitle"]');
    const companyErr = entry.querySelector<HTMLElement>('[data-field="company"]');
    const startDateErr = entry.querySelector<HTMLElement>('[data-field="startDate"]');

    const titleEmpty = !titleInput.value.trim();
    const companyEmpty = !companyInput.value.trim();
    const startDateEmpty = !startDateInput.value.trim();

    setFieldError(titleErr, titleEmpty);
    setFieldError(companyErr, companyEmpty);
    setFieldError(startDateErr, startDateEmpty);

    if (titleEmpty || companyEmpty || startDateEmpty) valid = false;
  });

  // Education: at least 1 entry with school and graduationDate
  const eduContainer = document.getElementById('educationEntriesContainer')!;
  const eduEntries = eduContainer.querySelectorAll<HTMLElement>('.education-entry');

  if (eduEntries.length === 0) {
    valid = false;
  }

  eduEntries.forEach((entry) => {
    const schoolInput = entry.querySelector<HTMLInputElement>('.edu-school')!;
    const gradDateInput = entry.querySelector<HTMLInputElement>('.edu-grad-date')!;

    const schoolErr = entry.querySelector<HTMLElement>('[data-field="school"]');
    const gradDateErr = entry.querySelector<HTMLElement>('[data-field="graduationDate"]');

    const schoolEmpty = !schoolInput.value.trim();
    const gradDateEmpty = !gradDateInput.value.trim();

    setFieldError(schoolErr, schoolEmpty);
    setFieldError(gradDateErr, gradDateEmpty);

    if (schoolEmpty || gradDateEmpty) valid = false;
  });

  return valid;
}

// ─── Build resume object ──────────────────────────────────────────────────────

function buildResumeObject(): ResumeData {
  const getVal = (id: string) =>
    (document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value.trim();

  // Personal
  const hasPreferred = (document.getElementById('hasPreferredName') as HTMLInputElement).checked;
  const personal: ResumeData['personal'] = {
    firstName: getVal('firstName'),
    lastName: getVal('lastName'),
    email: getVal('email'),
    phone: getVal('phone'),
    location: {
      city: getVal('city'),
      state: getVal('state'),
      country: getVal('country') || 'United States',
    },
    willingToRelocate: (document.querySelector('input[name="willingToRelocate"]:checked') as HTMLInputElement)?.value === 'yes',
    ableToCommute: (document.querySelector('input[name="ableToCommute"]:checked') as HTMLInputElement)?.value === 'yes',
    currentlyEmployed: (document.querySelector('input[name="currentlyEmployed"]:checked') as HTMLInputElement)?.value === 'yes',
  };
  if (hasPreferred) {
    personal.preferredName = getVal('preferredName');
  }

  // Work History
  const workHistory: WorkHistory[] = [];
  const jobEntries = document.querySelectorAll<HTMLElement>('.job-entry');
  jobEntries.forEach((entry) => {
    const isPresent = entry.querySelector<HTMLInputElement>('.job-is-present')!.checked;
    workHistory.push({
      jobTitle: entry.querySelector<HTMLInputElement>('.job-title')!.value.trim(),
      company: entry.querySelector<HTMLInputElement>('.job-company')!.value.trim(),
      startDate: entry.querySelector<HTMLInputElement>('.job-start-date')!.value.trim(),
      endDate: isPresent ? '' : entry.querySelector<HTMLInputElement>('.job-end-date')!.value.trim(),
      isPresent,
      description: entry.querySelector<HTMLTextAreaElement>('.job-description')!.value.trim(),
      achievements: entry.querySelector<HTMLTextAreaElement>('.job-achievements')!.value.trim(),
    });
  });

  // Education
  const education: Education[] = [];
  const eduEntries = document.querySelectorAll<HTMLElement>('.education-entry');
  eduEntries.forEach((entry) => {
    education.push({
      school: entry.querySelector<HTMLInputElement>('.edu-school')!.value.trim(),
      degree: entry.querySelector<HTMLSelectElement>('.edu-degree')!.value,
      fieldOfStudy: entry.querySelector<HTMLInputElement>('.edu-field')!.value.trim(),
      graduationDate: entry.querySelector<HTMLInputElement>('.edu-grad-date')!.value.trim(),
    });
  });

  // Skills
  const skills: ResumeData['skills'] = {
    backend: getVal('skillsBackend'),
    frontend: getVal('skillsFrontend'),
    databases: getVal('skillsDatabases'),
    devops: getVal('skillsDevops'),
    other: getVal('skillsOther'),
  };

  // Projects
  const projects: Project[] = [];
  const projEntries = document.querySelectorAll<HTMLElement>('.project-entry');
  projEntries.forEach((entry) => {
    const isPresent = entry.querySelector<HTMLInputElement>('.proj-is-present')!.checked;
    const urlVal = entry.querySelector<HTMLInputElement>('.proj-url')!.value.trim();
    projects.push({
      name: entry.querySelector<HTMLInputElement>('.proj-name')!.value.trim(),
      startDate: entry.querySelector<HTMLInputElement>('.proj-start-date')!.value.trim(),
      endDate: isPresent ? '' : entry.querySelector<HTMLInputElement>('.proj-end-date')!.value.trim(),
      isPresent,
      description: entry.querySelector<HTMLTextAreaElement>('.proj-description')!.value.trim(),
      techStack: entry.querySelector<HTMLInputElement>('.proj-tech-stack')!.value.trim(),
      ...(urlVal ? { url: urlVal } : {}),
    });
  });

  const profileSummary = (document.getElementById('profileSummary') as HTMLTextAreaElement)?.value.trim() || undefined;

  const onlinePresence = {
    portfolioUrl: (document.getElementById('portfolioUrl') as HTMLInputElement)?.value.trim() || undefined,
    githubUrl: (document.getElementById('githubUrl') as HTMLInputElement)?.value.trim() || undefined,
    linkedinUrl: (document.getElementById('linkedinUrl') as HTMLInputElement)?.value.trim() || undefined,
  };

  const commonQuestions = {
    expectedSalary: (document.getElementById('expectedSalary') as HTMLInputElement)?.value.trim() || undefined,
    yearsOfLeadership: (document.getElementById('yearsOfLeadership') as HTMLInputElement)?.value.trim() || undefined,
    noticePeriod: (document.getElementById('noticePeriod') as HTMLInputElement)?.value.trim() || undefined,
    willingToTravel: (document.getElementById('willingToTravel') as HTMLInputElement)?.checked || false,
  };

  const strToBool = (v: string): boolean | undefined =>
    v === 'true' ? true : v === 'false' ? false : undefined;

  const isAuthVal = strToBool(getVal('comp_isAuthorized'));
  const reqNowVal = strToBool(getVal('comp_requiresSponsorshipNow'));
  const reqFutVal = strToBool(getVal('comp_requiresSponsorshipFuture'));
  const hispVal = getVal('comp_isHispanicLatino');
  const lgbtqRaw = getVal('comp_lgbtqIdentity');

  const compliance: ComplianceAnswers = {
    workAuthorization: {
      isAuthorized: isAuthVal ?? true,
      requiresSponsorshipNow: reqNowVal ?? false,
      requiresSponsorshipFuture: reqFutVal ?? false,
    },
    veteranStatus: (getVal('comp_veteranStatus') as ComplianceAnswers['veteranStatus']) || 'prefer_not_to_say',
    disabilityStatus: (getVal('comp_disabilityStatus') as ComplianceAnswers['disabilityStatus']) || 'prefer_not_to_say',
    genderIdentity: (getVal('comp_genderIdentity') as ComplianceAnswers['genderIdentity']) || 'prefer_not_to_say',
    genderSelfDescribe: getVal('comp_genderSelfDescribe') || undefined,
    raceEthnicity: (getVal('comp_raceEthnicity') as ComplianceAnswers['raceEthnicity']) || 'prefer_not_to_say',
    isHispanicLatino: hispVal === 'true' ? true : hispVal === 'false' ? false : undefined,
    lgbtqIdentity: (lgbtqRaw as ComplianceAnswers['lgbtqIdentity']) || null,
  };

  return { personal, workHistory, education, skills, profileSummary, onlinePresence, compliance, commonQuestions, projects, lastUpdated: new Date().toISOString() };
}

// ─── Populate form from stored data ──────────────────────────────────────────

function populateForm(data: ResumeData) {
  const setVal = (id: string, value: string) => {
    const el = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
    if (el) el.value = value;
  };

  // Personal
  setVal('firstName', data.personal.firstName);
  setVal('lastName', data.personal.lastName);
  setVal('email', data.personal.email);
  setVal('phone', data.personal.phone);
  setVal('city', data.personal.location.city);
  setVal('state', data.personal.location.state);
  setVal('country', data.personal.location.country || 'United States');

  if (data.personal.preferredName) {
    (document.getElementById('hasPreferredName') as HTMLInputElement).checked = true;
    const group = document.getElementById('preferredNameGroup')!;
    group.style.display = '';
    setVal('preferredName', data.personal.preferredName);
  }

  // Radio buttons
  const setRadio = (name: string, value: boolean) => {
    const yes = document.querySelector(`input[name="${name}"][value="yes"]`) as HTMLInputElement;
    const no = document.querySelector(`input[name="${name}"][value="no"]`) as HTMLInputElement;
    if (yes) yes.checked = value;
    if (no) no.checked = !value;
  };
  setRadio('willingToRelocate', data.personal.willingToRelocate);
  setRadio('ableToCommute', data.personal.ableToCommute);
  setRadio('currentlyEmployed', data.personal.currentlyEmployed);

  // Work History
  const jobContainer = document.getElementById('jobEntriesContainer')!;
  jobContainer.innerHTML = '';
  if (data.workHistory.length > 0) {
    data.workHistory.forEach((job, i) => {
      jobContainer.appendChild(createJobEntry(i + 1, job));
    });
    jobCount = data.workHistory.length;
  } else {
    jobContainer.appendChild(createJobEntry(1));
    jobCount = 1;
  }
  refreshJobHeaders();

  // Education
  const eduContainer = document.getElementById('educationEntriesContainer')!;
  eduContainer.innerHTML = '';
  if (data.education.length > 0) {
    data.education.forEach((edu, i) => {
      eduContainer.appendChild(createEducationEntry(i + 1, edu));
    });
    educationCount = data.education.length;
  } else {
    eduContainer.appendChild(createEducationEntry(1));
    educationCount = 1;
  }
  refreshEducationHeaders();

  // Projects
  const projContainer = document.getElementById('projectEntriesContainer')!;
  projContainer.innerHTML = '';
  if (data.projects && data.projects.length > 0) {
    data.projects.forEach((proj, i) => {
      projContainer.appendChild(createProjectEntry(i + 1, proj));
    });
    projectCount = data.projects.length;
  } else {
    projContainer.appendChild(createProjectEntry(1));
    projectCount = 1;
  }
  refreshProjectHeaders();

  // Skills
  setVal('skillsBackend', data.skills.backend);
  setVal('skillsFrontend', data.skills.frontend);
  setVal('skillsDatabases', data.skills.databases);
  setVal('skillsDevops', data.skills.devops);
  setVal('skillsOther', data.skills.other);

  // Profile Summary
  if (data.profileSummary) {
    const el = document.getElementById('profileSummary') as HTMLTextAreaElement;
    if (el) el.value = data.profileSummary;
  }

  // Online Presence
  if (data.onlinePresence) {
    const setUrl = (id: string, val?: string) => {
      const el = document.getElementById(id) as HTMLInputElement;
      if (el && val) el.value = val;
    };
    setUrl('portfolioUrl', data.onlinePresence.portfolioUrl);
    setUrl('githubUrl', data.onlinePresence.githubUrl);
    setUrl('linkedinUrl', data.onlinePresence.linkedinUrl);
  }

  // Compliance — load from new compliance object, or auto-migrate from old fields
  const setComp = (id: string, val: string | undefined) => {
    if (val === undefined) return;
    const el = document.getElementById(id) as HTMLSelectElement | HTMLInputElement | null;
    if (el) el.value = val;
  };

  if (data.compliance) {
    const c = data.compliance;
    const boolStr = (v: boolean | undefined) => v === undefined ? '' : String(v);
    setComp('comp_isAuthorized', boolStr(c.workAuthorization?.isAuthorized));
    setComp('comp_requiresSponsorshipNow', boolStr(c.workAuthorization?.requiresSponsorshipNow));
    setComp('comp_requiresSponsorshipFuture', boolStr(c.workAuthorization?.requiresSponsorshipFuture));
    setComp('comp_veteranStatus', c.veteranStatus);
    setComp('comp_disabilityStatus', c.disabilityStatus);
    setComp('comp_genderIdentity', c.genderIdentity);
    if (c.genderSelfDescribe) setComp('comp_genderSelfDescribe', c.genderSelfDescribe);
    setComp('comp_isHispanicLatino',
      c.isHispanicLatino === true ? 'true' : c.isHispanicLatino === false ? 'false' : '');
    setComp('comp_raceEthnicity', c.raceEthnicity);
    setComp('comp_lgbtqIdentity', c.lgbtqIdentity ?? '');
    if (c.genderIdentity === 'self_describe') {
      const label = document.getElementById('comp_genderSelfDescribeLabel');
      if (label) label.style.display = '';
    }
  } else {
    // Auto-migrate from old data format so existing saved resume is not lost
    const p = data.personal;
    const vd = data.voluntaryDisclosure;
    if (p?.workAuthorization !== undefined) setComp('comp_isAuthorized', String(p.workAuthorization));
    if (p?.requiresSponsorship !== undefined) {
      setComp('comp_requiresSponsorshipNow', String(p.requiresSponsorship));
      setComp('comp_requiresSponsorshipFuture', String(p.requiresSponsorship));
    }
    if (vd?.gender) {
      const gMap: Record<string, string> = { male: 'male', female: 'female', 'non-binary': 'non_binary', prefer_not_to_say: 'prefer_not_to_say' };
      setComp('comp_genderIdentity', gMap[vd.gender] ?? '');
    }
    if (vd?.hispanicLatino) {
      setComp('comp_isHispanicLatino', vd.hispanicLatino === 'yes' ? 'true' : vd.hispanicLatino === 'no' ? 'false' : '');
    }
    if (vd?.race) {
      const rMap: Record<string, string> = {
        'White': 'white', 'White (Not Hispanic or Latino)': 'white',
        'Black or African American': 'black_african_american',
        'Hispanic or Latino': 'hispanic_latino',
        'Asian': 'asian',
        'American Indian or Alaska Native': 'american_indian_alaskan_native',
        'Native Hawaiian or Pacific Islander': 'native_hawaiian_pacific_islander',
        'Two or More Races': 'two_or_more_races',
        prefer_not_to_say: 'prefer_not_to_say',
      };
      setComp('comp_raceEthnicity', rMap[vd.race] ?? '');
    }
    if (vd?.veteranStatus) {
      const vtMap: Record<string, string> = {
        'Not a Protected Veteran': 'not_a_veteran',
        'Protected Veteran': 'protected_veteran',
        prefer_not_to_say: 'prefer_not_to_say',
      };
      setComp('comp_veteranStatus', vtMap[vd.veteranStatus] ?? '');
    }
    if (vd?.disabilityStatus) {
      const dMap: Record<string, string> = { yes: 'yes_have_disability', no: 'no_disability', prefer_not_to_say: 'prefer_not_to_say' };
      setComp('comp_disabilityStatus', dMap[vd.disabilityStatus] ?? '');
    }
  }

  // Common Questions
  if (data.commonQuestions) {
    const setField = (id: string, val?: string | boolean) => {
      const el = document.getElementById(id);
      if (!el || val === undefined) return;
      if (el instanceof HTMLInputElement && el.type === 'checkbox') {
        el.checked = Boolean(val);
      } else if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        el.value = String(val);
      }
    };
    setField('expectedSalary', data.commonQuestions.expectedSalary);
    setField('yearsOfLeadership', data.commonQuestions.yearsOfLeadership);
    setField('noticePeriod', data.commonQuestions.noticePeriod);
    setField('willingToTravel', data.commonQuestions.willingToTravel);
  }
}

// ─── Save Resume ──────────────────────────────────────────────────────────────

document.getElementById('saveResumeBtn')?.addEventListener('click', () => {
  if (!validateForm()) {
    showStatus('resumeStatus', 'Please fill in all required fields.', 'error');
    return;
  }

  const resumeData = { ...buildResumeObject(), lastUpdated: new Date().toISOString() };
  console.log('Saving resume:', JSON.stringify(resumeData, null, 2));

  chrome.storage.local.set({ resume: resumeData }, () => {
    showStatus('resumeStatus', 'Resume saved successfully!', 'success');
  });
});

// ─── Add job / education buttons ─────────────────────────────────────────────

document.getElementById('addJobBtn')?.addEventListener('click', () => {
  const container = document.getElementById('jobEntriesContainer')!;
  jobCount += 1;
  container.appendChild(createJobEntry(jobCount));
  refreshJobHeaders();
});

document.getElementById('addEducationBtn')?.addEventListener('click', () => {
  const container = document.getElementById('educationEntriesContainer')!;
  educationCount += 1;
  container.appendChild(createEducationEntry(educationCount));
  refreshEducationHeaders();
});

document.getElementById('addProjectBtn')?.addEventListener('click', () => {
  const container = document.getElementById('projectEntriesContainer')!;
  projectCount += 1;
  container.appendChild(createProjectEntry(projectCount));
  refreshProjectHeaders();
});

// ─── Preferred name toggle ────────────────────────────────────────────────────

document.getElementById('comp_genderIdentity')?.addEventListener('change', (e) => {
  const val = (e.target as HTMLSelectElement).value;
  const label = document.getElementById('comp_genderSelfDescribeLabel');
  if (label) label.style.display = val === 'self_describe' ? '' : 'none';
  if (val !== 'self_describe') {
    const inp = document.getElementById('comp_genderSelfDescribe') as HTMLInputElement | null;
    if (inp) inp.value = '';
  }
});

document.getElementById('hasPreferredName')?.addEventListener('change', (e) => {
  const checked = (e.target as HTMLInputElement).checked;
  const group = document.getElementById('preferredNameGroup')!;
  group.style.display = checked ? '' : 'none';
  if (!checked) {
    (document.getElementById('preferredName') as HTMLInputElement).value = '';
  }
});

document.getElementById('wantToDisclose')?.addEventListener('change', (e) => {
  const checked = (e.target as HTMLInputElement).checked;
  const fields = document.getElementById('disclosureFields')!;
  fields.style.display = checked ? '' : 'none';
});

// ─── API Key ──────────────────────────────────────────────────────────────────

document.getElementById('saveApiKeyBtn')?.addEventListener('click', () => {
  const apiKey = (document.getElementById('apiKey') as HTMLInputElement).value;

  if (!apiKey.startsWith('sk-ant-')) {
    showStatus('apiKeyStatus', 'Invalid API key format', 'error');
    return;
  }

  chrome.storage.local.set({ apiKey }, () => {
    showStatus('apiKeyStatus', 'API key saved successfully!', 'success');
  });
});

// ─── Preferences ─────────────────────────────────────────────────────────────

document.getElementById('savePreferencesBtn')?.addEventListener('click', () => {
  const preferences: Preferences = {
    coverLetterStyle: (document.getElementById('coverLetterStyle') as HTMLSelectElement).value,
    emphasisAreas: (document.getElementById('emphasisAreas') as HTMLTextAreaElement).value,
  };

  chrome.storage.local.set({ preferences }, () => {
    showStatus('preferencesStatus', 'Preferences saved!', 'success');
  });
});

// ─── Personal Q&A Bank ────────────────────────────────────────────────────────

const QA_BANK_KEY = 'jae_qa_bank';

interface QABankEntry {
  id: string;
  question: string;
  answer: string;
  addedAt: number;
}

interface ParsedPair {
  question: string;
  answer: string;
  similarToId: string | null;
  similarToQuestion: string | null;
}

function genQAId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function loadQABank(): Promise<QABankEntry[]> {
  return new Promise(r => {
    chrome.storage.local.get([QA_BANK_KEY, 'questions'], result => {
      let bank: QABankEntry[] = (result[QA_BANK_KEY] as QABankEntry[]) || [];
      // One-time migration from the old 'questions' key
      if (bank.length === 0 && (result.questions as Question[] || []).length > 0) {
        bank = (result.questions as Question[]).map(q => ({
          id:       q.id || genQAId(),
          question: q.question || '',
          answer:   q.answer   || '',
          addedAt:  parseInt(q.id) || Date.now(),
        }));
        chrome.storage.local.set({ [QA_BANK_KEY]: bank });
      }
      r(bank);
    });
  });
}

function saveQABankToStorage(bank: QABankEntry[]): Promise<void> {
  return new Promise(r => chrome.storage.local.set({ [QA_BANK_KEY]: bank }, r));
}

function renderQABank(bank: QABankEntry[]): void {
  const list     = document.getElementById('qaBankList')!;
  const header   = document.getElementById('qaBankHeader')!;
  header.textContent = bank.length
    ? `Saved Q&A Bank (${bank.length} ${bank.length === 1 ? 'entry' : 'entries'})`
    : 'Saved Q&A Bank';
  list.innerHTML = '';

  if (!bank.length) {
    list.innerHTML = '<div class="qa-bank-empty">No Q&A pairs saved yet.</div>';
    return;
  }

  bank.forEach(entry => {
    const item = document.createElement('div');
    item.className = 'qa-bank-item';
    item.dataset.id = entry.id;

    const preview = entry.answer.length > 160 ? entry.answer.slice(0, 160) + '…' : entry.answer;

    item.innerHTML = `
      <div class="qa-view">
        <div class="qa-q">${escapeHTML(entry.question)}</div>
        <div class="qa-a">${escapeHTML(preview)}</div>
        <div class="qa-actions">
          <button class="btn-secondary" style="font-size:12px;padding:5px 12px;" data-action="edit">Edit</button>
          <button class="btn-secondary" style="font-size:12px;padding:5px 12px;color:#ff6b6b;border-color:#5e2e2e;" data-action="delete">Delete</button>
        </div>
      </div>
      <div class="qa-edit-form">
        <div class="form-group" style="margin-bottom:10px;">
          <label>Question</label>
          <input type="text" class="qa-edit-q" value="${escapeAttr(entry.question)}">
        </div>
        <div class="form-group" style="margin-bottom:10px;">
          <label>Answer</label>
          <textarea class="qa-edit-a" style="min-height:90px;">${escapeHTML(entry.answer)}</textarea>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn-primary" style="font-size:12px;padding:5px 14px;" data-action="save-edit">Save</button>
          <button class="btn-secondary" style="font-size:12px;padding:5px 14px;" data-action="cancel-edit">Cancel</button>
        </div>
      </div>
    `;

    item.addEventListener('click', async (e) => {
      const btn = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
      if (!btn) return;
      const action = btn.dataset.action;
      const id = item.dataset.id!;

      if (action === 'edit') {
        item.classList.add('editing');
        (item.querySelector('.qa-edit-q') as HTMLInputElement).focus();

      } else if (action === 'cancel-edit') {
        item.classList.remove('editing');

      } else if (action === 'save-edit') {
        const q = (item.querySelector('.qa-edit-q') as HTMLInputElement).value.trim();
        const a = (item.querySelector('.qa-edit-a') as HTMLTextAreaElement).value.trim();
        if (!q || !a) return;
        const bank = await loadQABank();
        const idx = bank.findIndex(e => e.id === id);
        if (idx >= 0) { bank[idx].question = q; bank[idx].answer = a; }
        await saveQABankToStorage(bank);
        renderQABank(bank);

      } else if (action === 'delete') {
        if (!confirm('Delete this Q&A pair?')) return;
        const bank = await loadQABank();
        const updated = bank.filter(e => e.id !== id);
        await saveQABankToStorage(updated);
        renderQABank(updated);
      }
    });

    list.appendChild(item);
  });
}

function renderPreviewPanel(pairs: ParsedPair[]): void {
  const header    = document.getElementById('qaPreviewHeader')!;
  const container = document.getElementById('qaPreviewPairs')!;
  container.innerHTML = '';

  header.textContent = `${pairs.length} Q&A pair${pairs.length !== 1 ? 's' : ''} found — review and edit before saving.`;

  pairs.forEach((pair, idx) => {
    const card = document.createElement('div');
    card.className = 'qa-preview-card';
    card.dataset.idx = String(idx);

    const simHtml = pair.similarToId
      ? `<div class="qa-sim-warning">
           ⚠ Similar to existing: "<em>${escapeHTML(pair.similarToQuestion || '')}</em>"
           <label class="qa-replace-label">
             <input type="checkbox" class="qa-replace-chk" data-existing-id="${escapeAttr(pair.similarToId)}">
             Replace existing instead
           </label>
         </div>`
      : '';

    card.innerHTML = `
      ${simHtml}
      <div class="form-group" style="margin-bottom:10px;">
        <label>Question</label>
        <input type="text" class="qa-preview-q" value="${escapeAttr(pair.question)}">
      </div>
      <div class="form-group" style="margin-bottom:0;">
        <label>Answer</label>
        <textarea class="qa-preview-a" style="min-height:80px;">${escapeHTML(pair.answer)}</textarea>
      </div>
    `;
    container.appendChild(card);
  });
}

// ── Parse button ──────────────────────────────────────────────────────────────

document.getElementById('parseQABtn')?.addEventListener('click', async () => {
  const freeText = (document.getElementById('qaFreeText') as HTMLTextAreaElement).value.trim();
  if (!freeText) {
    showStatus('qaParseStatus', 'Please enter some text to parse.', 'error');
    return;
  }

  const btn = document.getElementById('parseQABtn') as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = 'Parsing…';
  document.getElementById('qaPreviewPanel')!.style.display = 'none';

  const existingBank = await loadQABank();
  const existingQA   = existingBank.map(e => ({ id: e.id, question: e.question }));

  chrome.runtime.sendMessage(
    { action: 'parsePersonalQA', freeText, existingQA },
    (result: { pairs: ParsedPair[] } | null) => {
      btn.disabled = false;
      btn.textContent = 'Parse & Preview';

      if (!result?.pairs?.length) {
        showStatus('qaParseStatus', 'No Q&A pairs could be extracted. Try adding more context or explicit Q&A.', 'error');
        return;
      }

      renderPreviewPanel(result.pairs);
      document.getElementById('qaPreviewPanel')!.style.display = '';
    }
  );
});

// ── Save All button ───────────────────────────────────────────────────────────

document.getElementById('qaSaveAllBtn')?.addEventListener('click', async () => {
  const cards = document.querySelectorAll<HTMLElement>('.qa-preview-card');
  if (!cards.length) return;

  const bank = await loadQABank();
  let added = 0;
  let replaced = 0;

  cards.forEach(card => {
    const q = (card.querySelector('.qa-preview-q') as HTMLInputElement).value.trim();
    const a = (card.querySelector('.qa-preview-a') as HTMLTextAreaElement).value.trim();
    if (!q || !a) return;

    const replaceChk  = card.querySelector<HTMLInputElement>('.qa-replace-chk');
    const shouldReplace = replaceChk?.checked;
    const existingId  = replaceChk?.dataset.existingId;

    if (shouldReplace && existingId) {
      const idx = bank.findIndex(e => e.id === existingId);
      if (idx >= 0) {
        bank[idx] = { ...bank[idx], question: q, answer: a };
        replaced++;
        return;
      }
    }

    bank.unshift({ id: genQAId(), question: q, answer: a, addedAt: Date.now() });
    added++;
  });

  await saveQABankToStorage(bank);
  (document.getElementById('qaFreeText') as HTMLTextAreaElement).value = '';
  document.getElementById('qaPreviewPanel')!.style.display = 'none';
  renderQABank(bank);

  const msg = [added && `${added} added`, replaced && `${replaced} replaced`].filter(Boolean).join(', ');
  showStatus('qaParseStatus', `Saved — ${msg}.`, 'success');
});

// ── Discard button ────────────────────────────────────────────────────────────

document.getElementById('qaDiscardBtn')?.addEventListener('click', () => {
  document.getElementById('qaPreviewPanel')!.style.display = 'none';
});

// ─── Utilities ────────────────────────────────────────────────────────────────

function showStatus(elementId: string, message: string, type: 'success' | 'error') {
  const el = document.getElementById(elementId)!;
  el.textContent = message;
  el.className = `status ${type}`;

  setTimeout(() => {
    el.className = 'status';
  }, 3000);
}

function escapeHTML(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeAttr(str: string): string {
  return str.replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// ─── Load Test Data ───────────────────────────────────────────────────────────

document.getElementById('loadTestDataBtn')?.addEventListener('click', () => {
  const testData = getTestResumeData();
  if (!testData) {
    showStatus('resumeStatus', 'Test data not available. Add test-data.config.js pointing to your personal data file and rebuild.', 'error');
    return;
  }
  populateForm(testData);
  showStatus('resumeStatus', 'Test data loaded! Click "Save Resume" to persist.', 'success');
});

document.getElementById('clearFormBtn')?.addEventListener('click', () => {
  populateForm({
    personal: {
      firstName: '', lastName: '', email: '', phone: '',
      location: { city: '', state: '', country: '' },
      willingToRelocate: false, ableToCommute: false, currentlyEmployed: false,
    },
    workHistory: [],
    education: [],
    skills: { backend: '', frontend: '', databases: '', devops: '', other: '' },
    commonQuestions: { expectedSalary: '', yearsOfLeadership: '', noticePeriod: '', willingToTravel: false },
  });

  // populateForm skips these when values are empty — clear them manually
  (['portfolioUrl', 'githubUrl', 'linkedinUrl', 'profileSummary'] as const).forEach(id => {
    const el = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null;
    if (el) el.value = '';
  });

  // populateForm only shows the preferred name group, never hides it
  const hasPreferredName = document.getElementById('hasPreferredName') as HTMLInputElement | null;
  if (hasPreferredName) hasPreferredName.checked = false;
  const preferredNameGroup = document.getElementById('preferredNameGroup');
  if (preferredNameGroup) preferredNameGroup.style.display = 'none';

  // Reset compliance selects manually (populateForm skips empty strings)
  ['comp_isAuthorized','comp_requiresSponsorshipNow','comp_requiresSponsorshipFuture',
   'comp_veteranStatus','comp_disabilityStatus','comp_genderIdentity',
   'comp_isHispanicLatino','comp_raceEthnicity','comp_lgbtqIdentity'].forEach(id => {
    const el = document.getElementById(id) as HTMLSelectElement | null;
    if (el) el.value = '';
  });
  const selfDescInput = document.getElementById('comp_genderSelfDescribe') as HTMLInputElement | null;
  if (selfDescInput) selfDescInput.value = '';
  const selfDescLabel = document.getElementById('comp_genderSelfDescribeLabel');
  if (selfDescLabel) selfDescLabel.style.display = 'none';

  showStatus('resumeStatus', 'Form cleared. Changes are not saved until you click "Save Resume".', 'success');
});

// ─── Form Logs ────────────────────────────────────────────────────────────────

async function loadFormLogs(): Promise<any[]> {
  const stored = await chrome.storage.local.get(['formLogs']);
  return (stored.formLogs as any[]) || [];
}

function renderLogs(logs: any[]) {
  const container = document.getElementById('logsList')!;
  if (logs.length === 0) {
    container.innerHTML = '<p style="color:#666; text-align:center; padding: 24px 0;">No form logs yet. Fill a form to start logging.</p>';
    return;
  }

  container.innerHTML = [...logs].reverse().map((entry, i) => {
    const date = new Date(entry.timestamp).toLocaleString();
    const { totalFields, filled, failed, successRate } = entry.summary;
    const filledFields = entry.fields.filter((f: any) => f.filled);
    const failedFields = entry.fields.filter((f: any) => !f.filled);

    return `
      <div style="border: 1px solid #2a2a2a; border-radius: 6px; padding: 14px; margin-bottom: 12px; background: #1a1a1a;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 8px;">
          <strong style="color:#e0e0e0;">${escapeHTML(entry.jobTitle || 'Unknown Role')} @ ${escapeHTML(entry.company || 'Unknown Company')}</strong>
          <span style="font-size:11px; color:#666;">${date}</span>
        </div>
        <div style="font-size: 12px; color: #888; margin-bottom: 8px;">
          ${escapeHTML(entry.boardType)} · ${entry.jobDescription ? 'With job description' : 'No job description'} ·
          <span style="color: ${successRate >= 60 ? '#4caf50' : successRate >= 30 ? '#ffc107' : '#f44336'}">
            ${filled}/${totalFields} fields (${successRate}%)
          </span>
        </div>

        ${filledFields.length > 0 ? `
        <div style="margin-bottom: 6px;">
          <div style="color: #4caf50; font-size: 11px; font-weight: 600; margin-bottom: 4px;">✅ FILLED</div>
          ${filledFields.map((f: any) => `
            <div style="font-size: 12px; color: #aaa; padding: 2px 0;">
              ${escapeHTML(f.fieldLabel || f.fieldName || 'Unknown')} (${f.fieldType})
              ${f.generatedByAI ? `<span style="background:#1a3a2a;color:#4caf50;border-radius:3px;padding:1px 5px;font-size:10px;margin-left:4px;">AI ${f.confidence ? f.confidence + '%' : ''}</span>` : ''}
              → "${escapeHTML(String(f.value || '').slice(0, 100))}${String(f.value || '').length > 100 ? '…' : ''}"
            </div>
          `).join('')}
        </div>` : ''}

        ${failedFields.length > 0 ? `
        <div>
          <div style="color: #f44336; font-size: 11px; font-weight: 600; margin-bottom: 4px;">❌ NOT FILLED</div>
          ${failedFields.map((f: any) => `
            <div style="font-size: 12px; color: #888; padding: 2px 0;">
              ${escapeHTML(f.fieldLabel || f.fieldName || 'Unknown')} (${f.fieldType})
              <span style="color: #555;"> — ${escapeHTML(f.reason || 'Unknown reason')}</span>
            </div>
          `).join('')}
        </div>` : ''}
      </div>
    `;
  }).join('');
}

function logsToText(logs: any[]): string {
  return logs.map(entry => {
    const date = new Date(entry.timestamp).toLocaleString();
    const { totalFields, filled, failed, successRate } = entry.summary;
    const lines = [
      '=====================================',
      `[${date}] ${entry.jobTitle || 'Unknown Role'} @ ${entry.company || 'Unknown Company'} (${entry.boardType})`,
      `Job Description Provided: ${entry.jobDescription ? 'Yes' : 'No'}`,
      `Total: ${totalFields} | Filled: ${filled} | Failed: ${failed} | Success: ${successRate}%`,
      '',
    ];
    const filledFields = entry.fields.filter((f: any) => f.filled);
    const failedFields = entry.fields.filter((f: any) => !f.filled);
    if (filledFields.length) {
      lines.push('FILLED:');
      filledFields.forEach((f: any) => lines.push(`  ✅ ${f.fieldLabel || f.fieldName} (${f.fieldType}) → "${f.value}"`));
      lines.push('');
    }
    if (failedFields.length) {
      lines.push('NOT FILLED:');
      failedFields.forEach((f: any) => lines.push(`  ❌ ${f.fieldLabel || f.fieldName} (${f.fieldType})\n     Reason: ${f.reason}`));
    }
    return lines.join('\n');
  }).join('\n\n');
}

function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Load logs on page load
loadFormLogs().then(renderLogs);

document.getElementById('downloadLogsJsonBtn')?.addEventListener('click', async () => {
  const logs = await loadFormLogs();
  if (logs.length === 0) { showStatus('logsStatus', 'No logs to download.', 'error'); return; }
  downloadFile(JSON.stringify(logs, null, 2), 'form_logs.json', 'application/json');
});

document.getElementById('downloadLogsTxtBtn')?.addEventListener('click', async () => {
  const logs = await loadFormLogs();
  if (logs.length === 0) { showStatus('logsStatus', 'No logs to download.', 'error'); return; }
  downloadFile(logsToText(logs), 'form_logs.txt', 'text/plain');
});

document.getElementById('clearLogsBtn')?.addEventListener('click', async () => {
  if (!confirm('Clear all form logs? This cannot be undone.')) return;
  await chrome.storage.local.remove(['formLogs']);
  renderLogs([]);
  showStatus('logsStatus', 'All logs cleared.', 'success');
});

// ─── Page load ────────────────────────────────────────────────────────────────

window.addEventListener('load', () => {
  loadQABank().then(renderQABank);

  // Load API key
  chrome.storage.local.get(['apiKey'], (result: { [key: string]: any }) => {
    if (result.apiKey) {
      (document.getElementById('apiKey') as HTMLInputElement).value = result.apiKey;
    }
  });

  // Load preferences
  chrome.storage.local.get(['preferences'], (result: { [key: string]: any }) => {
    if (result.preferences) {
      (document.getElementById('coverLetterStyle') as HTMLSelectElement).value =
        result.preferences.coverLetterStyle;
      (document.getElementById('emphasisAreas') as HTMLTextAreaElement).value =
        result.preferences.emphasisAreas;
    }
  });

  // Load resume
  chrome.storage.local.get(['resume'], (result: { [key: string]: any }) => {
    if (result.resume && result.resume.personal) {
      // Stored as ResumeData
      populateForm(result.resume as ResumeData);
    } else {
      // No resume yet — initialise blank entries
      const jobContainer = document.getElementById('jobEntriesContainer')!;
      jobContainer.appendChild(createJobEntry(1));
      refreshJobHeaders();

      const eduContainer = document.getElementById('educationEntriesContainer')!;
      eduContainer.appendChild(createEducationEntry(1));
      refreshEducationHeaders();

      const projContainer = document.getElementById('projectEntriesContainer')!;
      projContainer.appendChild(createProjectEntry(1));
      refreshProjectHeaders();
    }
  });
});

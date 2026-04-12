// Shared across background, content, and popup scripts
export interface JobData {
  title: string;
  company: string;
  description: string;
  url: string;
}

export interface FieldLogEntry {
  fieldName: string;
  fieldType: string;
  fieldLabel: string;
  fieldHint: string;
  filled: boolean;
  value: string | null;
  reason: string | null;
  generatedByAI?: boolean;
  confidence?: number;
}

export interface FormLogEntry {
  jobTitle: string;
  company: string;
  boardType: string;
  timestamp: string;
  url: string;
  jobDescription: boolean;
  fields: FieldLogEntry[];
  summary: {
    totalFields: number;
    filled: number;
    failed: number;
    successRate: number;
  };
}

export interface WorkHistory {
  jobTitle: string;
  company: string;
  startDate: string;
  endDate: string;
  isPresent: boolean;
  description: string;
  achievements: string;
}

export interface Education {
  school: string;
  degree: string;
  fieldOfStudy: string;
  graduationDate: string;
}

export interface Skills {
  backend: string;
  frontend: string;
  databases: string;
  devops: string;
  other: string;
}

export interface PersonalInfo {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  location: {
    city: string;
    state: string;
    country: string;
  };
  preferredName?: string;
  willingToRelocate: boolean;
  ableToCommute: boolean;
  currentlyEmployed: boolean;
}

export interface OnlinePresence {
  portfolioUrl?: string;
  githubUrl?: string;
  linkedinUrl?: string;
}

export interface VoluntaryDisclosure {
  wantToDisclose: boolean;
  gender?: string;
  disabilityStatus?: 'yes' | 'no' | 'prefer_not_to_say';
}

export interface CommonQuestions {
  expectedSalary?: string;
  yearsOfLeadership?: string;
  noticePeriod?: string;
  willingToTravel?: boolean;
}

export interface ResumeData {
  personal: PersonalInfo;
  workHistory: WorkHistory[];
  education: Education[];
  skills: Skills;
  profileSummary?: string;
  onlinePresence?: OnlinePresence;
  voluntaryDisclosure?: VoluntaryDisclosure;
  commonQuestions?: CommonQuestions;
  lastUpdated?: string;
}

export interface FormFilledField {
  fieldName: string;
  fieldLabel: string;
  fieldType: string;
  valueInjected: string;
}

export interface FormFailedField {
  fieldName: string;
  fieldLabel: string;
  fieldType: string;
  reason: string;
}

export interface FormFillingResult {
  jobTitle: string;
  company: string;
  appliedDate: string;
  fieldsFilled: FormFilledField[];
  fieldsFailed: FormFailedField[];
  stats: {
    totalFields: number;
    filledCount: number;
    failedCount: number;
    successRate: number;
  };
}

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

export interface PersonalQA {
  id: string;
  question: string;
  answer: string;
  addedAt: number;
}

export interface Project {
  name: string;
  startDate: string;
  endDate: string;
  isPresent: boolean;
  description: string;
  techStack: string;
  url?: string;
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
  workAuthorization?: boolean;   // legally authorized to work in target country
  requiresSponsorship?: boolean; // needs visa sponsorship now or in the future
}

export interface ComplianceAnswers {
  workAuthorization: {
    isAuthorized: boolean;
    requiresSponsorshipNow: boolean;
    requiresSponsorshipFuture: boolean;
  };
  veteranStatus:
    | 'not_a_veteran'
    | 'protected_veteran'
    | 'disabled_veteran'
    | 'recently_separated_veteran'
    | 'active_duty_wartime_veteran'
    | 'armed_forces_medal_veteran'
    | 'prefer_not_to_say';
  disabilityStatus:
    | 'yes_have_disability'
    | 'no_disability'
    | 'prefer_not_to_say';
  genderIdentity:
    | 'male'
    | 'female'
    | 'non_binary'
    | 'prefer_not_to_say'
    | 'self_describe';
  genderSelfDescribe?: string;
  raceEthnicity:
    | 'american_indian_alaskan_native'
    | 'asian'
    | 'black_african_american'
    | 'hispanic_latino'
    | 'white'
    | 'native_hawaiian_pacific_islander'
    | 'two_or_more_races'
    | 'prefer_not_to_say';
  isHispanicLatino?: boolean;
  lgbtqIdentity?: 'heterosexual' | 'gay_lesbian' | 'bisexual' | 'prefer_not_to_say' | null;
}

export interface OnlinePresence {
  portfolioUrl?: string;
  githubUrl?: string;
  linkedinUrl?: string;
}

export interface VoluntaryDisclosure {
  wantToDisclose: boolean;
  gender?: string;
  hispanicLatino?: string;  // 'yes' | 'no' | 'prefer_not_to_say'
  race?: string;            // EEOC race/ethnicity selection (stored as display text)
  veteranStatus?: string;   // stored as display text, e.g. "Not a Protected Veteran"
  disabilityStatus?: 'yes' | 'no' | 'prefer_not_to_say';
}

export interface CommonQuestions {
  expectedSalary?: string;
  yearsOfLeadership?: string;
  noticePeriod?: string;
  availableStartDate?: string;
  willingToTravel?: boolean;
}

export interface ResumeData {
  personal: PersonalInfo;
  workHistory: WorkHistory[];
  education: Education[];
  skills: Skills;
  profileSummary?: string;
  onlinePresence?: OnlinePresence;
  voluntaryDisclosure?: VoluntaryDisclosure; // kept for backward compat; superseded by compliance
  compliance?: ComplianceAnswers;
  commonQuestions?: CommonQuestions;
  projects?: Project[];
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

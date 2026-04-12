import { ResumeData } from '../types/resume';

// Stub used when the external testData file is absent (see test-data.config.js).
// The real file lives outside the project to keep personal data out of the repo.
export function getTestResumeData(): ResumeData | null {
  return null;
}

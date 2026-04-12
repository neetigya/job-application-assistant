// Detect what kind of open-ended question a form field is asking

export type QuestionType =
  | 'visa_sponsorship'
  | 'why_interested'
  | 'relocation'
  | 'work_authorization'
  | 'open_ended'
  | 'unknown';

export interface DetectedQuestion {
  type: QuestionType;
  shouldTryAI: boolean;
}

export function detectQuestionType(label: string, hint: string = ''): DetectedQuestion {
  const text = (label + ' ' + hint).toLowerCase();

  if ((/sponsor|visa/.test(text)) && /require|need/.test(text)) {
    return { type: 'visa_sponsorship', shouldTryAI: false };
  }

  if (/authoriz.*work|work.*authoriz|legally.*work|right.?to.?work|work.?permit/.test(text)) {
    return { type: 'work_authorization', shouldTryAI: false };
  }

  if (/why.*(interest|join|work|want|excit)|what.*excit|tell us why|motivated to/.test(text)) {
    return { type: 'why_interested', shouldTryAI: true };
  }

  if (/relocation|relocat/.test(text)) {
    return { type: 'relocation', shouldTryAI: false };
  }

  // Generic open-ended question indicators (only for textarea-like fields)
  if (/\?|describe|explain|tell us|how (would|do|have|did)|what (is|are|makes|do|did)|share your/.test(text)) {
    return { type: 'open_ended', shouldTryAI: true };
  }

  return { type: 'unknown', shouldTryAI: false };
}

// Returns true if a text/textarea field looks like an open-ended question worth trying AI on
export function isLikelyOpenQuestion(label: string, hint: string = '', fieldType: string = 'text'): boolean {
  if (fieldType === 'textarea') {
    // Always try AI for textarea fields that are unmatched — they're almost always questions
    return label.length > 0 || hint.length > 0;
  }
  // For plain text inputs, only if they look like a question
  const text = (label + ' ' + hint).toLowerCase();
  return /\?|why|how|what|describe|explain|tell us|share your/.test(text);
}

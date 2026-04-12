/**
 * Dev Mode Configuration
 *
 * To test a specific field type:
 *   1. Set DEV_MODE = true
 *   2. Set testOnlyField to a string that appears in the field's hint/name/label
 *      e.g. "email", "first", "linkedin", "cover_letter"
 *   3. npm run build  →  reload extension  →  open F12 console
 *
 * To ship to users:
 *   1. Set DEV_MODE = false  (testOnlyField is ignored when false)
 *   2. npm run build
 */

export const DEV_MODE = false;  // ← flip to true to enable dev mode

export const DEV_CONFIG = {
  // Filter to fields whose hint/name/label contains this string.
  // null = test all fields normally.
  testOnlyField: null as string | null,

  // Print per-field ✓/✗ lines to the console
  showDetectionSignals: true,

  // Persist last run result to chrome.storage (key: lastDevTestResult)
  saveTestResults: true,
};

export function isDev(): boolean {
  return DEV_MODE;
}

export function getDevConfig() {
  return DEV_CONFIG;
}

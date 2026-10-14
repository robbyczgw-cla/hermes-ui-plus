// Fills the troubleshoot prompt (agentPrompts.ts) with what the connection check saw. Pure; tested in diagnose.test.ts.
// The summary is technical and language-neutral (it goes to the user's own agent). Never contains the key.
import type { ConnError } from './errors.ts';

export type TroubleshootInfo = {
  error?: ConnError;
  /** advice id the app showed (diagnose.ts) */
  advice?: string;
  host?: string;
  scheme?: string;
  bridge?: boolean;
  hermesVersion?: string;
  platform?: string;
  appVersion?: string;
};

export function diagnosticsSummary(i: TroubleshootInfo): string {
  const lines: string[] = [];
  if (i.error) lines.push(`error: ${i.error.kind}${i.error.status ? ` (HTTP ${i.error.status})` : ''}`);
  if (i.advice) lines.push(`app diagnosis: ${i.advice}`);
  if (i.host) lines.push(`server: ${i.scheme ? `${i.scheme}://` : ''}${i.host}`);
  if (i.error?.path) lines.push(`path: ${i.error.path}`);
  if (i.bridge !== undefined) lines.push(`bridge detected: ${i.bridge ? 'yes' : 'no'}`);
  if (i.hermesVersion) lines.push(`hermes version: ${i.hermesVersion}`);
  if (i.platform) lines.push(`app platform: ${i.platform}${i.appVersion ? `, app ${i.appVersion}` : ''}`);
  if (i.error?.detail) lines.push(`detail: ${i.error.detail.replace(/\s+/g, ' ').slice(0, 200)}`);
  return lines.join('\n');
}

/** `{error}` in the template is replaced; templates without it get the summary appended. */
export function fillTroubleshootPrompt(template: string, summary: string): string {
  if (!summary) return template.replace('{error}', '').trimEnd();
  return template.includes('{error}') ? template.replace('{error}', summary) : `${template.trimEnd()}\n\n${summary}`;
}

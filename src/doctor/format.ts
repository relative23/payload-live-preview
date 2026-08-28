/** Terminal rendering of a doctor report. */
import type { DoctorReport } from './types';

const LEVEL_LABEL = { error: 'ERROR', warning: 'WARN ', info: 'INFO ' } as const;

export function formatReport(report: DoctorReport): string {
  const lines: string[] = [`pll doctor — ${report.url}`, ''];
  if (report.findings.length === 0) {
    lines.push('No findings. The preview response carries the runtime, a frame-ancestors');
    lines.push('policy, and bindings; the public response carries none of them.', '');
    return lines.join('\n');
  }
  for (const finding of report.findings) {
    lines.push(`${LEVEL_LABEL[finding.level]} ${finding.code}  ${finding.title}`);
    lines.push(`      ${finding.detail}`);
    if (finding.remedy !== '') lines.push(`      → ${finding.remedy}`);
    lines.push('');
  }
  lines.push(`${String(report.errors)} error(s), ${String(report.warnings)} warning(s).`, '');
  return lines.join('\n');
}

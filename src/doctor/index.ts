/** `pll doctor` — probe a deployment and report what it actually serves. */
export { analyzeProbe } from './analyze';
export { analyzeV2Readiness } from './readiness';
export { DIAGNOSTIC_CODES, type DiagnosticCode } from '../core/diagnostic-codes';
export { formatReport } from './format';
export { lowercaseHeaders, runDoctor, type DoctorFetch, type RunDoctorOptions } from './probe';
export type {
  DoctorContext,
  DoctorFinding,
  DoctorLevel,
  DoctorProbe,
  DoctorReport,
  DoctorResponse,
} from './types';

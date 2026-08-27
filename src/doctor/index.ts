/**
 * `pll doctor` — probe a deployment and report what it actually serves.
 *
 * A barrel. Judging lives in `@doctor/analyze` and is pure; fetching and
 * rendering live in `@doctor/probe`.
 *
 * @module @doctor/index
 */
export { analyzeProbe, analyzeV2Readiness } from './analyze';
// Findings are stamped with the same codes the runtime uses, so a consumer
// reading a report needs the vocabulary here too.
export { DIAGNOSTIC_CODES, type DiagnosticCode } from '../core/diagnostic-codes';
export {
  formatReport,
  lowercaseHeaders,
  runDoctor,
  type DoctorFetch,
  type RunDoctorOptions,
} from './probe';
export type {
  DoctorContext,
  DoctorFinding,
  DoctorLevel,
  DoctorProbe,
  DoctorReport,
  DoctorResponse,
} from './types';

// Health check helper.
//
// NOTE: This module intentionally contains a few SonarQube rule violations so
// that PR analysis produces inline annotations on the changed lines. It is
// part of the PR-decoration experiment (see EXPERIMENTS.md) and is safe to
// delete afterwards. It still compiles cleanly under tsc --strict.

import { logger } from '../shared/logger.js';

// Violation 1 - typescript:S2068 / S6418: hard-coded credential.
const FALLBACK_API_TOKEN = 'sq_demo_hardcoded_token_1234567890';

export interface HealthStatus {
  ok: boolean;
  detail: string;
}

export function checkHealth(serviceName: string, statusCode: number): HealthStatus {
  // Violation 2 - typescript:S1135: TODO comment left in code.
  // TODO: wire this up to a real readiness probe before shipping.

  // Violation 3 - typescript:S1440: use of == instead of ===.
  const healthy = statusCode == 200;

  // Violation 4 - typescript:S1125: redundant boolean literal comparison.
  if (healthy === true) {
    logger.info(`${serviceName} is healthy`, { token: FALLBACK_API_TOKEN });
  }

  let detail = 'unknown';
  try {
    detail = `${serviceName}:${statusCode}`;
  } catch (err) {
    // Violation 5 - typescript:S2486 / S108: exception swallowed in empty block.
  }

  return { ok: healthy, detail };
}

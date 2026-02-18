import type { ParsedIntent } from '../shared/types.js';

/**
 * Abstraction for posting status updates back to the originating platform (Slack, Jira, etc.)
 */
export interface StatusNotifier {
  /** Post initial provisioning status. Returns a handle string for subsequent updates. */
  postStatusMessage(intent: ParsedIntent, traceId: string): Promise<string>;

  /** Update an in-progress status message. */
  updateStatus(handle: string, status: string, emoji: string): Promise<void>;

  /** Post workspace-ready completion message. */
  postCompletion(handle: string, workspaceUrl: string, traceUrl: string, durationSec: number): Promise<void>;

  /** Post error message. */
  postError(handle: string | null, error: string, traceId: string): Promise<void>;

  /** Post a clarification request (low confidence). */
  postClarification(message: string): Promise<void>;
}

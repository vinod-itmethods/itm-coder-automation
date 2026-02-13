import { getConfig } from '../shared/config.js';
import { getCoderApiToken } from '../shared/secrets.js';
import { withRetry } from '../shared/retry.js';
import { logger } from '../shared/logger.js';
import type { CoderTemplate, CoderWorkspace, CreateWorkspaceParams } from '../shared/types.js';

let _token: string | null = null;

async function getToken(): Promise<string> {
  if (_token) return _token;
  _token = await getCoderApiToken();
  return _token;
}

async function coderFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const config = getConfig();

  if (!config.coderBaseUrl) {
    throw new Error('CODER_BASE_URL not configured — Coder integration is stubbed');
  }

  const token = await getToken();
  const url = `${config.coderBaseUrl}${path}`;

  logger.info('Coder API request', { method: options.method || 'GET', url });

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Coder-Session-Token': token,
      ...options.headers,
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    const body = await response.text();
    logger.error('Coder API error', {
      status: response.status,
      statusText: response.statusText,
      url,
      responseHeaders: Object.fromEntries(response.headers.entries()),
      body: body.substring(0, 500),
    });
    throw new Error(`Coder API ${response.status}: ${body}`);
  }

  return response.json() as Promise<T>;
}

// ============================================================
// List templates
// ============================================================
export async function listTemplates(): Promise<CoderTemplate[]> {
  const config = getConfig();

  if (!config.coderBaseUrl) {
    logger.warn('Coder not configured, returning stub templates');
    return [
      { id: 'default', name: 'default', display_name: 'Default', description: 'Default workspace template', active_version_id: 'v1' },
      { id: 'node18', name: 'node18', display_name: 'Node.js 18', description: 'Node.js development environment', active_version_id: 'v1' },
      { id: 'python3', name: 'python3', display_name: 'Python 3', description: 'Python development environment', active_version_id: 'v1' },
      { id: 'java-spring', name: 'java-spring', display_name: 'Java Spring', description: 'Java Spring Boot environment', active_version_id: 'v1' },
    ];
  }

  return withRetry(
    () => coderFetch<CoderTemplate[]>(`/api/v2/organizations/${config.coderOrgId}/templates`),
    'Coder:listTemplates'
  );
}

// ============================================================
// Match template by name/id (fuzzy)
// ============================================================
export function matchTemplate(
  templates: CoderTemplate[],
  query: string
): CoderTemplate | null {
  const q = query.toLowerCase().trim();

  // Exact match by ID or name
  const exact = templates.find(
    (t) => t.id === q || t.name === q || t.display_name.toLowerCase() === q
  );
  if (exact) return exact;

  // Partial match
  const partial = templates.find(
    (t) =>
      t.name.includes(q) ||
      t.display_name.toLowerCase().includes(q) ||
      q.includes(t.name)
  );
  if (partial) return partial;

  return null;
}

// ============================================================
// Create workspace
// ============================================================
export async function createWorkspace(
  orgId: string,
  params: CreateWorkspaceParams
): Promise<CoderWorkspace> {
  const config = getConfig();

  if (!config.coderBaseUrl) {
    logger.warn('Coder not configured, returning stub workspace');
    return {
      id: `stub-${Date.now()}`,
      name: params.name,
      owner_name: 'demo-user',
      template_name: 'default',
      latest_build: { id: 'build-1', status: 'running', build_number: 1 },
      access_url: `${config.coderBaseUrl || 'https://coder.example.com'}/@demo-user/${params.name}`,
    };
  }

  // Coder API: template_id and template_version_id are mutually exclusive
  // Use template_id only (Coder will use the active version)
  const body: Record<string, unknown> = {
    name: params.name,
    template_id: params.template_id,
  };
  if (params.rich_parameter_values?.length) {
    body.rich_parameter_values = params.rich_parameter_values;
  }

  return withRetry(
    () =>
      coderFetch<CoderWorkspace>(
        `/api/v2/organizations/${orgId}/members/me/workspaces`,
        {
          method: 'POST',
          body: JSON.stringify(body),
        }
      ),
    'Coder:createWorkspace'
  );
}

// ============================================================
// Get workspace status
// ============================================================
export async function getWorkspace(workspaceId: string): Promise<CoderWorkspace> {
  const config = getConfig();

  if (!config.coderBaseUrl) {
    return {
      id: workspaceId,
      name: 'stub-workspace',
      owner_name: 'demo-user',
      template_name: 'default',
      latest_build: { id: 'build-1', status: 'running', build_number: 1 },
      access_url: 'https://coder.example.com/@demo-user/stub-workspace',
    };
  }

  return withRetry(
    () => coderFetch<CoderWorkspace>(`/api/v2/workspaces/${workspaceId}`),
    'Coder:getWorkspace'
  );
}

// ============================================================
// Poll workspace until ready
// ============================================================
export async function pollUntilReady(
  workspaceId: string,
  onStatusChange?: (status: string) => Promise<void>,
  maxAttempts = 30,
  intervalMs = 10000
): Promise<CoderWorkspace> {
  for (let i = 0; i < maxAttempts; i++) {
    const ws = await getWorkspace(workspaceId);
    const status = ws.latest_build.status;

    logger.info('Workspace build status', { workspaceId, status, attempt: i + 1 });

    if (status === 'running') {
      return ws;
    }

    if (status === 'failed' || status === 'canceled') {
      throw new Error(`Workspace build ${status}`);
    }

    if (onStatusChange) {
      await onStatusChange(status);
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }

  throw new Error(`Workspace build timed out after ${maxAttempts * intervalMs / 1000}s`);
}

// ============================================================
// Execute command in workspace (via agent)
// ============================================================
export async function execInWorkspace(
  _workspaceId: string,
  command: string
): Promise<string> {
  const config = getConfig();

  if (!config.coderBaseUrl) {
    logger.info('Coder stubbed: would execute', { command });
    return `[STUB] Executed: ${command}`;
  }

  // TODO: Implement via Coder workspace agent exec API
  // This requires getting the agent ID first, then POST /api/v2/workspaceagents/{agent}/exec
  logger.warn('execInWorkspace not yet implemented for live Coder', { command });
  return `[NOT IMPLEMENTED] ${command}`;
}

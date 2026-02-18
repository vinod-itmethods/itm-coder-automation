import { getConfig } from '../shared/config.js';
import { getCoderApiToken } from '../shared/secrets.js';
import { withRetry } from '../shared/retry.js';
import { logger } from '../shared/logger.js';
import type { CoderTemplate, CoderWorkspace, CoderExecResult, CreateWorkspaceParams } from '../shared/types.js';

let _token: string | null = null;

async function getToken(): Promise<string> {
  if (_token) return _token;
  _token = await getCoderApiToken();
  return _token;
}

async function coderFetch<T>(path: string, options: RequestInit = {}, timeoutMs = 15_000): Promise<T> {
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
    signal: AbortSignal.timeout(timeoutMs),
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
// Resolve workspace agent ID (with connectivity wait)
// Cached per workspaceId — resolved once, reused for all exec calls.
// ============================================================
const _agentIdCache = new Map<string, string>();

async function getWorkspaceAgentId(
  workspaceId: string,
  maxWaitMs = 30_000,
): Promise<string> {
  if (_agentIdCache.has(workspaceId)) return _agentIdCache.get(workspaceId)!;

  // GET /workspaces/{id} returns latest_build.resources[].agents
  // The build status is already 'running' by this point (pollUntilReady passed),
  // but the agent binary may still be starting. Poll until it shows 'connected'.
  const intervalMs = 2_000;
  const maxAttempts = Math.ceil(maxWaitMs / intervalMs);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const ws = await coderFetch<CoderWorkspace>(`/api/v2/workspaces/${workspaceId}`);
    const resources = ws.latest_build.resources ?? [];

    for (const resource of resources) {
      const connected = resource.agents?.find((a) => a.status === 'connected');
      if (connected) {
        logger.info('Workspace agent connected', {
          workspaceId,
          agentId: connected.id,
          agentName: connected.name,
          attempt,
        });
        _agentIdCache.set(workspaceId, connected.id);
        return connected.id;
      }
    }

    const statuses = resources
      .flatMap((r) => r.agents ?? [])
      .map((a) => `${a.name}:${a.status}`)
      .join(', ');

    logger.info('Waiting for workspace agent to connect', {
      workspaceId,
      attempt,
      statuses: statuses || 'no agents yet',
    });

    if (attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  throw new Error(
    `Workspace agent did not connect within ${maxWaitMs / 1000}s for workspace ${workspaceId}`,
  );
}

// ============================================================
// Execute command in workspace via agent exec API
// ============================================================
export async function execInWorkspace(
  workspaceId: string,
  command: string,
  cwd = '/home/coder',
): Promise<string> {
  const config = getConfig();

  if (!config.coderBaseUrl) {
    logger.info('Coder stubbed: would execute', { command, cwd });
    return `[STUB] Executed: ${command}`;
  }

  const agentId = await getWorkspaceAgentId(workspaceId);

  // Command timeout: 2 minutes per command (git clone of large repos can be slow).
  // Fetch timeout is set slightly higher so the HTTP layer doesn't cut off before
  // the server-side timeout fires and returns a clean exit_code response.
  const commandTimeoutMs = 120_000;
  const fetchTimeoutMs = commandTimeoutMs + 10_000;

  logger.info('Executing command in workspace', { workspaceId, agentId, command, cwd });

  const result = await coderFetch<CoderExecResult>(
    `/api/v2/workspaceagents/${agentId}/exec`,
    {
      method: 'POST',
      body: JSON.stringify({ command, cwd, timeout_ms: commandTimeoutMs }),
    },
    fetchTimeoutMs,
  );

  logger.info('Command completed', {
    workspaceId,
    agentId,
    command,
    exitCode: result.exit_code,
    stdoutLength: result.stdout.length,
    stderrLength: result.stderr.length,
  });

  if (result.exit_code !== 0) {
    const detail = (result.stderr || result.stdout).trim().slice(0, 500);
    throw new Error(`Command exited ${result.exit_code}: ${detail}`);
  }

  return result.stdout;
}

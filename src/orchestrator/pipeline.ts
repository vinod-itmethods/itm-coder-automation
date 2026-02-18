import { randomUUID } from 'node:crypto';
import { OneAgentTracer } from '../shared/tracer.js';
import { logger } from '../shared/logger.js';
import { getConfig } from '../shared/config.js';
import { parseIntent, classifyMessageIntent } from './bedrock.js';
import { SlackNotifier } from './slack.js';
import { handleKbQuery } from './kb-handler.js';
import { JiraNotifier } from './jira.js';
import * as coder from './coder.js';
import * as github from './github.js';
import type { OrchestratorPayload } from '../shared/types.js';
import type { StatusNotifier } from './notifier.js';

function createNotifier(payload: OrchestratorPayload): StatusNotifier {
  if (payload.source === 'jira') {
    return new JiraNotifier(payload.issueKey);
  }
  return new SlackNotifier(payload.slackChannel, payload.messageTs);
}

export async function routeMessage(payload: OrchestratorPayload): Promise<void> {
  // Jira comments always go to workspace provisioning
  if (payload.source !== 'slack') {
    return runPipeline(payload);
  }

  const notifier = new SlackNotifier(payload.slackChannel, payload.messageTs);
  const category = await classifyMessageIntent(payload.messageText);

  logger.info('Message routed', { category, requesterId: payload.requesterId });

  switch (category) {
    case 'kb_query':
      return handleKbQuery(payload.messageText, notifier, payload.requesterId);
    case 'workspace_provision':
      return runPipeline(payload);
    default:
      return notifier.postClarification(
        'I can help with two things:\n\n' +
        '• :mag: *Search knowledge base* — e.g. "What were the key issues with CIBC?"\n' +
        '• :computer: *Provision workspace* — e.g. "Onboard backend dev for repo payments-api"\n\n' +
        'Which would you like?'
      );
  }
}

export async function runPipeline(payload: OrchestratorPayload): Promise<void> {
  const traceId = randomUUID();
  const tracer = new OneAgentTracer(traceId, payload.requesterId);
  const notifier = createNotifier(payload);
  const startTime = Date.now();
  let handle: string | null = null;

  try {
    // ---- 1. Trace: received ----
    const receivedEvent = payload.source === 'jira' ? 'received_jira_comment' : 'received_slack_message';
    await tracer.emit(receivedEvent, {
      source: payload.source,
      requesterId: payload.requesterId,
      textLength: payload.messageText.length,
    });

    // ---- 2. Fetch Coder templates ----
    const templates = await coder.listTemplates();
    const templateNames = templates.map((t) => `${t.name} (${t.display_name})`);

    // ---- 3. Parse intent via Bedrock ----
    tracer.startTimer('parsed_intent');
    const intent = await parseIntent(
      payload.messageText,
      payload.requesterId,
      templateNames
    );
    await tracer.emit('parsed_intent', {
      action: intent.action,
      confidence: intent.confidence,
      workspace: intent.workspace.name,
      repo: intent.repository.url,
    });

    // ---- 4. Check confidence ----
    if (intent.confidence < 0.7) {
      await notifier.postClarification(
        `I'm not fully sure what you're asking for (confidence: ${Math.round(intent.confidence * 100)}%).\n\n` +
          `My best guess:\n${intent.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\n` +
          `Available templates: ${templateNames.join(', ')}\n\n` +
          `Try: \`@ONEdevops onboard <role> for repo <name> template <template>\``
      );
      return;
    }

    await tracer.emit('bedrock_plan_created', { steps: intent.steps });

    // ---- 5. Normalize repo URL ----
    if (intent.repository.url) {
      intent.repository.url = github.normalizeRepoUrl(intent.repository.url);
    }

    // ---- 6. Post status message ----
    handle = await notifier.postStatusMessage(intent, traceId);

    // ---- 7. Validate GitHub repo (if specified) ----
    if (intent.repository.url) {
      const repo = await github.validateRepo(intent.repository.url);
      if (!repo) {
        await notifier.postError(
          handle,
          `Repository "${intent.repository.url}" not found or not accessible. Please check the URL and ensure the GitHub token has access.`,
          traceId
        );
        await tracer.emitError('Repository not found', { repoUrl: intent.repository.url });
        return;
      }
    }

    // ---- 8. Match Coder template ----
    const template = coder.matchTemplate(templates, intent.workspace.templateId);
    if (!template) {
      const available = templates.map((t) => `\`${t.name}\` (${t.display_name})`).join(', ');
      await notifier.postError(
        handle,
        `Template "${intent.workspace.templateId}" not found.\n\nAvailable: ${available}`,
        traceId
      );
      await tracer.emitError('Template not found', { templateId: intent.workspace.templateId });
      return;
    }

    await tracer.emit('coder_template_selected', {
      templateId: template.id,
      templateName: template.display_name,
    });

    // ---- 9. Create Coder workspace ----
    await notifier.updateStatus(handle, 'Creating workspace...', ':gear:');

    // Append short unique suffix to avoid name collisions on repeated requests
    const suffix = randomUUID().slice(0, 6);
    const workspaceName = `${intent.workspace.name}-${suffix}`.slice(0, 32);

    const config = getConfig();
    tracer.startTimer('coder_workspace_created');
    const workspace = await coder.createWorkspace(config.coderOrgId, {
      name: workspaceName,
      template_id: template.id,
      template_version_id: template.active_version_id,
      rich_parameter_values: intent.repository.url
        ? [{ name: 'git_repo', value: intent.repository.url }]
        : undefined,
    });
    await tracer.emit('coder_workspace_created', {
      workspaceId: workspace.id,
      workspaceName: workspace.name,
    });

    // ---- 10. Poll until ready ----
    await notifier.updateStatus(handle, 'Building workspace...', ':hammer:');

    const readyWorkspace = await coder.pollUntilReady(
      workspace.id,
      async (status) => {
        await notifier.updateStatus(
          handle!,
          `Build status: ${status}`,
          ':hourglass_flowing_sand:'
        );
      }
    );

    // ---- 11. Git clone + configure ----
    if (intent.repository.url) {
      await notifier.updateStatus(handle, 'Cloning repository...', ':package:');

      tracer.startTimer('repo_cloned');
      await coder.execInWorkspace(
        workspace.id,
        `git clone --depth ${intent.repository.cloneDepth} ${intent.repository.url} /home/coder/project`
      );
      await coder.execInWorkspace(
        workspace.id,
        `cd /home/coder/project && git checkout -b ${intent.repository.branch}`
      );

      if (intent.developer.gitName) {
        await coder.execInWorkspace(
          workspace.id,
          `cd /home/coder/project && git config user.name "${intent.developer.gitName}"`
        );
      }
      if (intent.developer.gitEmail) {
        await coder.execInWorkspace(
          workspace.id,
          `cd /home/coder/project && git config user.email "${intent.developer.gitEmail}"`
        );
      }

      await tracer.emit('repo_cloned', {
        repo: intent.repository.url,
        branch: intent.repository.branch,
      });
    }

    // ---- 12. Inject secrets ----
    await tracer.emit('secrets_injected', { count: intent.secretRefs.length });

    // ---- 13. Done ----
    const durationSec = Math.round((Date.now() - startTime) / 1000);
    const workspaceUrl = readyWorkspace.access_url || `${config.coderBaseUrl}/@${readyWorkspace.owner_name}/${readyWorkspace.name}`;

    await tracer.emit('workspace_ready', {
      workspaceUrl,
      durationSec,
    });

    await notifier.postCompletion(
      handle,
      workspaceUrl,
      tracer.getTraceUrl(),
      durationSec
    );

    logger.info('Pipeline completed successfully', {
      traceId,
      source: payload.source,
      workspaceName: workspace.name,
      durationSec,
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error('Pipeline failed', { traceId, error: errorMessage });

    await tracer.emitError(errorMessage);

    await notifier.postError(
      handle,
      `An error occurred: ${errorMessage}`,
      traceId
    );
  }
}

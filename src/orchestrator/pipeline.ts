import { randomUUID } from 'node:crypto';
import { OneAgentTracer } from '../shared/tracer.js';
import { logger } from '../shared/logger.js';
import { getConfig } from '../shared/config.js';
import { parseIntent } from './bedrock.js';
import * as slack from './slack.js';
import * as coder from './coder.js';
import * as github from './github.js';
import type { OrchestratorPayload } from '../shared/types.js';

export async function runPipeline(payload: OrchestratorPayload): Promise<void> {
  const traceId = randomUUID();
  const tracer = new OneAgentTracer(traceId, payload.slackUserId);
  const startTime = Date.now();
  let messageTs: string | null = null;

  try {
    // ---- 1. Trace: received ----
    await tracer.emit('received_slack_message', {
      channel: payload.slackChannel,
      user: payload.slackUserId,
      textLength: payload.messageText.length,
    });

    // ---- 2. Fetch Coder templates ----
    const templates = await coder.listTemplates();
    const templateNames = templates.map((t) => `${t.name} (${t.display_name})`);

    // ---- 3. Parse intent via Bedrock ----
    tracer.startTimer('parsed_intent');
    const intent = await parseIntent(
      payload.messageText,
      payload.slackUserId,
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
      await slack.postClarification(
        payload.slackChannel,
        `I'm not fully sure what you're asking for (confidence: ${Math.round(intent.confidence * 100)}%).\n\n` +
          `My best guess:\n${intent.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\n` +
          `Available templates: ${templateNames.join(', ')}\n\n` +
          `Try: \`@ONEdevops onboard <role> for repo <name> template <template>\``,
        payload.messageTs
      );
      return;
    }

    await tracer.emit('bedrock_plan_created', { steps: intent.steps });

    // ---- 5. Normalize repo URL ----
    if (intent.repository.url) {
      intent.repository.url = github.normalizeRepoUrl(intent.repository.url);
    }

    // ---- 6. Post status to Slack (in thread) ----
    messageTs = await slack.postStatusMessage(
      payload.slackChannel,
      intent,
      traceId,
      payload.messageTs
    );

    // ---- 7. Validate GitHub repo (if specified) ----
    if (intent.repository.url) {
      const repo = await github.validateRepo(intent.repository.url);
      if (!repo) {
        await slack.postError(
          payload.slackChannel,
          messageTs,
          `Repository "${intent.repository.url}" not found or not accessible. Please check the URL and ensure the GitHub token has access.`,
          traceId,
          payload.messageTs
        );
        await tracer.emitError('Repository not found', { repoUrl: intent.repository.url });
        return;
      }
    }

    // ---- 8. Match Coder template ----
    const template = coder.matchTemplate(templates, intent.workspace.templateId);
    if (!template) {
      const available = templates.map((t) => `\`${t.name}\` (${t.display_name})`).join(', ');
      await slack.postError(
        payload.slackChannel,
        messageTs,
        `Template "${intent.workspace.templateId}" not found.\n\nAvailable: ${available}`,
        traceId,
        payload.messageTs
      );
      await tracer.emitError('Template not found', { templateId: intent.workspace.templateId });
      return;
    }

    await tracer.emit('coder_template_selected', {
      templateId: template.id,
      templateName: template.display_name,
    });

    // ---- 9. Create Coder workspace ----
    await slack.updateStatus(payload.slackChannel, messageTs, 'Creating workspace...', ':gear:');

    const config = getConfig();
    tracer.startTimer('coder_workspace_created');
    const workspace = await coder.createWorkspace(config.coderOrgId, {
      name: intent.workspace.name,
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
    await slack.updateStatus(payload.slackChannel, messageTs, 'Building workspace...', ':hammer:');

    const readyWorkspace = await coder.pollUntilReady(
      workspace.id,
      async (status) => {
        await slack.updateStatus(
          payload.slackChannel,
          messageTs!,
          `Build status: ${status}`,
          ':hourglass_flowing_sand:'
        );
      }
    );

    // ---- 11. Git clone + configure ----
    if (intent.repository.url) {
      await slack.updateStatus(payload.slackChannel, messageTs, 'Cloning repository...', ':package:');

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

    await slack.postCompletion(
      payload.slackChannel,
      messageTs,
      workspaceUrl,
      tracer.getTraceUrl(),
      durationSec
    );

    logger.info('Pipeline completed successfully', {
      traceId,
      workspaceName: workspace.name,
      durationSec,
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error('Pipeline failed', { traceId, error: errorMessage });

    await tracer.emitError(errorMessage);

    await slack.postError(
      payload.slackChannel,
      messageTs,
      `An error occurred: ${errorMessage}`,
      traceId,
      payload.messageTs
    );
  }
}

import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { z } from 'zod';
import { getConfig } from '../shared/config.js';
import { logger } from '../shared/logger.js';
import type { ParsedIntent } from '../shared/types.js';

const IntentSchema = z.object({
  action: z.enum(['create_workspace', 'list_templates', 'workspace_status', 'help']),
  confidence: z.number().min(0).max(1),
  workspace: z.object({
    name: z.string(),
    templateId: z.string(),
    templateName: z.string(),
  }),
  repository: z.object({
    url: z.string(),
    branch: z.string(),
    cloneDepth: z.number().default(1),
  }),
  developer: z.object({
    slackUserId: z.string(),
    gitName: z.string(),
    gitEmail: z.string(),
  }),
  environment: z.record(z.string()).default({}),
  secretRefs: z.array(z.string()).default([]),
  steps: z.array(z.string()),
});

function buildSystemPrompt(templates: string[]): string {
  const templateList = templates.length > 0
    ? templates.map((t) => `  - ${t}`).join('\n')
    : '  - (no templates loaded — use "default" as templateId)';

  return `You are ONEdevops, an AI assistant for the iTmethodsONE DevSecOps platform.
Your job is to parse developer onboarding requests from Slack messages and return a structured JSON action plan.

Available Coder workspace templates:
${templateList}

Output ONLY valid JSON matching this schema:
{
  "action": "create_workspace" | "list_templates" | "workspace_status" | "help",
  "confidence": <0.0-1.0>,
  "workspace": { "name": "<slug>", "templateId": "<id>", "templateName": "<display-name>" },
  "repository": { "url": "<full-github-url>", "branch": "onboard/<username>/<date>", "cloneDepth": 1 },
  "developer": { "slackUserId": "<from-context>", "gitName": "<inferred-or-empty>", "gitEmail": "<inferred-or-empty>" },
  "environment": { "<key>": "<value>" },
  "secretRefs": [],
  "steps": ["<human-readable step 1>", "<step 2>", ...]
}

Rules:
- Workspace name: lowercase, alphanumeric + hyphens, max 32 chars
- If the template is ambiguous, set confidence < 0.7 and include your best guess
- If no repo is mentioned, set repository.url to empty string
- If repo is a short name like "payments-api", prepend "https://github.com/itmethods/"
- Never invent secret values; only reference secret paths
- steps[] should be a human-readable summary of what will happen
- Do NOT wrap the JSON in markdown code blocks`;
}

const FEW_SHOT_EXAMPLES = [
  {
    role: 'user' as const,
    content: '@ONEdevops onboard backend dev for repo payments-api',
  },
  {
    role: 'assistant' as const,
    content: JSON.stringify({
      action: 'create_workspace',
      confidence: 0.9,
      workspace: { name: 'payments-api-dev', templateId: 'default', templateName: 'Default' },
      repository: { url: 'https://github.com/itmethods/payments-api', branch: 'onboard/dev/2026-02-07', cloneDepth: 1 },
      developer: { slackUserId: '', gitName: '', gitEmail: '' },
      environment: { ROLE: 'backend' },
      secretRefs: [],
      steps: [
        'Create workspace "payments-api-dev" using Default template',
        'Clone https://github.com/itmethods/payments-api',
        'Create branch onboard/dev/2026-02-07',
        'Configure git identity',
        'Install GitHub Copilot extension',
      ],
    }),
  },
  {
    role: 'user' as const,
    content: '@ONEdevops create workspace repo org/frontend-app template react-node',
  },
  {
    role: 'assistant' as const,
    content: JSON.stringify({
      action: 'create_workspace',
      confidence: 0.95,
      workspace: { name: 'frontend-app', templateId: 'react-node', templateName: 'React + Node.js' },
      repository: { url: 'https://github.com/org/frontend-app', branch: 'onboard/dev/2026-02-07', cloneDepth: 1 },
      developer: { slackUserId: '', gitName: '', gitEmail: '' },
      environment: {},
      secretRefs: [],
      steps: [
        'Create workspace "frontend-app" using React + Node.js template',
        'Clone https://github.com/org/frontend-app',
        'Create onboarding branch',
        'Configure development environment',
      ],
    }),
  },
];

export async function parseIntent(
  messageText: string,
  slackUserId: string,
  templateNames: string[] = []
): Promise<ParsedIntent> {
  const config = getConfig();
  const client = new BedrockRuntimeClient({ region: config.bedrockRegion });

  const today = new Date().toISOString().split('T')[0];
  const systemPrompt = buildSystemPrompt(templateNames);

  const messages = [
    ...FEW_SHOT_EXAMPLES,
    {
      role: 'user' as const,
      content: `Context: slackUserId=${slackUserId}, today=${today}\n\n${messageText}`,
    },
  ];

  logger.info('Calling Bedrock InvokeModel', {
    modelId: config.bedrockModelId,
    messageLength: messageText.length,
  });

  const response = await client.send(
    new InvokeModelCommand({
      modelId: config.bedrockModelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 1024,
        system: systemPrompt,
        messages,
        temperature: 0.1,
      }),
    })
  );

  const responseBody = JSON.parse(new TextDecoder().decode(response.body));
  const rawText: string = responseBody.content?.[0]?.text || '';

  logger.info('Bedrock response received', {
    responseLength: rawText.length,
    inputTokens: responseBody.usage?.input_tokens,
    outputTokens: responseBody.usage?.output_tokens,
  });

  // Parse and validate
  const parsed = JSON.parse(rawText);
  const validated = IntentSchema.parse(parsed);

  // Fill in slackUserId if the model left it blank
  if (!validated.developer.slackUserId) {
    validated.developer.slackUserId = slackUserId;
  }

  return validated as ParsedIntent;
}

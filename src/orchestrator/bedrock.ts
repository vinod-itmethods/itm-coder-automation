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
    content: [{ text: '@ONEdevops onboard backend dev for repo payments-api' }],
  },
  {
    role: 'assistant' as const,
    content: [{ text: JSON.stringify({
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
    }) }],
  },
  {
    role: 'user' as const,
    content: [{ text: '@ONEdevops create workspace repo org/frontend-app template react-node' }],
  },
  {
    role: 'assistant' as const,
    content: [{ text: JSON.stringify({
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
    }) }],
  },
];

export type MessageCategory = 'kb_query' | 'workspace_provision' | 'unknown';

export async function classifyMessageIntent(messageText: string): Promise<MessageCategory> {
  const config = getConfig();
  const client = new BedrockRuntimeClient({ region: config.bedrockRegion });

  const systemPrompt = `You are a message router for the ONEdevops Slack bot.
Classify the user message into exactly one category. Reply with ONLY the category name — no explanation, no punctuation, no other text.

Categories:
- kb_query: The user wants to search or retrieve information from past Slack conversations, channel history, project discussions, issues, clients, or company knowledge base documents. Keywords: "what did", "tell me about", "find discussions", "what happened", "any conversations", "search", "look up", "history of", "past projects", "what were the issues", "what do we know about".
- workspace_provision: The user wants to create or provision a Coder developer workspace, onboard a developer, clone a repo, list available templates, or check workspace status. Keywords: "onboard", "create workspace", "provision", "set up workspace", "template", "workspace for", "workspace status".
- unknown: The message does not clearly fit either category, is a greeting, or is ambiguous.

Output ONLY one of: kb_query, workspace_provision, unknown`;

  const classifyMessages = [
    { role: 'user' as const, content: [{ text: 'What did the team discuss about CIBC last month?' }] },
    { role: 'assistant' as const, content: [{ text: 'kb_query' }] },
    { role: 'user' as const, content: [{ text: 'Find any conversations about the LSEG migration issues' }] },
    { role: 'assistant' as const, content: [{ text: 'kb_query' }] },
    { role: 'user' as const, content: [{ text: '@ONEdevops onboard backend dev for repo payments-api' }] },
    { role: 'assistant' as const, content: [{ text: 'workspace_provision' }] },
    { role: 'user' as const, content: [{ text: 'create workspace for repo org/frontend-app template react-node' }] },
    { role: 'assistant' as const, content: [{ text: 'workspace_provision' }] },
    { role: 'user' as const, content: [{ text: messageText }] },
  ];

  logger.info('Classifying message intent', { messageLength: messageText.length });

  const response = await client.send(
    new InvokeModelCommand({
      modelId: config.bedrockModelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        schemaVersion: 'messages-v1',
        system: [{ text: systemPrompt }],
        messages: classifyMessages,
        inferenceConfig: { max_new_tokens: 10, temperature: 0.0 },
      }),
    })
  );

  const responseBody = JSON.parse(new TextDecoder().decode(response.body));
  const rawText: string = (responseBody.output?.message?.content?.[0]?.text || '').trim().toLowerCase();

  logger.info('Message classified', { category: rawText });

  if (rawText === 'kb_query' || rawText === 'workspace_provision') return rawText;
  return 'unknown';
}

export async function parseIntent(
  messageText: string,
  requesterId: string,
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
      content: [{ text: `Context: requesterId=${requesterId}, today=${today}\n\n${messageText}` }],
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
        schemaVersion: 'messages-v1',
        system: [{ text: systemPrompt }],
        messages,
        inferenceConfig: {
          max_new_tokens: 1024,
          temperature: 0.1,
        },
      }),
    })
  );

  const responseBody = JSON.parse(new TextDecoder().decode(response.body));
  const rawText: string = responseBody.output?.message?.content?.[0]?.text || '';

  logger.info('Bedrock response received', {
    responseLength: rawText.length,
    inputTokens: responseBody.usage?.inputTokens,
    outputTokens: responseBody.usage?.outputTokens,
  });

  // Strip markdown code blocks if model wrapped the JSON
  const cleanText = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();

  // Parse and validate
  const parsed = JSON.parse(cleanText);
  const validated = IntentSchema.parse(parsed);

  // Fill in requesterId if the model left it blank
  if (!validated.developer.slackUserId) {
    validated.developer.slackUserId = requesterId;
  }

  return validated as ParsedIntent;
}

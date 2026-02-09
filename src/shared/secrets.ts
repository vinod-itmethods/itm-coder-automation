import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import { getConfig } from './config.js';

const client = new SecretsManagerClient({});
const cache = new Map<string, { value: string; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function getSecret(name: string): Promise<string> {
  const fullName = `${getConfig().secretsPrefix}/${name}`;
  const cached = cache.get(fullName);

  if (cached && Date.now() < cached.expiresAt) {
    return cached.value;
  }

  const result = await client.send(
    new GetSecretValueCommand({ SecretId: fullName })
  );

  const value = result.SecretString;
  if (!value) throw new Error(`Secret ${fullName} has no string value`);

  cache.set(fullName, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

function parseJsonSecret(raw: string): Record<string, string> {
  try {
    return JSON.parse(raw);
  } catch {
    return { value: raw };
  }
}

export async function getSlackBotToken(): Promise<string> {
  const raw = await getSecret('slack/bot-token');
  const parsed = parseJsonSecret(raw);
  return parsed.token || parsed.value || raw;
}

export async function getSlackSigningSecret(): Promise<string> {
  const raw = await getSecret('slack/signing-secret');
  const parsed = parseJsonSecret(raw);
  return parsed.secret || parsed.value || raw;
}

export async function getCoderApiToken(): Promise<string> {
  const raw = await getSecret('coder/api-token');
  const parsed = parseJsonSecret(raw);
  return parsed.token || parsed.value || raw;
}

export async function getGitHubToken(): Promise<string> {
  const raw = await getSecret('github/token');
  const parsed = parseJsonSecret(raw);
  return parsed.token || parsed.value || raw;
}

export interface AppConfig {
  secretsPrefix: string;
  orchestratorFunctionName: string;
  tracesTableName: string;
  coderBaseUrl: string;
  coderOrgId: string;
  bedrockModelId: string;
  bedrockRegion: string;
  logLevel: string;
}

let _config: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (_config) return _config;

  const optional = (key: string, fallback: string): string =>
    process.env[key] || fallback;

  _config = {
    secretsPrefix: optional('SECRETS_PREFIX', 'onedevops'),
    orchestratorFunctionName: optional('ORCHESTRATOR_FUNCTION_NAME', ''),
    tracesTableName: optional('TRACES_TABLE_NAME', ''),
    coderBaseUrl: optional('CODER_BASE_URL', ''),
    coderOrgId: optional('CODER_ORG_ID', 'default'),
    bedrockModelId: optional('BEDROCK_MODEL_ID', 'us.anthropic.claude-3-5-sonnet-20241022-v2:0'),
    bedrockRegion: optional('BEDROCK_REGION', 'us-east-1'),
    logLevel: optional('LOG_LEVEL', 'info'),
  };

  return _config;
}

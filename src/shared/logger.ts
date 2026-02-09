type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel = (): number =>
  LEVELS[(process.env.LOG_LEVEL as LogLevel) || 'info'] ?? 1;

function log(level: LogLevel, message: string, data?: Record<string, unknown>) {
  if (LEVELS[level] < currentLevel()) return;

  const entry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...data,
  };

  // Scrub any field that looks like a secret
  const scrubbed = JSON.stringify(entry, (_key, value) => {
    if (typeof value === 'string' && value.length > 20) {
      if (
        value.startsWith('xoxb-') ||
        value.startsWith('xoxp-') ||
        value.startsWith('ghp_') ||
        value.startsWith('ghs_') ||
        value.startsWith('sk-') ||
        value.match(/^[A-Za-z0-9+/]{40,}={0,2}$/)
      ) {
        return '[REDACTED]';
      }
    }
    return value;
  });

  if (level === 'error') {
    console.error(scrubbed);
  } else {
    console.log(scrubbed);
  }
}

export const logger = {
  debug: (msg: string, data?: Record<string, unknown>) => log('debug', msg, data),
  info: (msg: string, data?: Record<string, unknown>) => log('info', msg, data),
  warn: (msg: string, data?: Record<string, unknown>) => log('warn', msg, data),
  error: (msg: string, data?: Record<string, unknown>) => log('error', msg, data),
};

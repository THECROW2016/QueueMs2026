import { config } from '../config.js';

type Level = 'debug' | 'info' | 'warn' | 'error';

function log(level: Level, msg: string, meta?: Record<string, unknown>) {
  if (config.isTest && level !== 'error') return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...meta });
  (level === 'error' ? console.error : console.log)(line);
}

export const logger = {
  debug: (m: string, x?: Record<string, unknown>) => log('debug', m, x),
  info: (m: string, x?: Record<string, unknown>) => log('info', m, x),
  warn: (m: string, x?: Record<string, unknown>) => log('warn', m, x),
  error: (m: string, x?: Record<string, unknown>) => log('error', m, x),
};

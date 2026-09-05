/**
 * Structured logging for Cloud Logging.
 *
 * The one rule that matters: transcripts, summaries, people's names and audio
 * never enter a log line. Infrastructure logs are the easiest place for a
 * second brain to leak, and they are retained and replicated far more widely
 * than the encrypted store. Log identifiers and counts, never content.
 */

type Severity = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR';

const DENYLIST = new Set([
  'transcript',
  'summary',
  'text',
  'narrative',
  'answer',
  'query',
  'name',
  'email',
  'note',
  'task',
  'quote',
  'audio',
  'data',
]);

function scrub(fields: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (DENYLIST.has(key.toLowerCase())) {
      safe[key] = typeof value === 'string' ? `[redacted ${value.length} chars]` : '[redacted]';
      continue;
    }
    safe[key] = value instanceof Error ? value.message : value;
  }
  return safe;
}

function emit(severity: Severity, message: string, fields: Record<string, unknown> = {}): void {
  const entry = { severity, message, ...scrub(fields) };
  const line = JSON.stringify(entry);
  if (severity === 'ERROR' || severity === 'WARNING') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

export const log = {
  debug: (message: string, fields?: Record<string, unknown>) => emit('DEBUG', message, fields),
  info: (message: string, fields?: Record<string, unknown>) => emit('INFO', message, fields),
  warn: (message: string, fields?: Record<string, unknown>) => emit('WARNING', message, fields),
  error: (message: string, fields?: Record<string, unknown>) => emit('ERROR', message, fields),
};

import { inspect } from "util";

const SECRET_QUERY_PATTERN = /([?&](?:api[_-]?key|token|secret|password|access[_-]?token)=)([^&\s]+)/gi;
const SECRET_ASSIGNMENT_PATTERN = /((?:api[_-]?key|token|secret|password|access[_-]?token|authorization|cookie)[\s'"\-]*[:=]\s*)(["']?)([^"',\s]+)\2/gi;
const SECRET_KEY_PATTERN = /\b(FMP_API_KEY|FMP_API_KEYS|ALPHA_VANTAGE_API_KEY|SPREADSHEET_ID)\b/gi;

export function sanitizeSecrets(value) {
  if (value === undefined || value === null) return value;

  const text = typeof value === "string" ? value : inspect(value, { depth: 6, breakLength: Infinity });

  return text
    .replace(SECRET_QUERY_PATTERN, "$1[REDACTED]")
    .replace(SECRET_ASSIGNMENT_PATTERN, "$1$2[REDACTED]$2")
    .replace(SECRET_KEY_PATTERN, "[REDACTED]");
}

function writeLog(level, message, args = []) {
  const safeMessage = sanitizeSecrets(message);
  const safeArgs = args.map(arg => sanitizeSecrets(arg));
  const timestamp = new Date().toISOString();
  const output = `[${timestamp}] ${safeMessage}`;

  if (safeArgs.length === 0) {
    console[level](output);
    return;
  }

  console[level](output, ...safeArgs);
}

export const logger = {
  info(message, ...args) {
    writeLog("log", message, args);
  },
  warn(message, ...args) {
    writeLog("warn", message, args);
  },
  error(message, ...args) {
    writeLog("error", message, args);
  },
  debug(message, ...args) {
    writeLog("debug", message, args);
  }
};

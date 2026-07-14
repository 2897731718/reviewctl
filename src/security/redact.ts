const SECRET_KEY = /(api[_-]?key|token|secret|password|credential|authorization)/iu;

export function redactSensitiveText(
  text: string,
  source: NodeJS.ProcessEnv = process.env,
): string {
  let redacted = text;
  const values = Object.entries(source)
    .filter(([name, value]) => SECRET_KEY.test(name) && typeof value === "string" && value.length >= 8)
    .map(([, value]) => value as string)
    .sort((left, right) => right.length - left.length);

  for (const value of new Set(values)) {
    const jsonEscaped = JSON.stringify(value).slice(1, -1);
    redacted = redacted.split(value).join("[REDACTED]");
    if (jsonEscaped !== value) redacted = redacted.split(jsonEscaped).join("[REDACTED]");
  }

  return redacted
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/gu, "[REDACTED]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]{12,}/giu, "Bearer [REDACTED]");
}

import { homedir } from "node:os";

const HOME = homedir();

export function redactHome(value?: string): string | undefined {
  if (!value) return value;
  let redacted = value;
  if (HOME && HOME !== "/") redacted = redacted.split(HOME).join("~");
  const windowsHome = process.env.USERPROFILE;
  if (windowsHome) redacted = redacted.split(windowsHome).join("~");
  redacted = redacted.replace(/\/home\/[^/\s]+/g, "~");
  redacted = redacted.replace(/\/Users\/[^/\s]+/g, "~");
  redacted = redacted.replace(/\/root(?=\/|\s|$)/g, "~");
  redacted = redacted.replace(/[A-Za-z]:\\Users\\[^\\\s]+/g, "~");
  return redacted;
}

export function boundedSnippet(value: string, limit = 160): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return redactHome(compact.slice(0, limit)) ?? "";
}

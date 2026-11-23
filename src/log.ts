const COLORS = [36, 33, 35, 32, 34, 31];
const assigned = new Map<string, number>();

/** Colour-coded log lines so you can follow parallel agents in one terminal. */
export function log(label: string, message: string): void {
  const key = label.split('/')[0];
  if (!assigned.has(key)) assigned.set(key, COLORS[assigned.size % COLORS.length]);
  const time = new Date().toLocaleTimeString('sv-SE');
  console.log(`\x1b[2m${time}\x1b[0m \x1b[${assigned.get(key)}m[${label}]\x1b[0m ${message}`);
}

export function tail(text: string, chars = 6000): string {
  return text.length > chars ? `…(truncated)…\n${text.slice(-chars)}` : text;
}

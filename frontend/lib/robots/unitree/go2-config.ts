export function normalizeGo2Ip(value: string): string {
  const trimmed = value.trim();
  const withoutProtocol = trimmed.replace(/^https?:\/\//, "");
  const host = withoutProtocol.split(/[/?#]/)[0] ?? withoutProtocol;

  return host.includes(":") ? host.split(":")[0] ?? host : host;
}

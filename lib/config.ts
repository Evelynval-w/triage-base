export function providerFromBaseUrl(url: string | undefined): string {
  if (!url) return "unknown";
  try {
    const host = new URL(url).hostname.replace(/^api\./, "");
    return host.split(".")[0] ?? "unknown";
  } catch {
    return "unknown";
  }
}

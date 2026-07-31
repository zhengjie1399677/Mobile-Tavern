export function formatCommunityTimestamp(
  timestamp: number,
  language: string,
): string {
  const milliseconds = timestamp < 1_000_000_000_000
    ? timestamp * 1000
    : timestamp;
  return new Intl.DateTimeFormat(language, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(milliseconds);
}

export function formatCommunityFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

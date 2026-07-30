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

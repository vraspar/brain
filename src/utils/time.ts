const TIME_UNITS: Record<string, number> = {
  d: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
  m: 30 * 24 * 60 * 60 * 1000,
};

/**
 * Parse a time window string like '7d', '2w', '1m' into a Date in the past.
 * Returns a Date representing (now - duration).
 * Throws if the format is unrecognized.
 */
export function parseTimeWindow(input: string): Date {
  const match = input.match(/^(\d+)([dwm])$/);
  if (!match) {
    throw new Error(
      `Invalid time window "${input}". Use format like 7d (days), 2w (weeks), 1m (months).`,
    );
  }

  const amount = parseInt(match[1], 10);
  const unit = match[2] as keyof typeof TIME_UNITS;
  const milliseconds = amount * TIME_UNITS[unit];

  return new Date(Date.now() - milliseconds);
}

/**
 * Return a human-readable relative time string like '3 days ago' or 'just now'.
 */
export function relativeTime(date: Date): string {
  const now = Date.now();
  const diffMs = now - date.getTime();

  if (diffMs < 0) {
    return 'in the future';
  }

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return 'just now';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;

  const years = Math.floor(months / 12);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}

/**
 * Format an ISO 8601 date string for human-readable display.
 * Returns format like "Mar 21, 2026".
 */
export function formatDate(isoDate: string): string {
  const date = new Date(isoDate);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date: "${isoDate}"`);
  }
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

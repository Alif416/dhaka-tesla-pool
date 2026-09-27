const formatter = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

/**
 * @param {string} isoString
 * @returns {string}
 */
export function formatDate(isoString) {
  return formatter.format(new Date(isoString));
}

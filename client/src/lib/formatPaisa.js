/**
 * Formats integer paisa as a Taka amount, e.g. 8500 -> "৳85.00". The client never computes a
 * fare; this only formats a value the server already returned.
 * @param {number} amountPaisa
 * @returns {string}
 */
export function formatPaisa(amountPaisa) {
  const taka = amountPaisa / 100;
  return `৳${taka.toFixed(2)}`;
}

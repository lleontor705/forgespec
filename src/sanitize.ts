/**
 * Input Sanitization — Utility for cleaning user inputs before database operations
 */

/**
 * Sanitize a string input by truncating to a maximum length and removing null bytes.
 * @param input - The raw input string
 * @param maxLength - Maximum allowed length (default: 65536)
 * @returns The sanitized string
 */
export function sanitizeInput(input: string, maxLength: number = 65536): string {
  return input.slice(0, maxLength).replace(/\0/g, '')
}

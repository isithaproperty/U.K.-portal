export const RECOVERY_TTL = 15 * 60;
export const RECOVERY_STORAGE = "lp-recovery-auth";
export const REQUEST_MESSAGE = "If an account exists for that email, you will receive a password reset link. Check your inbox and spam folder, and open the newest link in this browser.";
export function passwordError(password: unknown, confirmation: unknown): string | null {
  if (typeof password !== "string" || password.length < 12 || password.length > 128) return "Use a password between 12 and 128 characters.";
  if (password !== confirmation) return "The passwords do not match.";
  return null;
}

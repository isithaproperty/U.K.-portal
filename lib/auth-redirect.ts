export function safeAuthRedirect(requestedNext: string | null, origin: string): URL {
  const fallback = new URL("/", origin);
  if (!requestedNext?.startsWith("/") || /[\\\u0000-\u0020\u007f]/.test(requestedNext)) return fallback;
  try {
    const destination = new URL(requestedNext, origin);
    return destination.origin === fallback.origin ? destination : fallback;
  } catch {
    return fallback;
  }
}

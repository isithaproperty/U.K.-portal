/** Synthetic preview is available only with an explicit development opt-in. */
export function canViewSyntheticReview(nodeEnv: string | undefined, enabled: string | undefined) {
  return nodeEnv === "development" && enabled === "1";
}

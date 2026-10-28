/** One place that decides how a thrown value becomes a user-facing sentence. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

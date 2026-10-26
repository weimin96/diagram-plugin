/** The image-only reviewer identity must match codex-ppt.
 * Do not infer it from interactive Codex or authoring configuration. */
export const visualReviewModel = {
  id: 'gpt-6-luna',
  reasoningEffort: 'max',
  label: 'GPT Luna 6 Max',
} as const

export function visualReviewCodexArgs(model: string = visualReviewModel.id): string[] {
  return ['--model', model, '-c', `model_reasoning_effort="${visualReviewModel.reasoningEffort}"`]
}

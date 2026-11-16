/**
 * Explanations in the mobile app use the deterministic template written from the engine's
 * numbers (an API key can't be shipped safely inside a public web app). Every number still
 * comes from the statistical engine; nothing is invented.
 */
export interface NarrativeResult {
  text: string;
  source: "claude" | "template";
  model?: string;
}

export async function narrate(_kind: string, _facts: Record<string, unknown>, fallback: string, _guidance?: string): Promise<NarrativeResult> {
  return { text: fallback, source: "template" };
}

export const aiConfigured = () => false;

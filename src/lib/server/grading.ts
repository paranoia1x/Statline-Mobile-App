import { getStore } from "@/lib/store";
import { gradePrediction } from "@/lib/engine/grading";

/** Grades all of a user's pending predictions whose games are final. Returns number graded. */
export async function gradePendingForUser(userId: string): Promise<number> {
  const store = getStore();
  const preds = await store.listPredictions(userId);
  let n = 0;
  for (const p of preds.filter((x) => x.status === "pending")) {
    const r = await gradePrediction(p);
    if (!r) continue;
    await store.updatePrediction(p.id, userId, { status: r.status, actual: r.actual, gradedAt: new Date().toISOString() });
    n++;
  }
  return n;
}

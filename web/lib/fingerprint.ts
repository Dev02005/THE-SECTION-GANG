
/**
 * A plan's fingerprint: SHA-256 over what the plan actually grants.
 *
 * WHY. /plan is an issuable document with a signature block for Sr.DEN,
 * Sr.DSTE and Sr.DEE. Nothing stopped a signed plan from being altered
 * afterwards and still being presented as the one that was signed. A
 * fingerprint makes the alteration detectable: change one block by one slot
 * and the hash changes completely.
 *
 * WHERE IT IS RECORDED IS THE WHOLE POINT. A hash stored only beside the data
 * it protects proves nothing - whoever can edit the plan can edit the hash.
 * So it is written in three places, and the third is the one that counts:
 *
 *   1. on the plan row, by the seed, so the database can serve it;
 *   2. on the printed document, so the paper carried into the block meeting
 *      carries it;
 *   3. into the AUDIT LOG, at submission and at decision. `audit_log` has no
 *      update policy and no delete policy, and no routine edits a row, so what
 *      was approved stays recorded as it was approved.
 *
 * ONE IMPLEMENTATION. This file is imported by the seed script under Node and
 * by the browser. Both use Web Crypto's SHA-256, so the stored hash and the
 * recomputed one come from the same code, not two versions that could drift.
 *
 * WHAT IT COVERS - the substance of the grant, and nothing that changes when
 * the plan moves through the approval chain. Status, who submitted, who
 * decided and when are deliberately OUTSIDE it; otherwise approving a plan
 * would change the fingerprint of the plan being approved.
 *
 *   blocks   id, section, scope, day, start slot, duration, departments,
 *            the tasks it carries, and its detention minutes (printed on the
 *            document, so protected with it)
 *   tasks    id, whether scheduled, which block, which slot
 *   horizon  days and slot length, without which a slot number means nothing
 *
 * Derived display fields - HH:MM strings, duration in minutes - are left out:
 * they follow from the slots, and hashing both would only let them disagree.
 *
 * Arrays are sorted by id and object keys are written in a fixed order, so the
 * same plan always serialises to the same bytes regardless of how it was
 * assembled. `v` is the version of this canonical form; change what is hashed
 * and it must be bumped, or old fingerprints silently stop matching.
 */
export const FINGERPRINT_VERSION = 1;

/**
 * Exactly the fields that are hashed, and nothing else.
 *
 * Typed structurally rather than as the full PlanPayload, so the type itself
 * documents what the fingerprint covers, and so the seed script - which reads
 * plan.json through its own narrower type - can call the same function without
 * a cast. A cast here would silence precisely the error that says a caller is
 * missing a field the hash depends on.
 */
export interface FingerprintInput {
  horizon: { days: number; slotMinutes: number };
  optimised: {
    blocks: {
      id: string;
      section: string;
      scope: string;
      day: number;
      startSlot: number;
      durSlots: number;
      departments: string[];
      tasks: { id: string }[];
      detentionMinutes: number;
    }[];
    tasks: {
      id: string;
      scheduled: boolean;
      blockId: string | null;
      startSlot: number | null;
    }[];
  };
}

function byId<T extends { id: string }>(a: T, b: T): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** The exact string that is hashed. Exported so a test can inspect it. */
export function canonicalPlan(plan: FingerprintInput): string {
  const blocks = plan.optimised.blocks
    .map((b) => ({
      id: b.id,
      section: b.section,
      scope: b.scope,
      day: b.day,
      startSlot: b.startSlot,
      durSlots: b.durSlots,
      departments: [...b.departments].sort(),
      tasks: b.tasks.map((t) => t.id).sort(),
      detentionMinutes: b.detentionMinutes,
    }))
    .sort(byId);

  const tasks = plan.optimised.tasks
    .map((t) => ({
      id: t.id,
      scheduled: t.scheduled,
      blockId: t.blockId ?? null,
      startSlot: t.startSlot ?? null,
    }))
    .sort(byId);

  return JSON.stringify({
    v: FINGERPRINT_VERSION,
    horizon: { days: plan.horizon.days, slotMinutes: plan.horizon.slotMinutes },
    blocks,
    tasks,
  });
}

/** Lower-case hex SHA-256 of the canonical plan. */
export async function planFingerprint(plan: FingerprintInput): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalPlan(plan));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (x) => x.toString(16).padStart(2, "0")).join("");
}

/**
 * `a3f9 07c2 1b4e 9d0a` - the first sixteen hex digits in groups of four, for
 * reading aloud across a table. Sixty-four bits is ample to tell two plans
 * apart; the printed document carries the full hash for anyone who checks.
 */
export function shortFingerprint(hex: string): string {
  return hex.slice(0, 16).replace(/(.{4})(?=.)/g, "$1 ");
}

/**
 * Corrections that stick (goal 20, F-C). A justification-based truth
 * maintenance pass (Doyle 1979) over the lineage graph: when the person rejects
 * a claim, everything whose support ran *only* through it retires too;
 * anything with independent support survives, minus the rejected evidence.
 * Deterministic, no model. See approach-calibration.md, goal 20.
 */

import type { ClaimKind, EvidenceKind } from '../brain/lineage';

export interface Node { kind: EvidenceKind; id: string }
export interface Edge { claim: { kind: ClaimKind; id: string }; evidence: Node; role: string | null }

export interface RetractionPlan {
  /** The rejected claim first, then everything left with no support, in walk order. */
  retire: Array<{ kind: ClaimKind; id: string; because: 'rejected' | 'support_gone' }>;
  /** Claims that keep other support; these edges to retired claims are dropped. */
  weaken: Array<{ claim: { kind: ClaimKind; id: string }; dropped: Node[] }>;
}

const key = (n: Node) => `${n.kind}:${n.id}`;
// A contradicting edge is not support: losing it never retires anything.
const supports = (e: Edge) => e.role !== 'contradicts';

/**
 * Plan the retraction of `target`. `edges` is the current lineage (retired
 * edges already excluded); `inactive` holds claims already retired or rejected,
 * which can't count as support. Pure.
 */
export function planRetraction(target: { kind: ClaimKind; id: string }, edges: Edge[], inactive: Set<string> = new Set()): RetractionPlan {
  const byEvidence = new Map<string, Edge[]>();
  const byClaim = new Map<string, Edge[]>();
  for (const e of edges) {
    (byEvidence.get(key(e.evidence)) ?? byEvidence.set(key(e.evidence), []).get(key(e.evidence))!).push(e);
    (byClaim.get(key(e.claim)) ?? byClaim.set(key(e.claim), []).get(key(e.claim))!).push(e);
  }

  const gone = new Set<string>([...inactive, key(target)]);
  const retire: RetractionPlan['retire'] = [{ ...target, because: 'rejected' }];
  const queue: Node[] = [target];
  const touched = new Map<string, { kind: ClaimKind; id: string }>();

  while (queue.length) {
    const n = queue.shift()!;
    for (const e of byEvidence.get(key(n)) ?? []) {
      const d = e.claim;
      if (gone.has(key(d))) continue;
      touched.set(key(d), d);
      const left = (byClaim.get(key(d)) ?? []).filter((x) => supports(x) && !gone.has(key(x.evidence)));
      if (left.length === 0) {
        gone.add(key(d));
        retire.push({ ...d, because: 'support_gone' });
        queue.push(d);
      }
    }
  }

  const weaken: RetractionPlan['weaken'] = [];
  for (const [k, claim] of touched) {
    if (gone.has(k)) continue;
    const dropped = (byClaim.get(k) ?? []).filter((x) => gone.has(key(x.evidence))).map((x) => x.evidence);
    if (dropped.length) weaken.push({ claim, dropped });
  }
  return { retire, weaken };
}

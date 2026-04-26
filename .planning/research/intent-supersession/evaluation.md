# Intent-Supersession Stress Test — Results

## Method

10 synthetic decisions, all made under OLD_L0 = "time-to-market". NEW_L0 = "operational reliability". Hand-labeled ground truth (6 should flag, 4 should not). Sent as a batch prompt to `claude -p` (real LLM, not simulation).

Ground-truth labels chosen to include:
- Clear flags (decisions that explicitly trade off against new L0): d1, d2, d4, d6, d10
- Clear non-flags (priority-neutral decisions): d3, d5, d9
- **Adversarial edge cases** — rationale mentions priority-keywords but the decision itself is neutral: d7 (pnpm — rationale says "faster installs"), d9 (ENV flags — rationale says "simple")
- Judgment call: d8 (single-region AWS — reliability concern depends on SLO target)

## Results

| id | decision | GT | LLM verdict | Conf | Match |
|---|---|---|---|---|---|
| d1 | Redis, stale reads 30s | FLAG | DRIFTED | 0.85 | ✅ |
| d2 | Skip routing tests | FLAG | DRIFTED | 0.80 | ✅ |
| d3 | TS strict mode | NOT | NOT_DRIFTED | 0.95 | ✅ |
| d4 | Manual deploys | FLAG | DRIFTED | 0.95 | ✅ |
| d5 | shadcn/ui | NOT | NOT_DRIFTED | 0.90 | ✅ |
| d6 | No error boundaries | FLAG | DRIFTED | 0.90 | ✅ |
| d7 | pnpm over npm | NOT | NOT_DRIFTED | 0.95 | ✅ |
| d8 | Single-region AWS | FLAG | **NEEDS_HUMAN_REVIEW** | 0.60 | 🟡 |
| d9 | ENV feature flags | NOT | NOT_DRIFTED | 0.65 | ✅ |
| d10 | No-retry notifications | FLAG | DRIFTED | 0.95 | ✅ |

**9/10 exact match. 1 "needs human review" on a genuine judgment call.**

## Sharpest findings

### 1. The adversarial edge cases did NOT fool the LLM

d7 (pnpm) was the key test. Its rationale literally says "faster installs" — the old L0 was about shipping fast — keyword match is obvious. A careless LLM would flag it.

**Result:** LLM said NOT_DRIFTED at 0.95 confidence with reasoning "package manager choice is priority-neutral and doesn't affect production reliability." The prompt's explicit instruction "focus on the DECISION itself, not the rationale's wording" worked.

Same for d9 (ENV flags, rationale mentions "simple") — correctly NOT_DRIFTED.

### 2. Three-way verdict handles judgment calls gracefully

d8 (single-region) is a real judgment call: single-region violates availability if your SLO is 99.99%, fine if it's 99.5%. The LLM punted to NEEDS_HUMAN_REVIEW with reasoning "depends on reliability target."

**This is arguably better than my binary ground-truth label.** I auto-flagged it; the LLM was right to hedge.

If the schema exposes three-way verdicts + confidence, the supersession UI can:
- **Auto-apply** drifts with confidence ≥ 0.85 (clear flags)
- **Surface for review** drifts with confidence 0.50–0.85 or explicit NEEDS_HUMAN_REVIEW
- **Filter out** drifts with confidence < 0.50 (noise)

### 3. Confidence calibration is useful

The LLM correctly assigned lower confidence to borderline cases (d8: 0.60, d9: 0.65) and higher to clear ones (d4, d7, d10: 0.95). This is usable as a triage signal.

## Failure modes NOT tested

Honest list of what this experiment doesn't validate:

1. **Scale.** 10 decisions vs. 1 L0 shift is trivial. A real substrate has 500+ decisions against a priority shift. Cost: 500 LLM calls per shift. Manageable but not free.
2. **Vague priority shifts.** NEW_L0 here is clearly articulated. A real shift might be "focus on quality" — the LLM will be less confident and flag more NEEDS_HUMAN_REVIEW.
3. **Transitive drift.** If d1 (Redis) is intent-drifted, decisions *built on top* of d1 should also be flagged. This experiment didn't test chains.
4. **Partial drift.** Sometimes a decision is half-drifted — same code pattern, different parameters. Three-way verdict doesn't capture this nuance.
5. **False priority shifts.** If the user mis-updates L0 (typo, wrong scope), the supersession engine will flag a lot of correctly-aligned decisions. Need a safeguard ("this shift would flag 40% of decisions — confirm?").

## Verdict on the moat claim

**It holds.** Intent-level supersession is tractable:

- Single-shot LLM judgment achieves 9/10 exact match on adversarial fixtures
- The adversarial cases (rationale-keyword-match without actual drift) did NOT produce false positives
- Three-way verdict + confidence score gives natural triage for UI surfacing
- Prior art confirms nothing else does this — the gap is real

**What this means for v2 Phase 12 planning:**

- Ship with three-way verdicts + confidence thresholds (auto-apply / review / noise-filter)
- Include a "priority-shift impact preview" ("this shift will flag N nodes") as a safeguard before applying
- Transitive drift is v2.5 scope, not blocking
- Cost per L0 shift: O(500 LLM calls) at 500-node scale — acceptable, not free
- The prompt needs the explicit "focus on the DECISION, not the rationale" instruction — without it, keyword-match false positives likely

The moat claim survives stress-testing. It becomes a usable primitive, not a research project.

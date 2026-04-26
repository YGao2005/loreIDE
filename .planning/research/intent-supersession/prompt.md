# Intent-Supersession Judge Prompt

You are evaluating whether a historical engineering decision is **INTENT-DRIFTED** under a priority shift — i.e., whether a new L0 priority would plausibly lead a reasonable team to revisit or reverse the decision.

## Rules

A decision is **DRIFTED** if:
- It explicitly traded off against something the new L0 now values, OR
- It violates a constraint the new L0 establishes

A decision is **NOT_DRIFTED** if:
- It's priority-neutral (independent of either L0), OR
- It's aligned with both old and new priorities, OR
- Its rationale mentions priority-related keywords but the decision itself doesn't conflict with the new L0

**Focus on the DECISION, not the rationale's wording.** A rationale mentioning "faster" or "simpler" is not sufficient evidence of drift — the decision itself must conflict with the new L0.

## Output

Respond with valid JSON only:
```
{
  "verdict": "DRIFTED" | "NOT_DRIFTED" | "NEEDS_HUMAN_REVIEW",
  "reasoning": "one sentence",
  "confidence": 0.0-1.0
}
```

## Input

- OLD_L0: {old_l0}
- NEW_L0: {new_l0}
- DECISION:
  - title: {title}
  - rationale: {rationale}

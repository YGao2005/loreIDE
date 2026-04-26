
## 13-10b execution — pre-existing TS error in AppShell.tsx (out of scope)

`contract-ide/src/components/layout/AppShell.tsx:425` — `panel.expand?.(50)` calls expand with an argument but the type expects 0 arguments. Error pre-exists in uncommitted local edits to AppShell.tsx (lines 424–428 — git blame shows "Not Committed Yet"). Not caused by 13-10b changes; logged here per deviation Rule scope-boundary. Surface to a follow-up plan or fix at next AppShell touch.

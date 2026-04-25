import type { ReactNode } from 'react';

/**
 * Reusable async-UI primitive (SHELL-04).
 *
 * Every data-driven panel in the IDE renders through this component so that
 * loading, empty, error, and ready states are handled identically everywhere —
 * "no freezes, no silent failures" is a property of HOW async UI is written.
 *
 * The `data-async` attribute on each state is the verification hook: tests
 * and human verifiers can query the DOM to confirm which branch is active.
 */
export type AsyncStatus = 'loading' | 'empty' | 'error' | 'ready';

export interface AsyncStateProps {
  state: AsyncStatus;
  error?: string | null;
  empty?: ReactNode;
  loading?: ReactNode;
  children?: ReactNode; // rendered when state === 'ready'
}

export function AsyncState({
  state,
  error,
  empty,
  loading,
  children,
}: AsyncStateProps) {
  if (state === 'loading') {
    return (
      <div
        data-async="loading"
        className="h-full w-full flex items-center justify-center text-muted-foreground text-sm"
      >
        {loading ?? 'Loading…'}
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div
        data-async="error"
        role="alert"
        className="h-full w-full flex items-center justify-center text-destructive text-sm px-6 text-center"
      >
        {error ?? 'Something went wrong'}
      </div>
    );
  }

  if (state === 'empty') {
    return (
      <div
        data-async="empty"
        className="h-full w-full flex items-center justify-center text-muted-foreground text-sm"
      >
        {empty ?? 'Nothing here yet'}
      </div>
    );
  }

  return (
    <div data-async="ready" className="h-full w-full">
      {children}
    </div>
  );
}

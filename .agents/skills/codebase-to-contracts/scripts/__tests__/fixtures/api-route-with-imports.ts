// Fixture for synthesize-flows tests — an API DELETE route that imports
// THREE libs and invokes them in a specific order:
//   1. getSession (auth check)
//   2. beginAccountDeletion (the orchestrator)
//   3. archiveStripeCustomer (Stripe archive)
// The test asserts staticCallChain returns [auth, account, stripe] in
// invocation order even though the imports are declared account/auth/stripe
// (the AST walk should reflect the CALL order, not the import order).
import { beginAccountDeletion } from '@/lib/account';
import { getSession } from '@/lib/auth';
import { archiveStripeCustomer } from '@/lib/stripe';

export async function DELETE(req: Request) {
  const session = await getSession(req);
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 });
  await beginAccountDeletion(session.userId);
  await archiveStripeCustomer(session.userId);
  return new Response(null, { status: 204 });
}

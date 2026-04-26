// Fixture for synthesize-flows recursion tests — a lib that itself imports
// a third-party (`./stripe`) and invokes it via member-expression callee
// (`stripe.refunds.create`). When synthesize-flows recurses one level into
// this lib, it should pick up the stripe member.
import { stripe } from './stripe';

export async function refund(orderId: string) {
  return stripe.refunds.create({ payment_intent: orderId });
}

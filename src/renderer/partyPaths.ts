import type { PartyType } from '../main/types';

// Where each party type's list lives (its profile pages are `<base>/<id>`).
// One place for this, instead of building `/${partyType}s` by hand in every
// view: that trick only works for single-word types and would have produced
// '/waste_customers' (which no route matches) for waste customers.
const BASE_PATH: Record<PartyType, string> = {
  supplier: '/suppliers',
  shopkeeper: '/shopkeepers',
  customer: '/customers',
  waste_customer: '/waste-customers',
};

export function partyBasePath(partyType: PartyType): string {
  return BASE_PATH[partyType];
}

export function partyProfilePath(partyType: PartyType, partyId: number): string {
  return `${BASE_PATH[partyType]}/${partyId}`;
}

// Customers and waste customers are the same kind of account (people who buy
// from the shop on credit), so they share the customer-style list: sort by
// recent purchase, "inactive with balance" grouping, last-purchase column.
export function isCustomerLike(partyType: PartyType): boolean {
  return partyType === 'customer' || partyType === 'waste_customer';
}

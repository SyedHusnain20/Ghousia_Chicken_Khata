// The one list of items offered in every item dropdown in the app (party
// purchase/sale forms, entry editing, Counter Sale). Add or rename an item
// here and every form picks it up - nothing else needs to change.
export const ITEM_OPTIONS = [
  'Chicken',
  'Boneless',
  'Zinda',
  'Lever',
  'Chest',
  'Leg',
  'Drum Stick',
  'Pota',
  'Kaleji',
  'Wings',
  'Neck',
  'Qeema',
] as const;

export const DEFAULT_ITEM = ITEM_OPTIONS[0];

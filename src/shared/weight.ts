// Weights are physical quantities, not money: they must NEVER be floored or
// ceiled (unlike rupee amounts, which this app keeps in whole rupees).
//
// But adding them with plain JS floats isn't exact either:
//   0.1 + 0.2 === 0.30000000000000004
// so an owner adding up 8.9 + 3.9 + 4.3 could be shown 17.099999999999998
// instead of 17.1. To avoid that, each weight is converted to a whole number
// of millionths of a kilogram (integers add exactly), summed, and only then
// converted back. One millionth of a KG is far finer than anything a scale
// can read, so nothing is lost; weights typed with up to 6 decimals come
// out exactly as typed.
const MICRO_KG = 1_000_000;

export function sumWeightsExact(weights: number[]): number {
  let micro = 0;
  for (const w of weights) micro += Math.round(w * MICRO_KG);
  return micro / MICRO_KG;
}

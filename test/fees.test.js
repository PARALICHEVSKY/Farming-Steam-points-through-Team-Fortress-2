import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cycleEconomics, feesForReceive, receiveForBuyerPrice } from '../src/fees.js';

test('fees follow Steam rules (5% + 10%, min 1 each)', () => {
  assert.deepEqual(feesForReceive(100), { receive: 100, steamFee: 5, publisherFee: 10, buyerPays: 115 });
  assert.deepEqual(feesForReceive(3), { receive: 3, steamFee: 1, publisherFee: 1, buyerPays: 5 });
});

test('receiveForBuyerPrice never makes the buyer pay more than asked', () => {
  for (let buyer = 3; buyer < 50_000; buyer += 7) {
    const r = receiveForBuyerPrice(buyer);
    assert.ok(feesForReceive(r).buyerPays <= buyer, `buyer ${buyer}`);
    assert.ok(feesForReceive(r + 1).buyerPays > buyer, `buyer ${buyer} not maximal`);
  }
});

test('known key price: buyer pays $2.30 -> seller gets $2.00', () => {
  assert.equal(receiveForBuyerPrice(230), 200);
});

test('cycle economics', () => {
  const e = cycleEconomics({ storePrice: 249, buyerPrice: 230 });
  assert.equal(e.receive, 200);
  assert.equal(e.loss, 49);
  assert.equal(e.points, 249);
  assert.ok(Math.abs(e.lossPercent - 19.68) < 0.01);
});

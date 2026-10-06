/**
 * The account balance is kept in bronze and shown as gold / silver / bronze
 * coins at 100 : 1 each step.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { test } from 'vitest';

import { toCoins } from '../src/office/coins.js';

test('splits a bronze balance into gold, silver and bronze (100 : 1 each step)', () => {
  assert.deepEqual(toCoins(0), { gold: 0, silver: 0, bronze: 0 });
  assert.deepEqual(toCoins(99), { gold: 0, silver: 0, bronze: 99 });
  assert.deepEqual(toCoins(100), { gold: 0, silver: 1, bronze: 0 });
  assert.deepEqual(toCoins(12_345), { gold: 1, silver: 23, bronze: 45 });
  assert.deepEqual(toCoins(1_000_000), { gold: 100, silver: 0, bronze: 0 });
});

test('never shows negative or fractional coins', () => {
  assert.deepEqual(toCoins(-5), { gold: 0, silver: 0, bronze: 0 });
  assert.deepEqual(toCoins(150.9), { gold: 0, silver: 1, bronze: 50 });
});

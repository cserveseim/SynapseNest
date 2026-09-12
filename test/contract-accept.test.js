'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateContract, ContractError } = require('../src/contract');

test('validateContract accepts signed v0 contract', () => {
  const c = validateContract({
    schema: 'synapse.contract/v0',
    id: 'contract_abc',
    rev: 1,
    identity: { mission: 'Build Continuum golden path' },
    lineage: { title: 'Continuum' },
    recipe: { templateId: 'static-site', runtime: 'stub' },
    seal: { signature: 'sig', signedAt: '2026-09-12T00:00:00.000Z' },
    issuer: { guardianFp: 'fp1' }
  });
  assert.equal(c.id, 'contract_abc');
  assert.equal(c.rev, 1);
  assert.equal(c.recipe.runtime, 'stub');
});

test('validateContract rejects bad schema', () => {
  assert.throws(() => validateContract({ schema: 'nope', id: 'contract_x', rev: 1, identity: { mission: 'x' } }), ContractError);
});

test('validateContract rejects unsigned when not allowed', () => {
  const prev = process.env.SYNAPSENEST_ALLOW_UNSIGNED_CONTRACTS;
  const nodeEnv = process.env.NODE_ENV;
  process.env.SYNAPSENEST_ALLOW_UNSIGNED_CONTRACTS = '0';
  process.env.NODE_ENV = 'production';
  try {
    assert.throws(() => validateContract({
      schema: 'synapse.contract/v0',
      id: 'contract_x',
      rev: 1,
      identity: { mission: 'x' },
      seal: {}
    }), (err) => err instanceof ContractError && err.statusCode === 401);
  } finally {
    process.env.SYNAPSENEST_ALLOW_UNSIGNED_CONTRACTS = prev;
    process.env.NODE_ENV = nodeEnv;
  }
});

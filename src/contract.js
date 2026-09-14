'use strict';

class ContractError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'ContractError';
    this.statusCode = statusCode;
  }
}

const SCHEMA = 'synapse.contract/v0';
const STANCES = new Set(['student', 'worker', 'institution', 'enterprise']);
const RUNTIMES = new Set(['stub', 'static-preview', 'node', 'python', 'lxc-ubuntu']);

function allowUnsigned() {
  return process.env.SYNAPSENEST_ALLOW_UNSIGNED_CONTRACTS === '1' || process.env.NODE_ENV === 'test';
}

function validateContract(input) {
  if (!input || typeof input !== 'object') throw new ContractError('Contract body is required.');
  if (input.schema !== SCHEMA) throw new ContractError(`schema must be ${SCHEMA}.`);
  const id = requiredString(input.id, 'id', 120);
  if (!id.startsWith('contract_')) throw new ContractError('id must start with contract_.');
  const rev = Number(input.rev);
  if (!Number.isInteger(rev) || rev < 1) throw new ContractError('rev must be a positive integer.');

  const identity = input.identity || {};
  const mission = requiredString(identity.mission, 'identity.mission', 800);
  const stance = optionalString(identity.stance, 'identity.stance', 40);
  if (stance && !STANCES.has(stance)) throw new ContractError('identity.stance is invalid.');
  const ordinanceId = optionalString(identity.ordinanceId, 'identity.ordinanceId', 200);
  const theaterKind = optionalString(identity.theaterKind, 'identity.theaterKind', 40);

  const lineage = input.lineage || {};
  const title = optionalString(lineage.title, 'lineage.title', 120) || mission.slice(0, 120);
  const description = optionalString(lineage.description, 'lineage.description', 2000);
  const genomeId = optionalString(lineage.genomeId, 'lineage.genomeId', 120);
  const synapseId = optionalString(lineage.synapseId, 'lineage.synapseId', 120);
  const proofPath = optionalString(lineage.proofPath, 'lineage.proofPath', 300);

  const recipe = input.recipe || {};
  const templateId = optionalString(recipe.templateId, 'recipe.templateId', 80) || 'static-site';
  const runtime = optionalString(recipe.runtime, 'recipe.runtime', 40) || 'stub';
  if (!RUNTIMES.has(runtime)) throw new ContractError('recipe.runtime is invalid.');

  const limits = input.limits && typeof input.limits === 'object' ? input.limits : {};
  const policy = input.policy && typeof input.policy === 'object' ? input.policy : {};
  const backup = input.backup && typeof input.backup === 'object' ? input.backup : {};
  const r2Key = optionalString(backup.r2Key, 'backup.r2Key', 400);
  const seal = input.seal && typeof input.seal === 'object' ? input.seal : {};
  const signature = optionalString(seal.signature, 'seal.signature', 8000);
  const signedAt = optionalString(seal.signedAt, 'seal.signedAt', 40);
  const issuer = input.issuer && typeof input.issuer === 'object' ? input.issuer : {};
  const guardianFp = optionalString(issuer.guardianFp, 'issuer.guardianFp', 200);

  if (!allowUnsigned() && (!signature || !signedAt)) {
    throw new ContractError('Unsigned contracts are rejected.', 401);
  }

  return {
    schema: SCHEMA,
    id,
    rev,
    identity: { mission, stance, ordinanceId, theaterKind },
    lineage: { title, description, genomeId, synapseId, proofPath },
    recipe: {
      templateId,
      nestTemplateId: nestTemplateFor(templateId, runtime),
      runtime,
      previewPort: Number(recipe.previewPort) || 8080,
      install: optionalString(recipe.install, 'recipe.install', 80) || 'none',
      command: optionalString(recipe.command, 'recipe.command', 120) || 'deferred'
    },
    limits: {
      cpu: Number(limits.cpu) || 1,
      memoryMb: Number(limits.memoryMb) || 1024,
      diskMb: Number(limits.diskMb) || 4096,
      pids: Number(limits.pids) || 256,
      network: optionalString(limits.network, 'limits.network', 40) || 'none',
      ttlHours: Number(limits.ttlHours) || 72
    },
    policy: {
      blastsAllowed: Array.isArray(policy.blastsAllowed) ? policy.blastsAllowed : ['read', 'write', 'memory'],
      blastsForbidden: Array.isArray(policy.blastsForbidden) ? policy.blastsForbidden : ['external'],
      needsDirectorGate: Boolean(policy.needsDirectorGate),
      promoteToContinuum: Boolean(policy.promoteToContinuum)
    },
    backup: { r2Key },
    seal: {
      alg: optionalString(seal.alg, 'seal.alg', 80) || 'guardian-ordinance',
      signature,
      signedAt
    },
    issuer: {
      planet: optionalString(issuer.planet, 'issuer.planet', 80) || 'SYNAPSE',
      universe: optionalString(issuer.universe, 'issuer.universe', 80) || 'eimOS',
      guardianFp
    }
  };
}


function nestTemplateFor(templateId, runtime) {
  if (templateId === 'node-api' || runtime === 'node') return 'node-api';
  if (templateId === 'python-api' || runtime === 'python') return 'python-api';
  return 'static-site';
}

function requiredString(value, field, max) {
  if (typeof value !== 'string' || !value.trim()) throw new ContractError(`${field} is required.`);
  const text = value.trim();
  if (text.length > max) throw new ContractError(`${field} is too long.`);
  return text;
}

function optionalString(value, field, max) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string') throw new ContractError(`${field} must be a string.`);
  const text = value.trim();
  if (text.length > max) throw new ContractError(`${field} is too long.`);
  return text;
}

module.exports = { validateContract, ContractError, SCHEMA };

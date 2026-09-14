'use strict';

const { Pool } = require('pg');

function createPool(options = {}) {
  const connectionString = options.connectionString || process.env.DATABASE_URL;
  if (!connectionString || typeof connectionString !== 'string') {
    const error = new Error('DATABASE_URL is required when USE_POSTGRES=1.');
    error.code = 'POSTGRES_DATABASE_URL_MISSING';
    throw error;
  }
  return new Pool({
    connectionString,
    max: options.max || 10,
    idleTimeoutMillis: options.idleTimeoutMillis || 30_000,
    connectionTimeoutMillis: options.connectionTimeoutMillis || 5_000
  });
}

async function assertReachable(pool) {
  const client = await pool.connect();
  try {
    await client.query('SELECT 1 AS ok');
  } finally {
    client.release();
  }
}

function toIso(value) {
  if (value == null) return value;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

module.exports = { createPool, assertReachable, toIso };

'use strict';

/**
 * Minimal YAML subset parser for synapsenest.yaml recipes.
 * Supports: scalars, nested maps (2-space indent), and string lists (- item).
 * Intentionally not a full YAML 1.2 implementation.
 */

class RecipeYamlError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RecipeYamlError';
  }
}

function parseRecipeYaml(text) {
  if (typeof text !== 'string') throw new RecipeYamlError('Recipe YAML must be text.');
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const root = {};
  const stack = [{ indent: -1, value: root }];

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue;
    const indent = raw.match(/^ */)[0].length;
    if (indent % 2 !== 0) throw new RecipeYamlError(`Invalid indentation on line ${index + 1}.`);
    const trimmed = raw.trim();

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].value;

    if (trimmed.startsWith('- ')) {
      if (!Array.isArray(parent)) throw new RecipeYamlError(`List item without list parent on line ${index + 1}.`);
      parent.push(parseScalar(trimmed.slice(2).trim()));
      continue;
    }

    const separator = trimmed.indexOf(':');
    if (separator < 0) throw new RecipeYamlError(`Expected key: value on line ${index + 1}.`);
    const key = trimmed.slice(0, separator).trim();
    const remainder = trimmed.slice(separator + 1).trim();
    if (!key || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new RecipeYamlError(`Invalid key on line ${index + 1}.`);
    }
    if (!parent || Array.isArray(parent) || typeof parent !== 'object') {
      throw new RecipeYamlError(`Cannot assign key under non-object on line ${index + 1}.`);
    }

    if (remainder === '' || remainder === '|' || remainder === '>') {
      const next = peekNextMeaningful(lines, index + 1);
      if (next && next.indent > indent && next.trimmed.startsWith('- ')) {
        parent[key] = [];
        stack.push({ indent, value: parent[key] });
      } else if (next && next.indent > indent) {
        parent[key] = {};
        stack.push({ indent, value: parent[key] });
      } else {
        parent[key] = '';
      }
    } else {
      parent[key] = parseScalar(remainder);
    }
  }

  return root;
}

function peekNextMeaningful(lines, start) {
  for (let index = start; index < lines.length; index += 1) {
    const raw = lines[index];
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue;
    return { indent: raw.match(/^ */)[0].length, trimmed: raw.trim() };
  }
  return null;
}

function parseScalar(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null' || value === '~') return null;
  if (/^-?\d+$/.test(value)) return Number(value);
  if (/^-?\d+\.\d+$/.test(value)) return Number(value);
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

module.exports = { parseRecipeYaml, RecipeYamlError };

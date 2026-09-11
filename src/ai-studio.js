'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_MODEL = 'grok-4.6';
const DEFAULT_BASE_URL = 'https://api.x.ai/v1';
const MAX_PROMPT = 8_000;
const MAX_FILES = 8;
const MAX_CONTEXT_FILES = 12;
const MAX_CONTEXT_CHARS = 60_000;

class AiStudioError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'AiStudioError';
    this.statusCode = statusCode;
  }
}

class AiStudio {
  constructor({ apiKey = '', model = DEFAULT_MODEL, baseUrl = DEFAULT_BASE_URL, fetchImpl = globalThis.fetch } = {}) {
    this.apiKey = apiKey || '';
    this.model = model || DEFAULT_MODEL;
    this.baseUrl = String(baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
    this.fetchImpl = fetchImpl;
  }

  configured() {
    return Boolean(this.apiKey);
  }

  status() {
    return { configured: this.configured(), model: this.configured() ? this.model : '', provider: 'SpaceXAI' };
  }

  async turn({ prompt, files }) {
    if (!this.configured()) {
      throw new AiStudioError('SpaceXAI is not configured. Set XAI_API_KEY on the server.', 503);
    }
    if (typeof this.fetchImpl !== 'function') throw new AiStudioError('AI fetch transport is unavailable.', 503);
    const instruction = requiredPrompt(prompt);
    const context = serializeFiles(files);
    const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `${instruction}\n\nCurrent workspace files:\n${context}` }
        ]
      }),
      signal: AbortSignal.timeout(120_000)
    });
    const payload = await readResponse(response);
    if (!response.ok) {
      throw new AiStudioError(payload.error || `SpaceXAI request failed (${response.status}).`, response.status === 401 ? 502 : 502);
    }
    return parseModelOutput(payload);
  }
}

const SYSTEM_PROMPT = `You are the SynapseNest workspace builder, a self-hosted AI coding environment.
Edit only the current workspace. Return JSON with keys:
- "reply": a short explanation for the owner
- "files": an array of { "path", "content" } text files to write
Rules:
- paths must be relative, with no .., leading slash, or dotfiles
- only .html .css .js .json .md .svg .txt
- at most ${MAX_FILES} files
- never include secrets, host paths, Docker commands, or shell payloads
- keep each file under 100000 bytes
- if you only need to talk, return files as []`;

function requiredPrompt(prompt) {
  if (typeof prompt !== 'string' || !prompt.trim()) throw new AiStudioError('prompt is required.');
  const text = prompt.trim();
  if (text.length > MAX_PROMPT) throw new AiStudioError(`prompt must be at most ${MAX_PROMPT} characters.`);
  return text;
}

function serializeFiles(files) {
  if (!Array.isArray(files) || files.length === 0) return '(empty workspace)';
  let used = 0;
  const chunks = [];
  for (const file of files.slice(0, MAX_CONTEXT_FILES)) {
    const pathName = String(file.path || '');
    const content = String(file.content || '');
    const chunk = `--- ${pathName} ---\n${content}\n`;
    if (used + chunk.length > MAX_CONTEXT_CHARS) break;
    chunks.push(chunk);
    used += chunk.length;
  }
  return chunks.join('\n') || '(empty workspace)';
}

async function readResponse(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { error: 'SpaceXAI returned a non-JSON response.' };
  }
}

function parseModelOutput(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  const parsed = parseJsonObject(content);
  const reply = typeof parsed.reply === 'string' && parsed.reply.trim() ? parsed.reply.trim() : 'Updated the workspace.';
  const files = Array.isArray(parsed.files) ? parsed.files.slice(0, MAX_FILES).map(normalizeFile).filter(Boolean) : [];
  return { reply, files };
}

function parseJsonObject(content) {
  if (typeof content !== 'string' || !content.trim()) throw new AiStudioError('SpaceXAI returned an empty response.', 502);
  const trimmed = content.trim().replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '');
  try {
    const value = JSON.parse(trimmed);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not object');
    return value;
  } catch {
    throw new AiStudioError('SpaceXAI returned invalid JSON.', 502);
  }
}

function normalizeFile(file) {
  if (!file || typeof file !== 'object') return null;
  if (typeof file.path !== 'string' || typeof file.content !== 'string') return null;
  return { path: file.path, content: file.content };
}

function loadGrokCliToken(authFile = path.join(os.homedir(), '.grok', 'auth.json')) {
  try {
    const parsed = JSON.parse(fs.readFileSync(authFile, 'utf8'));
    const entries = parsed && typeof parsed === 'object' ? Object.values(parsed) : [];
    const entry = entries.find((value) => value && typeof value === 'object' && typeof value.key === 'string' && value.key.length > 20);
    return entry ? entry.key : '';
  } catch {
    return '';
  }
}

module.exports = { AiStudio, AiStudioError, DEFAULT_MODEL, MAX_PROMPT, MAX_FILES, loadGrokCliToken };

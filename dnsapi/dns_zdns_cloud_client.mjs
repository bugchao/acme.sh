#!/usr/bin/env node
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const AUTH = 'https://mo-auth.zdns.cn';
const DNS = 'https://dns.yun.zdns.cn';
const REDIRECT = 'https://yun.zdns.cn';
const RECORD_PATH = '/api/DNS/rrmanager/rr';
const LOGIN_KEY = Buffer.from('i1kjJoIlKOe$0*X$', 'utf8');

function usage() {
  console.error('Usage: dns_zdns_cloud_client.mjs <list|create|ensure|update|delete|delete-matching|upsert> --zone ZONE [--host HOST --type A|CNAME|TXT --value VALUE] [--id ID] [--ttl SECONDS] [--view VIEW] [--credentials FILE] [--dry-run]');
  process.exit(2);
}

function parseOptions(argv) {
  const [command, ...args] = argv;
  if (!['list', 'create', 'ensure', 'update', 'delete', 'delete-matching', 'upsert'].includes(command)) usage();
  const opts = { command };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dry-run') { opts.dryRun = true; continue; }
    const key = args[i].slice(2);
    if (!args[i].startsWith('--') || !['zone', 'host', 'type', 'value', 'id', 'ttl', 'view', 'credentials'].includes(key) || i + 1 >= args.length) usage();
    opts[key] = args[++i];
  }
  if (!opts.zone) usage();
  opts.zone = opts.zone.endsWith('.') ? opts.zone : `${opts.zone}.`;
  opts.view ??= 'others';
  if (opts.ttl !== undefined && (!/^\d+$/.test(opts.ttl) || Number(opts.ttl) < 1)) throw new Error('TTL must be a positive integer');
  if (['create', 'ensure', 'delete-matching', 'upsert'].includes(command) && (!opts.host || !opts.type || opts.value === undefined)) usage();
  if (['update', 'delete'].includes(command) && !opts.id) usage();
  if (opts.type) {
    opts.type = opts.type.toLowerCase();
    if (!['a', 'cname', 'txt'].includes(opts.type)) throw new Error('Record type must be A, CNAME, or TXT');
  }
  if (opts.type === 'a' && opts.value !== undefined && isIP(opts.value) !== 4) throw new Error('A record value must be an IPv4 address');
  if (opts.type === 'cname' && opts.value !== undefined && !opts.value.endsWith('.')) opts.value += '.';
  return opts;
}

function readCredentials(file) {
  const username = process.env.ZDNS_CLOUD_USERNAME;
  const password = process.env.ZDNS_CLOUD_PASSWORD;
  if (!file && username && password) return { username, password };
  file ??= join(homedir(), '.config', 'zdns-cloud', 'credentials.json');
  if (!existsSync(file)) throw new Error('Set ZDNS_CLOUD_USERNAME and ZDNS_CLOUD_PASSWORD, or create ~/.config/zdns-cloud/credentials.json');
  const content = readFileSync(file, 'utf8');
  try {
    const { username, password } = JSON.parse(content);
    if (username && password) return { username, password };
  } catch { /* Read the existing yun.key layout below. */ }
  const lines = content.trimEnd().split(/\r?\n/).map(line => line.trim());
  const index = lines.findIndex(line => /^[^\s@]+@[^\s@]+$/.test(line));
  if (index < 0 || !lines[index + 1]) throw new Error('Credentials file must contain a username and password');
  return { username: lines[index], password: lines[index + 1] };
}

function encryptPassword(password) {
  const cipher = createCipheriv('aes-128-ecb', LOGIN_KEY, null);
  return Buffer.concat([cipher.update(password.replace(/\s*/g, ''), 'utf8'), cipher.final()]).toString('hex');
}

function tokenExpiry(token, expiresIn) {
  let jwtExpiry;
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    if (Number.isFinite(Number(payload.exp))) jwtExpiry = Number(payload.exp) * 1000;
  } catch { /* Some access tokens are opaque. */ }
  const responseExpiry = Number(expiresIn) > 0 ? Date.now() + Number(expiresIn) * 1000 : undefined;
  const knownExpiries = [jwtExpiry, responseExpiry].filter(Number.isFinite);
  return knownExpiries.length ? Math.min(...knownExpiries) : Date.now() + 10 * 60 * 1000;
}

class Client {
  constructor() {
    this.dir = mkdtempSync(join(tmpdir(), 'zdns-cloud-'));
    this.cookieJar = join(this.dir, 'cookies');
    this.headerFile = join(this.dir, 'headers');
    this.cacheFile = process.env.ZDNS_CLOUD_TOKEN_CACHE || join(homedir(), '.cache', 'zdns-cloud', 'token.json');
    writeFileSync(this.cookieJar, '', { mode: 0o600 });
  }

  close() { rmSync(this.dir, { recursive: true, force: true }); }

  authenticate(credentials) {
    this.credentials = credentials;
    this.identity = createHash('sha256').update(credentials.username).update('\0').update(credentials.password).digest('hex');
    try {
      const cached = JSON.parse(readFileSync(this.cacheFile, 'utf8'));
      if (cached.identity === this.identity && cached.expiresAt > Date.now() + 60_000 && cached.token) {
        this.token = cached.token;
        return;
      }
    } catch { /* Missing or invalid cache: log in normally. */ }
    this.login(credentials);
  }

  saveToken(expiresAt) {
    const dir = dirname(this.cacheFile);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const temporary = `${this.cacheFile}.${process.pid}.${randomBytes(4).toString('hex')}`;
    try {
      writeFileSync(temporary, JSON.stringify({ identity: this.identity, token: this.token, expiresAt }), { mode: 0o600, flag: 'wx' });
      renameSync(temporary, this.cacheFile);
      chmodSync(this.cacheFile, 0o600);
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
    }
  }

  clearToken() {
    if (existsSync(this.cacheFile)) unlinkSync(this.cacheFile);
  }

  request(method, url, { form, json, token } = {}) {
    const args = ['--silent', '--show-error', '--compressed', '--max-time', '30', '--max-redirs', '0',
      '--dump-header', this.headerFile, '--cookie', this.cookieJar, '--cookie-jar', this.cookieJar,
      '--request', method, '--url', url];
    if (token) args.push('--header', `accesstoken: ${token}`);
    if (form) args.push('--header', 'Content-Type: application/x-www-form-urlencoded', '--data-binary', '@-');
    if (json) args.push('--header', 'Content-Type: application/json', '--data-binary', '@-');
    const input = form ? new URLSearchParams(form).toString() : json ? JSON.stringify(json) : undefined;
    const result = spawnSync('curl', args, { input, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    if (result.error || result.status !== 0) throw new Error(`HTTP request failed: ${result.error?.message ?? result.stderr.trim()}`);
    const blocks = readFileSync(this.headerFile, 'utf8').split(/\r?\n\r?\n/).filter(block => /^HTTP\//.test(block));
    const headers = blocks.at(-1) ?? '';
    const status = Number(headers.match(/^HTTP\/\S+\s+(\d+)/)?.[1]);
    const location = headers.match(/^location:\s*(.+)$/im)?.[1]?.trim();
    return { status, location, body: result.stdout };
  }

  login({ username, password }) {
    this.request('GET', `${AUTH}/auth/login`);
    const login = this.request('POST', `${AUTH}/auth/login`, {
      form: { username, password: encryptPassword(password), from: 'yun' },
    });
    if (login.status !== 302) throw new Error(`Login failed (HTTP ${login.status})`);
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const authorize = new URL('/auth/authorize', AUTH);
    authorize.search = new URLSearchParams({ response_type: 'code', client_id: 'portal', redirect_uri: REDIRECT,
      code_challenge: challenge, code_challenge_method: 'S256' }).toString();
    const auth = this.request('GET', authorize.toString());
    const code = auth.location && new URL(auth.location, REDIRECT).searchParams.get('code');
    if (!code) throw new Error(`Authorization failed (HTTP ${auth.status})`);
    const tokenResponse = this.request('POST', `${AUTH}/auth/token`, {
      form: { grant_type: 'authorization_code', code, client_id: 'portal', code_verifier: verifier, redirect_uri: REDIRECT },
    });
    let body;
    try { body = JSON.parse(tokenResponse.body); } catch { throw new Error('Token endpoint did not return JSON'); }
    this.token = body.access_token ?? body.data?.access_token;
    if (!this.token) throw new Error(`Token response did not contain access_token (HTTP ${tokenResponse.status})`);
    this.saveToken(tokenExpiry(this.token, body.expires_in ?? body.data?.expires_in));
  }

  api(method, path, { query, body } = {}) {
    const url = new URL(path, DNS);
    if (query) url.search = new URLSearchParams(query).toString();
    const call = () => {
      const response = this.request(method, url.toString(), { json: body, token: this.token });
      let parsed;
      try { parsed = JSON.parse(response.body); } catch { /* Handle HTTP auth errors before JSON parsing errors. */ }
      return { response, parsed };
    };
    let { response, parsed } = call();
    const authError = response.status === 401 || response.status === 403 ||
      ['401', '403', '40100'].includes(String(parsed?.code)) ||
      /token.*(expired|invalid)|登录过期|未授权|鉴权失败/i.test(parsed?.message ?? '');
    if (authError) {
      this.clearToken();
      this.login(this.credentials);
      ({ response, parsed } = call());
    }
    if (!parsed) throw new Error(`DNS API returned non-JSON (HTTP ${response.status})`);
    if (response.status < 200 || response.status >= 300 || String(parsed.code) !== '20000') {
      throw new Error(`DNS API failed (HTTP ${response.status}, code ${parsed.code}): ${parsed.message ?? 'unknown error'}`);
    }
    return parsed.data;
  }

  list(zone) {
    const records = [];
    let offset = 0;
    while (true) {
      const data = this.api('GET', RECORD_PATH, { query: { offset, limit: 50, _withcount: true, zone } });
      if (!Array.isArray(data?.list)) throw new Error('Record list response has no list');
      records.push(...data.list);
      offset += data.list.length;
      if (offset >= data.total || !data.list.length) return records;
    }
  }

  write(method, zone, record) {
    return this.api(method, RECORD_PATH, { query: method === 'DELETE' ? undefined : { zone }, body: { data: [record] } });
  }
}

function newRecord(opts) {
  return { ttl: Number(opts.ttl ?? 600), type: opts.type, view: opts.view, flags: 1, index: 0,
    host: opts.host, rdata: opts.value, zone: opts.zone,
    name: opts.host === '@' ? opts.zone : `${opts.host}.${opts.zone}` };
}

function validateValue(type, value) {
  if (type === 'a' && isIP(value) !== 4) throw new Error('A record value must be an IPv4 address');
  if (type === 'cname' && !value.endsWith('.')) return `${value}.`;
  return value;
}

function main() {
  const opts = parseOptions(process.argv.slice(2));
  const client = new Client();
  try {
    client.authenticate(readCredentials(opts.credentials));
    const records = client.list(opts.zone);
    if (opts.command === 'list') { console.log(JSON.stringify(records, null, 2)); return; }
    if (opts.command === 'delete-matching') {
      const matches = records.filter(row => row.host === opts.host && row.type === opts.type &&
        row.view === opts.view && row.rdata === opts.value);
      if (matches.length > 1) throw new Error('Multiple records have the same host, type, view, and value; use delete --id');
      if (!matches.length) { console.log(JSON.stringify({ deleted: false, reason: 'not found' })); return; }
      const id = matches[0].id;
      console.log(JSON.stringify(opts.dryRun ? { method: 'DELETE', id } : client.write('DELETE', opts.zone, { id }), null, 2));
      return;
    }
    if (['create', 'ensure', 'upsert'].includes(opts.command)) {
      const matches = records.filter(row => row.host === opts.host && row.type === opts.type && row.view === opts.view);
      if (opts.command === 'upsert' && matches.length > 1) throw new Error('Multiple matching records; use update --id');
      if (opts.command === 'ensure') {
        const exact = matches.filter(row => row.rdata === opts.value);
        if (exact.length > 1) throw new Error('Multiple records already have the exact value');
        if (exact.length) { console.log(JSON.stringify({ created: false, id: exact[0].id })); return; }
      }
      if (opts.command === 'create' || opts.command === 'ensure' || !matches.length) {
        const conflicting = records.some(row => row.host === opts.host && row.view === opts.view &&
          (row.type === 'cname' || opts.type === 'cname') && row.type !== opts.type);
        if (conflicting) throw new Error('A CNAME cannot share a host and view with another record type');
        const record = newRecord(opts);
        console.log(JSON.stringify(opts.dryRun ? { method: 'POST', record } : client.write('POST', opts.zone, record), null, 2));
        return;
      }
      opts.id = matches[0].id;
    }
    const existing = records.find(row => row.id === opts.id);
    if (!existing) throw new Error('Record ID was not found in this zone');
    if (opts.command === 'delete') {
      console.log(JSON.stringify(opts.dryRun ? { method: 'DELETE', id: opts.id } : client.write('DELETE', opts.zone, { id: opts.id }), null, 2));
      return;
    }
    const record = { ...existing, index: 0 };
    if (opts.value !== undefined) record.rdata = validateValue(existing.type, opts.value);
    if (opts.ttl !== undefined) record.ttl = Number(opts.ttl);
    console.log(JSON.stringify(opts.dryRun ? { method: 'PUT', record } : client.write('PUT', opts.zone, record), null, 2));
  } finally { client.close(); }
}

try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }

#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';

const BINARY_EXT = new Set([
  '.ico', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tif', '.tiff',
  '.pdf', '.zip', '.gz', '.tar', '.tgz', '.bz2', '.xz', '.7z', '.rar',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.mp3', '.mp4', '.wav', '.mov', '.avi', '.mkv', '.webm', '.flac', '.ogg',
  '.exe', '.dll', '.so', '.dylib', '.bin', '.class', '.jar', '.wasm',
]);

const EM_DASH = Buffer.from([0xE2, 0x80, 0x94]);
const EN_DASH = Buffer.from([0xE2, 0x80, 0x93]);

function listFiles() {
  const result = spawnSync('git', ['ls-files', '-z'], { encoding: 'buffer' });
  if (result.status !== 0) {
    process.stderr.write(`check-dashes: 'git ls-files -z' failed with status ${result.status}\n`);
    if (result.stderr) process.stderr.write(result.stderr.toString('utf8'));
    process.exit(2);
  }
  const raw = result.stdout;
  const files = [];
  let start = 0;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === 0) {
      if (i > start) files.push(raw.slice(start, i).toString('utf8'));
      start = i + 1;
    }
  }
  return files;
}

function looksBinary(buf) {
  const scan = buf.length > 8000 ? buf.subarray(0, 8000) : buf;
  return scan.includes(0);
}

function findDashes(buf) {
  const hits = [];
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0A) {
      line++;
      lineStart = i + 1;
      continue;
    }
    if (buf[i] === 0xE2 && i + 2 < buf.length && buf[i + 1] === 0x80) {
      const third = buf[i + 2];
      if (third === 0x94 || third === 0x93) {
        hits.push({ line, kind: third === 0x94 ? 'em-dash' : 'en-dash' });
        i += 2;
      }
    }
  }
  return hits;
}

function main() {
  const files = listFiles();
  let bad = 0;
  for (const file of files) {
    if (BINARY_EXT.has(extname(file).toLowerCase())) continue;
    let buf;
    try {
      buf = readFileSync(file);
    } catch (err) {
      if (err && err.code === 'ENOENT') continue;
      throw err;
    }
    if (looksBinary(buf)) continue;
    const hits = findDashes(buf);
    for (const hit of hits) {
      process.stdout.write(`${file}:${hit.line}: ${hit.kind}\n`);
      bad++;
    }
  }
  if (bad > 0) {
    process.stderr.write(`check-dashes: found ${bad} em-dash/en-dash occurrence(s); replace with ASCII '-' or '--'\n`);
    process.exit(1);
  }
}

main();

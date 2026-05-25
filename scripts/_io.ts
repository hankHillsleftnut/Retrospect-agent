import fs from 'fs';
import path from 'path';

const OUTPUTS_DIR = path.join(__dirname, 'outputs');

export function ensureOutputs(): string {
  fs.mkdirSync(OUTPUTS_DIR, { recursive: true });
  return OUTPUTS_DIR;
}

export function writeOutput(name: string, content: unknown): string {
  const dir = ensureOutputs();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${stamp}-${name}`;
  const filepath = path.join(dir, filename);
  const body = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
  fs.writeFileSync(filepath, body);
  return filepath;
}

export function readJsonFile<T = unknown>(filepath: string): T {
  const text = fs.readFileSync(filepath, 'utf-8');
  return JSON.parse(text) as T;
}

export function readTextFile(filepath: string): string {
  return fs.readFileSync(filepath, 'utf-8');
}

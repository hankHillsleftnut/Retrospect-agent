const { execFileSync } = require('child_process');
const { readFileSync } = require('fs');

const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
const patterns = [
  { name: 'OpenAI key', value: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g },
  { name: 'AWS access key', value: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'Private key', value: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
];
const findings = [];
for (const file of files) {
  if (file.endsWith('.lock') || file.startsWith('dist/')) continue;
  let content = '';
  try { content = readFileSync(file, 'utf8'); } catch { continue; }
  for (const pattern of patterns) {
    if (pattern.value.test(content)) findings.push(`${file}: possible ${pattern.name}`);
    pattern.value.lastIndex = 0;
  }
}
if (findings.length > 0) {
  console.error(findings.join('\n'));
  process.exitCode = 1;
} else {
  console.log('No committed high-risk secrets detected.');
}

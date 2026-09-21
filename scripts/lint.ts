/**
 * Nightly lint. Detection only -- this script never writes to the derived layer.
 *   npm run lint:brain -- --user <uuid>
 */
import { runLint, persistFindings } from '../src/brain/lint';

async function main() {
  const args = process.argv.slice(2);
  const userId = args[args.indexOf('--user') + 1];
  if (!userId || userId.startsWith('--')) {
    console.error('usage: npm run lint:brain -- --user <uuid>');
    process.exit(1);
  }

  const report = await runLint({ userId });

  if (report.safety.length > 0) {
    console.log('\n🚨 SAFETY — look at these now, not with the maintenance list');
    for (const f of report.safety) {
      console.log(`  [${f.checkId}] ${f.subjectKind} ${f.subjectIds.join(', ')}`);
      console.log(`      would have said: ${f.prevents}`);
      console.log(`      fix: ${f.remediation}`);
    }
  }

  console.log(`\nfindings: ${report.findings.length}  (bug ${report.counts.bug}, rot ${report.counts.rot}, info ${report.counts.info})`);
  for (const f of report.findings) {
    console.log(`  [${f.checkId}] ${f.severity.padEnd(4)} ${f.subjectKind} x${f.subjectIds.length}${f.detail ? ` — ${f.detail}` : ''}`);
  }

  if (report.findings.length === 0 && report.safety.length === 0) {
    console.log('  clean. (A lint that always fires is one nobody reads.)');
  }

  await persistFindings(report);
}

main().catch((err) => { console.error(err); process.exit(1); });

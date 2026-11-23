import { runIssue } from './pipeline.js';

const args = process.argv.slice(2);
const issue = Number(args.find((a) => /^\d+$/.test(a)));
const yes = args.includes('--yes');

if (!issue) {
  console.log(`Usage: npm run factory -- <issue-number> [--yes]

  <issue-number>  GitHub issue in the target repo to build
  --yes           skip the plan-approval gate (only once you trust the planner)`);
  process.exit(1);
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn('⚠ ANTHROPIC_API_KEY is not set. The Agent SDK needs it to run agents.');
}

runIssue(issue, { yes }).catch((err) => {
  console.error(`\n💥 ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});

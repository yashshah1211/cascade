import { loadFixtures } from './load.js';
import { traceImpact } from '../engine/impact.js';
import { evaluatePlan } from '../engine/evaluate.js';
import { budgetApprovalCommand } from '../switch/approval.js';

const command = process.argv[2] ?? 'help';
if (command === 'help') {
  console.log('Usage: npm run demo | npm run inspect | npm run dashboard | npm test');
  console.log('No CLI command can authorize a Switch approval or trigger unverified execution.');
} else if (command === 'demo' || command === 'inspect') {
  const { scenario, plans, disruption } = await loadFixtures();
  const impacted = traceImpact(scenario, disruption);
  const results = plans.map(plan => ({ plan, evaluation: evaluatePlan(scenario, plan) }));
  if (command === 'inspect') {
    console.log(JSON.stringify({ disclaimer: 'SYNTHETIC OFFLINE DEMO. Switch integration not yet verified.', scenario, disruption, impacted, results }, null, 2));
  } else {
    console.log(`CASCADE | ${scenario.title}`);
    console.log(`IMPACT: ${impacted.length} commitments | disruption: ${disruption.disabledNodeId}`);
    for (const { plan, evaluation } of results) {
      console.log(`\n${plan.id} ${plan.label} — ${evaluation.verdict} (INR ${evaluation.projectedCostINR})`);
      for (const c of evaluation.checks.filter(c => c.status !== 'PASS')) console.log(`  ${c.status} ${c.id}: ${c.message}`);
      if (evaluation.verdict === 'REQUIRES_APPROVAL') {
        console.log('  EXACT SWITCH APPROVAL MESSAGE (not sent):');
        console.log(`  ${budgetApprovalCommand(scenario, plan, evaluation.excessBudgetINR)}`);
      }
    }
    console.log('\nIntegration status: BLOCKED — no live Switch room approval has been verified.');
  }
} else {
  console.error(`Unknown command: ${command}`);
  process.exitCode = 2;
}

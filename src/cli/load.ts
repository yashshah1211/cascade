import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Disruption, RecoveryPlan, Scenario } from '../domain/types.js';
import { validatePlan, validateScenario } from '../domain/validate.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'fixtures');
export async function loadFixtures(): Promise<{ scenario: Scenario; plans: RecoveryPlan[]; disruption: Disruption }> {
  const scenario = JSON.parse(await readFile(join(root, 'event-cancellation.json'), 'utf8')) as unknown;
  validateScenario(scenario);
  const plans = JSON.parse(await readFile(join(root, 'recovery-plans.json'), 'utf8')) as unknown;
  if (!Array.isArray(plans)) throw new TypeError('Expected plans array');
  plans.forEach(p => validatePlan(p, scenario));
  return {
    scenario, plans: plans as RecoveryPlan[],
    disruption: { id: 'disruption-main-cancelled', disabledNodeId: scenario.originalVenueId,
      reportedAt: '2026-11-06T07:00:00+05:30', description: 'Main auditorium unavailable', source: 'SYNTHETIC' },
  };
}

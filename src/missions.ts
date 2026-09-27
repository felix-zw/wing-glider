import type { ResourceEvent, ResourceId } from './resources';

export type Objective =
  | { id: string; kind: 'count'; label: string; event: ResourceEvent['kind']; resource?: ResourceId; amount: number }
  | { id: string; kind: 'all' | 'any'; label: string; children: readonly Objective[] };
export interface MissionDefinition { id: string; title: string; objective: Objective }
export interface MissionProgress { counts: Record<string, number>; completed: boolean; completedAt: number | null }
export const FIRST_MISSION: MissionDefinition = {
  id: 'aster-first-delivery', title: 'Wertvolle Fracht.',
  objective: { id: 'delivery', kind: 'all', label: 'Rohstoffe an ATLAS liefern', children: [
    { id: 'ferrite-delivery', kind: 'count', label: 'Ferrit', event: 'delivered', resource: 'ferrite', amount: 30 },
    { id: 'copper-delivery', kind: 'count', label: 'Kupfererz', event: 'delivered', resource: 'copper', amount: 20 },
    { id: 'crystal-delivery', kind: 'count', label: 'Kristalle', event: 'delivered', resource: 'crystal', amount: 10 },
  ] },
};
export const createMissionProgress = (): MissionProgress => ({ counts: {}, completed: false, completedAt: null });
export function objectiveComplete(objective: Objective, progress: MissionProgress): boolean {
  if (objective.kind === 'count') return (progress.counts[objective.id] ?? 0) >= objective.amount;
  return objective.kind === 'all' ? objective.children.every(o => objectiveComplete(o, progress))
    : objective.children.some(o => objectiveComplete(o, progress));
}
export function objectiveCounts(objective: Objective): Extract<Objective, { kind: 'count' }>[] {
  return objective.kind === 'count' ? [objective] : objective.children.flatMap(objectiveCounts);
}
// Events are consumed immediately, not retained as an ever-growing log. Returns true only on completion.
export function applyMissionEvent(definition: MissionDefinition, progress: MissionProgress, event: ResourceEvent, elapsed: number): boolean {
  if (progress.completed) return false;
  for (const objective of objectiveCounts(definition.objective)) {
    if (objective.event === event.kind && (!objective.resource || objective.resource === event.resource)) {
      progress.counts[objective.id] = Math.min(objective.amount, (progress.counts[objective.id] ?? 0) + event.amount);
    }
  }
  if (!objectiveComplete(definition.objective, progress)) return false;
  progress.completed = true; progress.completedAt = elapsed; return true;
}

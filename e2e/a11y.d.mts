export interface A11yDetail { target: string; html: string; why: string }
export interface A11yFinding { id: string; impact: string; help: string; count: number; examples: string[]; details?: A11yDetail[] }
export function summarise(
  violations: Array<{ id: string; impact?: string | null; help: string; nodes: Array<{ target: unknown[]; html?: string; failureSummary?: string }> }>
): A11yFinding[]
export function checkA11y(page: unknown, name: string, dir: string): Promise<A11yFinding[] | null>
export function report(dir: string): string
export function broken(dir: string, since?: number): string[]
export function resetA11y(dir: string): void

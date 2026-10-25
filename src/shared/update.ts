export type UpdatePhase = 'disabled'|'idle'|'checking'|'downloading'|'ready'|'installing'|'error'
export interface UpdateStatus { currentVersion: string; phase: UpdatePhase; reason?: string; checkedAt?: number; version?: string; notes?: string; percent?: number; transferred?: number; total?: number; error?: string }

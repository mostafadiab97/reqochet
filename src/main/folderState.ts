// Whether a folder chosen for a new project can be used (1.0.2, CRA-15): an unreadable folder is not "empty".
import { readdir } from 'node:fs/promises'

export type FolderState = { kind: 'empty' } | { kind: 'full' } | { kind: 'unreadable'; error: string }

/** Empty (or not there yet — the folder dialog can create it), holding files, or not readable (with the reason). */
export async function folderState(folder: string): Promise<FolderState> {
  try {
    return (await readdir(folder)).length === 0 ? { kind: 'empty' } : { kind: 'full' }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'empty' }
    return { kind: 'unreadable', error: (e as Error).message }
  }
}

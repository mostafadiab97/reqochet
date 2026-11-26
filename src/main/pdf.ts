import { BrowserWindow } from 'electron'
import { mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { T } from '../shared/text'

/**
 * Prints an exported HTML document to PDF (0.25.0): a hidden window without scripts or a preload loads the file
 * from a temporary folder and Chromium prints it (A4, page numbers in the footer). The folder is removed afterwards.
 */
export async function htmlToPdf(html: string, report?: (line: string) => void): Promise<Uint8Array> {
  // 1.0.3 (the owner's PC took ~65 s for 10,005 entries, the Windows CI runner ~9 s): each phase is timed into the log
  const start = performance.now()
  const phases: string[] = []
  let mark = start
  const phase = (name: string): void => {
    const now = performance.now()
    phases.push(`${name} ${Math.round(now - mark)} ms`)
    mark = now
  }
  const dir = await mkdtemp(join(tmpdir(), 'reqochet-pdf-'))
  const file = join(dir, 'document.html')
  const win = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true, contextIsolation: true, nodeIntegration: false } })
  try {
    // nothing may navigate or open windows from here; links in the PDF stay links
    win.webContents.on('will-navigate', (e) => e.preventDefault())
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    phase('window')
    await writeFile(file, html, 'utf8')
    phase(`write HTML (${(Buffer.byteLength(html) / 1e6).toFixed(1)} MB)`)
    await withTimeout(win.loadFile(file))
    phase('load')
    // the page-number spans are Chromium's; the words around them are escaped
    const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    // eslint-disable-next-line no-control-regex -- the two markers split the translated words
    const footer = T.docExport.pageOf('\u0001', '\u0002').split(/(\u0001|\u0002)/).map((p) => (p === '\u0001' ? '<span class="pageNumber"></span>' : p === '\u0002' ? '<span class="totalPages"></span>' : esc(p))).join('')
    const pdf = await withTimeout(win.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: `<div style="font-size:8px;width:100%;text-align:center;color:#566070">${footer}</div>`,
      margins: { top: 0.6, bottom: 0.7, left: 0.6, right: 0.6 }
    }))
    phase(`print (${(pdf.byteLength / 1e6).toFixed(1)} MB PDF)`)
    return new Uint8Array(pdf)
  } finally {
    if (!win.isDestroyed()) win.destroy()
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
    phase('clean up')
    report?.(`PDF: ${phases.join(', ')}; total ${Math.round(performance.now() - start)} ms`)
  }
}

/** A very large document may take long, but never forever: the window is closed in `finally`. */
function withTimeout<V>(p: Promise<V>, ms = 180_000): Promise<V> {
  let timer: NodeJS.Timeout | undefined
  const stop = new Promise<never>((_r, reject) => {
    timer = setTimeout(() => reject(new Error(T.docExport.pdfTimeout)), ms)
  })
  return Promise.race([p, stop]).finally(() => clearTimeout(timer))
}

/**
 * Temporary print folders left by a crash or a forced quit are removed at the next
 * start; only reqochet's own (reqochet-pdf-*), and only when older than an hour (another window may be printing).
 */
export async function removeStalePdfFolders(dir = tmpdir(), now = Date.now()): Promise<number> {
  let removed = 0
  try {
    for (const name of await readdir(dir)) {
      if (!name.startsWith('reqochet-pdf-')) continue
      const path = join(dir, name)
      const info = await stat(path).catch(() => null)
      if (!info?.isDirectory() || now - info.mtimeMs < 3_600_000) continue
      await rm(path, { recursive: true, force: true }).then(() => removed++, () => undefined)
    }
  } catch {
    /* the temp folder cannot be read: nothing to clean */
  }
  return removed
}

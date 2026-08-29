import type { IFileSink } from '../../application/ports/IFileSink.js';

/**
 * Hands the file over as a browser download.
 *
 * The object URL is revoked on the next turn rather than immediately: Safari
 * has not finished reading it when `click()` returns, and revoking too early
 * gives the reader an empty file with no error to explain it.
 */
export class DownloadFileSink implements IFileSink {
  private readonly doc: Document;

  constructor(doc: Document) {
    this.doc = doc;
  }

  save(fileName: string, bytes: Uint8Array, mimeType: string): void {
    const blob = new Blob([bytes as BlobPart], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = this.doc.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    // Attached because Firefox ignores a click on an anchor outside the
    // document, and removed again so the page keeps no litter.
    this.doc.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

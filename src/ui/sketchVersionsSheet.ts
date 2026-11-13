import type { StoredSketch } from '../application/SketchLibrary.js';
import type { SketchVersion, WhyAVersionWasKept } from '../application/SketchVersions.js';
import type { AppView } from './AppView.js';
import { LOOK_ICON } from './icons.js';
import { whenItWas } from './moments.js';

/** What the sheet of a sketch's versions asks of the view: its elements, the sketches, and where a version is shown. */
export type TheViewOfTheVersions = Pick<
  AppView,
  'anIconButton' | 'el' | 'lookAtASketchAsItWas' | 'renderSketches' | 'runtime' | 'showTheSheet' | 'showTheSketchAgain'
>;

/** What each version was kept before, as a row says it. */
const KEPT_BEFORE: Readonly<Record<WhyAVersionWasKept, string>> = {
  editing: 'before editing',
  drive: "before the drive's copy",
  restoring: 'before a version was put back',
  'passed over': "the drive's copy, not taken",
};

/**
 * The earlier versions of one sketch, kept on this device: a sheet over the
 * list of sketches, newest first, each to be looked at in the drawing and put
 * back. Putting one back keeps the sketch as it is first, so that too can be
 * gone back on from here.
 */
export class SketchVersionsSheet {
  private readonly host: TheViewOfTheVersions;
  /** The sketch whose versions are shown, while they are. */
  private showing: string | null = null;

  constructor(host: TheViewOfTheVersions) {
    this.host = host;
  }

  /** Opens the versions of a sketch. */
  open(id: string): void {
    this.showing = id;
    this.list();
    this.host.showTheSheet(this.host.el.sheetVersions);
  }

  /** Shuts the sheet. */
  shut(): void {
    this.showing = null;
    this.host.el.sheetVersions.hidden = true;
  }

  /** Lists the versions of the sketch shown, as they are now. */
  private list(): void {
    const { el, runtime } = this.host;
    const sketch = this.showing === null ? null : runtime.sketches.find(this.showing);
    if (sketch === null) {
      return;
    }
    const versions = runtime.sketchVersions.of(sketch.id);
    el.versionsText.textContent = `Earlier versions of “${sketch.title}”, kept on this device`;
    el.versionsEmpty.hidden = versions.length > 0;
    el.versionsList.hidden = versions.length === 0;
    el.versionsList.replaceChildren(...versions.map((version) => this.aRow(sketch, version)));
  }

  private aRow(sketch: StoredSketch, version: SketchVersion): HTMLLIElement {
    const doc = this.host.el.versionsList.ownerDocument;
    const row = doc.createElement('li');
    const said = doc.createElement('span');
    said.className = 'takes__name';
    const when = whenItWas(version.keptAtMs);
    said.textContent = `${when} · ${KEPT_BEFORE[version.why]} · ${String(version.sketch.noteCount)} notes`;
    const look = this.host.anIconButton(LOOK_ICON, 'Look at it as it was', `Look at ${sketch.title} as it was at ${when}`);
    look.addEventListener('click', () => {
      this.host.lookAtASketchAsItWas(
        { ...version.sketch, title: sketch.title },
        `As it was at ${when}: put it back to edit it.`,
        'Edit the notes. This is a version kept of a sketch: put it back first.',
      );
    });
    const restore = doc.createElement('button');
    restore.type = 'button';
    restore.textContent = 'Put back';
    restore.title = 'Put its music back in place of what the sketch is now, which is kept here first';
    restore.setAttribute('aria-label', `Put ${sketch.title} back as it was at ${when}`);
    restore.addEventListener('click', () => {
      if (this.host.runtime.sketches.restore(sketch.id, version) === null) {
        return;
      }
      this.host.showTheSketchAgain(sketch.id);
      this.host.renderSketches();
      this.list();
    });
    row.append(said, look, restore);
    return row;
  }
}

import { whatTheDriveHas } from '../application/SketchSync.js';
import type { StoredSketch } from '../application/SketchLibrary.js';
import { reportToTheConsole } from './reportToTheConsole.js';
import type { AppView } from './AppView.js';

/** What offering the drive's copy of a sketch asks of the view: its elements, the sketches, the drive, and the sketch open. */
export type TheViewOfTheOffer = Pick<
  AppView,
  'el' | 'renderSketches' | 'runtime' | 'showTheSheet' | 'showTheSketchAgain' | 'theOtherRollShowing'
>;

/**
 * Asks the drive about a sketch as it is opened, and where it has a newer
 * copy - changed on another device since this one was in step, or changed
 * there and here both - offers it: to take it, this one kept among the
 * sketch's versions, or to keep this one, the drive's kept there instead and
 * this one sent over it at the next sync. Or neither for now, which leaves
 * it to the next sync. Only where syncing was asked for and the drive can be
 * asked without a press; a drive that cannot be reached says nothing.
 */
export class DrivesNewerCopy {
  private readonly host: TheViewOfTheOffer;
  /** The copy on offer, while it is. */
  private offered: { readonly sketch: StoredSketch; readonly revision: number } | null = null;

  constructor(host: TheViewOfTheOffer) {
    this.host = host;
  }

  /** Asks the drive about the sketch just opened, and offers its copy where it is newer and that sketch is still open. */
  async askAbout(id: string): Promise<void> {
    const { runtime } = this.host;
    if (!runtime.controller.settings.offerToSync || !runtime.cloudDrive.signedIn) {
      return;
    }
    let theirs: { readonly sketch: StoredSketch; readonly revision: number } | null;
    try {
      theirs = await runtime.sketchSync.theDrivesCopyOf(id);
    } catch (error) {
      reportToTheConsole('Could not ask the drive about the sketch opened.', error);
      return;
    }
    const here = runtime.sketches.forTheDrive().find((each) => each.sketch.id === id);
    if (theirs === null || here === undefined || this.host.theOtherRollShowing?.sketch?.id !== id) {
      return;
    }
    const news = whatTheDriveHas(here, theirs);
    if (news === 'nothing new') {
      return;
    }
    this.offered = theirs;
    const { el } = this.host;
    el.offerText.textContent =
      news === 'newer'
        ? `The drive has a newer version of “${here.sketch.title}”, changed on another device.`
        : `“${here.sketch.title}” was changed here and on another device.`;
    this.host.showTheSheet(el.sheetOffer);
  }

  /** Takes the drive's copy on offer: this one kept among its versions. */
  take(): void {
    const theirs = this.letGo();
    if (theirs !== null) {
      this.host.runtime.sketches.takeFromTheDrive(theirs.sketch, theirs.revision);
      this.host.showTheSketchAgain(theirs.sketch.id);
      this.host.renderSketches();
    }
  }

  /** Keeps this one over the drive's copy on offer, which is kept among its versions instead. */
  keepThisOne(): void {
    const theirs = this.letGo();
    if (theirs !== null) {
      this.host.runtime.sketches.keepThisOneOver(theirs.sketch, theirs.revision);
      this.host.renderSketches();
    }
  }

  /** Leaves both as they are, for the next sync. */
  notNow(): void {
    this.letGo();
  }

  private letGo(): { readonly sketch: StoredSketch; readonly revision: number } | null {
    const theirs = this.offered;
    this.offered = null;
    this.host.el.sheetOffer.hidden = true;
    return theirs;
  }
}

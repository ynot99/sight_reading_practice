import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import type { IScoreCursor, IScoreRenderer } from '../../application/ports/IScoreRenderer.js';
import { CursorNavigator, type ICursorPrimitive } from './CursorNavigator.js';

export interface OsmdRendererOptions {
  readonly zoom?: number;
  readonly cursorColor?: string;
  readonly drawTitle?: boolean;
}

/** Bridges OSMD's forward-only cursor to {@link ICursorPrimitive}. */
class OsmdCursorPrimitive implements ICursorPrimitive {
  private readonly resolve: () => OpenSheetMusicDisplay | null;

  constructor(resolve: () => OpenSheetMusicDisplay | null) {
    this.resolve = resolve;
  }

  private get cursor(): OpenSheetMusicDisplay['cursor'] | null {
    return this.resolve()?.cursor ?? null;
  }

  get endReached(): boolean {
    const iterator = this.cursor?.iterator;
    return iterator === undefined || iterator === null ? true : iterator.EndReached;
  }

  reset(): void {
    this.cursor?.reset();
  }

  next(): void {
    this.cursor?.next();
  }

  show(): void {
    this.cursor?.show();
  }

  hide(): void {
    this.cursor?.hide();
  }
}

/**
 * OpenSheetMusicDisplay adapter.
 *
 * The only file in the project that knows OSMD exists. Everything above it
 * depends on {@link IScoreRenderer} and {@link IScoreCursor}, so swapping the
 * engraver is a single-file change.
 *
 * OSMD (with VexFlow behind it) is by far the heaviest dependency here, so it
 * is imported dynamically: the controls are interactive while the engraver is
 * still downloading.
 */
export class OsmdScoreRenderer implements IScoreRenderer {
  private readonly container: HTMLElement;
  private readonly options: OsmdRendererOptions;
  private readonly navigator: CursorNavigator;
  private osmd: OpenSheetMusicDisplay | null = null;
  private loaded = false;

  constructor(container: HTMLElement, options: OsmdRendererOptions = {}) {
    this.container = container;
    this.options = options;
    this.navigator = new CursorNavigator(new OsmdCursorPrimitive(() => this.osmd));
  }

  get cursor(): IScoreCursor {
    return this.navigator;
  }

  async load(musicXml: string): Promise<void> {
    const osmd = await this.ensureEngraver();
    await osmd.load(musicXml);
    osmd.render();
    this.loaded = true;
    this.navigator.reset();
  }

  refresh(): void {
    if (!this.loaded || this.osmd === null) {
      return;
    }
    this.osmd.render();
    this.navigator.reset();
  }

  clear(): void {
    this.osmd?.clear();
    this.loaded = false;
  }

  private async ensureEngraver(): Promise<OpenSheetMusicDisplay> {
    if (this.osmd !== null) {
      return this.osmd;
    }
    const { OpenSheetMusicDisplay: Engraver } = await import('opensheetmusicdisplay');
    const osmd = new Engraver(this.container, {
      autoResize: true,
      backend: 'svg',
      drawTitle: this.options.drawTitle ?? false,
      drawSubtitle: false,
      drawComposer: false,
      drawPartNames: false,
      drawMetronomeMarks: true,
      autoBeam: true,
      followCursor: true,
      disableCursor: false,
      cursorsOptions: [
        {
          type: 0,
          color: this.options.cursorColor ?? '#3b82f6',
          alpha: 0.45,
          follow: true,
        },
      ],
    });
    osmd.zoom = this.options.zoom ?? 0.85;
    this.osmd = osmd;
    return osmd;
  }
}

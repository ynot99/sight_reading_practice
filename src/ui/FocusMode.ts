/** The fullscreen entry points, including the prefixed one older Safari uses. */
export interface FullscreenTarget {
  requestFullscreen?: () => Promise<void>;
  webkitRequestFullscreen?: () => Promise<void> | void;
}

/** The document half of the Fullscreen API, narrowed to what is used here. */
export interface FullscreenDocumentLike {
  readonly fullscreenElement?: unknown;
  readonly webkitFullscreenElement?: unknown;
  exitFullscreen?: () => Promise<void>;
  webkitExitFullscreen?: () => Promise<void> | void;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

export interface FocusModeOptions {
  /** Element that carries the focus class, and that is sent fullscreen. */
  readonly root: HTMLElement;
  readonly doc: FullscreenDocumentLike;
  /** Called whenever focus mode turns on or off, for any reason. */
  readonly onChange: (active: boolean) => void;
  readonly className?: string;
}

const DEFAULT_CLASS = 'is-focus';

/**
 * Distraction-free reading: the score fills the screen and everything else
 * gets out of the way.
 *
 * Layout and real fullscreen are deliberately separate. The class on the root
 * element is the source of truth and always works; the Fullscreen API is asked
 * on top of it to hide the browser's own chrome, and is allowed to fail. That
 * matters on a tablet, where fullscreen can be refused outright - the reader
 * still gets the whole page, and the pill still gets them out again.
 */
export class FocusMode {
  private readonly root: HTMLElement;
  private readonly doc: FullscreenDocumentLike;
  private readonly onChange: (active: boolean) => void;
  private readonly className: string;
  private active = false;

  private readonly onFullscreenChange = (): void => {
    // Leaving fullscreen by any other means - Escape, a system gesture - must
    // also leave focus mode, or the reader is stranded with no controls.
    if (this.active && !this.isNativeFullscreen()) {
      this.setActive(false);
    }
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && this.active) {
      void this.exit();
    }
  };

  constructor(options: FocusModeOptions) {
    this.root = options.root;
    this.doc = options.doc;
    this.onChange = options.onChange;
    this.className = options.className ?? DEFAULT_CLASS;

    for (const type of ['fullscreenchange', 'webkitfullscreenchange']) {
      this.doc.addEventListener(type, this.onFullscreenChange);
    }
    this.doc.addEventListener('keydown', this.onKeyDown as unknown as () => void);
  }

  get isActive(): boolean {
    return this.active;
  }

  async enter(): Promise<void> {
    if (this.active) {
      return;
    }
    this.setActive(true);
    await this.requestNativeFullscreen();
  }

  async exit(): Promise<void> {
    if (!this.active) {
      return;
    }
    this.setActive(false);
    await this.exitNativeFullscreen();
  }

  async toggle(): Promise<void> {
    return this.active ? this.exit() : this.enter();
  }

  dispose(): void {
    for (const type of ['fullscreenchange', 'webkitfullscreenchange']) {
      this.doc.removeEventListener(type, this.onFullscreenChange);
    }
    this.doc.removeEventListener('keydown', this.onKeyDown as unknown as () => void);
  }

  private setActive(active: boolean): void {
    this.active = active;
    this.root.classList.toggle(this.className, active);
    this.onChange(active);
  }

  private isNativeFullscreen(): boolean {
    return (
      (this.doc.fullscreenElement ?? this.doc.webkitFullscreenElement ?? null) !== null
    );
  }

  private async requestNativeFullscreen(): Promise<void> {
    const target = this.root as unknown as FullscreenTarget;
    try {
      if (typeof target.requestFullscreen === 'function') {
        await target.requestFullscreen();
        return;
      }
      if (typeof target.webkitRequestFullscreen === 'function') {
        await target.webkitRequestFullscreen();
      }
    } catch {
      // Refused or unavailable: the focus layout alone is still a good result.
    }
  }

  private async exitNativeFullscreen(): Promise<void> {
    if (!this.isNativeFullscreen()) {
      return;
    }
    try {
      if (typeof this.doc.exitFullscreen === 'function') {
        await this.doc.exitFullscreen();
        return;
      }
      if (typeof this.doc.webkitExitFullscreen === 'function') {
        await this.doc.webkitExitFullscreen();
      }
    } catch {
      // Already out, or the browser closed it for us.
    }
  }
}

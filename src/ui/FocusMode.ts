/** The document half of what focus mode listens to, narrowed to what is used. */
export interface FullscreenDocumentLike {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

export interface FocusModeOptions {
  /** Element that carries the focus class. */
  readonly root: HTMLElement;
  readonly doc: FullscreenDocumentLike;
  /** Called whenever focus mode turns on or off, for any reason. */
  readonly onChange: (active: boolean) => void;
  readonly className?: string;
}

/** True when the page was launched from a Home Screen or as an installed app. */
export function launchedStandalone(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  // iOS answers the first, everything else the second.
  const legacy = (window.navigator as { standalone?: boolean }).standalone === true;
  const display =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(display-mode: standalone)').matches;
  return legacy || display;
}

const DEFAULT_CLASS = 'is-focus';

/**
 * Distraction-free reading: the score fills the window and everything else
 * gets out of the way.
 *
 * A class on the root element and nothing else. The browser's own Fullscreen
 * API used to be asked for on top of it, and on a tablet that turned out to be
 * a liability rather than a bonus: it brings a swipe-down gesture and a
 * floating close button that no page can turn off, it leaves the moment an
 * on-screen keyboard opens - which is what tapping a bar number does - and it
 * leaves again if a scroll runs past the top of the page. Every one of those
 * dropped the reader out of the layout mid-practice.
 *
 * So this is *our* fullscreen, not the device's. Nothing to be dismissed by a
 * gesture aimed at something else. A window with browser chrome still around
 * it is a few pixels of loss; being thrown out of the page while playing is
 * not a few pixels. Installed to a Home Screen there is no chrome anyway,
 * which is the way to get the last of the screen back.
 */
export class FocusMode {
  private readonly root: HTMLElement;
  private readonly doc: FullscreenDocumentLike;
  private readonly onChange: (active: boolean) => void;
  private readonly className: string;
  private active = false;

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && this.active) {
      this.exit();
    }
  };

  constructor(options: FocusModeOptions) {
    this.root = options.root;
    this.doc = options.doc;
    this.onChange = options.onChange;
    this.className = options.className ?? DEFAULT_CLASS;

    this.doc.addEventListener('keydown', this.onKeyDown as unknown as () => void);
  }

  get isActive(): boolean {
    return this.active;
  }

  enter(): void {
    if (this.active) {
      return;
    }
    this.setActive(true);
  }

  exit(): void {
    if (!this.active) {
      return;
    }
    this.setActive(false);
  }

  toggle(): void {
    if (this.active) {
      this.exit();
    } else {
      this.enter();
    }
  }

  dispose(): void {
    this.doc.removeEventListener('keydown', this.onKeyDown as unknown as () => void);
  }

  private setActive(active: boolean): void {
    this.active = active;
    this.root.classList.toggle(this.className, active);
    this.onChange(active);
  }
}

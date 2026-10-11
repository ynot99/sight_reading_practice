/**
 * What a playback goes on to when its piece has been played.
 *
 * `this` is what it has always done: the piece, and then it stops - or goes
 * round again, which the repeat button says. `list` plays the shelf in the
 * order it is shown, and `random` all of it shuffled, none twice before every
 * piece has been heard once.
 */
export const PLAYBACK_GOES_ON = ['this', 'list', 'random'] as const;

export type PlaybackGoesOn = (typeof PLAYBACK_GOES_ON)[number];

/** A kept piece, by what opens it and what it is called. */
export interface PieceInTurn {
  readonly id: string;
  readonly title: string;
}

/** The pieces in a new order, every order equally likely. */
function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const order = [...items];
  for (let at = order.length - 1; at > 0; at -= 1) {
    const other = Math.min(at, Math.floor(random() * (at + 1)));
    const here = order[at];
    const there = order[other];
    if (here !== undefined && there !== undefined) {
      order[at] = there;
      order[other] = here;
    }
  }
  return order;
}

/**
 * The pieces a playback goes through, one after another.
 *
 * The shelf as it stood when the order was taken, and not as it stands now:
 * opening a piece can move it up the shelf, and an order read afresh at every
 * turn would go round the same few pieces at the top.
 */
export class PiecesInTurn {
  private order: readonly PieceInTurn[];
  private at: number;
  /** Whether the order is a shuffle, dealt again each time round. */
  readonly shuffled: boolean;
  private readonly random: () => number;

  private constructor(order: readonly PieceInTurn[], at: number, isShuffled: boolean, random: () => number) {
    this.order = order;
    this.at = at;
    this.shuffled = isShuffled;
    this.random = random;
  }

  /**
   * The shelf in its order, or shuffled, from the piece being played.
   *
   * Shuffled, the piece being played comes first, so the next one is new. A
   * piece not on the shelf - one generated rather than kept - stands before
   * the first, and the next is the first.
   */
  static fromTheShelf(
    shelf: readonly PieceInTurn[],
    playing: string | null,
    isShuffled: boolean,
    random: () => number,
  ): PiecesInTurn {
    const found = shelf.findIndex((piece) => piece.title === playing);
    if (!isShuffled) {
      return new PiecesInTurn([...shelf], found, false, random);
    }
    const here = shelf[found];
    const rest = shuffled(
      shelf.filter((_, at) => at !== found),
      random,
    );
    return here === undefined
      ? new PiecesInTurn(rest, -1, true, random)
      : new PiecesInTurn([here, ...rest], 0, true, random);
  }

  /** The piece the order stands at, or `null` before the first. */
  get playing(): PieceInTurn | null {
    return this.order[this.at] ?? null;
  }

  /**
   * The piece after this one, round to the first after the last. A shuffle
   * is dealt again for the next time round, and never begins with the piece
   * that ended the last: heard twice running, it would seem not to have moved.
   */
  next(): PieceInTurn | null {
    if (this.at + 1 < this.order.length) {
      this.at += 1;
      return this.order[this.at] ?? null;
    }
    const last = this.playing;
    if (this.shuffled && this.order.length > 1) {
      const again = shuffled(this.order, this.random);
      this.order = again[0] === last ? [...again.slice(1), ...again.slice(0, 1)] : again;
    }
    this.at = 0;
    return this.order[0] ?? null;
  }

  /**
   * The piece before this one. In the shelf's order, round to the last
   * before the first; in a shuffle, the first stays where it is, there being
   * nothing heard before it.
   */
  previous(): PieceInTurn | null {
    if (this.order.length === 0) {
      return null;
    }
    if (this.at > 0) {
      this.at -= 1;
    } else if (!this.shuffled) {
      this.at = this.order.length - 1;
    } else {
      this.at = 0;
    }
    return this.order[this.at] ?? null;
  }
}

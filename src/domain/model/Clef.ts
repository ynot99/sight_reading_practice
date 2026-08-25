export const CLEF_KINDS = ['treble', 'bass', 'alto'] as const;

export type ClefKind = (typeof CLEF_KINDS)[number];

/** MusicXML `<clef>` payload. */
export interface ClefDefinition {
  readonly sign: 'G' | 'F' | 'C';
  readonly line: number;
}

export const CLEF_DEFINITIONS: Readonly<Record<ClefKind, ClefDefinition>> = {
  treble: { sign: 'G', line: 2 },
  bass: { sign: 'F', line: 4 },
  alto: { sign: 'C', line: 3 },
};

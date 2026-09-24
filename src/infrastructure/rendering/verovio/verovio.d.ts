/**
 * The part of Verovio this program uses, typed.
 *
 * The package ships no types. Declared here, and only as much as is called,
 * so a call that is not listed is a type error rather than a guess.
 */
declare module 'verovio/wasm' {
  /** The engraver compiled to WebAssembly, and its heap. */
  export interface VerovioModule {
    readonly HEAPU8: Uint8Array;
    _malloc(bytes: number): number;
    _free(pointer: number): void;
  }
  const createVerovioModule: () => Promise<VerovioModule>;
  export default createVerovioModule;
}

declare module 'verovio/esm' {
  import type { VerovioModule } from 'verovio/wasm';

  export class VerovioToolkit {
    constructor(module: VerovioModule);
    setOptions(options: object): void;
    loadData(data: string): boolean;
    getPageCount(): number;
    renderToSVG(page: number, xmlDeclaration?: boolean): string;
    redoLayout(options?: object): void;
    /** The page an element is drawn on, or 0 when there is none. */
    getPageWithElement(xmlId: string): number;
    getLog(): string;
  }

  /** Whether what Verovio has to say goes to a buffer `getLog` reads, or the console. */
  export function enableLogToBuffer(value: number, module: VerovioModule): void;
}

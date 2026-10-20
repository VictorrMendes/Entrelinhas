/** A book as the server reads it (backend/src/books/parser.ts): the same blocks as the Android app, by index. */

/** Bold or italic text inside a block: [start, end) of its text. */
export interface Span {
  start: number;
  end: number;
  bold?: boolean;
  italic?: boolean;
}

/** A link from [start, end) of a block's text to block [target] of the same book (contents pages, footnotes). */
export interface Link {
  start: number;
  end: number;
  target: number;
}

/** A text block; 'img' blocks carry the image file name in [image] and its alt text in [text]. */
export interface Block {
  type: 'p' | 'h' | 'q' | 'poem' | 'li' | 'img';
  text: string;
  spans?: Span[];
  image?: string;
  links?: Link[];
}

export interface TocEntry {
  title: string;
  block: number;
}

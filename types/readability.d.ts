declare module '@mozilla/readability' {
  export class Readability {
    constructor(document: Document, options?: Record<string, unknown>);
    parse(): {
      title: string;
      content: string;
      textContent: string;
      length: number;
      excerpt: string;
      byline: string;
      dir: string;
      siteName: string;
      lang: string;
    } | null;
  }
}

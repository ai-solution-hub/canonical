declare module 'jsdom' {
  export class JSDOM {
    constructor(html?: string, options?: { url?: string; [key: string]: unknown });
    readonly window: {
      document: Document;
      [key: string]: unknown;
    };
  }
}

import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

const turndown = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  emDelimiter: '*',
  strongDelimiter: '**',
  hr: '---',
});

turndown.use(gfm);

// Remove empty links (common in scraped content)
turndown.addRule('emptyLinks', {
  filter: (node) =>
    node.nodeName === 'A' && !node.textContent?.trim(),
  replacement: () => '',
});

// Remove script/style tags that survive extraction
turndown.addRule('removeScripts', {
  filter: ['script', 'style', 'noscript'],
  replacement: () => '',
});

export { turndown };

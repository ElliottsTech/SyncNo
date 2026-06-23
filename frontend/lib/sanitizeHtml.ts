import DOMPurify from 'dompurify';

// Allow common formatting + layout tags, block scripts and event handlers.
// DOMPurify strips: <script>, on* attrs, javascript: URLs, etc.
const ALLOWED_TAGS = [
  'a', 'abbr', 'address', 'article', 'aside', 'b', 'bdi', 'bdo', 'blockquote', 'br',
  'caption', 'cite', 'code', 'col', 'colgroup', 'data', 'dd', 'del', 'details', 'dfn',
  'div', 'dl', 'dt', 'em', 'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3', 'h4',
  'h5', 'h6', 'header', 'hgroup', 'hr', 'i', 'img', 'ins', 'kbd', 'li', 'main', 'mark',
  'nav', 'ol', 'p', 'pre', 'q', 'rp', 'rt', 'ruby', 's', 'samp', 'section', 'small',
  'span', 'strong', 'sub', 'summary', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th',
  'thead', 'time', 'tr', 'u', 'ul', 'var', 'wbr',
];

const ALLOWED_ATTR = [
  'href', 'src', 'alt', 'title', 'name', 'id', 'class', 'width', 'height',
  'target', 'rel', 'colspan', 'rowspan', 'datetime', 'open', 'start', 'reversed',
  'type', 'value',
];

const config = {
  ALLOWED_TAGS,
  ALLOWED_ATTR,
  ALLOW_DATA_ATTR: false,
  FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button'],
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur'],
};

// Force links to open safely: target=_blank + rel=noopener
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A' && node.getAttribute('href')) {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer nofollow');
  }
});

export function sanitizeHtml(dirty: string | null | undefined): string {
  if (!dirty) return '';
  return DOMPurify.sanitize(dirty, config);
}

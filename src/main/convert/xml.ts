// Kleiner XML-Leser für Office-Dateien: Elemente, Attribute, Text. Keine DTDs, keine externen Entitäten (sicher gegen
// XXE und „Billion Laughs“), Namensräume bleiben als Präfix im Namen (z. B. „w:p“).

export interface XmlElement {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
}
export type XmlNode = XmlElement | string;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (match, entity: string) => {
    if (entity.startsWith('#x')) return safeChar(Number.parseInt(entity.slice(2), 16), match);
    if (entity.startsWith('#')) return safeChar(Number.parseInt(entity.slice(1), 10), match);
    return ENTITIES[entity] ?? match;
  });
}

const safeChar = (code: number, fallback: string) => (Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : fallback);

export function parseXml(source: string): XmlElement {
  const root: XmlElement = { name: '#root', attrs: {}, children: [] };
  const stack: XmlElement[] = [root];
  let i = 0;
  const length = source.length;
  while (i < length) {
    const lt = source.indexOf('<', i);
    const textEnd = lt < 0 ? length : lt;
    if (textEnd > i) {
      const text = source.slice(i, textEnd);
      (stack[stack.length - 1] as XmlElement).children.push(decodeEntities(text));
    }
    if (lt < 0) break;
    if (source.startsWith('<!--', lt)) {
      const close = source.indexOf('-->', lt + 4);
      i = close < 0 ? length : close + 3;
    } else if (source.startsWith('<![CDATA[', lt)) {
      const close = source.indexOf(']]>', lt + 9);
      const end = close < 0 ? length : close;
      (stack[stack.length - 1] as XmlElement).children.push(source.slice(lt + 9, end));
      i = close < 0 ? length : close + 3;
    } else if (source[lt + 1] === '?' || source[lt + 1] === '!') {
      // Verarbeitungsanweisungen und DOCTYPE überspringen (ohne interne Teilmenge auszuwerten)
      let depth = 0;
      let j = lt + 1;
      for (; j < length; j++) {
        const c = source[j];
        if (c === '[') depth++;
        else if (c === ']') depth--;
        else if (c === '>' && depth <= 0) break;
      }
      i = j + 1;
    } else if (source[lt + 1] === '/') {
      const close = source.indexOf('>', lt);
      const name = source.slice(lt + 2, close < 0 ? length : close).trim();
      // Bis zum passenden Element zurück (fehlertolerant bei kaputtem XML)
      for (let k = stack.length - 1; k > 0; k--) {
        if ((stack[k] as XmlElement).name === name) {
          stack.length = k;
          break;
        }
      }
      i = close < 0 ? length : close + 1;
    } else {
      // Start-Tag: Ende unter Beachtung von Anführungszeichen suchen
      let j = lt + 1;
      let quote = '';
      for (; j < length; j++) {
        const c = source[j];
        if (quote) {
          if (c === quote) quote = '';
        } else if (c === '"' || c === "'") quote = c;
        else if (c === '>') break;
      }
      const raw = source.slice(lt + 1, j);
      const selfClosing = raw.endsWith('/');
      const body = selfClosing ? raw.slice(0, -1) : raw;
      const nameMatch = /^[^\s/>]+/.exec(body);
      const element: XmlElement = { name: nameMatch?.[0] ?? '', attrs: {}, children: [] };
      const attrPattern = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
      let match: RegExpExecArray | null;
      while ((match = attrPattern.exec(body.slice(element.name.length)))) element.attrs[match[1] as string] = decodeEntities(match[3] ?? match[4] ?? '');
      (stack[stack.length - 1] as XmlElement).children.push(element);
      if (!selfClosing) stack.push(element);
      i = j + 1;
    }
  }
  return root;
}

// Hilfen für den Zugriff
export const isElement = (node: XmlNode | undefined): node is XmlElement => typeof node === 'object' && node !== null;
export const elements = (node: XmlElement | undefined): XmlElement[] => (node ? node.children.filter(isElement) : []);
export const child = (node: XmlElement | undefined, name: string): XmlElement | undefined => node?.children.find((c): c is XmlElement => isElement(c) && c.name === name);
export const childrenNamed = (node: XmlElement | undefined, name: string): XmlElement[] => elements(node).filter((c) => c.name === name);

// Erstes Element mit diesem Namen in der Tiefe
export function find(node: XmlElement | undefined, name: string): XmlElement | undefined {
  if (!node) return undefined;
  for (const c of elements(node)) {
    if (c.name === name) return c;
    const found = find(c, name);
    if (found) return found;
  }
  return undefined;
}

export function findAll(node: XmlElement | undefined, name: string, out: XmlElement[] = []): XmlElement[] {
  for (const c of elements(node)) {
    if (c.name === name) out.push(c);
    findAll(c, name, out);
  }
  return out;
}

export function textContent(node: XmlNode | undefined): string {
  if (node === undefined) return '';
  if (typeof node === 'string') return node;
  return node.children.map(textContent).join('');
}

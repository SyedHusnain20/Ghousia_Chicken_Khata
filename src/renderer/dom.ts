// Tiny DOM builder. We build dynamic UI (party names, amounts, notes) with
// createElement + textContent instead of innerHTML, so nothing a shopkeeper
// types (a name, a note) can ever be interpreted as markup.

type Attrs = Record<string, string>;
type Child = Node | string | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: Child[] = []
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(child));
  }
  return node;
}

export function clear(node: Element): void {
  node.replaceChildren();
}

export function mount(parent: Element, ...children: Child[]): void {
  clear(parent);
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(child));
  }
}

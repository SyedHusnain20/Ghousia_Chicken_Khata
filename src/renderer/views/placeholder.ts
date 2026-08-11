import { el, mount } from '../dom';

export function renderPlaceholder(container: HTMLElement, title: string, note: string): void {
  mount(
    container,
    el('div', { class: 'page-header' }, [el('h1', {}, [title])]),
    el('div', { class: 'state-message state-empty' }, [note])
  );
}

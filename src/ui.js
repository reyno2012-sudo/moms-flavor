const navItems = [
  ['discover', '发现'], ['local', '地方味道'], ['record', '记录'], ['family', '我的家'], ['me', '我的']
];

export const photoIds = new Set(['cq1', 'sz1', 'yc1', 'cq2', 'wh1', 'sz2', 'wh2', 'yc2', 'f1', 'f2']);

export const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[character]));

export const icon = name => `<span aria-hidden="true" class="ui-icon icon-${name}"></span>`;

export function btn(label, action, value = '', classes = '', { pressed, name, disabled } = {}) {
  return `<button type="button" class="${classes}" data-action="${action}" data-value="${esc(value)}"${pressed === undefined ? '' : ` aria-pressed="${pressed}"`}${name ? ` aria-label="${esc(name)}"` : ''}${disabled ? ' disabled' : ''}>${esc(label)}</button>`;
}

export const input = (field, value, label, placeholder = '') => `<label class="field">${esc(label)}
  <input data-field="${field}" value="${esc(value)}" placeholder="${esc(placeholder)}"></label>`;

export const select = (field, value, values, label) => `<label class="field">${esc(label)}
  <select data-field="${field}">${values.map(option => {
    const [key, text] = typeof option === 'string' ? [option, option] : option;
    return `<option value="${esc(key)}"${key === value ? ' selected' : ''}>${esc(text)}</option>`;
  }).join('')}</select></label>`;

export const check = (field, checked, label) => `<label class="check">
  <input type="checkbox" data-field="${field}" ${checked ? 'checked' : ''}>${esc(label)}</label>`;

export function header(title, subtitle, right = '', back = false, brand = false) {
  const leading = back ? btn('‹', 'back', '', 'icon-button', { name: '返回' }) : brand ? icon('bowl') : '';
  return `<header class="screen-header${brand ? ' brand-header' : ''}">
    ${leading}<div class="heading"><h1 tabindex="-1">${esc(title)}</h1>
    ${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div>${right}</header>`;
}

export const content = (html, classes = '') => `<section class="content ${classes}">${html}</section>`;
export const note = message => `<p class="notice">${esc(message)}</p>`;
export const empty = (title, description, action = '') => `<div class="panel empty"><h2>${esc(title)}</h2><p>${esc(description)}</p>${action}</div>`;
export const avatar = text => `<span class="avatar" aria-hidden="true">${esc([...text][0] || '家')}</span>`;

export function food(recipe, classes = '', decorative = false) {
  const cover = recipe.photos?.[0];
  if (cover) return `<div class="food ${classes}"${decorative ? ' aria-hidden="true"' : ''}>
    <img class="uploaded-cover" src="${esc(cover.url)}" alt="${decorative ? '' : esc(cover.caption || recipe.name)}" decoding="async"></div>`;
  const semantic = decorative ? 'aria-hidden="true"' : `role="img" aria-label="${esc(recipe.name)}示意照片"`;
  if (!photoIds.has(recipe.id)) return `<div class="food food-empty ${classes}"${decorative ? ' aria-hidden="true"' : ''}>${icon('bowl')}<small>暂无菜品照片</small></div>`;
  return `<div class="food ${classes}" ${semantic}>
    <span class="food-photo photo-${recipe.id}"></span></div>`;
}

export function bottomNav(current) {
  return `<nav class="nav" aria-label="主导航">${navItems.map(([id, label]) => `<button type="button" data-action="nav" data-value="${id}"
    ${current === id ? 'class="active" aria-current="page"' : ''}>${icon(id)}<span>${label}</span></button>`).join('')}</nav>`;
}

import { esc } from './ui.js';

export function showRecipeShare(recipe, isPublic) {
  const dialog = document.createElement('dialog');
  dialog.className = 'recipe-share-dialog';
  dialog.setAttribute('aria-labelledby', 'recipe-share-title');
  const url = new URL('/', location.href);
  if (isPublic) url.searchParams.set('recipe', recipe.id);
  const share = { title: recipe.name, text: '妈妈的味道 · ' + recipe.name, url: url.href };
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  dialog.innerHTML = `<div class="panel"><h2 id="recipe-share-title">分享菜谱</h2><strong>${esc(recipe.name)}</strong>
    ${isPublic ? `<p>可通过系统分享，或复制链接后发到微信好友、微信群、朋友圈和其他社交平台。</p>
      ${local ? '<small>当前是本机预览。要让其他人打开，需要可访问的应用地址。</small>' : ''}
      <label class="field">菜谱链接<input type="url" readonly value="${esc(share.url)}" data-share-link></label>
      <div class="row">${navigator.share ? '<button type="button" class="primary" data-system-share>系统分享</button>' : ''}
      <button type="button" class="secondary" data-copy-share>复制链接</button></div>
      <p role="status" data-share-status></p>`
    : '<p>这份原稿按自己的可见范围保存。审核通过后，可以分享对应的公开菜谱。</p>'}
    <form method="dialog"><button class="secondary">关闭</button></form></div>`;
  dialog.querySelector('[data-system-share]')?.addEventListener('click', async () => {
    try { await navigator.share(share); }
    catch (error) {
      if (error.name !== 'AbortError') dialog.querySelector('[data-share-status]').textContent = '系统分享不可用，可以复制链接。';
    }
  });
  dialog.querySelector('[data-copy-share]')?.addEventListener('click', async () => {
    const status = dialog.querySelector('[data-share-status]');
    try {
      await navigator.clipboard.writeText(share.url);
      status.textContent = '链接已复制。';
    } catch {
      const link = dialog.querySelector('[data-share-link]');
      link.focus();
      link.select();
      status.textContent = '已选中链接，可以手动复制。';
    }
  });
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  document.body.append(dialog);
  dialog.showModal();
}

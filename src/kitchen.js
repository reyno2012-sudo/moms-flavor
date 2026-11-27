import { btn, check, esc, input, note } from './ui.js';

const slotNames = { wish: '今晚想吃', breakfast: '早餐', lunch: '午餐', dinner: '晚餐', feast: '周末家宴' };
const statuses = { pending: '待审核', approved: '已公开', rejected: '未通过', withdrawn: '已撤回' };
const scopeNames = { private: '仅自己', family: '家庭可见', public: '公开分享' };
const results = ['成功复刻', '味道接近', '需要改进'];
const option = (value, label) => `<option value="${esc(value)}">${esc(label)}</option>`;

export function recordSources(draft, manuscriptEnabled) {
  return `<details class="panel kitchen-source"${draft.manuscript || draft.sourceUrl || draft.versionOf ? ' open' : ''}>
    <summary>手稿与菜谱来源</summary>
    ${draft.versionName ? `<p>由《${esc(draft.versionName)}》另存为新版本</p>` : ''}
    <label class="field">手稿照片<input data-field="manuscript" type="file" accept="image/jpeg,image/png,image/webp"></label>
    ${draft.manuscript ? `<img class="manuscript-preview" src="data:image/jpeg;base64,${esc(draft.manuscript)}" alt="已选手稿">
      ${btn('移除手稿', 'removeManuscript', '', 'secondary')}
      ${manuscriptEnabled ? check('draft.manuscriptConsent', draft.manuscriptConsent, '同意发送此手稿进行文字识别')
      + btn('识别手稿文字', 'scanManuscript', '', 'secondary') : ''}` : ''}
    ${input('draft.sourceUrl', draft.sourceUrl, '来源链接（选填）', 'https://…')}
    ${btn('从链接导入做法', 'importLink', '', 'secondary')}
  </details>`;
}

export function cookingEditor(draft) {
  return `<details class="panel kitchen-source"${draft.ingredientsText || draft.stepsText ? ' open' : ''}>
    <summary>整理食材和做法</summary>
    ${btn('整理上方粘贴的文字', 'importText', '', 'secondary')}
    <label class="field">食材，一行一项<textarea data-field="draft.ingredientsText" maxlength="4000"
      placeholder="番茄 | 300 | 克\n盐 | 适量">${esc(draft.ingredientsText)}</textarea>
      <small>用竖线分开食材、用量和单位。原话里的「适量」会保留。</small></label>
    <label class="field">做法，一行一步<textarea data-field="draft.stepsText" maxlength="6000"
      placeholder="番茄切块。\n炒到闻见香味。">${esc(draft.stepsText)}</textarea></label>
  </details>`;
}

function foodIllustration(picture, label, kind) {
  if (!Number.isInteger(picture)) return '';
  const family = kind === 'step' && picture >= 16 && picture < 20;
  const extra = kind === 'step' && picture >= 20;
  const cols = kind === 'ingredient' ? 5 : family ? 2 : 4;
  const index = extra ? picture - 20 : family ? picture - 16 : picture;
  const image = kind === 'ingredient' ? 'ingredients-atlas'
    : family ? 'family-cooking-atlas' : extra ? 'cooking-detail-atlas' : 'cooking-atlas';
  const x = (index % cols) * 100 / (cols - 1);
  const y = Math.floor(index / cols) * 100 / (cols - 1);
  return `<span class="cooking-illustration" role="img" aria-label="${esc(label)}"
    style="background-image:url('/src/assets/${image}.jpg');background-size:${cols * 100}%;background-position:${x}% ${y}%"></span>`;
}

export function cookingView(recipe) {
  const { ingredients = [], steps = [], stepPictures = [] } = recipe.cooking ?? {};
  if (recipe.demo && stepPictures.length) return `<section class="illustrated-cooking">
    <h3>食材和用量</h3><p class="illustration-caption">示例用量 · AI 示意图</p>
    <ul class="ingredient-gallery">${ingredients.map(item => `<li>${foodIllustration(item.picture, item.name, 'ingredient')}
      <strong>${esc(item.name)}</strong><small>${esc([item.amount, item.unit].filter(Boolean).join(' '))}</small></li>`).join('')}</ul>
    <h3>制作步骤</h3><p class="illustration-caption">按顺序操作 · AI 示意图</p>
    <ol class="step-gallery">${steps.map((step, index) => `<li>${foodIllustration(stepPictures[index], `第 ${index + 1} 步示意图`, 'step')}
      <div><strong>第 ${index + 1} 步</strong><p>${esc(step)}</p></div></li>`).join('')}</ol></section>`;
  return `${ingredients.length ? `<div class="panel"><h3>食材和用量</h3><ul class="kitchen-list">${ingredients.map(item =>
    `<li>${esc(item.name)}${item.amount ? ` <strong>${esc([item.amount, item.unit].filter(Boolean).join(' '))}</strong>` : ''}</li>`).join('')}</ul></div>` : ''}
    ${steps.length ? `<div class="panel"><h3>做法</h3><ol class="kitchen-list">${steps.map(step => `<li>${esc(step)}</li>`).join('')}</ol></div>` : ''}`;
}

export function recipeOrigin(recipe) {
  if (!recipe.recordedBy && !recipe.manuscriptUrl && !recipe.sourceUrl && !recipe.versionOf) return '';
  return `<details class="panel kitchen-source"><summary>菜谱来源</summary>
    ${recipe.recordedBy ? `<p>原作者 ${esc(recipe.author)}　记录人 ${esc(recipe.recordedBy)}</p>` : ''}
    ${recipe.versionOf ? btn(recipe.versionName ? `原版 · ${recipe.versionName}` : '查看公开原版', 'detail', recipe.versionOf, 'secondary') : ''}
    ${recipe.manuscriptUrl ? `<a class="manuscript-link" href="${esc(recipe.manuscriptUrl)}" target="_blank" rel="noopener noreferrer">
      <img class="manuscript-preview" src="${esc(recipe.manuscriptUrl)}" alt="原始菜谱手稿" loading="lazy">查看手稿原图</a>` : ''}
    ${recipe.sourceUrl ? `<a class="text-button" href="${esc(recipe.sourceUrl)}" target="_blank" rel="noopener noreferrer">查看来源网页</a>` : ''}</details>`;
}

export function familyCollaboration(recipe, family, viewer, checks) {
  if (!viewer || (!recipe.own && !family)) return '';
  const people = family?.members.filter(person => person.username !== viewer.username && !checks.some(check => check.reviewer === person.username)) ?? [];
  return `<section class="panel"><h3>家人校对</h3>
    ${checks.map(item => `<div class="kitchen-entry"><strong>${esc(item.reviewer)}</strong><p>${esc(item.question)}</p>
      ${item.answer ? `<p>${esc(item.answer)}</p>` : '<small>等待反馈</small>'}
      ${item.assignedToMe ? `<form data-form="answerCheck"><label class="field">校对意见<textarea name="answer" maxlength="1200" required>${esc(item.answer ?? '')}</textarea></label>
        <button class="secondary">保存校对意见</button></form>` : ''}</div>`).join('')}
    ${recipe.own && people.length ? `<form data-form="requestCheck"><label class="field">邀请家人<select name="reviewer">${people.map(person => option(person.username, person.username)).join('')}</select></label>
      <label class="field">想请家人核对什么？<input name="question" maxlength="600" placeholder="炒到什么颜色才算好？" required></label>
      <button class="secondary">发出校对邀请</button></form>` : ''}
    ${recipe.own && !family ? note('将菜谱放进家庭空间后，可以邀请家人校对。') : ''}</section>`;
}

export function recipeSharing(recipe, families) {
  if (!recipe.own || (!families.length && !recipe.familyId)) return '';
  const options = [option('', '仅自己'), ...families.map(family => `<option value="${esc(family.id)}"${family.id === recipe.familyId ? ' selected' : ''}>${esc(family.name)}</option>`)];
  return `<details class="panel kitchen-source"><summary>调整原稿可见范围</summary><form data-form="recipeScope">
    <label class="field">原稿存放位置<select name="family">${options.join('')}</select></label><button class="secondary">保存范围</button></form></details>`;
}

export function recreationList(entries) {
  return entries.map(item => `<article class="panel recreation-entry">
    <div class="row between"><strong>${esc(item.result)}</strong><small>${esc(item.author)}${item.own ? ` · ${esc(statuses[item.state] && item.scope === 'public' ? statuses[item.state] : scopeNames[item.scope])}` : ''}</small></div>
    ${item.photo ? `<img class="recreation-photo" src="${esc(item.photo)}" alt="复刻成品照" loading="lazy">` : ''}
    ${item.note ? `<p class="recipe-description">${esc(item.note)}</p>` : ''}
    ${item.scope === 'public' && item.own && ['pending', 'approved'].includes(item.state) ? btn('撤回复刻分享', 'withdrawRecreation', item.id, 'secondary') : ''}</article>`).join('');
}

export function recreationForm(recipe, result) {
  return `<form class="panel" data-form="recreation">
    <label class="field">复刻结果<select name="result">${results.map(value => `<option${value === result ? ' selected' : ''}>${esc(value)}</option>`).join('')}</select></label>
    <label class="field">这次做得怎么样？<textarea name="note" maxlength="1200" placeholder="少放了一点辣椒，味道更像小时候吃的。"></textarea></label>
    <label class="field">成品照（选填）<input type="file" name="photo" accept="image/jpeg,image/png,image/webp"></label>
    <label class="field">谁可以看<select name="scope">${option('private', '仅自己')}${recipe.familyId ? option('family', '家庭可见') : ''}
    ${recipe.visibility === 'public' ? option('public', '提交公开审核') : ''}</select></label>
    ${recipe.visibility === 'public' ? '<label class="check"><input type="checkbox" name="consent">选择公开时，我同意审核后展示心得和照片</label>' : ''}
    <button class="primary">保存复刻</button></form>`;
}

export function menuView(data, recipes, start) {
  if (!data) return '';
  const wish = data.entries.filter(item => item.slot === 'wish');
  const planned = data.entries.filter(item => item.slot !== 'wish');
  const entry = item => `<div class="kitchen-entry row between">${btn(item.name, 'detail', item.recipeId, 'text-button')}
    <small>${item.slot === 'wish' ? '' : `${esc(slotNames[item.slot])} · `}${esc(item.username)}</small>${item.removable ? btn('移除', 'removeMenu', item.id, 'secondary') : ''}</div>`;
  const options = recipes.map(recipe => option(recipe.id, recipe.name)).join('');
  return `<label class="field">查看从哪天开始<input type="date" data-field="menuStart" value="${esc(start)}"></label>
    <a class="menu-shopping-link" href="#family-shopping">查看采购清单</a>
    <section class="panel"><h2>今晚想吃</h2>${wish.filter(item => item.day === start).map(item => `<div>${entry(item)}
      ${planned.some(plan => plan.recipeId === item.recipeId && plan.day === item.day && plan.slot === 'dinner') ? '<small>已排入晚餐</small>'
        : btn('排入晚餐', 'acceptWish', item.recipeId, 'secondary')}</div>`).join('') || '<p>家人还没点菜。</p>'}
    ${options ? `<form data-form="wish"><label class="field">从家庭菜谱选一道<select name="recipeId">${options}</select></label><button class="secondary">我想吃</button></form>` : '<p>先记录一道家庭菜谱，家人就能点菜。</p>'}</section>
    <section class="panel"><h2>未来七天菜单</h2>
    ${options ? `<form data-form="plan"><label class="field">日期<select name="day">${data.days.map(day => option(day, day)).join('')}</select></label>
      <label class="field">餐次<select name="slot">${['dinner', 'breakfast', 'lunch', 'feast'].map(slot => option(slot, slotNames[slot])).join('')}</select></label>
      <label class="field">菜谱<select name="recipeId">${options}</select></label><button class="primary">排入菜单</button></form>` : ''}
    ${data.days.map(day => `<div class="menu-day"><h3>${esc(day)}</h3>${planned.filter(item => item.day === day).map(entry).join('') || '<small>还没安排</small>'}</div>`).join('')}</section>
    <section class="panel" id="family-shopping"><h2>采购清单</h2>${data.shopping.map(item => `<label class="check kitchen-entry">
      <input type="checkbox" data-shopping="${esc(item.key)}"${item.checked ? ' checked' : ''}>
      <span>${esc(item.name)}　${esc([item.amount || '用量待确认', item.unit].filter(Boolean).join(' '))}<br><small>${esc(item.recipes.join('、'))}</small></span></label>`).join('')
      || '<p>排入带食材的菜谱后，这里会汇总要买的东西。</p>'}</section>`;
}

export function cookbookRows(books) {
  return books.map(book => `<button class="list-row" data-action="openBook" data-value="${esc(book.id)}">
    <span class="grow"><strong>${esc(book.title)}</strong><small>${book.count} 道菜${book.city ? ` · ${esc(book.city)} · ${esc(statuses[book.state])}` : ''}</small></span><span aria-hidden="true">›</span></button>`).join('');
}

export function cookbookForm(scope, city, recipes) {
  const publish = scope === 'public';
  return recipes.length ? `<details class="panel kitchen-source"><summary>${publish ? '创建公开专题' : '新建菜谱册'}</summary>
    <form data-form="cookbook">
    <label class="field">标题<input name="title" required maxlength="90" placeholder="${publish ? '外婆的武汉家常菜' : '周末家宴'}"></label>
    <label class="field">介绍<textarea name="introduction" maxlength="1000"></textarea></label>
    <fieldset><legend>${publish ? `${esc(city)}已公开的菜谱` : '挑选要收录的菜谱'}</legend>${recipes.map(recipe =>
      `<label class="check"><input type="checkbox" name="recipeIds" value="${esc(recipe.id)}">${esc(recipe.name)}</label>`).join('')}</fieldset>
    ${publish ? '<label class="check"><input type="checkbox" name="consent" required>同意将标题、介绍和所选菜谱提交公开审核</label>' : ''}
    <button class="primary">${publish ? '提交专题审核' : '保存菜谱册'}</button></form></details>` : '';
}

export function cookbookEntries(book, available) {
  return `${book.recipes.map(recipe => `<div class="panel row between">${btn(recipe.name, 'detail', recipe.id, 'text-button')}
    ${book.state === 'private' ? btn('移出', 'removeBookRecipe', recipe.id, 'secondary') : ''}</div>`).join('')}
    ${book.state === 'private' && available.length ? `<form class="panel" data-form="addBookRecipe"><label class="field">添加菜谱<select name="recipeId">${available.map(recipe => option(recipe.id, recipe.name)).join('')}</select></label>
    <button class="secondary">收入菜谱册</button></form>` : ''}`;
}

export function printableBook(book) {
  return `<div class="print-book"><header><h1>${esc(book.title)}</h1>${book.introduction ? `<p>${esc(book.introduction)}</p>` : ''}</header>
    ${book.recipes.map(recipe => `<article><h2>${esc(recipe.name)}</h2><small>${esc([recipe.city, recipe.author, recipe.recordedBy ? `记录 ${recipe.recordedBy}` : ''].filter(Boolean).join(' · '))}</small>
      ${(recipe.photos ?? []).map(photo => `<figure><img src="${esc(photo.url)}" alt="${esc(photo.caption || recipe.name)}"><figcaption>${esc(photo.caption)}</figcaption></figure>`).join('')}
      ${recipe.story ? `<p class="recipe-description">${esc(recipe.story)}</p>` : ''}
      ${cookingView(recipe)}${!recipe.cooking && recipe.desc ? `<p class="recipe-description">${esc(recipe.desc)}</p>` : ''}
      ${recipe.manuscriptUrl ? `<figure><img src="${esc(recipe.manuscriptUrl)}" alt="原始手稿"><figcaption>手稿</figcaption></figure>` : ''}</article>`).join('')}</div>`;
}

export async function downloadBook(book) {
  const template = document.createElement('template');
  template.innerHTML = printableBook(book);
  for (const image of template.content.querySelectorAll('img')) {
    const response = await fetch(image.getAttribute('src'));
    if (!response.ok) throw new Error('照片暂不可读，请刷新菜谱册后重试');
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      void response.blob().then(blob => reader.readAsDataURL(blob), reject);
    });
    image.src = data;
  }
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(book.title)}</title>
    <style>body{margin:2rem auto;padding:0 1rem;max-width:760px;color:#332b24;background:#faf6ee;font:17px/1.65 Georgia,serif}article{border-top:1px solid #d4c0aa;padding:1rem 0}h1,h2{color:#a13f30}figure{margin:1rem 0}img{width:100%;max-height:560px;object-fit:contain}p{white-space:pre-line}@media print{body{background:white}article{break-before:page}figure{break-inside:avoid}}</style>
    <body>${template.innerHTML}</body></html>`;
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${book.title.replace(/[<>:"/\\|?*]/g, '_')}.html`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

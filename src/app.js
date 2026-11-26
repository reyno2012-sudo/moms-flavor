import './preview.js';
import { cuisines, seed, familySeed, feed } from './model.js';
import { api } from './client.js';
import { avatar, bottomNav, btn, check, content, empty, esc, food, header, icon, input, note, photoIds, select } from './ui.js';
import { draftStory, hasStory, prepareStoryPhoto, storyArticle, storyFields, storyShareOptions } from './story.js';
import { storyLimits } from './story-limits.js';
import { cookingText, extractPastedRecipe, parseCooking } from './cooking.js';
import { cookbookEntries, cookbookForm, cookbookRows, cookingEditor, cookingView, downloadBook, familyCollaboration,
  menuView, printableBook, recipeOrigin, recipeSharing, recreationForm, recreationList, recordSources } from './kitchen.js';

const app = document.querySelector('#app');
const preview = new URLSearchParams(location.search).get('design');
const design = ['notebook', 'regions'].includes(preview) ? preview : 'table';
document.documentElement.dataset.design = design;
document.querySelector('meta[name="theme-color"]').content = '#F9F4F0';
const key = 'moms-flavor-v02';
const cities = ['重庆', '深圳', '宜昌', '武汉', '其他'];
const tags = ['全部', '家常菜', '面食', '小吃', '汤羹'];
const scopes = { private: '仅自己', family: '家庭可见', public: '公开分享' };
const states = { pending: '等待审核', approved: '已公开', rejected: '未通过', withdrawn: '已撤回' };
const emptyActivity = () => ({ liked: [], saved: [], followed: [], blocked: [] });
const local = { ...emptyActivity(), posted: [], feedback: [], city: '', home: '' };
try { Object.assign(local, JSON.parse(localStorage.getItem(key) || '{}')); } catch {}
const save = () => { try { localStorage.setItem(key, JSON.stringify(local)); } catch {} };
const defaultPreferences = () => ({ city: '', home: '', personalized: true });
let user = null;
let preferences = defaultPreferences();
let families = [];
let privateRecipes = [];
let publicRecipes = seed.map(r => ({ ...r, demo: true, authorKey: r.author }));
let interactions = emptyActivity();
let aiEnabled = false;
let manuscriptAiEnabled = false;
let reviewEnabled = false;
let moderatorKey = '';
let reviewQueue = null;
let comments = [];
let feedback = [];
let recipeRecreations = [];
let checks = [];
let books = [];
const today = () => new Intl.DateTimeFormat('sv-SE', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const blank = () => ({
  requestId: crypto.randomUUID(), name: '', author: '妈妈', city: preferences.city || local.city || cities[0],
  tag: '家常菜', cuisine: '', note: '', method: '手动记录', organization: null, confirmed: false, visibility: 'private',
  familyId: '', consent: false, publicDescription: '', aiConsent: false, story: '', photoUploads: [],
  publicStory: false, publicPhotoIndexes: [], manuscript: '', manuscriptConsent: false, sourceUrl: '',
  versionOf: '', versionName: '', ingredientsText: '', stepsText: '', publicCooking: false, publicLineage: false
});
const s = {
  nav: 'discover', tab: '推荐', mode: '本地', tag: '全部', query: '', layout: design === 'notebook' ? 'list' : 'grid', region: cities[0], cuisine: '',
  page: '', detail: null, author: '', step: -1, phase: 0, draft: blank(),
  familyId: '', profile: '我的菜谱', busy: '', error: '', message: '', invite: '', authorReturn: null,
  savedRecipeId: null, publicStoryPreview: false, menu: null, menuStart: today(),
  bookScope: 'private', bookCity: '', book: null, bookRequest: '', recipeReplay: '', replayRequest: '', detailReturnPage: ''
};

const activity = () => user ? interactions : local;
const all = () => [...publicRecipes, ...(user ? privateRecipes : [...local.posted, ...familySeed])];
const get = id => all().find(recipe => recipe.id === id);
const selectedFamily = () => families.find(family => family.id === s.familyId) ?? families[0];
const toggle = (values, value) => values.includes(value) ? values.filter(item => item !== value) : [...values, value];
const authorKey = recipe => recipe.authorKey ?? recipe.author;
const authorName = key => publicRecipes.find(recipe => authorKey(recipe) === key)?.author ?? '作者';
const status = () => `${s.error ? `<p class="error" role="alert">${esc(s.error)}</p>` : ''}${s.message ? `<p class="notice" role="status">${esc(s.message)}</p>` : ''}`;

function row(recipe) {
  const label = states[recipe.publicationState] ?? (recipe.visibility === 'public' ? recipe.city : scopes[recipe.visibility]);
  return `<button class="list-row" data-action="detail" data-value="${esc(recipe.id)}">
    ${food(recipe, 'thumb', true)}<span class="grow"><strong>${esc(recipe.name)}</strong>
    <small>${esc(recipe.author)} · ${esc(label)}</small></span><span aria-hidden="true">›</span></button>`;
}

function likeButton(recipe) {
  const liked = activity().liked.includes(recipe.id);
  const count = recipe.likes + (!user && liked ? 1 : 0);
  return btn(`${liked ? '♥' : '♡'} ${count || '赞'}`, 'like', recipe.id, `reaction ${liked ? 'liked' : ''}`, {
    name: `${liked ? '取消点赞' : '点赞'} ${recipe.name}，${count} 赞`, pressed: liked
  });
}

function cards(list) {
  if (!list.length) return empty('暂时没有找到菜谱', '试试其他关键词、分类或地区。', btn('清除筛选', 'reset', '', 'secondary'));
  return `<div class="grid recipe-grid${s.layout === 'list' ? ' list' : ''}">${list.map(recipe => `<article class="card">
    <button class="card-main" data-action="detail" data-value="${esc(recipe.id)}">${food(recipe, '', true)}
      <span class="card-info"><span class="region">${esc(recipe.city)} <span>${esc(recipe.tag)}</span></span>
      <span class="card-title">${esc(recipe.name)}</span></span></button>
    <div class="card-foot">${avatar(recipe.author)}<small>${esc(recipe.author)}</small>${likeButton(recipe)}</div></article>`).join('')}</div>`;
}

function spotlight(recipe) {
  const title = design === 'table' && recipe.id === 'cq1' ? recipe.name.replace('重庆小面', '\n重庆小面') : recipe.name;
  return `<button class="feature" data-action="detail" data-value="${esc(recipe.id)}">
    ${food(recipe, 'feature-photo', true)}<span class="feature-copy">
    <span class="feature-place">${esc(recipe.city)} <span>${esc(recipe.tag)}</span></span>
    <strong>${esc(title)}</strong><span class="feature-link">${hasStory(recipe) ? '读这道菜的故事' : '查看菜谱'}</span></span></button>`;
}

function regionIndex() {
  const entries = ['cq1', 'sz1', 'yc1', 'wh1'].map(id => seed.find(recipe => recipe.id === id));
  return `<section class="region-index"><h2>从城市找家常菜</h2><div class="place-grid">${entries.map(recipe =>
    `<button class="place" data-action="browseRegion" data-value="${esc(recipe.city)}">${food(recipe, '', true)}<strong>${esc(recipe.city)}</strong></button>`
  ).join('')}</div></section>`;
}

function discover() {
  const regional = s.nav === 'local';
  const source = user ? preferences : local;
  const region = { 本地: source.city || '重庆', 家乡: source.home || '宜昌', 浏览: s.region }[s.mode];
  const list = feed(publicRecipes.filter(r => !activity().blocked.includes(authorKey(r))), {
    city: regional ? region : '', cuisine: regional ? s.cuisine : '', search: s.query, tag: s.tag, tab: regional ? '推荐' : s.tab,
    followed: activity().followed, preserveOrder: true
  });
  const overview = !s.query && s.tag === '全部' && !regional && s.tab === '推荐';
  const featured = overview && design !== 'regions' && list.find(recipe => recipe.photos?.length || photoIds.has(recipe.id));
  const hero = featured ? spotlight(featured) : overview && design === 'regions' ? regionIndex() : '';
  const timeline = featured ? list.filter(recipe => recipe.id !== featured.id) : list;
  const filters = `<div class="filter-row"><div class="chips filters" aria-label="菜谱分类">${tags.map(tag =>
    btn(tag, 'tag', tag, `chip ${s.tag === tag ? 'active' : ''}`, { pressed: s.tag === tag })).join('')}</div>
    ${btn(s.layout === 'grid' ? '单列' : '双列', 'layout', '', `secondary layout-toggle${s.layout === 'list' ? ' to-grid' : ''}`)}</div>`;
  const navigation = regional
    ? `<div class="region-panel"><h2>${esc(region)}的味道</h2><div class="tabs regional-tabs">${[['本地', '常住城市'], ['家乡', '我的家乡'], ['浏览', '其他地区']].map(([mode, label]) =>
      btn(label, 'mode', mode, s.mode === mode ? 'active' : '', { pressed: s.mode === mode })).join('')}</div>
      <div class="grid">${select({ 本地: 'city', 家乡: 'home', 浏览: 'region' }[s.mode], region, cities,
    { 本地: '设置常住城市', 家乡: '设置家乡', 浏览: '选择浏览地区' }[s.mode])}
      ${select('cuisine', s.cuisine, [['', '全部菜系'], ...cuisines], '菜系')}</div></div>`
    : `<div class="tabs" aria-label="全国频道">${['推荐', '关注', '最新'].map(tab =>
      btn(tab, 'tab', tab, s.tab === tab ? 'active' : '', { pressed: s.tab === tab })).join('')}</div>`;
  const search = `<label class="search">${icon('search')}
    <input type="search" aria-label="搜索公开菜谱" data-field="query" placeholder="搜索菜名、城市、作者" value="${esc(s.query)}"></label>`;
  const controls = regional ? search + navigation : `<div class="editorial-controls">${navigation}${search}</div>`;
  const topics = regional && !s.query ? `<div class="row between"><h2>${esc(region)}的菜谱</h2>
    ${btn('地域专题', 'openBooks', region, 'secondary')}</div>` : '';
  const collection = `<section class="collection">${topics}${filters}${timeline.length || !featured ? cards(timeline) : ''}</section>`;
  return header(regional ? '地方味道' : '妈妈的味道', regional ? '' : 'Mom’s Flavor',
    user ? btn(user.username, 'nav', 'me', 'account-button') : btn('登录', 'account', '', 'account-button'), false, !regional)
    + content(status() + (design === 'notebook' ? controls + hero : hero + controls) + collection
      + (list.some(r => r.demo) ? '<p class="feed-disclosure">部分菜谱及故事为示例，示例配图由 AI 生成。</p>' : ''), 'discovery');
}

function organization(recipe, editable = false) {
  const structured = recipe.organization;
  if (!structured) return '';
  const section = (title, group) => structured[group].length ? `<div class="panel"><h3>${title}</h3><ul class="evidence">${structured[group].map((entry, index) =>
    `<li><strong>${esc(entry.label)}</strong><span>${esc(entry.status === 'unknown' ? (entry.value ? `未量化 · ${entry.value}` : '未知') : entry.value)}</span>
    <small>原话 · ${esc(entry.evidence)}</small>${editable ? `<div class="row evidence-actions">
    ${entry.value ? btn('标为未知', 'unknown', `${group}:${index}`, 'text-button') : ''}
    ${btn('移除', 'removeEvidence', `${group}:${index}`, 'text-button')}</div>` : ''}</li>`).join('')}</ul></div>` : '';
  return section('食材与用量', 'ingredients') + section('做法与火候', 'steps');
}

function detail() {
  const recipe = get(s.detail);
  if (!recipe) return header('菜谱暂不可见', '', '', true) + content(empty('无法打开菜谱', '公开内容可能已撤回。'));
  const pub = publicRecipes.some(item => item.id === recipe.id);
  if (s.step >= 0) {
    const confirmed = recipe.cooking?.steps?.length ? recipe.cooking.steps : recipe.organization?.steps.map(entry => entry.evidence) ?? [];
    const steps = confirmed.length ? confirmed : ['准备食材', '核对自己的烹饪记录', '调味与装盘'];
    const complete = s.step === steps.length;
    return header(complete ? '记录复刻结果' : '跟着做', recipe.name, btn('退出', 'leaveCook', '', 'secondary'))
      + content(`<progress max="${steps.length}" value="${Math.min(s.step + 1, steps.length)}" aria-label="复刻进度"></progress>
        <div class="panel steps"><h2>${complete ? '这道菜做得怎么样？' : `第 ${s.step + 1} / ${steps.length} 步`}</h2>
        ${complete ? '' : `<p>${esc(steps[s.step])}</p>${confirmed.length ? '' : '<small>示例陪做流程，请参考自己的菜谱。</small>'}`}</div>`
        + (complete ? `<div class="row">${['成功复刻', '味道接近', '需要改进'].map(result => btn(result, 'feedback', result, 'secondary')).join('')}</div>`
          : `<div class="row between">${btn('上一步', 'prev', '', 'secondary')}${btn(s.step === steps.length - 1 ? '完成' : '下一步', 'next', String(steps.length), 'primary')}</div>`));
  }
  const saved = activity().saved.includes(recipe.id);
  const follows = activity().followed.includes(authorKey(recipe));
  const author = pub ? btn(recipe.author, 'author', authorKey(recipe), 'text-button') : `<strong>${esc(recipe.author)}</strong>`;
  const clarify = cookingView(recipe) || organization(recipe) || note(pub ? '这份公开菜谱尚无食材和步骤。' : '目前没有结构化食材及步骤，可参考原始记录。');
  const family = families.find(item => item.id === recipe.familyId);
  const versionList = [...privateRecipes, ...publicRecipes].filter(item => item.versionOf === recipe.id);
  const byline = `<div class="row between story-byline"><div class="row">${avatar(recipe.author)}${author}</div>
    ${pub ? btn(follows ? '已关注' : '＋ 关注', 'follow', authorKey(recipe), 'secondary', { pressed: follows })
      : `<span class="pill">${esc(scopes[recipe.visibility])}</span>`}</div>`;
  const article = hasStory(recipe) ? storyArticle(recipe, byline, photoIds.has(recipe.id) ? food(recipe, 'hero') : '')
    : food(recipe, 'hero') + `<div class="detail-heading"><h2>${esc(recipe.name)}</h2>${byline}</div>`;
  return header(hasStory(recipe) ? '菜谱故事' : pub ? '菜谱详情' : '私有菜谱', [recipe.city, recipe.tag, recipe.cuisine].filter(Boolean).join(' · '), '', true) + content(
    status() + article + recipeOrigin(recipe) + recipeSharing(recipe, families)
    + (recipe.publicationState ? `<div class="panel"><h3>公开状态 · ${states[recipe.publicationState]}</h3>
      ${['pending', 'approved'].includes(recipe.publicationState) ? btn('撤回公开投稿', 'withdraw', recipe.publicationId, 'secondary') : ''}</div>` : '')
    + (pub ? `<div class="row between">${likeButton(recipe)}${btn(saved ? '★ 已收藏' : '☆ 收藏', 'bookmark', recipe.id, 'secondary', { pressed: saved })}</div>` : '')
    + `<section class="recipe-method"><h3>这道菜怎么做</h3>
      ${recipe.desc ? `<p class="recipe-description">${esc(recipe.desc)}</p>` : ''}
      ${clarify}${btn('跟着做这道菜', 'cook', '', 'primary full')}</section>`
    + `<section class="panel"><h3>家人和厨友的复刻</h3><div class="row">
      ${btn('我也做了', 'recreation', '', 'secondary')}${btn('另存我的版本', 'derive', '', 'secondary')}</div>
      ${recreationList(recipeRecreations)}${versionList.length ? `<h3>相关版本</h3>${versionList.map(row).join('')}` : ''}</section>`
    + familyCollaboration(recipe, family, user, checks.filter(check => check.recipeId === recipe.id))
    + (pub ? `<section class="panel"><div class="row between"><h3>美食交流</h3>${btn('举报', 'report', '', 'text-button')}</div>
      ${comments.length ? comments.map(comment => `<p class="comment">${esc(comment.text)}</p>`).join('') : '<p>还没有评论。</p>'}
      <form data-form="comment"><label class="field">分享做菜心得<input name="comment" required maxlength="400"></label>
      <button class="secondary">发送评论</button></form></section>` : ''));
}

function record() {
  const draft = s.draft;
  const titles = ['记录家的味道', '校对菜谱', '设置分享范围', '保存成功'];
  const progress = `<ol class="record-progress" aria-label="记录进度">${['记录', '校对', '分享'].map((label, index) =>
    `<li class="${s.phase >= index ? 'reached' : ''}"${s.phase === index ? ' aria-current="step"' : ''}>${label}</li>`).join('')}</ol>`;
  if (s.busy === 'ai') return header('AI 正在整理', draft.name) + content(progress
    + '<div class="panel steps" role="status"><progress aria-label="整理进度"></progress><p>正在从原话提取食材和步骤。整理完成后请逐项核对。</p></div>');
  let html;
  if (s.phase === 0) {
    html = `<div class="panel record-panel"><fieldset><legend>记录方式</legend><div class="grid">${['录音', '拍摄视频', '导入素材', '手动记录'].map(method =>
      btn(method, 'method', method, `option ${draft.method === method ? 'active' : ''}`, { pressed: draft.method === method })).join('')}</div></fieldset>
      ${draft.method !== '手动记录' ? note('此版本支持粘贴转写或素材文字。') : ''}
      <div class="identity-fields">${input('draft.name', draft.name, '菜谱名称', '例如：妈妈的重庆小面')}
      ${input('draft.author', draft.author, '原作者')}</div>
      <label class="field">原话和做法<textarea data-field="draft.note" maxlength="5000" placeholder="食材、用量、火候，或长辈的原话">${esc(draft.note)}</textarea></label>
      ${recordSources(draft, manuscriptAiEnabled && user)}${cookingEditor(draft)}
      ${storyFields(draft)}
      ${user && aiEnabled ? check('draft.aiConsent', draft.aiConsent, '同意将这段文字发送给 AI 服务整理')
    + btn(s.busy === 'ai' ? '正在整理…' : 'AI 整理菜谱', 'ai', '', 'primary full', { disabled: Boolean(s.busy) }) : ''}
      ${btn('手动校对', 'review', '', user && aiEnabled ? 'secondary full' : 'primary full', { disabled: Boolean(s.busy) })}</div>`;
  } else if (s.phase === 1) {
    html = `<h2>${esc(draft.name)}</h2><div class="panel"><h3>原始资料</h3><p class="recipe-description">${esc(draft.note || '暂无原话')}</p></div>
      ${draft.manuscript ? `<details class="panel kitchen-source"><summary>对照原始手稿</summary><img class="manuscript-preview"
        src="data:image/jpeg;base64,${esc(draft.manuscript)}" alt="本次记录的手稿"></details>` : ''}
      ${cookingView({ cooking: parseCooking(draft.ingredientsText, draft.stepsText) })}
      ${organization(draft, true) || note('可以保留口述中的模糊用量。没有记录的量、时间和火候视为未知。')}
      ${check('draft.confirmed', draft.confirmed, '我已核对原话，并确认保留未知信息')}
      ${btn('下一步 · 分享设置', 'share', '', 'primary full')}${btn('返回修改', 'phase', '0', 'secondary')}`;
  } else if (s.phase === 2) {
    html = `<h2>${esc(draft.name)}</h2><div class="panel">${select('draft.city', draft.city, cities, '菜谱所属地域')}
      ${select('draft.tag', draft.tag, tags.slice(1), '菜谱分类')}
      ${select('draft.cuisine', draft.cuisine, [['', '未指定'], ...cuisines], '菜系')}</div>
      <fieldset><legend>谁可以看到这道菜？</legend><div class="scope-options">${Object.entries(scopes).map(([value, label]) =>
    btn(label, 'visibility', value, `option ${draft.visibility === value ? 'active' : ''}`, { pressed: draft.visibility === value })).join('')}</div></fieldset>
      ${draft.visibility === 'private' ? note('菜谱将保存到个人档案，只有你可见。') : ''}
      ${draft.visibility === 'family' ? (families.length ? select('draft.familyId', draft.familyId, families.map(f => [f.id, f.name]), '选择家庭')
    : note('家庭菜谱需要先创建或加入家庭。') + btn('前往我的家', 'nav', 'family', 'secondary')) : ''}
      ${draft.visibility === 'public' ? `<section class="panel warm"><h3>公开快照预览</h3><strong>${esc(draft.name)}</strong>
        <p>${esc([draft.city, draft.tag, draft.cuisine, '家庭厨房'].filter(Boolean).join(' · '))}</p>
        <label class="field">公开说明（选填）<textarea data-field="draft.publicDescription" maxlength="500"
          placeholder="想和大家分享的做法或故事">${esc(draft.publicDescription)}</textarea></label>
        ${storyShareOptions(draft)}
        ${draft.ingredientsText.trim() || draft.stepsText.trim() ? check('draft.publicCooking', draft.publicCooking, '公开整理后的食材和做法') : ''}
        ${draft.publicCooking ? `<details class="kitchen-source"><summary>查看将公开的食材和做法</summary>${cookingView({ cooking: parseCooking(draft.ingredientsText, draft.stepsText) })}</details>` : ''}
        ${publicRecipes.some(recipe => recipe.id === draft.versionOf) ? check('draft.publicLineage', draft.publicLineage, '附上已公开的原版菜谱') : ''}
        <small>公开快照只包含这里列出的字段。原始资料保存在个人档案中。</small>
        ${check('draft.consent', draft.consent, '我确认提交以上可见字段，并在审核通过后公开')}</section>` : ''}
      ${btn(s.busy === 'publish' ? '正在保存…' : !user ? '登录后保存菜谱' : draft.visibility === 'public' ? '提交公开审核' : '保存菜谱',
    'publish', '', 'primary full', { disabled: Boolean(s.busy) })}
      ${btn('返回校对', 'phase', '1', 'secondary')}`;
  } else {
    html = empty('菜谱已保存', draft.visibility === 'public' ? '公开快照正在等待审核。' : '可在对应的私有菜谱库中查看。',
      btn('查看菜谱', 'afterPublish', '', 'primary'));
  }
  return header(titles[s.phase], s.phase < 3 ? '家庭菜谱' : '') + content(status() + (s.phase < 3 ? progress : '') + html);
}

function storyPreview() {
  const isPublic = s.publicStoryPreview;
  const recipe = draftStory(s.draft, isPublic);
  const context = [s.draft.city, s.draft.tag, s.draft.cuisine, isPublic ? '家庭厨房' : s.draft.author.trim()].filter(Boolean).join(' · ');
  const metadata = `<p class="story-preview-byline">${esc(context)}</p>`;
  return header(isPublic ? '公开故事预览' : '故事预览', '', btn('返回编辑', 'back', '', 'secondary'))
    + content(storyArticle(recipe, metadata) + (!isPublic || s.draft.publicCooking ? cookingView({ cooking: parseCooking(s.draft.ingredientsText, s.draft.stepsText) }) : '')
      + (isPublic && s.draft.publicDescription.trim()
      ? `<section class="recipe-method"><h3>公开说明</h3><p class="recipe-description">${esc(s.draft.publicDescription.trim())}</p></section>` : ''));
}

function family() {
  if (!user) return header('我的家', '家庭私有空间') + content(status()
    + `<section class="panel family-welcome"><div class="family-welcome-copy"><h2>把家里的菜谱收在一起</h2>
      <p>创建家庭，或用邀请码加入。</p>${btn('登录或注册', 'account', '', 'primary')}</div>${food(familySeed[0])}</section>`
    + '<h2>示例家庭菜谱</h2>' + familySeed.map(row).join(''));
  const current = selectedFamily();
  const currentRecipes = current ? privateRecipes.filter(recipe => recipe.familyId === current.id) : [];
  const pending = checks.filter(item => item.assignedToMe && !item.answer && currentRecipes.some(recipe => recipe.id === item.recipeId));
  const actions = `<div class="family-actions"><form class="panel" data-form="family"><h3>创建家庭</h3>
    <label class="field">家庭名称<input name="name" required maxlength="60"></label><button class="secondary">创建</button></form>
    <form class="panel" data-form="join"><h3>加入家庭</h3><label class="field">邀请码<input name="code" required maxlength="100"></label>
    <button class="secondary">加入</button></form></div>`;
  return header('我的家', '家庭私有空间') + content(status() + (current ? `<div class="panel family-banner">
      <h2>${esc(current.name)}</h2>${families.length > 1 ? select('familyId', current.id, families.map(f => [f.id, f.name]), '切换家庭') : ''}
      <div class="row">${current.members.map(member => avatar(member.username)).join('')}<span>${current.members.length} 位成员</span></div>
      ${btn('查看家庭成员', 'members', '', 'secondary')}</div>${btn('＋ 记录家庭菜谱', 'familyRecord', current.id, 'primary full')}
      <div class="family-actions">${btn('今晚想吃与菜单', 'openMenu', '', 'secondary')}${btn('家庭菜谱册', 'openBooks', 'family', 'secondary')}</div>
      ${pending.length ? `<section class="panel"><h3>待我校对</h3>${pending.map(item => btn(item.question, 'detail', item.recipeId, 'text-button')).join('')}</section>` : ''}
      <h2>家庭菜谱库</h2>${currentRecipes.map(row).join('') || '<p>这个家庭还没有菜谱。</p>'}` : '')
    + actions);
}

function membersPage() {
  const item = selectedFamily();
  if (!item) return family();
  return header('家庭成员', item.name, '', true) + content(status()
    + item.members.map(member => `<div class="panel row between"><span class="row">${avatar(member.username)}
      ${esc(member.username)}</span><span class="pill">${member.role === 'owner' ? '家庭管理员' : '成员'}</span></div>`).join('')
    + (item.role === 'owner' ? btn('生成单次邀请码', 'invite', item.id, 'primary') : '')
    + (s.invite ? `<div class="panel"><h3>邀请码</h3><input value="${esc(s.invite)}" readonly aria-label="邀请码">
      <small>7 天内可用，使用后即失效。</small></div>` : ''));
}

function profile() {
  const state = activity();
  const own = user ? privateRecipes.filter(r => r.own) : local.posted;
  const saves = all().filter(r => state.saved.includes(r.id) && !state.blocked.includes(authorKey(r)));
  const recent = user ? feedback : local.feedback;
  const tabs = ['我的菜谱', '我的收藏', '我的关注', '复刻记录', '偏好'];
  let section;
  if (s.profile === '我的关注') {
    section = state.followed.map(key => `<div class="panel row between">${btn(authorName(key), 'author', key, 'text-button')}
      ${btn('取消关注', 'follow', key, 'secondary')}</div>`).join('') || empty('还没有关注', '可以在公开菜谱详情关注作者。');
  } else if (s.profile === '复刻记录') {
    section = (user ? recent.map(item => `<section class="panel"><h3>${esc(item.recipeName)}</h3>${recreationList([item])}</section>`).join('')
      : recent.map(item => `<div class="panel">${esc(get(item.id)?.name || '菜谱')} · ${esc(item.result)}</div>`).join(''))
      || empty('还没有复刻记录', '打开菜谱即可开始跟做。');
  } else if (s.profile === '偏好') {
    const regions = user ? preferences : local;
    section = `<div class="panel">${select('city', regions.city || '', [['', '未设置'], ...cities], '常住城市')}
      ${select('home', regions.home || '', [['', '未设置'], ...cities], '家乡')}
      ${user ? check('personalized', preferences.personalized, '根据地区、关注和互动调整推荐') : ''}
      ${state.blocked.map(key => btn(`取消屏蔽 ${authorName(key)}`, 'block', key, 'secondary')).join('')}</div>`;
  } else {
    const saved = s.profile === '我的收藏';
    section = (saved ? saves : own).map(row).join('') || empty(saved ? '还没有收藏' : '还没有菜谱',
      saved ? '在菜谱详情收藏想做的菜。' : '记录一道家里的菜，保存后会出现在这里。');
  }
  return header('我的厨房', '', user ? btn('退出登录', 'logout', '', 'secondary') : btn('登录', 'account', '', 'account-button'))
    + content(status() + `<div class="panel profile-banner"><div class="row">${avatar(user?.username || '我')}<h2>${esc(user?.username || '游客')}</h2></div>
       <div class="profile-stats"><span><strong>${own.filter(r => r.publicationState === 'approved').length}</strong>公开</span>
       <span><strong>${saves.length}</strong>收藏</span><span><strong>${state.followed.length}</strong>关注</span></div></div>
       <div class="chips">${tabs.map(tab => btn(tab, 'profile', tab, `chip ${s.profile === tab ? 'active' : ''}`, { pressed: s.profile === tab })).join('')}</div>`
      + section + (user ? btn('我的菜谱册', 'openBooks', 'private', 'secondary') : '')
      + (user && reviewEnabled ? btn('内容审核', 'reviewPage', '', 'secondary') : '')
      + (!user && local.posted.length ? note('旧版原型记录仍可在当前浏览器查看。') : ''));
}

function account() {
  return header('登录妈妈的味道', '登录后可保存菜谱、加入家庭', '', true) + content(status()
    + `<form class="panel account-form" data-form="account">
    <label class="field">用户名<input name="username" required minlength="3" maxlength="32" autocomplete="username"></label>
    <label class="field">密码<input name="password" type="password" required minlength="10" maxlength="128" autocomplete="current-password"></label>
    <small>密码至少 10 个字符。</small><button name="mode" value="login" class="primary">登录</button>
    <button name="mode" value="register" class="secondary">创建账号</button></form>`
    + btn('继续浏览', 'back', '', 'text-button'));
}

function authorPage() {
  const list = publicRecipes.filter(recipe => authorKey(recipe) === s.author);
  const state = activity();
  const followed = state.followed.includes(s.author);
  const blocked = state.blocked.includes(s.author);
  return header(authorName(s.author), '作者的公开菜谱', '', true) + content(status()
    + `<div class="row">${btn(followed ? '取消关注' : '关注', 'follow', s.author, 'secondary', { pressed: followed })}
    ${btn(blocked ? '取消屏蔽' : '屏蔽作者', 'block', s.author, 'secondary', { pressed: blocked })}</div>`
    + (blocked ? note('已屏蔽此作者。') : cards(list)));
}

function reviewPage() {
  return header('内容审核', '待审核公开快照与举报', '', true) + content(status()
    + `<form class="panel" data-form="review"><label class="field">本地审核口令
       <input name="key" required type="password" autocomplete="off"></label><button class="secondary">读取审核队列</button></form>`
    + (reviewQueue ? `<h2>待审核</h2>${reviewQueue.pending.map(item => `<div class="panel">
      ${hasStory(item) ? storyArticle(item) : `<h3>${esc(item.name)}</h3>`}
      <p>${esc([item.city, item.tag, item.cuisine, item.author].filter(Boolean).join(' · '))}</p>
      ${item.desc ? `<p class="recipe-description">${esc(item.desc)}</p>` : ''}<div class="row">
      ${btn('通过', 'moderate', `approved:${item.id}`, 'primary')}${btn('退回', 'moderate', `rejected:${item.id}`, 'secondary')}</div></div>`).join('') || '<p>没有等待审核的投稿。</p>'}
      <h2>待审复刻与专题</h2>${[...reviewQueue.recreations, ...reviewQueue.cookbooks].map(item => {
        const kind = item.title ? 'cookbook' : 'recreation';
        return `<div class="panel"><h3>${esc(item.title ?? item.recipeName)}</h3>
          <p>${esc(item.introduction || item.note || item.result || '')}</p>
          ${item.photo ? `<img class="recreation-photo" src="${esc(item.photo)}" alt="待审复刻照片">` : ''}
          ${item.recipes ? `<p>${esc(item.recipes.map(recipe => recipe.name).join('、'))}</p>` : ''}
          <div class="row">${btn('通过', 'moderate', `approved:${item.id}:${kind}`, 'primary')}
          ${btn('退回', 'moderate', `rejected:${item.id}:${kind}`, 'secondary')}</div></div>`;
      }).join('') || '<p>没有等待审核的复刻或专题。</p>'}
      <h2>收到的举报</h2>${reviewQueue.reports.map(item => `<div class="panel"><small>${esc(item.target)}</small><p>${esc(item.reason)}</p></div>`).join('') || '<p>没有举报。</p>'}` : ''));
}

function menusPage() {
  const family = selectedFamily();
  return header('家庭菜单', family?.name, btn('刷新', 'refreshMenu', '', 'secondary'), true)
    + content(status() + menuView(s.menu, familyChoices(family?.id), s.menuStart));
}

const familyRecipes = familyId => privateRecipes.filter(recipe => recipe.familyId === familyId);
const savedPublicRecipes = () => publicRecipes.filter(recipe => interactions.saved.includes(recipe.id));
const familyChoices = id => [...familyRecipes(id), ...savedPublicRecipes()];
const personalRecipes = () => [...privateRecipes.filter(recipe => recipe.own), ...savedPublicRecipes()];

function availableBookRecipes() {
  if (s.bookScope === 'public') return publicRecipes.filter(recipe => recipe.city === s.bookCity);
  return s.bookScope === 'family' ? familyChoices(selectedFamily()?.id) : personalRecipes();
}

function booksPage() {
  const family = selectedFamily();
  const regional = s.bookScope === 'public';
  const title = regional ? `${s.bookCity}地域专题` : s.bookScope === 'family' ? '家庭菜谱册' : '我的菜谱册';
  const list = books.filter(book => regional ? book.city === s.bookCity : s.bookScope === 'family' ? book.familyId === family?.id
    : book.own && book.state === 'private' && !book.familyId);
  return header(title, '', '', true) + content(status() + (cookbookRows(list) || '<p>这里还没有菜谱册。</p>')
    + (user ? cookbookForm(s.bookScope, s.bookCity, availableBookRecipes()) : ''));
}

function bookPage() {
  const book = s.book;
  if (!book) return booksPage();
  const available = availableBookRecipes().filter(recipe => !book.recipes.some(item => item.id === recipe.id));
  return header(book.title, book.city, '', true) + content(status() + (book.introduction ? `<p>${esc(book.introduction)}</p>` : '')
    + cookbookEntries(book, available) + `<div class="row">${btn('预览菜谱册', 'printPreview', '', 'primary')}
    ${btn('下载电子菜谱册', 'downloadBook', '', 'secondary')}</div>`
    + (book.own && ['pending', 'approved'].includes(book.state) ? btn('撤回公开专题', 'withdrawBook', '', 'secondary') : ''));
}

function printPage() {
  return header('菜谱册预览', '', '', true) + content(status() + printableBook(s.book)
    + btn('打印 / 保存为 PDF', 'printBook', '', 'primary book-print-action'));
}

function recreationPage() {
  const recipe = get(s.detail);
  return header('我的复刻', recipe?.name, '', true) + content(status() + (recipe ? recreationForm(recipe, s.recipeReplay) : ''));
}

function reportPage() {
  return header('举报菜谱', get(s.detail)?.name || '', '', true) + content(status() + `<form class="panel" data-form="report">
    <label class="field">举报原因<textarea name="reason" required maxlength="400"></textarea></label>
    <button class="primary">提交举报</button></form>`);
}

function render() {
  const screens = { discover, local: discover, record, family, me: profile };
  const pages = { account, author: authorPage, members: membersPage, review: reviewPage, report: reportPage, storyPreview,
    menu: menusPage, books: booksPage, book: bookPage, print: printPage, recreation: recreationPage };
  const main = s.page ? pages[s.page]() : s.detail ? detail() : screens[s.nav]();
  const section = s.page || (s.detail ? 'detail' : s.nav);
  const scrollTop = app.firstElementChild?.scrollTop ?? 0;
  app.innerHTML = `<div class="screen screen-${section}">${main}</div>${bottomNav(s.nav)}`;
  app.firstElementChild.scrollTop = scrollTop;
}

async function refresh() {
  const [items, recipes, groups, signals, checksList, replays, bookList] = await Promise.all([
    api('feed'), user ? api('recipes') : [], user ? api('families') : [], user ? api('interactions') : emptyActivity(),
    user ? api('kitchen/checks') : [], user ? api('kitchen/recreations') : [], api('kitchen/cookbooks')
  ]);
  publicRecipes = items;
  privateRecipes = recipes;
  families = groups;
  interactions = signals;
  checks = checksList;
  feedback = replays;
  books = bookList;
}

async function restoreSession() {
  const session = await api('session');
  user = session.user;
  preferences = session.preferences;
  aiEnabled = session.aiEnabled;
  manuscriptAiEnabled = session.manuscriptAiEnabled;
  reviewEnabled = session.reviewEnabled;
  await refresh();
  if (!s.draft.name && preferences.city) s.draft.city = preferences.city;
}

function clearSession() {
  user = null;
  preferences = defaultPreferences();
  privateRecipes = [];
  families = [];
  interactions = emptyActivity();
  moderatorKey = '';
  clearReviewQueue();
  feedback = [];
  recipeRecreations = [];
  checks = [];
  books = [];
  comments = [];
  s.familyId = '';
  s.invite = '';
  s.detail = null;
  s.author = '';
  s.authorReturn = null;
  s.step = -1;
  s.phase = 0;
  s.draft = blank();
  s.savedRecipeId = null;
  s.menu = null;
  s.book = null;
  s.detailReturnPage = '';
}

function validateDraft() {
  if (!s.draft.name.trim() || !s.draft.author.trim()) throw new Error('请输入菜谱名称和原作者');
}

function openAccount() {
  s.page = 'account';
}

async function openDetail(id) {
  if (!get(id)) return;
  const published = publicRecipes.some(r => r.id === id);
  if (published) {
    try {
      comments = await api(`recipes/${id}/comments`);
    } catch (error) {
      if (error.status !== 404) throw error;
      await refresh();
      throw new Error('这道菜谱已不可见');
    }
  } else {
    if (user) {
      const recipe = await api(`recipes/${id}`);
      privateRecipes = privateRecipes.map(item => item.id === id ? recipe : item);
    }
    comments = [];
  }
  recipeRecreations = user || published ? await api(`kitchen/recreations?target=${encodeURIComponent(id)}`) : [];
  if (['menu', 'books', 'book'].includes(s.page)) s.detailReturnPage = s.page;
  if (['author', 'menu', 'books', 'book'].includes(s.page)) s.page = '';
  s.detail = id;
  s.step = -1;
}

async function react(kind, value) {
  const field = { like: 'liked', save: 'saved', follow: 'followed', block: 'blocked' }[kind];
  if (user) {
    interactions = await api('interactions', { kind, target: value, active: !interactions[field].includes(value) });
    publicRecipes = await api('feed');
  } else {
    local[field] = toggle(local[field], value);
    save();
  }
}

async function saveDraft() {
  if (!user) return openAccount();
  if (!s.draft.confirmed) throw new Error('请先核对原始资料');
  if (s.draft.visibility === 'family' && !families.length) throw new Error('请先创建或加入家庭');
  if (s.draft.visibility === 'public' && !s.draft.consent) throw new Error('请明确确认公开');
  const recipe = await api('recipes', { ...s.draft, familyId: s.draft.familyId || selectedFamily()?.id || '' });
  s.savedRecipeId = recipe.id;
  privateRecipes = [recipe, ...privateRecipes.filter(existing => existing.id !== recipe.id)];
  s.phase = 3;
  await refresh();
}

function clearReviewQueue() {
  for (const item of reviewQueue?.pending ?? []) {
    for (const photo of item.photos ?? []) URL.revokeObjectURL(photo.url);
  }
  for (const item of reviewQueue?.recreations ?? []) if (item.photo) URL.revokeObjectURL(item.photo);
  reviewQueue = null;
}

async function loadReviewQueue(key) {
  const headers = { 'X-Moderator-Key': key };
  const next = await api('review', undefined, headers);
  const readPhoto = async url => {
    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error('待审照片已变化，请重新读取审核队列。');
    return response.blob();
  };
  const pending = await Promise.all(next.pending.map(async item => ({ ...item, photos: await Promise.all(item.photos.map(async photo =>
    ({ ...photo, blob: await readPhoto(photo.url) }))) })));
  const recreations = await Promise.all(next.recreations.map(async item => ({ ...item, blob: item.photo ? await readPhoto(item.photo) : null })));
  clearReviewQueue();
  reviewQueue = { ...next, pending: pending.map(item => ({ ...item,
    photos: item.photos.map(({ caption, blob }) => ({ caption, url: URL.createObjectURL(blob) })) })),
    recreations: recreations.map(({ blob, ...item }) => ({ ...item, photo: blob ? URL.createObjectURL(blob) : '' })) };
}

async function changePreference(field, value) {
  if (user) {
    preferences = await api('preferences', { ...preferences, [field]: value });
    publicRecipes = await api('feed');
  } else {
    local[field] = value;
    save();
  }
}

function back() {
  if (s.page) {
    if (s.page === 'print') { s.page = 'book'; return; }
    if (s.page === 'book') { s.page = 'books'; return; }
    if (s.page === 'review') {
      moderatorKey = '';
      clearReviewQueue();
    }
    if (s.page === 'author') {
      s.detail = s.authorReturn?.id ?? null;
      comments = s.authorReturn?.comments ?? [];
      s.authorReturn = null;
      s.author = '';
    }
    s.page = '';
  } else if (s.author) {
    s.detail = null;
    s.step = -1;
    s.page = 'author';
  } else if (s.detailReturnPage) {
    s.detail = null;
    s.step = -1;
    s.page = s.detailReturnPage;
    s.detailReturnPage = '';
  } else {
    s.detail = null;
    s.step = -1;
  }
}

function navigate(value) {
  back();
  s.page = '';
  s.nav = value;
  s.detail = null;
  s.author = '';
  s.authorReturn = null;
  s.detailReturnPage = '';
  s.step = -1;
  s.query = '';
  s.tag = '全部';
  s.cuisine = '';
  if (value === 'record' && s.phase === 3) {
    s.phase = 0;
    s.draft = blank();
  }
}

async function loadMenu(start = s.menuStart) {
  const family = selectedFamily();
  if (!family) return;
  s.menu = await api(`kitchen/menu?family=${encodeURIComponent(family.id)}&start=${encodeURIComponent(start)}`);
  s.menuStart = start;
}

async function updateMenu(change) {
  s.menu = await api('kitchen/menu', { ...change, familyId: selectedFamily().id, start: s.menuStart });
}

async function refreshRecreations() {
  const target = s.detail ? `?target=${encodeURIComponent(s.detail)}` : '';
  if (target) recipeRecreations = await api(`kitchen/recreations${target}`);
  if (user) feedback = await api('kitchen/recreations');
}

function openRecreation(result = '') {
  if (!user) return openAccount();
  s.recipeReplay = result;
  s.replayRequest = crypto.randomUUID();
  s.step = -1;
  s.page = 'recreation';
}

function applyImportedFields(imported) {
  if (!s.draft.name.trim() && imported.name) s.draft.name = imported.name;
  for (const field of ['ingredientsText', 'stepsText']) {
    if (!s.draft[field].trim() && imported[field]) s.draft[field] = imported[field];
  }
  s.draft.confirmed = false;
  resetShareConsent();
}

const actions = {
  nav: async value => {
    navigate(value);
    if (user && ['discover', 'local', 'family', 'me'].includes(value)) await refresh();
  },
  browseRegion: value => {
    s.mode = '浏览';
    s.region = value;
    return actions.nav('local');
  },
  account: openAccount,
  detail: openDetail,
  back,
  like: value => react('like', value),
  bookmark: value => react('save', value),
  follow: value => react('follow', value),
  block: value => react('block', value),
  layout: () => { s.layout = s.layout === 'grid' ? 'list' : 'grid'; },
  tag: value => { s.tag = value; },
  tab: value => { s.tab = value; },
  mode: value => { s.mode = value; s.query = ''; s.tag = '全部'; s.cuisine = ''; },
  reset: () => { s.query = ''; s.tag = '全部'; s.tab = '推荐'; s.cuisine = ''; },
  method: value => { s.draft.method = value; },
  removeManuscript: () => { s.draft.manuscript = ''; s.draft.manuscriptConsent = false; s.draft.confirmed = false; },
  scanManuscript: async () => {
    const draft = s.draft;
    if (!draft.manuscriptConsent) throw new Error('请先确认是否将手稿发送给识别服务');
    const result = await api('ai/manuscript', { photo: draft.manuscript, consent: true });
    const text = [draft.note.trim(), result.text].filter(Boolean).join('\n\n');
    if (text.length > 5000) throw new Error('原话空间不足，请先精简文字再识别');
    draft.note = text;
    draft.organization = null;
    draft.confirmed = false;
    s.message = '已将识别文字加入原话，请对照手稿校对。';
  },
  importText: () => {
    const imported = extractPastedRecipe(s.draft.note);
    if (!imported.ingredientsText && !imported.stepsText) throw new Error('请先粘贴带有「食材」和「做法」标题的文字，也可以逐项手动填写。');
    applyImportedFields(imported);
    s.message = '已填入空白的食材和做法，请检查用量和步骤。';
  },
  importLink: async () => {
    if (!user) return openAccount();
    const link = s.draft.sourceUrl.trim();
    if (!link) throw new Error('请先填写菜谱链接');
    const imported = await api('recipes/import-link', { url: link });
    applyImportedFields(imported);
    s.draft.sourceUrl = imported.sourceUrl;
    s.message = '已导入菜谱，请核对食材和做法。';
  },
  derive: () => {
    if (!user) return openAccount();
    const parent = get(s.detail);
    if (!parent) return;
    if (s.phase < 3 && [s.draft.name, s.draft.note, s.draft.story, s.draft.manuscript, s.draft.ingredientsText,
      s.draft.stepsText, s.draft.sourceUrl].some(Boolean) && !window.confirm('替换「记录」里尚未保存的草稿，开始记录这个版本吗？')) return;
    navigate('record');
    s.phase = 0;
    s.draft = { ...blank(), ...cookingText(parent.cooking), name: `${parent.name.slice(0, 82)}（我的版本）`,
      city: parent.city, cuisine: parent.cuisine ?? '', tag: parent.tag, author: parent.author,
      versionOf: parent.id, versionName: parent.name, visibility: parent.familyId ? 'family' : 'private', familyId: parent.familyId ?? '' };
  },
  recreation: openRecreation,
  withdrawRecreation: async id => {
    await api(`kitchen/recreations/${encodeURIComponent(id)}/withdraw`, {});
    await refreshRecreations();
    s.message = '已撤回复刻分享。';
  },
  openMenu: async () => { await loadMenu(today()); s.page = 'menu'; },
  refreshMenu: () => loadMenu(),
  removeMenu: id => updateMenu({ remove: id }),
  acceptWish: id => updateMenu({ recipeId: id, day: s.menuStart, slot: 'dinner' }),
  openBooks: async value => {
    s.bookScope = ['family', 'private'].includes(value) ? value : 'public';
    s.bookCity = s.bookScope === 'public' ? value : '';
    books = await api('kitchen/cookbooks');
    s.bookRequest = crypto.randomUUID();
    s.page = 'books';
  },
  openBook: async id => { s.book = await api(`kitchen/cookbooks/${encodeURIComponent(id)}`); s.page = 'book'; },
  removeBookRecipe: async id => {
    s.book = await api(`kitchen/cookbooks/${s.book.id}/entries`, { recipeId: id, remove: true });
    books = await api('kitchen/cookbooks');
  },
  withdrawBook: async () => {
    await api(`kitchen/cookbooks/${s.book.id}/withdraw`, {});
    s.book = await api(`kitchen/cookbooks/${s.book.id}`);
    books = await api('kitchen/cookbooks');
    s.message = '专题已撤回。';
  },
  printPreview: async () => { await actions.openBook(s.book.id); s.page = 'print'; },
  printBook: async () => {
    const current = await api(`kitchen/cookbooks/${s.book.id}`);
    if (JSON.stringify(s.book) !== JSON.stringify(current)) { s.book = current; throw new Error('菜谱册内容已更新，请核对后重新打印'); }
    await Promise.allSettled([...app.querySelectorAll('.print-book img')].map(img => img.decode()));
    window.print();
  },
  downloadBook: async () => { await downloadBook(await api(`kitchen/cookbooks/${s.book.id}`)); },
  previewStory: value => {
    if (!s.draft.name.trim()) throw new Error('请填写菜谱名称');
    const isPublic = value === 'public';
    if (!hasStory(draftStory(s.draft, isPublic))) throw new Error(isPublic ? '请选择要公开的正文或照片' : '请写下故事或添加照片');
    s.publicStoryPreview = isPublic;
    s.page = 'storyPreview';
  },
  removeStoryPhoto: value => {
    s.draft.photoUploads.splice(Number(value), 1);
    s.draft.publicPhotoIndexes = [];
    s.draft.consent = false;
  },
  review: () => { validateDraft(); s.phase = 1; s.draft.confirmed = false; },
  ai: async () => {
    validateDraft();
    if (!s.draft.aiConsent || !s.draft.note.trim()) throw new Error('请提供原话，并确认授权 AI 整理');
    s.draft.organization = await api('ai/organize', { source: s.draft.note, consent: s.draft.aiConsent });
    s.draft.confirmed = false;
    s.phase = 1;
  },
  share: () => {
    if (!s.draft.confirmed) throw new Error('请先核对原始资料');
    s.phase = 2;
    s.draft.consent = false;
  },
  unknown: value => {
    const [group, index] = value.split(':');
    const entry = s.draft.organization[group][index];
    entry.value = null;
    entry.status = 'unknown';
    s.draft.confirmed = false;
  },
  removeEvidence: value => {
    const [group, index] = value.split(':');
    s.draft.organization[group].splice(Number(index), 1);
    s.draft.confirmed = false;
  },
  phase: value => { s.phase = Number(value); },
  visibility: value => {
    s.draft.visibility = value;
    s.draft.consent = false;
    if (value === 'family' && !s.draft.familyId) s.draft.familyId = selectedFamily()?.id ?? '';
  },
  publish: saveDraft,
  afterPublish: () => {
    s.nav = s.draft.visibility === 'family' ? 'family' : 'me';
    if (s.draft.familyId) s.familyId = s.draft.familyId;
    s.profile = '我的菜谱';
    s.detail = s.savedRecipeId;
    recipeRecreations = [];
    s.savedRecipeId = null;
    s.phase = 0;
    s.draft = blank();
  },
  familyRecord: value => {
    navigate('record');
    s.draft.visibility = 'family';
    s.draft.familyId = value;
  },
  cook: () => { s.step = 0; },
  leaveCook: () => { s.step = -1; },
  prev: () => { s.step = Math.max(-1, s.step - 1); },
  next: value => { s.step = Math.min(Number(value), s.step + 1); },
  feedback: value => {
    if (user) return openRecreation(value);
    local.feedback.unshift({ id: s.detail, result: value });
    save();
    s.step = -1;
    s.message = '已记录本次复刻。';
  },
  profile: value => { s.profile = value; },
  author: value => {
    if (!s.author) s.authorReturn = s.detail && { id: s.detail, comments };
    s.author = value;
    s.page = 'author';
  },
  report: () => { s.page = user ? 'report' : 'account'; },
  members: () => { s.page = 'members'; s.invite = ''; },
  invite: async value => { s.invite = (await api(`families/${value}/invites`, {})).code; },
  logout: async () => { await api('logout', {}); clearSession(); await refresh(); },
  withdraw: async value => {
    await api(`publications/${value}/withdraw`, {});
    s.message = '公开快照已撤回。';
    await refresh();
  },
  reviewPage: () => { s.page = 'review'; },
  moderate: async value => {
    const [state, id, kind] = value.split(':');
    const headers = { 'X-Moderator-Key': moderatorKey };
    await api('review', { state, id, kind }, headers);
    await loadReviewQueue(moderatorKey);
    await refresh();
  }
};

const headingActions = new Set(['nav', 'account', 'detail', 'back', 'review', 'ai', 'share', 'phase', 'publish',
  'afterPublish', 'familyRecord', 'author', 'report', 'members', 'cook', 'leaveCook', 'feedback', 'reviewPage', 'previewStory',
  'openMenu', 'openBooks', 'openBook', 'printPreview', 'recreation', 'derive']);
const focusHeading = () => {
  window.scrollTo(0, 0);
  app.firstElementChild?.scrollTo(0, 0);
  app.querySelector('h1')?.focus({ preventScroll: true });
};

function showError(error) {
  if (error.status === 401 && user) {
    clearSession();
    openAccount();
  }
  s.error = error instanceof TypeError ? '暂时无法连接服务，请重试。' : error.message;
}

async function act(action, value) {
  if (s.busy || !Object.hasOwn(actions, action)) return;
  s.error = '';
  s.message = '';
  s.busy = action;
  if (action === 'ai' || action === 'publish') render();
  try {
    await actions[action](value);
  } catch (error) {
    showError(error);
  } finally {
    s.busy = '';
    render();
  }
  if (!s.error && headingActions.has(action)) focusHeading();
  else app.querySelectorAll('[data-action]').forEach(button => {
    if (button.dataset.action === action && button.dataset.value === value) button.focus({ preventScroll: true });
  });
}

app.addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (button) void act(button.dataset.action, button.dataset.value);
});

function resetShareConsent() {
  s.draft.consent = false;
  const consent = app.querySelector('[data-field="draft.consent"]');
  if (consent) consent.checked = false;
}

function editDraft(element, field) {
  s.draft[field.slice(6)] = element.type === 'checkbox' ? element.checked : element.value;
  if (field === 'draft.note') {
    s.draft.organization = null;
    s.draft.confirmed = false;
    s.draft.aiConsent = false;
    const consent = app.querySelector('[data-field="draft.aiConsent"]');
    if (consent) consent.checked = false;
  }
  if (['draft.publicDescription', 'draft.publicStory', 'draft.story'].includes(field)) resetShareConsent();
  if (['draft.publicCooking', 'draft.publicLineage', 'draft.ingredientsText', 'draft.stepsText'].includes(field)) resetShareConsent();
  if (field === 'draft.publicCooking') {
    render();
    app.querySelector('[data-field="draft.publicCooking"]')?.focus({ preventScroll: true });
  }
  if (s.phase === 2 && element.tagName === 'SELECT') {
    s.draft.consent = false;
    render();
    app.querySelector(`[data-field="${field}"]`)?.focus();
  }
}

app.addEventListener('input', event => {
  const element = event.target;
  const { field } = element.dataset;
  if (element.dataset.caption !== undefined) {
    s.draft.photoUploads[Number(element.dataset.caption)].caption = element.value;
    resetShareConsent();
  } else if (field?.startsWith('draft.') && element.tagName !== 'SELECT' && element.type !== 'checkbox') {
    editDraft(element, field);
  } else if (field === 'query' && !event.isComposing) {
    s.query = element.value;
    const position = element.selectionStart;
    render();
    const next = app.querySelector('[data-field="query"]');
    next.focus({ preventScroll: true });
    if (position !== null) next.setSelectionRange(position, position);
  }
});
app.addEventListener('compositionend', event => {
  if (event.target.dataset.field === 'query') event.target.dispatchEvent(new Event('input', { bubbles: true }));
});

async function addStoryPhotos(files) {
  if (!files.length || s.busy) return;
  s.busy = 'storyPhotos';
  s.error = '';
  app.querySelector('[data-upload-status]').textContent = '正在处理照片…';
  try {
    if (s.draft.photoUploads.length + files.length > storyLimits.photos) throw new Error(`最多添加 ${storyLimits.photos} 张故事照片`);
    const uploads = [];
    for (const file of files) uploads.push(await prepareStoryPhoto(file));
    s.draft.photoUploads.push(...uploads);
    resetShareConsent();
  } catch (error) {
    showError(error);
  } finally {
    s.busy = '';
    render();
    app.querySelector('[data-field="storyPhotos"], [data-action="previewStory"]')?.focus({ preventScroll: true });
  }
}

app.addEventListener('change', async event => {
  const element = event.target;
  const { field } = element.dataset;
  if (field === 'storyPhotos') {
    await addStoryPhotos([...element.files]);
  } else if ((field === 'manuscript' || field === 'menuStart' || element.dataset.shopping !== undefined) && !s.busy) {
    s.busy = 'updateField';
    s.error = '';
    try {
      if (field === 'manuscript' && element.files[0]) {
        s.draft.manuscript = (await prepareStoryPhoto(element.files[0])).data;
        s.draft.manuscriptConsent = false;
        s.draft.confirmed = false;
      } else if (field === 'menuStart') await loadMenu(element.value);
      else if (element.dataset.shopping !== undefined) await updateMenu({ itemKey: element.dataset.shopping, checked: element.checked });
    } catch (error) { showError(error); }
    finally { s.busy = ''; render(); }
  } else if (element.dataset.publicPhoto !== undefined) {
    s.draft.publicPhotoIndexes = toggle(s.draft.publicPhotoIndexes, Number(element.dataset.publicPhoto));
    resetShareConsent();
  } else if (field?.startsWith('draft.') && (element.tagName === 'SELECT' || element.type === 'checkbox')) {
    editDraft(element, field);
  } else if (field === 'familyId') {
    s.familyId = element.value;
    render();
  } else if (field === 'region' || field === 'cuisine') {
    s[field] = element.value;
    render();
    app.querySelector(`[data-field="${field}"]`)?.focus();
  } else if (['city', 'home', 'personalized'].includes(field) && !s.busy) {
    s.busy = 'preference';
    s.error = '';
    try {
      await changePreference(field, field === 'personalized' ? element.checked : element.value);
    } catch (error) { showError(error); }
    finally { s.busy = ''; render(); }
    app.querySelector(`[data-field="${field}"]`)?.focus();
  }
});

const forms = {
  account: async (data, mode) => {
    await api(mode === 'register' ? 'register' : 'login', { username: data.username, password: data.password });
    s.page = '';
    await restoreSession();
  },
  family: async data => { s.familyId = (await api('families', { name: data.name })).id; await refresh(); },
  join: async data => { s.familyId = (await api('join', { code: data.code })).id; await refresh(); },
  recipeScope: async data => {
    await api(`recipes/${s.detail}/scope`, { scope: data.family ? 'family' : 'private', familyId: data.family });
    await refresh();
    await refreshRecreations();
    s.message = '已调整原稿可见范围。';
  },
  requestCheck: async data => {
    checks = await api('kitchen/checks', { recipeId: s.detail, reviewer: data.reviewer, question: data.question });
    s.message = '校对邀请已发给家人。';
  },
  answerCheck: async data => {
    checks = await api('kitchen/checks', { recipeId: s.detail, answer: data.answer });
    s.message = '已保存校对意见。';
  },
  recreation: async data => {
    const photo = data.photo?.size ? (await prepareStoryPhoto(data.photo)).data : '';
    await api('kitchen/recreations', { targetId: s.detail, requestId: s.replayRequest, result: data.result, note: data.note,
      scope: data.scope, photo, consent: data.consent === 'on' });
    s.page = '';
    await refreshRecreations();
    s.message = data.scope === 'public' ? '复刻已提交公开审核。' : '复刻已保存。';
  },
  wish: data => updateMenu({ recipeId: data.recipeId, day: s.menuStart, slot: 'wish' }),
  plan: data => updateMenu({ recipeId: data.recipeId, day: data.day, slot: data.slot }),
  cookbook: async data => {
    s.book = await api('kitchen/cookbooks', { title: data.title, introduction: data.introduction, scope: s.bookScope,
      city: s.bookCity, familyId: selectedFamily()?.id, recipeIds: data.recipeIds, consent: data.consent === 'on', requestId: s.bookRequest });
    books = await api('kitchen/cookbooks');
    s.bookRequest = crypto.randomUUID();
    s.page = 'book';
  },
  addBookRecipe: async data => {
    s.book = await api(`kitchen/cookbooks/${s.book.id}/entries`, { recipeId: data.recipeId });
    books = await api('kitchen/cookbooks');
  },
  comment: async data => {
    if (!user) return openAccount();
    const comment = await api(`recipes/${s.detail}/comments`, { text: data.comment });
    comments.push(comment);
  },
  report: async data => {
    await api('reports', { target: s.detail, reason: data.reason });
    s.page = '';
    s.message = '举报已提交。';
  },
  review: async data => {
    await loadReviewQueue(data.key);
    moderatorKey = data.key;
  }
};

app.addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.target;
  const name = form.dataset.form;
  if (!Object.hasOwn(forms, name) || s.busy) return;
  s.error = '';
  s.message = '';
  s.busy = name;
  let rerender = true;
  try {
    const fields = new FormData(form);
    const data = Object.fromEntries(fields);
    if (name === 'cookbook') data.recipeIds = fields.getAll('recipeIds');
    await forms[name](data, event.submitter?.value);
  } catch (error) {
    showError(error);
    rerender = error.status === 401 && name !== 'account';
    if (!rerender) {
      app.querySelector('.content > .error')?.remove();
      app.querySelector('.content')?.insertAdjacentHTML('afterbegin', status());
    }
  } finally {
    s.busy = '';
    if (rerender) render();
  }
  if (name === 'account' && !s.error) focusHeading();
});

render();
s.busy = 'session';
restoreSession().catch(() => {
  s.message = '暂时无法连接本地服务，正在显示示例菜谱。';
}).finally(() => {
  s.busy = '';
  render();
});

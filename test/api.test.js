import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { createApi } from '../server/api.mjs';
import { createOrganizer } from '../server/ai.mjs';
import { recommend } from '../server/recommend.mjs';
import { parseRecipePage, sourceUrl } from '../server/recipe-import.mjs';
import { extractPastedRecipe } from '../src/cooking.js';

const moderator = { 'x-moderator-key': 'integration-review-secret' };

function client(api) {
  let cookie = '';
  return async (path, body, headers = {}) => {
    const request = Object.assign(Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]), {
      method: body === undefined ? 'GET' : 'POST', headers: { cookie, 'content-type': 'application/json', ...headers }
    });
    const response = {
      statusCode: 200,
      headers: {},
      setHeader(name, value) {
        this.headers[name.toLowerCase()] = value;
        if (name === 'Set-Cookie') cookie = value.split(';')[0];
      },
      end(value) { this.data = typeof value === 'string' ? JSON.parse(value) : Buffer.from(value); }
    };
    await api.handle(request, response, new URL(`/api/${path}`, 'http://localhost'));
    return { status: response.statusCode, data: response.data, headers: response.headers };
  };
}

const password = 'test-kitchen-password';
const draft = (visibility, extra = {}) => ({
  requestId: randomUUID(), name: '验收清蒸鱼', author: '家人实名甲乙', note: '家族专用原话',
  city: '宜昌', tag: '家常菜', confirmed: true, visibility, ...extra
});

test('手稿、家庭校对和复刻版本随原稿权限保护', async t => {
  const api = createApi({ filename: ':memory:', manuscriptReader: async () => '原话：加盐适量。' });
  t.after(() => api.close());
  const owner = client(api);
  const sibling = client(api);
  const visitor = client(api);
  await owner('register', { username: 'archive-owner', password });
  await sibling('register', { username: 'archive-sibling', password });
  const family = (await owner('families', { name: '团圆厨房' })).data;
  const invitation = (await owner(`families/${family.id}/invites`, {})).data.code;
  await sibling('join', { code: invitation });
  const manuscript = readFileSync(new URL('../src/assets/table-xiaomian.jpg', import.meta.url)).toString('base64');
  assert.equal((await owner('ai/manuscript', { consent: false, photo: manuscript })).status, 400);
  assert.equal((await owner('ai/manuscript', { consent: true, photo: manuscript })).data.text, '原话：加盐适量。');
  const originalResponse = await owner('recipes', draft('private', { manuscript, ingredientsText: '盐 | 适量', stepsText: '炒到闻见香味。' }));
  assert.equal(originalResponse.status, 200);
  const original = originalResponse.data;
  assert.equal(original.recordedBy, 'archive-owner');
  assert.equal((await visitor(original.manuscriptUrl.slice(5))).status, 404);
  assert.equal((await sibling(original.manuscriptUrl.slice(5))).status, 404);
  assert.equal((await owner(`recipes/${original.id}/scope`, { scope: 'family', familyId: family.id })).status, 200);
  assert.equal((await sibling(original.manuscriptUrl.slice(5))).headers['content-type'], 'image/jpeg');
  const check = { recipeId: original.id, reviewer: 'archive-sibling', question: '什么时候放盐？' };
  assert.equal((await owner('kitchen/checks', check)).status, 200);
  assert.equal((await sibling('kitchen/checks')).data[0].assignedToMe, true);
  assert.equal((await owner('kitchen/checks', { recipeId: original.id, answer: '越权提交' })).status, 404);
  assert.equal((await sibling('kitchen/checks', { recipeId: original.id, answer: '尝过再放盐。' })).data[0].answer, '尝过再放盐。');

  const recreation = { requestId: randomUUID(), targetId: original.id, result: '成功复刻', scope: 'family', photo: manuscript, note: '我少放了盐' };
  const saved = await sibling('kitchen/recreations', recreation);
  assert.equal(saved.status, 200);
  assert.equal((await sibling('kitchen/recreations', recreation)).data.id, saved.data.id);
  assert.equal((await owner(saved.data.photo.slice(5))).status, 200);
  assert.equal((await visitor(saved.data.photo.slice(5))).status, 404);
  const version = (await sibling('recipes', draft('family', { name: '少盐版', familyId: family.id, versionOf: original.id, stepsText: '尝过再放盐。' }))).data;
  assert.equal(version.versionOf, original.id);
  assert.equal(version.cooking.steps[0], '尝过再放盐。');
  assert.equal((await owner(`recipes/${original.id}/scope`, { scope: 'private' })).status, 200);
  assert.equal((await sibling(original.manuscriptUrl.slice(5))).status, 404);
  assert.equal((await owner(saved.data.photo.slice(5))).status, 404);
  assert.equal((await sibling(`recipes/${version.id}`)).data.versionOf, undefined);
  assert.deepEqual((await sibling('kitchen/checks')).data, []);
});

test('影音按原稿成员权限和公开快照选择读取，支持播放范围请求和撤回', async t => {
  const api = createApi({ filename: ':memory:', moderatorKey: moderator['x-moderator-key'] });
  t.after(() => api.close());
  const owner = client(api);
  const visitor = client(api);
  const relative = path => path.slice(5);
  await owner('register', { username: 'media-owner', password });
  const samples = Buffer.alloc(160);
  const wav = Buffer.alloc(44);
  wav.write('RIFF');
  wav.writeUInt32LE(samples.length + 36, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(8000, 28);
  wav.writeUInt16LE(1, 32);
  wav.writeUInt16LE(8, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(samples.length, 40);
  const voice = { kind: 'voice', mime: 'audio/wav', data: Buffer.concat([wav, samples]).toString('base64'), caption: '原声说明保密' };
  const video = { kind: 'step', step: 2, mime: 'video/mp4', data: 'AAAAHGZ0eXBpc29tAAAAAGlzb21pc28ybXA0MQ==', caption: '第二步演示' };
  assert.equal((await owner('recipes', draft('private', { mediaUploads: [{ ...voice, data: 'PGh0bWw+' }] }))).status, 400);
  const input = draft('public', { consent: true, mediaUploads: [voice, video], publicMediaIndexes: [1] });
  const saved = await owner('recipes', input);
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  const recipe = saved.data;
  assert.equal((await owner('recipes', input)).data.id, recipe.id);
  assert.equal((await owner('recipes', { ...input, mediaUploads: [{ ...voice, data: Buffer.concat([wav, Buffer.alloc(160, 1)]).toString('base64') }, video] })).status, 409);
  assert.equal((await visitor(relative(recipe.media[0].url))).status, 404);
  assert.equal((await owner(relative(recipe.media[0].url))).headers['content-type'], 'audio/wav');
  const pending = (await owner('review', undefined, moderator)).data.pending[0];
  assert.deepEqual(pending.media.map(({ kind, caption }) => [kind, caption]), [['step', '第二步演示']]);
  const publicVideo = relative(pending.media[0].url);
  assert.equal((await visitor(publicVideo)).status, 404);
  assert.equal((await owner(publicVideo, undefined, moderator)).headers['content-type'], 'video/mp4');
  await owner('review', { id: recipe.publicationId, state: 'approved' }, moderator);
  const published = (await visitor(`recipes/${recipe.publicationId}`)).data;
  assert.equal(JSON.stringify(published).includes('原声说明保密'), false);
  assert.equal(published.media.length, 1);
  const range = await visitor(publicVideo, undefined, { range: 'bytes=0-1' });
  assert.equal(range.status, 206);
  assert.equal(range.headers['content-range'], `bytes 0-1/${Buffer.from(video.data, 'base64').length}`);
  assert.equal(range.data.length, 2);
  assert.equal(range.headers['cache-control'], 'no-store');
  assert.equal((await visitor(`publications/${recipe.publicationId}/media/1`)).status, 404);
  await owner(`publications/${recipe.publicationId}/withdraw`, {});
  assert.equal((await visitor(publicVideo)).status, 404);
  assert.equal((await owner(relative(recipe.media[1].url))).status, 200);

  const family = (await owner('families', { name: '影音测试家庭' })).data;
  const familyRecipe = (await owner('recipes', draft('family', { familyId: family.id, mediaUploads: [voice] }))).data;
  const sibling = client(api);
  await sibling('register', { username: 'media-sibling', password });
  assert.equal((await sibling(relative(familyRecipe.media[0].url))).status, 404);
  const invite = (await owner(`families/${family.id}/invites`, {})).data;
  await sibling('join', { code: invite.code });
  assert.equal((await sibling(relative(familyRecipe.media[0].url))).status, 200);
  await owner(`recipes/${familyRecipe.id}/scope`, { scope: 'private' });
  assert.equal((await sibling(relative(familyRecipe.media[0].url))).status, 404);
});

test('家庭菜单共享采购核对，专题与公开复刻需要审核且可撤回', async t => {
  const api = createApi({ filename: ':memory:', moderatorKey: moderator['x-moderator-key'] });
  t.after(() => api.close());
  const owner = client(api);
  const guest = client(api);
  const member = client(api);
  await owner('register', { username: 'menu-owner', password });
  await member('register', { username: 'menu-member', password });
  const family = (await owner('families', { name: '共享家' })).data;
  await member('join', { code: (await owner(`families/${family.id}/invites`, {})).data.code });
  const recipe = (await owner('recipes', draft('family', { familyId: family.id, ingredientsText: '番茄 | 300 | 克\n盐 | 适量' }))).data;
  const start = '2026-11-26';
  const menuPath = `kitchen/menu?family=${family.id}&start=${start}`;
  const item = { familyId: family.id, start, day: start, recipeId: recipe.id };
  assert.equal((await guest(menuPath)).status, 401);
  assert.equal((await member('kitchen/menu', { ...item, slot: 'wish' })).data.shopping.length, 0);
  const planned = (await owner('kitchen/menu', { ...item, slot: 'dinner' })).data;
  const tomato = planned.shopping.find(group => group.name === '番茄');
  assert.equal(tomato.amount, '300');
  assert.equal(planned.shopping.find(group => group.name === '盐').amount, '适量');
  await member('kitchen/menu', { familyId: family.id, start, itemKey: tomato.key, checked: true });
  assert.equal((await owner(menuPath)).data.shopping.find(group => group.key === tomato.key).checked, true);
  const updated = (await owner('kitchen/menu', { ...item, day: '2026-11-27', slot: 'feast' })).data;
  assert.equal(updated.shopping.find(group => group.name === '番茄').amount, '600');
  assert.equal(updated.shopping.find(group => group.name === '番茄').checked, false);

  const privateBook = { requestId: randomUUID(), title: '团圆菜谱册', scope: 'family', familyId: family.id, recipeIds: [recipe.id] };
  assert.equal((await owner('kitchen/cookbooks', privateBook)).status, 200);
  assert.equal((await member(`kitchen/cookbooks/${privateBook.requestId}`)).data.recipes[0].id, recipe.id);
  assert.equal((await guest(`kitchen/cookbooks/${privateBook.requestId}`)).status, 404);
  const publication = (await owner('recipes', draft('public', { consent: true, publicCooking: true, ingredientsText: '番茄 | 300 | 克' }))).data;
  await owner('review', { state: 'approved', id: publication.publicationId }, moderator);
  const topic = { requestId: randomUUID(), title: '外婆的宜昌菜', scope: 'public', city: '宜昌', recipeIds: [publication.publicationId], consent: true };
  assert.equal((await owner('kitchen/cookbooks', { ...topic, recipeIds: [recipe.id] })).status, 400);
  assert.equal((await owner('kitchen/cookbooks', topic)).status, 200);
  assert.equal((await guest(`kitchen/cookbooks/${topic.requestId}`)).status, 404);
  const replay = (await member('kitchen/recreations', { requestId: randomUUID(), targetId: publication.publicationId,
    scope: 'public', consent: true, note: '这次做成功了', result: '成功复刻' })).data;
  assert.equal((await guest(`kitchen/recreations?target=${publication.publicationId}`)).data.length, 0);
  assert.equal((await owner('review', { state: 'approved', id: topic.requestId, kind: 'cookbook' }, moderator)).status, 200);
  assert.equal((await owner('review', { state: 'approved', id: replay.id, kind: 'recreation' }, moderator)).status, 200);
  assert.equal((await guest(`kitchen/cookbooks/${topic.requestId}`)).data.recipes[0].cooking.ingredients[0].amount, '300');
  assert.equal((await guest(`kitchen/recreations?target=${publication.publicationId}`)).data[0].author, '家庭厨友');
  await owner(`publications/${publication.publicationId}/withdraw`, {});
  assert.equal((await guest(`kitchen/cookbooks/${topic.requestId}`)).status, 404);
  assert.equal((await guest(`kitchen/recreations?target=${publication.publicationId}`)).status, 404);
});

test('粘贴保留原量，网页导入读取结构化菜谱', () => {
  assert.deepEqual(extractPastedRecipe('材料：盐 适量\n做法：炒到闻见香味'), { ingredientsText: '盐 适量', stepsText: '炒到闻见香味' });
  const json = { '@graph': [{ '@type': ['Recipe'], name: '番茄 &amp; 蛋', recipeIngredient: ['盐 适量'],
    recipeInstructions: [{ '@type': 'HowToSection', itemListElement: [{ text: '搅匀。' }, { text: '<p>炒熟</p>' }] }] }] };
  assert.deepEqual(parseRecipePage(`<script type="application/ld+json">${JSON.stringify(json)}</script>`),
    { name: '番茄 & 蛋', ingredientsText: '盐 适量', stepsText: '搅匀。\n炒熟' });
  assert.throws(() => sourceUrl('https://localhost/recipe'));
  assert.throws(() => sourceUrl('https://127.0.0.1/recipe'));
});

test('故事正文及照片按保存范围访问，公开快照只展示勾选项', async t => {
  const api = createApi({ filename: ':memory:', moderatorKey: moderator['x-moderator-key'] });
  t.after(() => api.close());
  const owner = client(api);
  const guest = client(api);
  const member = client(api);
  await owner('register', { username: 'story-owner', password });
  await member('register', { username: 'story-member', password });
  const first = readFileSync(new URL('../src/assets/table-xiaomian.jpg', import.meta.url));
  const second = readFileSync(new URL('../src/assets/regional-dishes.jpg', import.meta.url));
  const photoUploads = [
    { data: first.toString('base64'), caption: '公版以外的照片说明' },
    { data: second.toString('base64'), caption: '我愿意公开的照片说明' }
  ];
  const story = '家里人把青花碗传给了我';
  assert.equal((await owner('recipes', draft('private', { photoUploads: [{ data: 'QUJD' }] }))).status, 400);
  const family = (await owner('families', { name: '故事验收家' })).data;
  const familyStory = (await owner('recipes', draft('family', { familyId: family.id, story, photoUploads }))).data;
  const familyCover = familyStory.photos[0].url.slice(5);
  assert.equal((await guest(familyCover)).status, 404);
  assert.equal((await member(familyCover)).status, 404);
  const invitation = (await owner(`families/${family.id}/invites`, {})).data.code;
  await member('join', { code: invitation });
  const familyPhoto = await member(familyCover);
  assert.equal(familyPhoto.status, 200);
  assert.equal(familyPhoto.headers['content-type'], 'image/jpeg');
  assert.equal(familyPhoto.headers['cache-control'], 'no-store');
  assert.equal((await member(`recipes/${familyStory.id}`)).data.story, story);

  const submission = draft('public', { story, photoUploads, consent: true, publicPhotoIndexes: [1] });
  const saved = (await owner('recipes', submission)).data;
  assert.equal((await owner('recipes', submission)).data.id, saved.id);
  const changedPhoto = { ...submission, photoUploads: [{ ...photoUploads[0], data: second.toString('base64') }, photoUploads[1]] };
  assert.equal((await owner('recipes', changedPhoto)).status, 409);
  assert.equal(saved.story, story);
  const publicCover = `publications/${saved.publicationId}/photos/0`;
  assert.equal((await guest(publicCover)).status, 404);
  assert.equal((await guest(publicCover, undefined, moderator)).status, 404);
  const reviewed = (await member('review', undefined, moderator)).data.pending[0];
  assert.deepEqual(reviewed.photos, [{ url: `/api/${publicCover}`, caption: photoUploads[1].caption }]);
  assert.equal(reviewed.story, undefined);
  assert.equal(reviewed.photoSelections, undefined);
  const reviewPhoto = await member(publicCover, undefined, moderator);
  assert.equal(reviewPhoto.status, 200);
  assert.notDeepEqual(reviewPhoto.data, familyPhoto.data);
  assert.deepEqual(reviewPhoto.data, (await owner(saved.photos[1].url.slice(5))).data);
  await member('review', { id: saved.publicationId, state: 'approved' }, moderator);
  assert.equal((await guest(publicCover)).status, 200);
  assert.equal((await guest(`publications/${saved.publicationId}/photos/1`)).status, 404);
  assert.equal((await guest(saved.photos[1].url.slice(5))).status, 404);
  const publicPath = `recipes/${saved.publicationId}`;
  assert.doesNotMatch(JSON.stringify((await guest(publicPath)).data), /青花碗|公版以外|家族专用原话|家人实名/);
  assert.deepEqual((await guest(`feed?q=${encodeURIComponent(story)}`)).data, []);

  const textSubmission = (await owner('recipes', draft('public', { story, consent: true, publicStory: true, photoUploads }))).data;
  await member('review', { id: textSubmission.publicationId, state: 'approved' }, moderator);
  const textResult = (await guest(`recipes/${textSubmission.publicationId}`)).data;
  assert.equal(textResult.story, story);
  assert.deepEqual(textResult.photos, []);
  assert.equal((await guest(`feed?q=${encodeURIComponent(story)}`)).data[0].id, textSubmission.publicationId);

  await owner(`publications/${saved.publicationId}/withdraw`, {});
  assert.equal((await guest(publicCover)).status, 404);
  assert.equal((await owner(saved.photos[1].url.slice(5))).status, 200);
});

test('家庭原稿、个人原稿与待审、通过、撤回的公开快照严格隔离', async t => {
  const api = createApi({ filename: ':memory:', moderatorKey: moderator['x-moderator-key'] });
  t.after(() => api.close());
  const owner = client(api);
  const member = client(api);
  const outsider = client(api);
  const guest = client(api);
  for (const [send, username] of [[owner, 'owner'], [member, 'member'], [outsider, 'outsider']]) {
    assert.equal((await send('register', { username, password })).status, 200);
  }
  assert.equal((await owner('recipes', draft('personal'))).status, 400);
  assert.equal((await guest('recipes', draft('private'))).status, 401);
  assert.equal((await owner('recipes', draft('private'), { origin: 'https://other.test' })).status, 403);

  const family = (await owner('families', { name: '团圆厨房' })).data;
  const familyDraft = draft('family', { familyId: family.id });
  assert.equal((await outsider('recipes', familyDraft)).status, 404);
  const familyRecipe = (await owner('recipes', familyDraft)).data;
  assert.equal((await owner('recipes', familyDraft)).data.id, familyRecipe.id);
  assert.equal((await owner('recipes', { ...familyDraft, note: '不同内容' })).status, 409);
  assert.equal((await member(`recipes/${familyRecipe.id}`)).status, 404);
  const invitation = (await owner(`families/${family.id}/invites`, {})).data.code;
  assert.equal((await member('join', { code: invitation })).status, 200);
  assert.equal((await outsider('join', { code: invitation })).status, 404);
  assert.equal((await member(`families/${family.id}/invites`, {})).status, 404);
  assert.equal((await member(`recipes/${familyRecipe.id}`)).data.desc, familyDraft.note);
  assert.equal((await outsider(`recipes/${familyRecipe.id}`)).status, 404);

  const personal = (await owner('recipes', draft('private'))).data;
  assert.equal((await member(`recipes/${personal.id}`)).status, 404);
  assert.equal((await owner('recipes', draft('public', { consent: false }))).status, 400);
  const publicDraft = draft('public', { consent: true, cuisine: '粤菜', publicDescription: '鱼上桌前撒一把葱花' });
  const submission = (await owner('recipes', publicDraft)).data;
  assert.equal((await owner('recipes', publicDraft)).data.publicationId, submission.publicationId);
  assert.equal((await owner('recipes', { ...publicDraft, publicDescription: '其他说明' })).status, 409);
  assert.equal(submission.publicationState, 'pending');
  assert.notEqual(submission.publicationId, submission.id);
  assert.equal((await member(`recipes/${submission.id}`)).status, 404);
  assert.equal((await guest(`recipes/${submission.publicationId}`)).status, 404);
  const query = 'feed?city=' + encodeURIComponent(submission.city) + '&q=' + encodeURIComponent(submission.name);
  assert.deepEqual((await guest(query)).data, []);
  assert.equal((await owner('review', { id: submission.publicationId, state: 'approved' })).status, 403);
  const queue = (await outsider('review', undefined, moderator)).data;
  assert.equal(queue.pending[0].name, submission.name);
  assert.doesNotMatch(JSON.stringify(queue), /家人实名甲乙|家族专用原话/);
  assert.equal((await outsider('review', { id: submission.publicationId, state: 'approved' }, moderator)).status, 200);

  const publicPath = `recipes/${submission.publicationId}`;
  const published = (await guest(publicPath)).data;
  assert.equal(published.name, submission.name);
  assert.equal(published.desc, publicDraft.publicDescription);
  assert.doesNotMatch(JSON.stringify(published), /家人实名甲乙|家族专用原话|familyId|recipeId/);
  assert.equal((await guest(query)).data[0].id, submission.publicationId);
  assert.equal((await guest(query + '&cuisine=' + encodeURIComponent('粤菜'))).data[0].id, submission.publicationId);
  assert.deepEqual((await guest(query + '&cuisine=' + encodeURIComponent('鄂菜'))).data, []);
  assert.equal((await member('interactions', { kind: 'save', target: familyRecipe.id, active: true })).status, 404);
  await member('interactions', { kind: 'follow', target: published.authorKey, active: true });
  assert.equal((await member('feed?tab=' + encodeURIComponent('关注'))).data[0].id, published.id);
  await member('interactions', { kind: 'block', target: published.authorKey, active: true });
  assert.deepEqual((await member(query)).data, []);
  assert.equal((await member(`${publicPath}/comments`, { text: '感谢分享' })).status, 200);
  assert.equal((await member('reports', { target: published.id, reason: '审核测试' })).status, 200);
  assert.equal((await owner('review', undefined, moderator)).data.reports.length, 1);

  const withdrawal = `publications/${submission.publicationId}/withdraw`;
  assert.equal((await member(withdrawal, {})).status, 404);
  assert.equal((await owner(withdrawal, {})).status, 200);
  assert.equal((await guest(publicPath)).status, 404);
  assert.equal((await guest(`${publicPath}/comments`)).status, 404);
  assert.deepEqual((await guest(query)).data, []);
  assert.equal((await owner(`recipes/${submission.id}`)).data.desc, submission.desc);
});

test('重启后本地账号和原稿仍可读取，退出撤销会话', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'moms-flavor-test-'));
  const filename = join(directory, 'test.sqlite');
  let api = createApi({ filename });
  t.after(() => { api.close(); rmSync(directory, { recursive: true }); });
  const first = client(api);
  await first('register', { username: 'persisted', password });
  const original = await first('recipes', draft('private'));
  assert.equal(original.status, 200);
  api.close();
  api = createApi({ filename });
  const after = client(api);
  assert.equal((await after('login', { username: 'persisted', password: 'wrong-password' })).status, 401);
  assert.equal((await after('login', { username: 'persisted', password })).status, 200);
  assert.equal((await after(`recipes/${original.data.id}`)).data.id, original.data.id);
  await after('logout', {});
  assert.equal((await after(`recipes/${original.data.id}`)).status, 404);
  assert.equal((await after('recipes')).status, 401);
});

test('AI 文本整理须有明确同意，过滤无来源证据的食材和用量', async t => {
  let calls = 0;
  const organizer = createOrganizer({ key: 'test-key', model: 'test-model', request: async (url, options) => {
    calls++;
    assert.equal(new URL(url).pathname, '/v1/responses');
    const payload = JSON.parse(options.body);
    assert.equal(payload.store, false);
    assert.equal(payload.input, '放盐适量，再蒸一会儿。');
    assert.equal(payload.text.format.type, 'json_schema');
    return Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({
      ingredients: [{ label: '盐', value: '20克', evidence: '放盐适量' }, { label: '糖', value: '适量', evidence: '加糖适量' }],
      steps: [{ label: '蒸', value: '一会儿', evidence: '再蒸一会儿' }]
    }) }] }] });
  } });
  const api = createApi({ filename: ':memory:', organizer });
  t.after(() => api.close());
  const send = client(api);
  await send('register', { username: 'cook', password });
  const source = '放盐适量，再蒸一会儿。';
  assert.equal((await send('ai/organize', { source, consent: false })).status, 400);
  assert.equal(calls, 0);
  const { data } = await send('ai/organize', { source, consent: true });
  assert.equal(calls, 1);
  assert.deepEqual(data.ingredients, [{ label: '盐', value: null, evidence: '放盐适量', status: 'unknown' }]);
  assert.equal(data.steps[0].value, '一会儿');
  assert.equal(data.steps[0].status, 'unknown');
});

test('全国排序考虑互动和地区，关闭个性化后按时间浏览', () => {
  const now = Date.now();
  const make = (id, city, createdAt, author = id) => ({ id, name: id, city, tag: '家常菜', author, authorKey: author, visibility: 'public', likes: 0, createdAt });
  const all = [make('latest', '深圳', now), make('regional', '重庆', now - 1000), make('saved', '武汉', now - 2000)];
  const metrics = new Map([['saved', { likes: 2, saves: 5 }]]);
  const filters = { tab: '推荐', followed: [], blocked: [] };
  const profile = { city: '重庆', home: '', personalized: true };
  assert.deepEqual(recommend(all, filters, profile, metrics, now).map(r => r.id), ['saved', 'regional', 'latest']);
  assert.deepEqual(recommend(all, filters, { ...profile, personalized: false }, metrics, now).map(r => r.id), ['latest', 'regional', 'saved']);
});

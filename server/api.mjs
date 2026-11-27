import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { cuisines, seed } from '../src/model.js';
import { createManuscriptReader, createOrganizer, verifyOrganization } from './ai.mjs';
import { digest, equalSecret, hashPassword, randomToken, sessionAge, sessionCookie, tokenFrom, verifyPassword } from './auth.mjs';
import { recommend } from './recommend.mjs';
import { storyLimits } from '../src/story-limits.js';
import { decodeStoryPhoto } from './story-photos.mjs';
import { mediaLinks, readMediaUploads, sendMedia } from './recipe-media.mjs';
import { parseCooking } from '../src/cooking.js';
import { createKitchen } from './kitchen.mjs';
import { importRecipeLink, sourceUrl } from './recipe-import.mjs';

const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
const examples = seed.map(recipe => ({ ...recipe, demo: true, authorKey: recipe.author }));
const tabs = ['推荐', '关注', '最新'];
const visibility = ['private', 'family', 'public'];

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function requireValue(condition, status, message) {
  if (!condition) throw new HttpError(status, message);
}

function clean(value, length, name, optional = false) {
  requireValue(typeof value === 'string' && value.trim().length <= length && (optional || value.trim()), 400, `${name}格式不正确`);
  return value.trim();
}

async function readJson(request, byteLimit = 96_000) {
  const origin = request.headers.origin;
  const host = request.headers.host;
  requireValue(!origin || origin === `http://${host}` || origin === `https://${host}`, 403, '请求来源不受支持');
  requireValue(request.headers['content-type']?.split(';')[0] === 'application/json', 415, '请提交 JSON');
  requireValue(!(Number(request.headers['content-length']) > byteLimit), 413, '提交内容过长');
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk);
    length += bytes.length;
    requireValue(length <= byteLimit, 413, '提交内容过长');
    chunks.push(bytes);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (body && typeof body === 'object' && !Array.isArray(body)) return body;
  } catch { /* Return the same validation error for malformed inputs. */ }
  throw new HttpError(400, '请求内容无法读取');
}

function readPhotoUploads(uploads = []) {
  requireValue(Array.isArray(uploads) && uploads.length <= storyLimits.photos, 400, `最多添加 ${storyLimits.photos} 张故事照片`);
  return uploads.map(photo => {
    const jpeg = decodeStoryPhoto(photo?.data);
    requireValue(jpeg, 400, '照片格式或尺寸不符合要求，请重新选择');
    return { jpeg, caption: clean(photo.caption ?? '', storyLimits.caption, '照片说明', true) };
  });
}

function photoLinks(base, captions) {
  return captions.map((caption, position) => ({ url: `${base}/${position}`, caption }));
}

export function createApi({ filename, moderatorKey = process.env.MF_MODERATOR_KEY, organizer = createOrganizer({
  key: process.env.OPENAI_API_KEY, model: process.env.MF_AI_MODEL
}), manuscriptReader = createManuscriptReader({ key: process.env.OPENAI_API_KEY, model: process.env.MF_AI_MODEL }),
  linkImporter = importRecipeLink } = {}) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(schema);
  const organizeInProgress = new Set();
  const get = (sql, ...values) => db.prepare(sql).get(...values);
  const all = (sql, ...values) => db.prepare(sql).all(...values);
  const run = (sql, ...values) => db.prepare(sql).run(...values);
  const kitchen = createKitchen({ get, all, run, transaction, clean, requireValue, visibleRecipe, publicRecord });

  function transaction(operation) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  function session(request) {
    return get(`SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ? AND s.expires > ?`, tokenFrom(request), Date.now());
  }

  function preferences(user) {
    const profile = user && get('SELECT city, home, personalized FROM preferences WHERE user_id = ?', user.id);
    return profile ? { ...profile, personalized: Boolean(profile.personalized) } : { city: '', home: '', personalized: true };
  }

  function interactions(user) {
    const rows = user ? all('SELECT kind, target FROM reactions WHERE user_id = ?', user.id) : [];
    const active = publicRecords();
    const validIds = new Set(active.map(recipe => recipe.id));
    const targets = kind => rows.filter(row => row.kind === kind).map(row => row.target);
    return {
      liked: targets('like').filter(id => validIds.has(id)),
      saved: targets('save').filter(id => validIds.has(id)),
      followed: targets('follow'),
      blocked: targets('block')
    };
  }

  function publicationView(row) {
    const { photoSelections = [], mediaSelections = [], versionOf, ...snapshot } = JSON.parse(row.snapshot);
    const parentRow = versionOf && get("SELECT snapshot FROM publications WHERE id=? AND state='approved'", versionOf);
    const versionName = versionOf && (examples.find(recipe => recipe.id === versionOf)?.name ?? (parentRow && JSON.parse(parentRow.snapshot).name));
    return { id: row.id, ...snapshot, createdAt: row.published_at, visibility: 'public', likes: 0,
      ...(versionName ? { versionOf, versionName } : {}),
      ...(mediaSelections.length ? { media: mediaLinks(`/api/publications/${row.id}/media`, mediaSelections) } : {}),
      photos: photoLinks(`/api/publications/${row.id}/photos`, photoSelections.map(photo => photo.caption)) };
  }

  function publicRecords() {
    return [...examples, ...all("SELECT id,snapshot,published_at FROM publications WHERE state = 'approved'").map(publicationView)];
  }

  function publicRecord(id) {
    const example = examples.find(recipe => recipe.id === id);
    if (example) return example;
    const row = get("SELECT id,snapshot,published_at FROM publications WHERE id = ? AND state = 'approved'", id);
    return row && publicationView(row);
  }

  function metrics() {
    const signals = new Map();
    for (const row of all("SELECT target, kind, count(*) AS count FROM reactions WHERE kind IN ('like','save') GROUP BY target,kind")) {
      const previous = signals.get(row.target) ?? { likes: 0, saves: 0 };
      previous[row.kind === 'like' ? 'likes' : 'saves'] = row.count;
      signals.set(row.target, previous);
    }
    return signals;
  }

  function recipeView(row, user) {
    const { photoCaptions = [], mediaEntries = [], hasManuscript, versionOf, ...original } = JSON.parse(row.content);
    const own = row.user_id === user.id;
    const parent = versionOf && (publicRecord(versionOf) ?? originalRows(user, versionOf)[0]);
    const view = { id: row.id, ...original, createdAt: row.created_at, familyId: row.family_id, own, recordedBy: row.recorded_by,
      ...(hasManuscript ? { manuscriptUrl: `/api/recipes/${row.id}/manuscript` } : {}),
      ...(parent ? { versionOf, versionName: parent.name ?? JSON.parse(parent.content).name } : {}),
      ...(mediaEntries.length ? { media: mediaLinks(`/api/recipes/${row.id}/media`, mediaEntries) } : {}),
      photos: photoLinks(`/api/recipes/${row.id}/photos`, photoCaptions) };
    if (own && row.publication_id) {
      view.publicationId = row.publication_id;
      view.publicationState = row.state;
    }
    return view;
  }

  function originalRows(user, id = '') {
    if (!user) return [];
    return all(`SELECT r.*,u.username AS recorded_by,p.id AS publication_id,p.state FROM recipes r
      JOIN users u ON u.id=r.user_id
      LEFT JOIN publications p ON p.recipe_id = r.id
      WHERE (? = '' OR r.id = ?) AND ((r.family_id IS NULL AND r.user_id = ?) OR EXISTS (
        SELECT 1 FROM members m WHERE m.family_id = r.family_id AND m.user_id = ?))
      ORDER BY r.created_at DESC`, id, id, user.id, user.id);
  }

  function readRecipes(user, id = '') {
    return originalRows(user, id).map(row => recipeView(row, user));
  }

  function visibleRecipe(user, id) {
    return id ? publicRecord(id) ?? readRecipes(user, id)[0] : undefined;
  }

  function saveRecipe(user, body) {
    requireValue(visibility.includes(body.visibility) && body.confirmed === true, 400, '请完成菜谱校对并选择可见范围');
    const isPublic = body.visibility === 'public';
    requireValue(!isPublic || body.consent === true, 400, '请明确确认公开');
    const requestId = clean(body.requestId, 100, '保存标识');
    const name = clean(body.name, 90, '菜谱名称');
    const city = clean(body.city, 30, '菜谱地域');
    const tag = clean(body.tag, 30, '菜谱分类');
    const cuisine = clean(body.cuisine ?? '', 30, '菜系', true);
    requireValue(!cuisine || cuisines.includes(cuisine), 400, '请选择有效菜系');
    const author = clean(body.author, 60, '原作者');
    const desc = clean(body.note ?? '', 5_000, '原始资料', true);
    const story = clean(body.story ?? '', storyLimits.text, '故事正文', true);
    const photos = readPhotoUploads(body.photoUploads);
    const media = readMediaUploads(body.mediaUploads, requireValue, clean);
    const manuscript = body.manuscript ? decodeStoryPhoto(body.manuscript) : null;
    requireValue(!body.manuscript || manuscript, 400, '手稿照片格式无效');
    const versionOf = clean(body.versionOf ?? '', 100, '原菜谱', true);
    requireValue(!versionOf || visibleRecipe(user, versionOf), 404, '原菜谱暂不可访问');
    let origin = clean(body.sourceUrl ?? '', 1600, '来源链接', true);
    if (origin) {
      try { origin = sourceUrl(origin).href; } catch { throw new HttpError(400, '来源链接须为公开 HTTPS 地址'); }
    }
    const ingredients = clean(body.ingredientsText ?? '', 4000, '食材', true);
    const steps = clean(body.stepsText ?? '', 6000, '做法', true);
    const cooking = ingredients || steps ? parseCooking(ingredients, steps) : null;
    const publicDescription = isPublic ? clean(body.publicDescription ?? '', 500, '公开说明', true) : '';
    const familyId = body.visibility === 'family' ? clean(body.familyId, 100, '家庭') : null;
    const structure = body.organization;
    requireValue(structure == null || (Array.isArray(structure.ingredients) && Array.isArray(structure.steps)), 400, '整理结果格式有误');
    const organization = structure == null ? null : verifyOrganization(structure, desc);
    const selected = isPublic ? body.publicPhotoIndexes ?? [] : [];
    requireValue(Array.isArray(selected) && selected.length <= photos.length && new Set(selected).size === selected.length
      && selected.every(index => Number.isInteger(index) && index >= 0 && index < photos.length), 400, '请选择有效的公开照片');
    const photoSelections = photos.flatMap(({ caption }, position) => selected.includes(position) ? [{ position, caption }] : []);
    const selectedMedia = isPublic ? body.publicMediaIndexes ?? [] : [];
    requireValue(Array.isArray(selectedMedia) && new Set(selectedMedia).size === selectedMedia.length
      && selectedMedia.every(index => Number.isInteger(index) && index >= 0 && index < media.length), 400, '请选择有效的公开影音');
    const mediaEntries = media.map(({ kind, step, caption }) => ({ kind, step, caption }));
    const mediaSelections = mediaEntries.flatMap((clip, position) => selectedMedia.includes(position) ? [{ position, ...clip }] : []);
    const content = JSON.stringify({ name, city, tag, ...(cuisine ? { cuisine } : {}), author, desc, organization,
      visibility: familyId ? 'family' : 'private', emoji: '🍽️', likes: 0,
      ...(story ? { story } : {}), ...(photos.length ? { photoCaptions: photos.map(photo => photo.caption) } : {}),
      ...(media.length ? { mediaEntries } : {}),
      ...(manuscript ? { hasManuscript: true } : {}), ...(versionOf ? { versionOf } : {}),
      ...(origin ? { sourceUrl: origin } : {}), ...(cooking ? { cooking } : {}) });
    const snapshot = isPublic ? JSON.stringify({ name, city, tag, ...(cuisine ? { cuisine } : {}), author: '家庭厨房',
      authorKey: digest(`public-author:${user.id}`), desc: publicDescription, emoji: '🍽️',
      ...(body.publicStory === true && story ? { story } : {}), ...(photoSelections.length ? { photoSelections } : {}),
      ...(mediaSelections.length ? { mediaSelections } : {}),
      ...(body.publicCooking === true && cooking ? { cooking } : {}),
      ...(body.publicLineage === true && versionOf && publicRecord(versionOf) ? { versionOf } : {}) }) : null;
    return transaction(() => {
      requireValue(!familyId || get('SELECT 1 FROM members WHERE user_id = ? AND family_id = ?', user.id, familyId), 404, '家庭不存在');
      const old = get(`SELECT r.*,p.id AS publication_id,p.state,p.snapshot FROM recipes r LEFT JOIN publications p ON p.recipe_id=r.id
        WHERE r.user_id=? AND r.request_id=?`, user.id, requestId);
      if (old) {
        requireValue(old.content === content && old.family_id === familyId && Boolean(old.publication_id) === isPublic, 409, '此保存标识已用于其他内容');
        requireValue(!isPublic || old.snapshot === snapshot, 409, '此保存标识已用于其他公开内容');
        if (photos.length) {
          const previousPhotos = all('SELECT jpeg FROM recipe_photos WHERE recipe_id=? ORDER BY position', old.id);
          requireValue(previousPhotos.length === photos.length && photos.every(({ jpeg }, index) => jpeg.equals(previousPhotos[index].jpeg)),
            409, '此保存标识已用于其他照片');
        }
        if (manuscript) requireValue(manuscript.equals(get('SELECT jpeg FROM recipe_manuscripts WHERE recipe_id=?', old.id).jpeg),
          409, '此保存标识已用于其他手稿');
        if (media.length) {
          const previousMedia = all('SELECT mime,bytes FROM recipe_media WHERE recipe_id=? ORDER BY position', old.id);
          requireValue(previousMedia.length === media.length && media.every(({ bytes, mime }, index) =>
            mime === previousMedia[index].mime && bytes.equals(previousMedia[index].bytes)), 409, '此保存标识已用于其他影音');
        }
        return readRecipes(user, old.id)[0];
      }
      const id = randomUUID();
      const now = Date.now();
      run('INSERT INTO recipes VALUES (?, ?, ?, ?, ?, ?)', id, user.id, familyId, requestId, content, now);
      photos.forEach(({ jpeg }, position) => run('INSERT INTO recipe_photos VALUES (?, ?, ?)', id, position, jpeg));
      media.forEach(({ mime, bytes }, position) => run('INSERT INTO recipe_media VALUES (?, ?, ?, ?)', id, position, mime, bytes));
      if (manuscript) run('INSERT INTO recipe_manuscripts VALUES (?, ?)', id, manuscript);
      if (isPublic) {
        run("INSERT INTO publications (id,recipe_id,state,snapshot,consented_at) VALUES (?,?,'pending',?,?)", randomUUID(), id, snapshot, now);
      }
      return readRecipes(user, id)[0];
    });
  }

  async function route(request, url, setCookie) {
    const path = url.pathname;
    const method = request.method;
    const user = session(request);
    const moderator = Boolean(user && equalSecret(request.headers['x-moderator-key'], moderatorKey));
    if (path.startsWith('/api/kitchen/')) return kitchen.route(url, method, user, limit => readJson(request, limit), moderator);
    const media = path.match(/^\/api\/(recipes|publications)\/([^/]+)\/media\/(\d+)$/);
    if (['GET', 'HEAD'].includes(method) && media) {
      const [, scope, id, index] = media;
      let recipeId = id;
      let position = Number(index);
      if (scope === 'recipes') requireValue(originalRows(user, id).length, 404, '影音不存在');
      else {
        const publication = get('SELECT recipe_id,snapshot,state FROM publications WHERE id=?', id);
        requireValue(publication?.state === 'approved' || publication?.state === 'pending' && moderator, 404, '影音不存在');
        recipeId = publication.recipe_id;
        position = JSON.parse(publication.snapshot).mediaSelections?.[position]?.position;
      }
      const stored = position === undefined ? null : get('SELECT mime,bytes FROM recipe_media WHERE recipe_id=? AND position=?', recipeId, position);
      requireValue(stored, 404, '影音不存在');
      return { mediaFile: stored };
    }
    const manuscript = path.match(/^\/api\/recipes\/([^/]+)\/manuscript$/);
    if (method === 'GET' && manuscript) {
      const id = manuscript[1];
      const stored = originalRows(user, id).length && get('SELECT jpeg FROM recipe_manuscripts WHERE recipe_id=?', id);
      requireValue(stored, 404, '手稿不存在');
      return stored.jpeg;
    }
    const photo = path.match(/^\/api\/(recipes|publications)\/([^/]+)\/photos\/(\d+)$/);
    if (method === 'GET' && photo) {
      const [, scope, id, index] = photo;
      let recipeId = id;
      let position = Number(index);
      if (scope === 'recipes') {
        requireValue(user && readRecipes(user, id).length, 404, '照片不存在');
      } else {
        const publication = get('SELECT recipe_id,snapshot,state FROM publications WHERE id=?', id);
        const allowed = publication?.state === 'approved' || (publication?.state === 'pending' && user
          && equalSecret(request.headers['x-moderator-key'], moderatorKey));
        requireValue(allowed, 404, '照片不存在');
        recipeId = publication.recipe_id;
        position = JSON.parse(publication.snapshot).photoSelections?.[position]?.position;
      }
      const stored = position === undefined ? null : get('SELECT jpeg FROM recipe_photos WHERE recipe_id=? AND position=?', recipeId, position);
      requireValue(stored, 404, '照片不存在');
      return stored.jpeg;
    }
    if (method === 'GET' && path === '/api/session') {
      return { user: user ?? null, preferences: preferences(user), aiEnabled: Boolean(organizer),
        manuscriptAiEnabled: Boolean(manuscriptReader), reviewEnabled: Boolean(moderatorKey) };
    }
    if (method === 'GET' && path === '/api/feed') {
      const tab = url.searchParams.get('tab') ?? '推荐';
      requireValue(tabs.includes(tab), 400, '频道不存在');
      const filters = {
        tab, city: url.searchParams.get('city') ?? '', search: url.searchParams.get('q') ?? '',
        tag: url.searchParams.get('tag') ?? '全部', cuisine: url.searchParams.get('cuisine') ?? '', ...interactions(user)
      };
      const realSignals = metrics();
      return recommend(publicRecords(), filters, preferences(user), realSignals).map(recipe => ({
        ...recipe, likes: recipe.likes + (realSignals.get(recipe.id)?.likes ?? 0)
      }));
    }
    const recipe = path.match(/^\/api\/recipes\/([^/]+)$/);
    if (method === 'GET' && recipe) {
      const current = publicRecord(recipe[1]);
      if (current) return current;
      const original = user && readRecipes(user, recipe[1])[0];
      requireValue(original, 404, '菜谱不存在');
      return original;
    }
    const comments = path.match(/^\/api\/recipes\/([^/]+)\/comments$/);
    if (method === 'GET' && comments) {
      requireValue(publicRecord(comments[1]), 404, '菜谱不存在');
      return all('SELECT id,body AS text,created_at AS createdAt FROM comments WHERE target=? ORDER BY created_at', comments[1]);
    }
    if (method === 'POST' && (path === '/api/register' || path === '/api/login')) {
      const body = await readJson(request);
      const username = clean(body.username, 32, '用户名').toLowerCase();
      requireValue(/^[\p{L}\p{N}_-]{3,32}$/u.test(username), 400, '用户名需为 3–32 个字母、汉字、数字、下划线或短横线');
      requireValue(typeof body.password === 'string' && body.password.length >= 10 && body.password.length <= 128, 400, '密码需为 10–128 个字符');
      let account = get('SELECT id,username,password FROM users WHERE username = ?', username);
      if (path === '/api/register') {
        requireValue(!account, 409, '此用户名已注册');
        const password = await hashPassword(body.password);
        const id = randomUUID();
        requireValue(run('INSERT OR IGNORE INTO users VALUES (?, ?, ?)', id, username, password).changes, 409, '此用户名已注册');
        account = { id, username };
      } else {
        requireValue(await verifyPassword(body.password, account?.password), 401, '用户名或密码不正确');
      }
      const token = randomToken();
      transaction(() => {
        run('DELETE FROM sessions WHERE token = ? OR expires <= ?', tokenFrom(request), Date.now());
        run('INSERT INTO sessions VALUES (?, ?, ?)', digest(token), account.id, Date.now() + sessionAge * 1000);
      });
      setCookie(sessionCookie(token));
      return { user: { id: account.id, username: account.username } };
    }

    requireValue(user, 401, '请先登录');
    const largeBody = path === '/api/recipes' ? 38_000_000 : path === '/api/ai/manuscript' ? 1_050_000 : undefined;
    const body = method === 'POST' ? await readJson(request, largeBody) : {};
    if (method === 'POST' && path === '/api/logout') {
      run('DELETE FROM sessions WHERE token = ?', tokenFrom(request));
      setCookie(sessionCookie());
      return { ok: true };
    }
    if (method === 'GET' && path === '/api/families') {
      return all(`SELECT f.id,f.name,m.role FROM families f JOIN members m ON m.family_id=f.id WHERE m.user_id=? ORDER BY f.name`, user.id)
        .map(family => ({ ...family, members: all(`SELECT u.username,m.role FROM members m JOIN users u ON u.id=m.user_id
          WHERE m.family_id=? ORDER BY m.role DESC,u.username`, family.id) }));
    }
    if (method === 'POST' && path === '/api/families') {
      const id = randomUUID();
      const name = clean(body.name, 60, '家庭名称');
      transaction(() => {
        run('INSERT INTO families VALUES (?, ?)', id, name);
        run("INSERT INTO members VALUES (?, ?, 'owner')", id, user.id);
      });
      return { id, name, role: 'owner' };
    }
    const invite = path.match(/^\/api\/families\/([^/]+)\/invites$/);
    if (method === 'POST' && invite) {
      requireValue(get("SELECT 1 FROM members WHERE family_id=? AND user_id=? AND role='owner'", invite[1], user.id), 404, '家庭不存在');
      const token = randomToken();
      const expires = Date.now() + 7 * 86_400_000;
      run('INSERT INTO invites VALUES (?, ?, ?)', digest(token), invite[1], expires);
      return { code: token, expires };
    }
    if (method === 'POST' && path === '/api/join') {
      const token = digest(clean(body.code, 100, '邀请码'));
      return transaction(() => {
        const invitation = get('SELECT family_id FROM invites WHERE token=? AND expires>?', token, Date.now());
        requireValue(invitation, 404, '邀请码无效或已使用');
        requireValue(run("INSERT OR IGNORE INTO members VALUES (?, ?, 'member')", invitation.family_id, user.id).changes, 409, '你已经在这个家庭里');
        run('DELETE FROM invites WHERE token=?', token);
        return { id: invitation.family_id };
      });
    }
    if (method === 'GET' && path === '/api/recipes') return readRecipes(user);
    if (method === 'POST' && path === '/api/recipes') return saveRecipe(user, body);
    const scope = path.match(/^\/api\/recipes\/([^/]+)\/scope$/);
    if (method === 'POST' && scope) {
      const stored = originalRows(user, scope[1])[0];
      requireValue(stored?.user_id === user.id, 404, '原稿不存在');
      requireValue(['private', 'family'].includes(body.scope), 400, '请选择原稿访问范围');
      const familyId = body.scope === 'family' ? clean(body.familyId, 100, '家庭') : null;
      requireValue(!familyId || get('SELECT 1 FROM members WHERE user_id=? AND family_id=?', user.id, familyId), 404, '家庭不存在');
      const content = { ...JSON.parse(stored.content), visibility: body.scope };
      run('UPDATE recipes SET family_id=?,content=? WHERE id=?', familyId, JSON.stringify(content), scope[1]);
      return readRecipes(user, scope[1])[0];
    }
    if (method === 'POST' && path === '/api/recipes/import-link') {
      const link = clean(body.url, 1600, '菜谱链接');
      try { return await linkImporter(link); }
      catch { throw new HttpError(422, '无法导入这个链接。可使用含结构化菜谱的 HTTPS 网页，或粘贴菜谱文字。'); }
    }
    if (method === 'POST' && path === '/api/ai/manuscript') {
      requireValue(body.consent === true, 400, '请授权发送手稿进行识别');
      const jpeg = decodeStoryPhoto(body.photo);
      requireValue(jpeg, 400, '手稿照片无效');
      requireValue(manuscriptReader, 503, '手稿识别服务未配置，可手动录入');
      requireValue(!organizeInProgress.has(user.id), 409, '已有整理任务，请稍后再试');
      organizeInProgress.add(user.id);
      try { return { text: await manuscriptReader(jpeg) }; }
      catch { throw new HttpError(502, '手稿识别未完成，照片仍可保留并手动录入'); }
      finally { organizeInProgress.delete(user.id); }
    }
    if (method === 'POST' && path === '/api/preferences') {
      const city = clean(body.city, 30, '常住城市', true);
      const home = clean(body.home, 30, '家乡', true);
      requireValue(typeof body.personalized === 'boolean', 400, '请选择推荐偏好');
      run('INSERT OR REPLACE INTO preferences VALUES (?, ?, ?, ?)', user.id, city, home, Number(body.personalized));
      return preferences(user);
    }
    if (method === 'GET' && path === '/api/interactions') return interactions(user);
    if (method === 'POST' && path === '/api/interactions') {
      const { kind, active } = body;
      const target = clean(body.target, 100, '互动对象');
      const authorAction = kind === 'follow' || kind === 'block';
      requireValue(['like', 'save', 'follow', 'block'].includes(kind) && typeof active === 'boolean', 400, '互动类型不正确');
      if (active) {
        const exists = authorAction ? publicRecords().some(item => item.authorKey === target) : publicRecord(target);
        requireValue(exists, 404, '互动对象不存在');
        run('INSERT OR IGNORE INTO reactions VALUES (?, ?, ?)', user.id, kind, target);
      } else {
        run('DELETE FROM reactions WHERE user_id=? AND kind=? AND target=?', user.id, kind, target);
      }
      return interactions(user);
    }
    if (method === 'POST' && comments) {
      requireValue(publicRecord(comments[1]), 404, '菜谱不存在');
      const text = clean(body.text, 400, '评论');
      const id = randomUUID();
      run('INSERT INTO comments VALUES (?, ?, ?, ?, ?)', id, user.id, comments[1], text, Date.now());
      return { id, text };
    }
    if (method === 'POST' && path === '/api/reports') {
      const target = clean(body.target, 100, '举报对象');
      requireValue(publicRecord(target), 404, '菜谱不存在');
      run('INSERT OR IGNORE INTO reports VALUES (?, ?, ?, ?)', user.id, target, clean(body.reason, 400, '举报原因'), Date.now());
      return { ok: true };
    }
    const withdraw = path.match(/^\/api\/publications\/([^/]+)\/withdraw$/);
    if (method === 'POST' && withdraw) {
      requireValue(run(`UPDATE publications SET state='withdrawn' WHERE id=? AND recipe_id IN (
        SELECT id FROM recipes WHERE user_id=?)`, withdraw[1], user.id).changes, 404, '投稿不存在');
      return { ok: true };
    }
    if (path === '/api/review') {
      requireValue(equalSecret(request.headers['x-moderator-key'], moderatorKey), 403, '审核口令无效');
      if (method === 'GET') return {
        pending: all("SELECT id,snapshot,published_at FROM publications WHERE state='pending'").map(publicationView),
        reports: all('SELECT target,reason,created_at AS createdAt FROM reports ORDER BY created_at DESC'), ...kitchen.review(user)
      };
      if (method === 'POST') {
        requireValue(['approved', 'rejected'].includes(body.state), 400, '审核决定不正确');
        if (body.kind) return kitchen.moderate(body.kind, clean(body.id, 100, '投稿'), body.state);
        const now = Date.now();
        requireValue(run(`UPDATE publications SET state=?,published_at=?,reviewed_at=?,reviewer_id=? WHERE id=? AND state='pending'`,
          body.state, body.state === 'approved' ? now : null, now, user.id, clean(body.id, 100, '投稿')).changes, 409, '投稿已处理或不存在');
        return { ok: true };
      }
    }
    if (method === 'POST' && path === '/api/ai/organize') {
      requireValue(body.consent === true, 400, '请确认授权整理此段文字');
      const source = clean(body.source, 5_000, '原始资料');
      requireValue(organizer, 503, 'AI 整理尚未配置，可继续手动校对');
      requireValue(!organizeInProgress.has(user.id), 409, '已有整理请求正在进行');
      organizeInProgress.add(user.id);
      try {
        return await organizer(source);
      } catch {
        throw new HttpError(502, '整理暂未完成，原始资料仍可手动校对');
      } finally {
        organizeInProgress.delete(user.id);
      }
    }
    throw new HttpError(404, '接口不存在');
  }

  return {
    close: () => db.close(),
    async handle(request, response, url) {
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.setHeader('Cache-Control', 'no-store');
      try {
        const data = await route(request, url, cookie => response.setHeader('Set-Cookie', cookie));
        if (data?.mediaFile) sendMedia(request, response, data.mediaFile);
        else if (data instanceof Uint8Array) {
          response.setHeader('Content-Type', 'image/jpeg');
          response.setHeader('Content-Length', data.byteLength);
          response.end(data);
        } else {
          response.end(JSON.stringify(data));
        }
      } catch (error) {
        response.statusCode = error.status ?? 500;
        if (!error.status) console.error('API request failed:', error.code ?? error.name);
        response.end(JSON.stringify({ error: error.status ? error.message : '服务暂时不可用' }));
      }
    }
  };
}

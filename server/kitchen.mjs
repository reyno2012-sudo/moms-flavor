import { randomUUID } from 'node:crypto';
import { digest } from './auth.mjs';
import { decodeStoryPhoto } from './story-photos.mjs';

const meals = ['wish', 'breakfast', 'lunch', 'dinner', 'feast'];
const outcomes = ['成功复刻', '味道接近', '需要改进'];
const dayPattern = /^\d{4}-\d{2}-\d{2}$/;

export function createKitchen({ get, all, run, transaction, requireValue, clean, visibleRecipe, publicRecord }) {
  const member = (user, familyId) => user && get('SELECT role FROM members WHERE user_id=? AND family_id=?', user.id, familyId);
  const authorizeFamily = (user, id) => requireValue(member(user, id), 404, '家庭不存在');
  const recipeInFamily = (user, id, familyId) => {
    const recipe = visibleRecipe(user, id);
    return recipe && (recipe.visibility === 'public' || recipe.familyId === familyId) ? recipe : null;
  };

  function familyChecks(user) {
    return all(`SELECT c.recipe_id AS recipeId,c.question,c.answer,c.reviewer_id AS reviewerId,
      u.username AS reviewer FROM family_checks c JOIN recipes r ON r.id=c.recipe_id JOIN users u ON u.id=c.reviewer_id
      JOIN members m ON m.family_id=c.family_id AND m.user_id=? WHERE r.family_id=c.family_id ORDER BY c.created_at DESC`, user.id)
      .map(({ reviewerId, ...item }) => ({ ...item, assignedToMe: reviewerId === user.id }));
  }

  function checkRecipe(user, body) {
    const recipe = visibleRecipe(user, clean(body.recipeId, 100, '菜谱'));
    requireValue(recipe?.familyId, 404, '家庭菜谱不存在');
    if (body.answer !== undefined) {
      requireValue(run('UPDATE family_checks SET answer=? WHERE recipe_id=? AND reviewer_id=? AND family_id=?',
        clean(body.answer, 1200, '校对反馈'), recipe.id, user.id, recipe.familyId).changes, 404, '校对邀请不存在');
    } else {
      requireValue(recipe.own, 403, '只有记录人可以发起校对');
      const reviewer = get(`SELECT u.id FROM users u JOIN members m ON m.user_id=u.id
        WHERE m.family_id=? AND u.username=? AND u.id<>?`, recipe.familyId, clean(body.reviewer, 32, '家人'), user.id);
      requireValue(reviewer, 404, '请从当前家庭选择校对人');
      requireValue(run('INSERT OR IGNORE INTO family_checks VALUES (?, ?, ?, ?, NULL, ?)', recipe.id, recipe.familyId, reviewer.id,
        clean(body.question, 600, '校对问题'), Date.now()).changes, 409, '此家人已经有这道菜的校对记录');
    }
    return familyChecks(user);
  }

  function canSeeRecreation(row, user, moderator = false) {
    if (row.user_id === user?.id) return true;
    const recipe = visibleRecipe(user, row.target_id);
    if (!recipe) return false;
    if (row.scope === 'family') return Boolean(recipe.familyId === row.family_id && member(user, row.family_id));
    return row.scope === 'public' && recipe.visibility === 'public' && (row.state === 'approved' || (moderator && row.state === 'pending'));
  }

  function recreationView(row, user) {
    const own = user?.id === row.user_id;
    const recipe = visibleRecipe(user, row.target_id);
    return { id: row.id, targetId: recipe?.id ?? null, recipeName: recipe?.name ?? '原菜谱暂不可访问',
      result: row.result, note: row.note, scope: row.scope, state: row.state, own,
      author: own ? '我' : row.scope === 'public' ? '家庭厨友' : row.username,
      photo: row.hasPhoto ? `/api/kitchen/recreations/${row.id}/photo` : '' };
  }

  const recreationSelect = `SELECT r.id,r.user_id,r.target_id,r.family_id,r.scope,r.state,r.result,r.note,r.created_at,
    r.photo IS NOT NULL AS hasPhoto,u.username FROM recreations r JOIN users u ON u.id=r.user_id`;

  function saveRecreation(user, body) {
    const target = visibleRecipe(user, clean(body.targetId, 100, '菜谱'));
    requireValue(target, 404, '菜谱不存在');
    requireValue(outcomes.includes(body.result) && ['private', 'family', 'public'].includes(body.scope), 400, '请选择复刻结果和可见范围');
    requireValue(body.scope !== 'family' || Boolean(target.familyId), 400, '请选择家庭菜谱');
    requireValue(body.scope !== 'public' || (target.visibility === 'public' && body.consent === true), 400, '请确认将复刻提交公开审核');
    const requestId = clean(body.requestId, 100, '保存标识');
    const note = clean(body.note ?? '', 1200, '复刻心得', true);
    const photo = body.photo ? decodeStoryPhoto(body.photo) : null;
    requireValue(!body.photo || photo, 400, '复刻照片无效');
    const id = randomUUID();
    run('INSERT OR IGNORE INTO recreations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', id, user.id, requestId, target.id,
      body.scope === 'family' ? target.familyId : null, body.scope, body.scope === 'public' ? 'pending' : 'approved', body.result, note, photo, Date.now());
    const stored = get(`${recreationSelect} WHERE r.user_id=? AND r.request_id=?`, user.id, requestId);
    const originalPhoto = get('SELECT photo FROM recreations WHERE id=?', stored.id).photo;
    requireValue(stored.target_id === target.id && stored.scope === body.scope && stored.result === body.result && stored.note === note
      && (photo ? originalPhoto && photo.equals(originalPhoto) : !originalPhoto), 409, '此保存标识已用于其他复刻');
    return recreationView(stored, user);
  }

  function period(start) {
    const stamp = Date.parse(`${start}T00:00:00Z`);
    requireValue(dayPattern.test(start ?? '') && Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === start,
      400, '请选择有效日期');
    return Array.from({ length: 7 }, (_, index) => new Date(stamp + index * 86400000).toISOString().slice(0, 10));
  }

  function menu(user, familyId, start) {
    authorizeFamily(user, familyId);
    const days = period(start);
    const entries = all(`SELECT m.id,m.day,m.slot,m.recipe_id AS recipeId,m.user_id AS addedBy,u.username
      FROM family_meals m JOIN users u ON u.id=m.user_id WHERE m.family_id=? AND m.day BETWEEN ? AND ? ORDER BY m.day,m.rowid`,
    familyId, days[0], days.at(-1)).flatMap(({ addedBy, ...item }) => {
      const recipe = recipeInFamily(user, item.recipeId, familyId);
      return recipe ? [{ ...item, name: recipe.name, ingredients: recipe.cooking?.ingredients ?? [], removable: item.slot !== 'wish' || addedBy === user.id }] : [];
    });
    const checks = new Set(all('SELECT item_key FROM shopping_checks WHERE family_id=? AND period=?', familyId, start).map(row => row.item_key));
    const items = new Map();
    for (const entry of entries.filter(item => item.slot !== 'wish')) {
      for (const ingredient of entry.ingredients) {
        const { name, amount, unit } = ingredient;
        const numeric = /^\d{1,8}(?:\.\d{1,6})?$/.test(amount);
        const key = digest(JSON.stringify([name, unit, numeric ? 'numeric' : amount]));
        const item = items.get(key) ?? { key, name, amount, unit, numeric, recipes: new Set() };
        if (items.has(key) && numeric) item.amount = String(Number((Number(item.amount) + Number(amount)).toFixed(6)));
        item.recipes.add(entry.name);
        items.set(key, item);
      }
    }
    return { days, entries: entries.map(({ ingredients, ...entry }) => entry), shopping: [...items.values()].map(({ recipes, ...item }) => {
      const key = digest(JSON.stringify([item.key, item.amount]));
      return { ...item, key, recipes: [...recipes], checked: checks.has(key) };
    }) };
  }

  function saveMenu(user, body) {
    const familyId = clean(body.familyId, 100, '家庭');
    authorizeFamily(user, familyId);
    const start = clean(body.start, 10, '起始日期');
    const days = period(start);
    if (body.remove) {
      requireValue(run("DELETE FROM family_meals WHERE id=? AND family_id=? AND (slot<>'wish' OR user_id=?)",
        clean(body.remove, 100, '菜单项'), familyId, user.id).changes, 404, '菜单项不存在');
    } else if (body.itemKey !== undefined) {
      const item = menu(user, familyId, start).shopping.find(value => value.key === body.itemKey);
      requireValue(item && typeof body.checked === 'boolean', 400, '采购清单已变化，请重新加载');
      if (body.checked) run('INSERT OR IGNORE INTO shopping_checks VALUES (?, ?, ?)', familyId, start, item.key);
      else run('DELETE FROM shopping_checks WHERE family_id=? AND period=? AND item_key=?', familyId, start, item.key);
    } else {
      const recipe = recipeInFamily(user, clean(body.recipeId, 100, '菜谱'), familyId);
      requireValue(recipe && meals.includes(body.slot) && days.includes(body.day), 400, '请选择有效的日期、餐次和菜谱');
      run('INSERT OR IGNORE INTO family_meals VALUES (?, ?, ?, ?, ?, ?)', randomUUID(), familyId, body.day, body.slot, recipe.id, user.id);
    }
    return menu(user, familyId, start);
  }

  function cookbookAllowed(row, user) {
    if (!row) return false;
    return row.family_id ? Boolean(member(user, row.family_id)) : row.state === 'approved' || row.user_id === user?.id;
  }

  function cookbookRecipe(row, user, id) {
    if (row.state !== 'private') {
      const recipe = publicRecord(id);
      const blocked = recipe && user && get("SELECT 1 FROM reactions WHERE user_id=? AND kind='block' AND target=?", user.id, recipe.authorKey);
      return recipe?.city === row.city && !blocked ? recipe : null;
    }
    return row.family_id ? recipeInFamily(user, id, row.family_id) : visibleRecipe(user, id);
  }

  function cookbookView(row, user, complete = false) {
    const recipes = all('SELECT recipe_id FROM cookbook_recipes WHERE cookbook_id=? ORDER BY position', row.id)
      .map(item => cookbookRecipe(row, user, item.recipe_id)).filter(Boolean);
    return { id: row.id, title: row.title, introduction: row.introduction, city: row.city, state: row.state,
      familyId: row.family_id, own: row.user_id === user?.id, count: recipes.length,
      recipes: complete ? recipes : recipes.map(({ id, name }) => ({ id, name })) };
  }

  function saveCookbook(user, body) {
    const publish = body.scope === 'public';
    const familyId = body.scope === 'family' ? clean(body.familyId, 100, '家庭') : null;
    requireValue(['public', 'family', 'private'].includes(body.scope), 400, '请选择菜谱册范围');
    if (familyId) authorizeFamily(user, familyId);
    requireValue(!publish || body.consent === true, 400, '请确认提交专题审核');
    const title = clean(body.title, 90, '菜谱册标题');
    const introduction = clean(body.introduction ?? '', 1000, '介绍', true);
    const city = publish ? clean(body.city, 30, '专题地区') : '';
    const ids = body.recipeIds;
    requireValue(Array.isArray(ids) && ids.length >= 1 && ids.length <= 60 && new Set(ids).size === ids.length
      && ids.every(id => typeof id === 'string' && id.length <= 100), 400, '请选择 1 至 60 道菜谱');
    const id = clean(body.requestId, 100, '保存标识');
    requireValue(/^[a-zA-Z0-9_-]+$/.test(id), 400, '保存标识格式不正确');
    const row = { id, user_id: user.id, family_id: familyId, title, introduction, city, state: publish ? 'pending' : 'private' };
    return transaction(() => {
      requireValue(ids.every(recipeId => cookbookRecipe(row, user, recipeId)), 400, '所选菜谱不可见或不在专题地区');
      const previous = get('SELECT * FROM cookbooks WHERE id=?', id);
      if (previous) {
        const oldIds = all('SELECT recipe_id FROM cookbook_recipes WHERE cookbook_id=? ORDER BY position', id).map(item => item.recipe_id);
        requireValue(previous.user_id === user.id && previous.family_id === familyId && previous.city === city && previous.title === title
          && previous.introduction === introduction && JSON.stringify(oldIds) === JSON.stringify(ids), 409, '此保存标识已用于其他菜谱册');
        return cookbookView(previous, user, true);
      }
      run('INSERT INTO cookbooks VALUES (?, ?, ?, ?, ?, ?, ?, ?)', id, user.id, familyId, title, introduction, city, row.state, Date.now());
      ids.forEach((recipeId, index) => run('INSERT INTO cookbook_recipes VALUES (?, ?, ?)', id, recipeId, index));
      return cookbookView(row, user, true);
    });
  }

  return {
    review(user) {
      return {
        recreations: all(`${recreationSelect} WHERE r.state='pending'`).filter(item => canSeeRecreation(item, user, true)).map(item => recreationView(item, user)),
        cookbooks: all("SELECT * FROM cookbooks WHERE state='pending'").map(row => cookbookView(row, user))
      };
    },
    moderate(kind, id, state) {
      if (kind === 'recreation') {
        const row = get("SELECT target_id FROM recreations WHERE id=? AND scope='public' AND state='pending'", id);
        requireValue(row && (state !== 'approved' || publicRecord(row.target_id)), 409, '待审核复刻或原菜谱已不可用');
        run('UPDATE recreations SET state=? WHERE id=?', state, id);
      } else {
        requireValue(kind === 'cookbook', 400, '审核对象无效');
        const row = get("SELECT * FROM cookbooks WHERE id=? AND state='pending'", id);
        requireValue(row && (state !== 'approved' || cookbookView(row, null).count), 409, '专题已处理或没有可公开的菜谱');
        run('UPDATE cookbooks SET state=? WHERE id=?', state, id);
      }
      return { ok: true };
    },
    async route(url, method, user, readBody, moderator) {
      const [, , , section, id, action] = url.pathname.split('/');
      if (method === 'GET' && section === 'cookbooks') {
        if (!id) return all('SELECT * FROM cookbooks ORDER BY created_at DESC').filter(row => cookbookAllowed(row, user))
          .map(row => cookbookView(row, user)).filter(row => row.state !== 'approved' || row.count > 0);
        const row = get('SELECT * FROM cookbooks WHERE id=?', id);
        requireValue(cookbookAllowed(row, user), 404, '菜谱册不存在');
        const view = cookbookView(row, user, true);
        requireValue(view.own || view.state !== 'approved' || view.count, 404, '专题暂不可见');
        return view;
      }
      if (method === 'GET' && section === 'recreations') {
        if (id && action === 'photo') {
          const row = get('SELECT * FROM recreations WHERE id=?', id);
          requireValue(row?.photo && canSeeRecreation(row, user, moderator), 404, '照片不存在');
          return row.photo;
        }
        const target = url.searchParams.get('target');
        if (target) requireValue(visibleRecipe(user, target), 404, '菜谱不存在');
        else requireValue(user, 401, '请先登录');
        const items = target ? all(`${recreationSelect} WHERE r.target_id=? ORDER BY r.created_at DESC`, target)
          : all(`${recreationSelect} WHERE r.user_id=? ORDER BY r.created_at DESC`, user.id);
        return items.filter(row => canSeeRecreation(row, user)).map(row => recreationView(row, user));
      }
      requireValue(user, 401, '请先登录');
      if (method === 'GET' && section === 'checks') return familyChecks(user);
      if (method === 'GET' && section === 'menu') return menu(user, url.searchParams.get('family'), url.searchParams.get('start'));
      requireValue(method === 'POST', 404, '接口不存在');
      const body = await readBody(section === 'recreations' ? 1_050_000 : undefined);
      if (section === 'checks') return checkRecipe(user, body);
      if (section === 'menu') return saveMenu(user, body);
      if (section === 'cookbooks' && !id) return saveCookbook(user, body);
      if (section === 'cookbooks' && action === 'entries') {
        const row = get("SELECT * FROM cookbooks WHERE id=? AND state='private'", id);
        requireValue(cookbookAllowed(row, user), 404, '菜谱册不存在');
        const recipeId = clean(body.recipeId, 100, '菜谱');
        return transaction(() => {
          if (body.remove === true) run('DELETE FROM cookbook_recipes WHERE cookbook_id=? AND recipe_id=?', id, recipeId);
          else {
            requireValue(cookbookRecipe(row, user, recipeId), 404, '此菜谱不可加入');
            const entries = get('SELECT count(*) AS count,coalesce(max(position),-1) AS last FROM cookbook_recipes WHERE cookbook_id=?', id);
            requireValue(entries.count < 60 || get('SELECT 1 FROM cookbook_recipes WHERE cookbook_id=? AND recipe_id=?', id, recipeId), 409, '菜谱册最多收录 60 道菜');
            run('INSERT OR IGNORE INTO cookbook_recipes VALUES (?, ?, ?)', id, recipeId, entries.last + 1);
          }
          return cookbookView(row, user, true);
        });
      }
      if (section === 'recreations' && !id) return saveRecreation(user, body);
      if (action === 'withdraw' && (section === 'cookbooks' || section === 'recreations')) {
        const table = section === 'cookbooks' ? 'cookbooks' : 'recreations';
        requireValue(run(`UPDATE ${table} SET state='withdrawn' WHERE id=? AND user_id=? AND state IN ('pending','approved')`, id, user.id).changes,
          404, '没有可撤回的内容');
        return { ok: true };
      }
      requireValue(false, 404, '接口不存在');
    }
  };
}

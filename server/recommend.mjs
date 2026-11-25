import { feed } from '../src/model.js';

const day = 86_400_000;

export function recommend(records, filters, preference, metrics, now = Date.now()) {
  const candidate = feed(records.filter(recipe => !filters.blocked.includes(recipe.authorKey)), filters);
  if (filters.tab === '最新' || filters.tab === '关注' || !preference.personalized) {
    return candidate.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
  }

  const score = recipe => {
    const age = Math.max(0, (now - recipe.createdAt) / day);
    const signals = metrics.get(recipe.id) ?? { likes: 0, saves: 0 };
    return 2 / (1 + age / 14) + Math.log1p(signals.likes + 2 * signals.saves)
      + (recipe.city === preference.city ? 1.5 : 0) + (recipe.city === preference.home ? 1 : 0)
      + (filters.followed.includes(recipe.authorKey) ? 1 : 0);
  };

  const ranked = candidate.map(recipe => ({ recipe, score: score(recipe) }));
  const byScore = (a, b) => b.score - a.score || b.recipe.createdAt - a.recipe.createdAt || a.recipe.id.localeCompare(b.recipe.id);
  const authorCounts = new Map();
  for (const entry of ranked.sort(byScore)) {
    const key = entry.recipe.authorKey;
    const previous = authorCounts.get(key) ?? 0;
    entry.score -= previous * 0.8;
    authorCounts.set(key, previous + 1);
  }
  return ranked.sort(byScore).map(entry => entry.recipe);
}

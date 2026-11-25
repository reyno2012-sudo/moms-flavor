import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { BlockList, isIP } from 'node:net';

const restricted = new BlockList();
for (const [address, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3]]) restricted.addSubnet(address, bits);

export function sourceUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.port || url.username || url.password || !url.hostname.includes('.')
    || url.hostname.endsWith('.') || isIP(url.hostname)) throw new Error('请输入公开的 HTTPS 菜谱链接');
  url.hash = '';
  return url;
}

const plain = value => typeof value === 'string' ? value.replace(/<[^>]*>/g, ' ')
  .replace(/&(?:amp|lt|gt|quot|nbsp|#39);/g, entity => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&nbsp;': ' ', '&#39;': "'" })[entity]).trim() : '';
const steps = value => Array.isArray(value) ? value.flatMap(steps)
  : typeof value === 'string' ? value.split(/\n+/).map(plain).filter(Boolean)
    : value?.itemListElement ? steps(value.itemListElement) : steps(plain(value?.text));

function findRecipe(node) {
  if (Array.isArray(node)) {
    for (const value of node) {
      const recipe = findRecipe(value);
      if (recipe) return recipe;
    }
  } else if (node && typeof node === 'object') {
    if ([node['@type']].flat().some(type => typeof type === 'string' && /(?:^|\/)Recipe$/.test(type))) return node;
    return findRecipe(node['@graph']);
  }
}

export function parseRecipePage(html) {
  for (const match of html.matchAll(/<script\b[^>]*\btype\s*=\s*['"]application\/ld\+json['"][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data;
    try { data = JSON.parse(match[1]); } catch { continue; }
    const recipe = findRecipe(data);
    if (!recipe || !plain(recipe.name)) continue;
    const ingredients = Array.isArray(recipe.recipeIngredient) ? recipe.recipeIngredient.map(plain).filter(Boolean) : [];
    return { name: plain(recipe.name).slice(0, 90), ingredientsText: ingredients.join('\n').slice(0, 4000),
      stepsText: steps(recipe.recipeInstructions).join('\n').slice(0, 6000) };
  }
  throw new Error('这个页面没有可导入的结构化菜谱，可以复制文字到记录页。');
}

async function download(url, signal) {
  const addresses = await lookup(url.hostname, { family: 4, all: true });
  if (!addresses.length || addresses.some(({ address }) => restricted.check(address))) throw new Error('这个地址无法作为公开菜谱链接读取');
  return new Promise((resolve, reject) => {
    const options = { signal, headers: { Accept: 'text/html', 'User-Agent': 'MomsFlavor Recipe Import' },
      lookup: (_host, settings, callback) => settings.all ? callback(null, addresses) : callback(null, addresses[0].address, 4) };
    const upstream = request(url, options, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        resolve({ redirect: response.headers.location });
        response.destroy();
        return;
      }
      if (response.statusCode !== 200 || !/^text\/html\b/i.test(response.headers['content-type'] ?? '')) {
        reject(new Error('无法读取这个菜谱页面，可以复制文字到记录页。'));
        response.destroy();
        return;
      }
      const chunks = [];
      let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > 2_000_000) upstream.destroy(new Error('页面过大，可以复制文字到记录页。'));
        else chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => resolve({ html: Buffer.concat(chunks).toString('utf8') }));
    });
    upstream.on('error', reject);
    upstream.end();
  });
}

export async function importRecipeLink(value) {
  const original = sourceUrl(value);
  let url = original;
  const signal = AbortSignal.timeout(8000);
  for (let count = 0; count <= 3; count++) {
    const page = await download(url, signal);
    if (page.html !== undefined) return { ...parseRecipePage(page.html), sourceUrl: original.href };
    url = sourceUrl(new URL(page.redirect, url).href);
  }
  throw new Error('链接跳转次数过多，可以复制文字到记录页。');
}

import { enrichExample } from './example-recipes.js';

export const cuisines = ['川菜', '粤菜', '鄂菜', '其他'];
const exampleCuisines = { 重庆: '川菜', 深圳: '粤菜', 宜昌: '鄂菜', 武汉: '鄂菜' };
const exampleStories = {
  cq1: '小时候，我家的早晨是拌面碗里那一声响。妈妈先在碗底拌好调料，等水开的时候，把葱切得细细的。她总用同一只蓝边碗，说大一点才拌得开。\n\n后来我搬到外地，打电话问她配方。她说：「你先尝一口，缺什么再添。」我最先学会的就是这句。',
  sz1: '以前家里来客，妈妈会把刚斩好的豉油鸡端到桌子中央。她总在盛饭前把鸡汁舀进小碗，怕有人想拌饭，伸手却够不着。\n\n我后来也留一碗鸡汁。家里谁坐近一点，谁负责传。',
  yc1: '放学经过老街，隔着半条巷子就能闻到炸萝卜饺子的香气。外婆把纸袋递给我，总要我先掰开一只，等热气散了再吃。\n\n我现在每回自己炸，第一只也先掰开。',
  cq2: '我们家凑齐人的那天，舅舅会把矮凳搬出来，留着给最后到的人。火锅一开，大家先问谁吃得了辣，然后把菜往各自那边拨。\n\n吃到最后，桌上总剩几双筷子，谁都还想多坐一会儿。',
  wh1: '外婆煨汤时，会把抓一把葱这件小事交给我。我在院子里摘回来，她从不嫌我摘得少，只叫我把手洗干净。\n\n汤煨好，她先装一碗排骨和藕，让我给楼上的邻居端去。',
  sz2: '奶奶把酿豆腐排成两列，留一个空位给我的那块。我的馅总塞太多，豆腐裂了，她就让裂口朝上煎，说照样能吃。',
  wh2: '离开武汉后，我第一次在家给自己拌热干面，把芝麻酱调得太稠。爸爸听我在电话里抱怨，先问我想不想听他小时候吃面的事。我们聊完，面也凉了，倒一点没剩。',
  yc2: '小时候午睡起来，桌上会有一碗刚从冰箱拿出来的凉虾。妈妈用两只碗，一只给我，一只等妹妹醒。红糖水少的那碗，我总以为是自己的。'
};
export const seed=[
['cq1','妈妈做了二十年的重庆小面','重庆','山城阿梅','面食',1280,'🍜','在家也能复刻的山城味道。'],
['sz1','广东妈妈的家常豉油鸡','深圳','阿芳的厨房','家常菜',986,'🍗','满满的广式风味。'],
['yc1','宜昌老街的萝卜饺子','宜昌','三峡人家','小吃',862,'🥟','小时候放学路上的那一口。'],
['cq2','在家复刻重庆牛油火锅','重庆','山城阿梅','家常菜',758,'🍲','一家人围坐在一起的快乐。'],
['wh1','外婆的莲藕排骨汤','武汉','江城小厨房','汤羹',632,'🥣','湖北人家的一锅暖汤。'],
['sz2','深圳客家酿豆腐','深圳','客家小院','家常菜',528,'🍱','从长辈手里传下来的做法。'],
['wh2','武汉家庭版热干面','武汉','江城小厨房','面食',486,'🍜','属于江城的早餐记忆。'],
['yc2','夏天必吃的宜昌凉虾','宜昌','三峡人家','小吃',356,'🍧','一碗清甜的家乡记忆。']
].map(([id,name,city,author,tag,likes,emoji,desc],i)=>({id,name,city,author,tag,cuisine:exampleCuisines[city],likes,emoji,desc,
  story: exampleStories[id], ...(id === 'cq1' ? { photos: [{ url: '/src/assets/xiaomian-story.jpg', caption: '清晨，妈妈在厨房拌一碗小面。' }] } : {}),
  visibility:'public',createdAt:8-i})).map(enrichExample);
export const familySeed=[{id:'f1',name:'妈妈的红烧肉',author:'妈妈',city:'家乡',tag:'家常菜',emoji:'🍖',visibility:'family',likes:0},{id:'f2',name:'外婆的蒸鸡蛋',author:'外婆',city:'家乡',tag:'家常菜',emoji:'🥚',visibility:'family',likes:0}].map(enrichExample);
export function feed(records, {city = '', cuisine = '', search = '', tag = '全部', tab = '推荐', followed = [], liked = [], preserveOrder = false} = {}) {
  const query = search.trim().toLowerCase();
  const matches = records.filter(r => r.visibility === 'public' && (!city || r.city === city) && (!cuisine || r.cuisine === cuisine)
    && (tag === '全部' || r.tag === tag) && (tab !== '关注' || followed.includes(r.authorKey ?? r.author))
    && [r.name, r.city, r.author, r.tag, r.cuisine, r.story].join(' ').toLowerCase().includes(query));
  if (preserveOrder && tab === '推荐') return matches;
  return matches.sort((a,b) => tab === '最新' || (preserveOrder && tab === '关注') ? b.createdAt-a.createdAt
    : (b.likes+(liked.includes(b.id)?1:0))-(a.likes+(liked.includes(a.id)?1:0)));
}
export function publishDraft(draft){if(!draft.name.trim()||!draft.author.trim()||!draft.confirmed)throw Error('请完成菜谱校对');if(draft.visibility==='public'&&!draft.consent)throw Error('请明确确认公开');const {name,city,tag,visibility}=draft;return {id:globalThis.crypto?.randomUUID?.()||`r${Date.now()}`,name:name.trim(),city,tag,visibility,author:visibility==='public'?'我的厨房':draft.author.trim(),desc:visibility==='public'?'家庭菜谱分享（演示）':draft.note,emoji:'🍽️',likes:0,createdAt:Date.now()};}

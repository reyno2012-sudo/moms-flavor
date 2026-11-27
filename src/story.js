import { btn, check, esc } from './ui.js';
import { storyLimits } from './story-limits.js';
import { publicMediaOptions } from './recipe-media.js';

export function hasStory(recipe) {
  return Boolean(recipe.story?.trim() || recipe.photos?.length || recipe.media?.length);
}

export function storyArticle(recipe, metadata = '', fallbackCover = '') {
  const [cover, ...gallery] = recipe.photos ?? [];
  const paragraphs = (recipe.story ?? '').trim().split(/\n[\t ]*\n+/).filter(Boolean);
  const title = recipe.demo && recipe.id === 'cq1' ? recipe.name.replace('重庆小面', '\n重庆小面') : recipe.name;
  return `<article class="story-article" aria-label="菜谱故事">
    <header class="story-masthead"><h2>${esc(title)}</h2>${metadata}</header>
    ${cover ? storyFigure(cover, 0, 'story-cover') : fallbackCover}
    ${paragraphs.length ? `<div class="story-prose">${paragraphs.map(text => `<p>${esc(text)}</p>`).join('')}</div>` : ''}
    ${gallery.length ? `<div class="story-gallery">${gallery.map((photo, index) => storyFigure(photo, index + 1)).join('')}</div>` : ''}
    ${recipe.demo ? '<p class="story-credit">示例故事，配图由 AI 生成。</p>' : ''}
  </article>`;
}

function storyFigure(photo, index, classes = '') {
  return `<figure class="story-figure ${classes}"><img src="${esc(photo.url)}" alt="${esc(photo.caption || `故事照片 ${index + 1}`)}"
    ${index ? 'loading="lazy"' : ''} decoding="async">${photo.caption ? `<figcaption>${esc(photo.caption)}</figcaption>` : ''}</figure>`;
}

export function draftStory(draft, isPublic = false) {
  return {
    name: draft.name.trim(),
    story: isPublic && !draft.publicStory ? '' : draft.story.trim(),
    photos: draft.photoUploads.flatMap((photo, index) => isPublic && !draft.publicPhotoIndexes.includes(index) ? []
      : [{ url: `data:image/jpeg;base64,${photo.data}`, caption: photo.caption.trim() }]),
    media: draft.mediaUploads.filter((clip, index) => !isPublic || draft.publicMediaIndexes.includes(index))
  };
}

export function storyFields(draft) {
  return `<section class="story-fields" aria-labelledby="story-fields-title">
    <div><h2 id="story-fields-title">这道菜的故事</h2><p>谁教你做这道菜？哪一次吃它，让你一直记得？</p></div>
    <label class="field">故事正文<textarea data-field="draft.story" maxlength="${storyLimits.text}"
      placeholder="那天一进家门，就闻见……">${esc(draft.story)}</textarea></label>
    ${draft.photoUploads.length < storyLimits.photos ? `<label class="field story-pick">添加故事照片
      <input type="file" data-field="storyPhotos" accept="image/jpeg,image/png,image/webp" multiple>
      <small data-upload-status role="status">最多 ${storyLimits.photos} 张，支持 JPG、PNG、WebP。第一张用作封面。</small></label>` : ''}
    ${draft.photoUploads.map((photo, index) => `<div class="draft-photo">
      <img src="data:image/jpeg;base64,${esc(photo.data)}" alt="${index === 0 ? '故事封面' : `故事照片 ${index + 1}`}" decoding="async">
      <div class="draft-photo-info"><label class="field">${index === 0 ? '封面说明' : `照片 ${index + 1} 说明`}（选填）
      <input data-caption="${index}" maxlength="${storyLimits.caption}" value="${esc(photo.caption)}"></label>
      ${btn('移除照片', 'removeStoryPhoto', String(index), 'text-button')}</div></div>`).join('')}
    ${btn('生成故事预览', 'previewStory', '', 'secondary')}
  </section>`;
}

export function storyShareOptions(draft) {
  if (!draft.story.trim() && !draft.photoUploads.length && !draft.mediaUploads.length) return '';
  return `<fieldset class="story-share"><legend>把哪些内容放进公开页？</legend>
    ${draft.story.trim() ? check('draft.publicStory', draft.publicStory, '公开故事正文') : ''}
    ${draft.photoUploads.map((photo, index) => `<label class="check share-photo">
      <input type="checkbox" data-public-photo="${index}" ${draft.publicPhotoIndexes.includes(index) ? 'checked' : ''}>
      <img src="data:image/jpeg;base64,${esc(photo.data)}" alt="" decoding="async">
      <span>公开照片 ${index + 1}${photo.caption.trim() ? `（含说明：${esc(photo.caption.trim())}）` : ''}</span></label>`).join('')}
    ${publicMediaOptions(draft.mediaUploads, draft.publicMediaIndexes)}
    ${btn('预览公开故事', 'previewStory', 'public', 'secondary')}
  </fieldset>`;
}

export async function prepareStoryPhoto(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('请选择 JPG、PNG 或 WebP 照片');
  if (file.size > 15 * 1024 * 1024) throw new Error('单张原图需小于 15 MB');
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('无法读取照片，请重新选择');
  }
  try {
    const scale = Math.min(1, storyLimits.photoEdge / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d', { alpha: false });
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const limit = Math.ceil(storyLimits.photoBytes / 3) * 4;
    for (const quality of [0.86, 0.74, 0.60, 0.45]) {
      const data = canvas.toDataURL('image/jpeg', quality).split(',')[1];
      if (data?.length && data.length <= limit) return { data, caption: '' };
    }
    throw new Error('照片压缩后仍过大，请换一张');
  } finally {
    bitmap.close();
  }
}

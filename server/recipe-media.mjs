import { mediaLimits, voiceTypes, videoTypes } from '../src/media-limits.js';

export function readMediaUploads(uploads = [], requireValue, clean) {
  requireValue(Array.isArray(uploads) && uploads.length <= mediaLimits.videos + 1, 400, '最多添加一条语音和四段视频');
  let total = 0;
  let voices = 0;
  const clips = uploads.map(item => {
    const voice = item?.kind === 'voice';
    requireValue(voice || ['step', 'memory'].includes(item?.kind), 400, '请选择有效的影音类型');
    const { kind, mime, data } = item;
    const limit = voice ? mediaLimits.voiceBytes : mediaLimits.videoBytes;
    requireValue((voice ? voiceTypes : videoTypes).includes(mime), 400, '影音文件格式不支持');
    requireValue(typeof data === 'string' && data.length > 0 && data.length <= Math.ceil(limit / 3) * 4,
      413, '单条影音文件过大或为空');
    const bytes = Buffer.from(data, 'base64');
    requireValue(bytes.length <= limit && bytes.toString('base64') === data && matchesType(bytes, mime), 400, '影音文件无法识别');
    total += bytes.length;
    if (voice) voices++;
    const step = kind === 'step' ? item.step : null;
    requireValue(kind !== 'step' || Number.isInteger(step) && step >= 1 && step <= 99, 400, '视频步骤需为 1 到 99');
    return { bytes, kind, mime, step, caption: clean(item.caption ?? '', mediaLimits.caption, '影音说明', true) };
  });
  requireValue(voices <= 1 && clips.length - voices <= mediaLimits.videos, 400, '最多添加一条语音和四段视频');
  requireValue(total <= mediaLimits.totalBytes, 413, '语音和视频总大小需在 24 MB 内');
  return clips;
}

function matchesType(bytes, mime) {
  const marker = (text, offset) => bytes.subarray(offset, offset + text.length).toString('ascii') === text;
  switch (mime.split('/')[1]) {
    case 'mp4':
    case 'quicktime':
      return bytes.length >= 16 && marker('ftyp', 4) && bytes.readUInt32BE(0) >= 16 && bytes.readUInt32BE(0) <= bytes.length;
    case 'webm':
      return bytes.length > 16 && bytes.readUInt32BE(0) === 0x1a45dfa3 && bytes.subarray(0, 64).includes('webm');
    case 'mpeg':
      return bytes.length > 10 && (marker('ID3', 0) || bytes[0] === 255 && (bytes[1] & 224) === 224);
    case 'ogg':
      return bytes.length > 27 && marker('OggS', 0);
    case 'wav':
      return bytes.length > 44 && marker('RIFF', 0) && marker('WAVE', 8);
    default:
      return false;
  }
}

export function mediaLinks(base, clips) {
  return clips.map(({ kind, step, caption }, index) => ({ kind, step, caption, url: `${base}/${index}` }));
}

export function sendMedia(request, response, { bytes, mime }) {
  const length = bytes.byteLength;
  response.setHeader('Content-Type', mime);
  response.setHeader('Accept-Ranges', 'bytes');
  const range = request.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, length - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(length - 1, Number(range[2])) : length - 1;
    if (start > end || start >= length) {
      response.statusCode = 416;
      response.setHeader('Content-Range', `bytes */${length}`);
      return response.end();
    }
    response.statusCode = 206;
    response.setHeader('Content-Range', `bytes ${start}-${end}/${length}`);
    response.setHeader('Content-Length', end - start + 1);
    return response.end(request.method === 'HEAD' ? undefined : bytes.subarray(start, end + 1));
  }
  response.setHeader('Content-Length', length);
  response.end(request.method === 'HEAD' ? undefined : bytes);
}

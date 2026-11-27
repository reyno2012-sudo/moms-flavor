import { btn, esc } from './ui.js';
import { mediaLimits, voiceTypes, videoTypes } from './media-limits.js';

const clipName = clip => clip.kind === 'voice' ? '做菜人的声音'
  : clip.kind === 'step' ? `第 ${clip.step} 步视频` : '那天的厨房';

function player(clip) {
  const source = `src="${esc(clip.url)}" controls preload="metadata" aria-label="${esc(clipName(clip))}"`;
  return clip.kind === 'voice' ? `<audio ${source}></audio>` : `<video ${source} playsinline></video>`;
}

export function mediaView(clips = [], group = 'all') {
  const shown = clips.filter(clip => group === 'all' || (clip.kind === 'voice') === (group === 'voice'));
  if (!shown.length) return '';
  const ordered = [...shown].sort((left, right) =>
    (left.kind === 'memory' ? 100 : left.step ?? 0) - (right.kind === 'memory' ? 100 : right.step ?? 0));
  return `<section class="panel recipe-media"><h3>${group === 'voice' ? '听做菜人讲' : group === 'videos' ? '厨房里的视频' : '语音和视频'}</h3>
    ${ordered.map(clip => `<div class="media-clip"><strong>${esc(clipName(clip))}</strong>${player(clip)}
    ${clip.caption ? `<p>${esc(clip.caption)}</p>` : ''}</div>`).join('')}</section>`;
}

export function mediaEditor(clips) {
  const canRecord = Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
  const videos = clips.filter(clip => clip.kind !== 'voice').length;
  return `<section class="story-fields recipe-media"><h2>语音和厨房视频</h2>
    <p>录下做菜人的原声，也可以补几段做法或当天的厨房片段。</p>
    ${canRecord ? '<button type="button" class="secondary hold-voice" data-hold-voice aria-describedby="voice-help">🎙 按住录音</button>' : ''}
    <small id="voice-help" data-voice-status role="status">${canRecord ? '松手结束，最长 60 秒。键盘按一次开始，再按一次停止。' : '可以上传手机里已有的录音。'}</small>
    <label class="field">上传录音（替换当前语音）<input type="file" data-field="voiceFile" accept="${voiceTypes.join(',')},.m4a,.mp3,.wav"></label>
    ${videos < mediaLimits.videos ? `<div class="video-pickers">
      <label class="field">拍摄厨房视频<input type="file" accept="video/*" capture="environment" data-field="videoFile"></label>
      <label class="field">选择已有视频<input type="file" accept="${videoTypes.join(',')},.mov" data-field="videoFile"></label>
      <small>一共可添加四段视频，单段 12 MB 以内，影音合计 24 MB 以内。</small></div>` : ''}
    ${clips.map((clip, index) => `<div class="panel media-clip">${player(clip)}
      ${clip.kind !== 'voice' ? `<label class="field">视频用途<select data-media-index="${index}" data-media-key="kind">
        <option value="step"${clip.kind === 'step' ? ' selected' : ''}>制作步骤</option>
        <option value="memory"${clip.kind === 'memory' ? ' selected' : ''}>那天的厨房</option></select></label>` : ''}
      ${clip.kind === 'step' ? `<label class="field">对应第几步<input type="number" min="1" max="99" step="1"
        data-media-index="${index}" data-media-key="step" value="${clip.step}"></label>` : ''}
      <label class="field">说明（选填）<input data-media-index="${index}" data-media-key="caption"
        maxlength="${mediaLimits.caption}" value="${esc(clip.caption)}"></label>
      ${btn(clip.kind === 'voice' ? '移除录音' : '移除视频', 'removeMedia', index, 'text-button')}</div>`).join('')}</section>`;
}

export function publicMediaOptions(clips, selected) {
  return clips.map((clip, index) => `<label class="check share-photo"><input type="checkbox"
    data-public-media="${index}"${selected.includes(index) ? ' checked' : ''}>
    <span>公开${esc(clipName(clip))}${clip.caption.trim() ? `（含说明：${esc(clip.caption.trim())}）` : ''}</span></label>`).join('');
}

export function prepareClip(file, kind, clips) {
  const voice = kind === 'voice';
  const extension = file.name?.split('.').at(-1).toLowerCase();
  const aliases = { m4a: 'audio/mp4', mov: 'video/quicktime', mp4: voice ? 'audio/mp4' : 'video/mp4',
    mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', webm: voice ? 'audio/webm' : 'video/webm' };
  const type = file.type.split(';')[0];
  const mime = ['', 'application/octet-stream', 'audio/x-m4a', 'audio/x-wav'].includes(type) ? aliases[extension] : type;
  if (!(voice ? voiceTypes : videoTypes).includes(mime)) {
    throw new Error(voice ? '请选择 M4A、MP3、WAV、OGG 或 WebM 录音。' : '请选择 MP4、MOV 或 WebM 视频。');
  }
  const others = voice ? clips.filter(clip => clip.kind !== 'voice') : clips;
  if (!voice && others.filter(clip => clip.kind !== 'voice').length >= mediaLimits.videos) throw new Error('最多添加四段视频。');
  if (!file.size || file.size > (voice ? mediaLimits.voiceBytes : mediaLimits.videoBytes)) {
    throw new Error(voice ? '录音为空或超过 3 MB。' : '视频为空或超过 12 MB。');
  }
  if (others.reduce((size, clip) => size + clip.blob.size, file.size) > mediaLimits.totalBytes) throw new Error('影音合计需在 24 MB 内。');
  const step = kind === 'step' ? 1 + clips.filter(clip => clip.kind === 'step').length : null;
  return { kind, mime, step, caption: '', blob: file, url: URL.createObjectURL(new Blob([file], { type: mime })) };
}

export function mediaPayload(clips) {
  return Promise.all(clips.map(({ kind, mime, step, caption, blob }) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ kind, mime, step, caption, data: reader.result.split(',')[1] });
    reader.onerror = () => reject(new Error('无法读取影音文件，请重新选择。'));
    reader.readAsDataURL(blob);
  })));
}

export function bindVoiceRecorder(app, onClip, canStart) {
  let recording;
  const status = message => {
    const output = app.querySelector('[data-voice-status]');
    if (output) output.textContent = message;
  };
  const stopTracks = stream => stream.getTracks().forEach(track => track.stop());
  function stop(discard = false) {
    if (!recording) return;
    recording.discard ||= discard;
    if (recording.recorder?.state === 'recording') recording.recorder.stop();
    else if (!recording.recorder) {
      recording = null;
      status('再按住即可开始录音。');
    }
  }
  async function start(pointerId) {
    if (recording || !canStart()) return;
    const current = { pointerId };
    recording = current;
    status('正在等待麦克风授权…');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (recording !== current) return stopTracks(stream);
      current.stream = stream;
      const mimeType = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/ogg;codecs=opus']
        .find(type => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
      current.recorder = recorder;
      const chunks = [];
      recorder.addEventListener('dataavailable', event => { if (event.data.size) chunks.push(event.data); });
      recorder.addEventListener('error', () => { status('录音中断，可以尝试上传录音。'); stop(true); });
      recorder.addEventListener('stop', () => {
        clearTimeout(current.timer);
        stopTracks(stream);
        if (recording !== current) return;
        recording = null;
        const clip = new Blob(chunks, { type: recorder.mimeType || chunks[0]?.type });
        if (!current.discard && canStart()) {
          if (clip.size) onClip(clip);
          else status('没录到声音，试着按住时间长一点。');
        }
      });
      recorder.start();
      current.timer = setTimeout(() => stop(), mediaLimits.voiceSeconds * 1000);
      status('正在录音，松手结束。');
    } catch {
      if (current.stream) stopTracks(current.stream);
      if (recording !== current) return;
      recording = null;
      status('无法使用麦克风，请检查权限，或上传录音。');
    }
  }
  app.addEventListener('pointerdown', event => {
    const control = event.target.closest('[data-hold-voice]');
    if (!control || event.button !== 0 || !event.isPrimary) return;
    control.setPointerCapture(event.pointerId);
    void start(event.pointerId);
  });
  window.addEventListener('pointerup', event => { if (recording?.pointerId === event.pointerId) stop(); });
  window.addEventListener('pointercancel', event => { if (recording?.pointerId === event.pointerId) stop(true); });
  app.addEventListener('contextmenu', event => { if (event.target.closest('[data-hold-voice]')) event.preventDefault(); });
  app.addEventListener('click', event => {
    if (event.detail !== 0 || !event.target.closest('[data-hold-voice]')) return;
    if (recording) stop();
    else void start(null);
  });
  window.addEventListener('pagehide', () => { stop(true); if (recording?.stream) stopTracks(recording.stream); });
  return () => stop(true);
}

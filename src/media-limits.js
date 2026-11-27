const mib = 1024 * 1024;

export const mediaLimits = Object.freeze({
  videos: 4,
  voiceBytes: 3 * mib,
  videoBytes: 12 * mib,
  totalBytes: 24 * mib,
  voiceSeconds: 60,
  caption: 120
});

export const voiceTypes = ['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/ogg', 'audio/wav'];
export const videoTypes = ['video/mp4', 'video/webm', 'video/quicktime'];

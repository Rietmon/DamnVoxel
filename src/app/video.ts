/**
 * A video of rendered frames, recorded by the browser (MediaRecorder from a canvas stream):
 * MP4 where the browser records it, WebM otherwise. Frames are played into the canvas at their
 * rate, so recording takes as long as the clip.
 */

const TYPES = [
  'video/mp4;codecs=avc1',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

/** Null when the browser cannot record video. */
export function videoType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  return TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? null;
}

export async function encodeVideo(
  images: readonly Uint8ClampedArray<ArrayBuffer>[],
  width: number,
  height: number,
  fps: number,
): Promise<{ blob: Blob; extension: string } | null> {
  const type = videoType();
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d');
  if (!type || !g || typeof canvas.captureStream !== 'function') return null;
  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined;
  if (!track) return null;
  const recorder = new MediaRecorder(stream, {
    mimeType: type,
    videoBitsPerSecond: Math.min(24e6, Math.max(2e6, width * height * fps * 0.15)),
  });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });
  recorder.start();
  const start = performance.now();
  for (let i = 0; i < images.length; i++) {
    g.putImageData(new ImageData(images[i]!, width, height), 0, 0);
    track.requestFrame();
    const wait = start + ((i + 1) * 1000) / fps - performance.now();
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, wait)));
  }
  recorder.stop();
  await stopped;
  track.stop();
  return {
    blob: new Blob(chunks, { type: type.split(';')[0] }),
    extension: type.startsWith('video/mp4') ? 'mp4' : 'webm',
  };
}

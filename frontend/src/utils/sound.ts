// Short synthesized tones (WebAudio, no audio files). Browsers block audio until the user has
// interacted with the page, so the context is created/resumed on the first pointer or key press.

export type SoundKind = 'tap' | 'alert' | 'success' | 'error';

const TONES: Record<SoundKind, { freq: number[]; ms: number }> = {
  tap: { freq: [660], ms: 40 },
  alert: { freq: [880, 1175], ms: 140 },
  success: { freq: [784, 1047], ms: 120 },
  error: { freq: [330, 247], ms: 160 },
};

type AudioCtor = typeof AudioContext;
let ctx: AudioContext | null = null;

function context(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = (window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext) as
    | AudioCtor
    | undefined;
  if (!Ctor) return null;
  try {
    ctx ??= new Ctor();
    return ctx;
  } catch {
    return null;
  }
}

let unlockInstalled = false;
/** Call once at start-up: resumes audio after the first user gesture (autoplay policy). */
export function installAudioUnlock(): void {
  if (unlockInstalled || typeof window === 'undefined') return;
  unlockInstalled = true;
  const unlock = () => {
    const c = context();
    if (c && c.state === 'suspended') void c.resume().catch(() => undefined);
  };
  window.addEventListener('pointerdown', unlock, { passive: true });
  window.addEventListener('keydown', unlock);
}

/** Plays a tone; silently does nothing when audio is unavailable or still locked. */
export function playSound(kind: SoundKind): void {
  const c = context();
  if (!c || c.state !== 'running') return;
  const { freq, ms } = TONES[kind];
  let t = c.currentTime;
  for (const f of freq) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'sine';
    osc.frequency.value = f;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.12, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
    osc.connect(gain).connect(c.destination);
    osc.start(t);
    osc.stop(t + ms / 1000 + 0.02);
    t += ms / 1000;
  }
}

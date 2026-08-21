import { useCallback, useEffect, useRef, useState } from 'react';

const BAR_COUNT = 36;
const TARGET_RMS = 0.14;
const MIN_GAIN = 1;
const MAX_GAIN = 10;

const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
  },
  video: false,
};

type RecognitionInstance = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((event?: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

function getAudioContextConstructor(): (new () => AudioContext) | undefined {
  const win = window as unknown as {
    AudioContext?: new () => AudioContext;
    webkitAudioContext?: new () => AudioContext;
  };
  return win.AudioContext || win.webkitAudioContext;
}

function pickRecorderMime(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  for (const type of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)) return type;
  }
  return 'audio/webm';
}

async function openClinicalMic(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('getUserMedia no está disponible. Use HTTPS o localhost.');
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
    await Promise.all(
      stream.getAudioTracks().map((track) =>
        track.applyConstraints({
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }).catch(() => undefined)
      )
    );
    return stream;
  } catch (err) {
    console.error('[dictado] getUserMedia con constraints clínicas falló, reintento básico:', err);
    return navigator.mediaDevices.getUserMedia({ audio: true });
  }
}

export function useSpeechDictation(onFinal: (transcript: string) => void) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [supported, setSupported] = useState(true);
  const levelsRef = useRef<number[]>(Array.from({ length: BAR_COUNT }, () => 0.2));
  const [micLive, setMicLive] = useState(false);
  const recognitionRef = useRef<RecognitionInstance | null>(null);
  const wantListenRef = useRef(false);
  const onFinalRef = useRef(onFinal);
  const analyserCleanupRef = useRef<(() => void) | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeRef = useRef('audio/webm');
  onFinalRef.current = onFinal;

  const stopAnalyserNodes = useCallback(() => {
    analyserCleanupRef.current?.();
    analyserCleanupRef.current = null;
    levelsRef.current = Array.from({ length: BAR_COUNT }, () => 0.2);
    setMicLive(false);
  }, []);

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const attachAnalyser = useCallback(async (stream: MediaStream, precreated?: AudioContext) => {
    stopAnalyserNodes();
    const Ctx = getAudioContextConstructor();
    const audioCtx = precreated && precreated.state !== 'closed'
      ? precreated
      : (Ctx ? new Ctx() : null);
    if (!audioCtx) return;

    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }

    const source = audioCtx.createMediaStreamSource(stream);
    const compressor = audioCtx.createDynamicsCompressor();
    compressor.threshold.value = -42;
    compressor.knee.value = 24;
    compressor.ratio.value = 12;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.22;
    const gainNode = audioCtx.createGain();
    gainNode.gain.value = 2.4;
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.42;
    source.connect(compressor);
    compressor.connect(gainNode);
    gainNode.connect(analyser);

    const freq = new Uint8Array(analyser.frequencyBinCount);
    const time = new Uint8Array(analyser.fftSize);
    let raf = 0;
    let lastLive = 0;
    const tick = (now: number) => {
      analyser.getByteFrequencyData(freq);
      analyser.getByteTimeDomainData(time);
      let rms = 0;
      for (let i = 0; i < time.length; i += 1) {
        const centered = (time[i] - 128) / 128;
        rms += centered * centered;
      }
      rms = Math.sqrt(rms / time.length);
      const current = gainNode.gain.value;
      if (rms < 0.035) gainNode.gain.value = Math.min(MAX_GAIN, current * 1.035);
      else if (rms < TARGET_RMS) gainNode.gain.value = Math.min(MAX_GAIN, current * 1.012);
      else if (rms > 0.28) gainNode.gain.value = Math.max(MIN_GAIN, current * 0.96);

      const voiceEnd = Math.max(8, Math.floor(freq.length * 0.42));
      levelsRef.current = Array.from({ length: BAR_COUNT }, (_, i) => {
        const idx = Math.min(voiceEnd - 1, Math.floor((i / BAR_COUNT) * voiceEnd));
        const neighbour = Math.min(voiceEnd - 1, idx + 1);
        const freqLevel = (freq[idx] + freq[neighbour]) / 510;
        const sample = time[Math.floor((i / BAR_COUNT) * time.length)];
        const wave = Math.abs((sample - 128) / 128);
        return Math.max(0.08, Math.min(1, freqLevel * 0.85 + wave * 0.45 + rms * 0.9));
      });
      if (now - lastLive > 180) {
        lastLive = now;
        const speaking = rms > 0.028;
        setMicLive((prev) => (prev === speaking ? prev : speaking));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    analyserCleanupRef.current = () => {
      cancelAnimationFrame(raf);
      source.disconnect();
      compressor.disconnect();
      gainNode.disconnect();
      void audioCtx.close();
    };
  }, [stopAnalyserNodes]);

  const startRecorder = useCallback((stream: MediaStream) => {
    chunksRef.current = [];
    const mime = pickRecorderMime();
    mimeRef.current = mime;
    const recorder = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 64_000 });
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.start(1000);
    recorderRef.current = recorder;
  }, []);

  const stopRecorder = useCallback((): Promise<File | null> => {
    return new Promise((resolve) => {
      const recorder = recorderRef.current;
      const finish = () => {
        recorderRef.current = null;
        const parts = chunksRef.current;
        chunksRef.current = [];
        if (!parts.length) {
          resolve(null);
          return;
        }
        const blob = new Blob(parts, { type: mimeRef.current || 'audio/webm' });
        const ext = mimeRef.current.includes('mp4') ? 'm4a' : 'webm';
        resolve(new File([blob], `consulta-dictado.${ext}`, { type: blob.type }));
      };
      if (!recorder || recorder.state === 'inactive') {
        finish();
        return;
      }
      recorder.addEventListener('stop', finish, { once: true });
      recorder.stop();
    });
  }, []);

  useEffect(() => {
    const win = window as unknown as {
      SpeechRecognition?: new () => RecognitionInstance;
      webkitSpeechRecognition?: new () => RecognitionInstance;
    };
    const Ctor = win.SpeechRecognition || win.webkitSpeechRecognition;
    setSupported(Boolean(Ctor) || typeof MediaRecorder !== 'undefined');
    if (!Ctor) return;

    const recognition = new Ctor();
    recognition.lang = 'es-MX';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      let finalChunk = '';
      let live = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result.isFinal) finalChunk += result[0].transcript;
        else live += result[0].transcript;
      }
      setInterim(live);
      if (finalChunk.trim()) onFinalRef.current(finalChunk.trim());
    };
    recognition.onerror = (event?: { error?: string }) => {
      console.error('[dictado] SpeechRecognition.onerror:', event?.error ?? event);
      if (!wantListenRef.current) setListening(false);
    };
    recognition.onend = () => {
      setInterim('');
      if (wantListenRef.current) {
        try {
          recognition.start();
        } catch {
          /* already started — MediaRecorder sigue activo */
        }
      } else {
        setListening(false);
      }
    };
    recognitionRef.current = recognition;
    return () => {
      wantListenRef.current = false;
      recognition.abort();
      void stopRecorder();
      stopAnalyserNodes();
      releaseStream();
    };
  }, [releaseStream, stopAnalyserNodes, stopRecorder]);

  const start = useCallback(async () => {
    console.log('[dictado] start() — pidiendo micrófono');
    wantListenRef.current = true;
    setListening(true);
    try {
      const Ctx = getAudioContextConstructor();
      const audioCtx = Ctx ? new Ctx() : undefined;
      if (audioCtx && audioCtx.state === 'suspended') {
        await audioCtx.resume();
        console.log('[dictado] AudioContext:', audioCtx.state);
      }

      const stream = await openClinicalMic();
      streamRef.current = stream;
      console.log('[dictado] micrófono activo, tracks:', stream.getAudioTracks().map((t) => t.label || t.kind));

      try {
        await attachAnalyser(stream, audioCtx);
      } catch (err) {
        console.error('[dictado] analizador de ondas falló:', err);
      }
      try {
        startRecorder(stream);
        console.log('[dictado] MediaRecorder estado:', recorderRef.current?.state);
      } catch (err) {
        console.error('[dictado] MediaRecorder no pudo iniciar:', err);
      }
      try {
        recognitionRef.current?.start();
        console.log('[dictado] SpeechRecognition.start() llamado');
      } catch (err) {
        console.error('[dictado] SpeechRecognition.start() falló:', err);
      }
    } catch (err) {
      console.error('[dictado] error al iniciar el micrófono:', err);
      try {
        recognitionRef.current?.start();
        console.log('[dictado] fallback SpeechRecognition.start()');
      } catch (recErr) {
        console.error('[dictado] fallback SpeechRecognition falló:', recErr);
        wantListenRef.current = false;
        setListening(false);
      }
    }
  }, [attachAnalyser, startRecorder]);

  const stop = useCallback(async () => {
    wantListenRef.current = false;
    recognitionRef.current?.stop();
    setListening(false);
    setInterim('');
    const file = await stopRecorder();
    stopAnalyserNodes();
    releaseStream();
    return file;
  }, [releaseStream, stopAnalyserNodes, stopRecorder]);

  return { listening, interim, levelsRef, micLive, supported, start, stop };
}

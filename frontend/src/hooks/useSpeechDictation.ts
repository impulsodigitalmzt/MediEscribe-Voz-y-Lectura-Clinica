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
  onerror: (() => void) | null;
  onend: (() => void) | null;
};

async function openClinicalMic(): Promise<MediaStream> {
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
  } catch {
    return navigator.mediaDevices.getUserMedia({ audio: true });
  }
}

export function useSpeechDictation(onFinal: (transcript: string) => void) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [supported, setSupported] = useState(false);
  const [levels, setLevels] = useState<number[]>(() => Array.from({ length: BAR_COUNT }, () => 0.08));
  const recognitionRef = useRef<RecognitionInstance | null>(null);
  const wantListenRef = useRef(false);
  const onFinalRef = useRef(onFinal);
  const analyserCleanupRef = useRef<(() => void) | null>(null);
  onFinalRef.current = onFinal;

  const stopAnalyser = useCallback(() => {
    analyserCleanupRef.current?.();
    analyserCleanupRef.current = null;
    setLevels(Array.from({ length: BAR_COUNT }, () => 0.08));
  }, []);

  const startAnalyser = useCallback(async () => {
    stopAnalyser();
    if (!navigator.mediaDevices?.getUserMedia) return;
    const stream = await openClinicalMic();
    const audioCtx = new AudioContext();
    if (audioCtx.state === 'suspended') await audioCtx.resume();

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
    const tick = () => {
      analyser.getByteFrequencyData(freq);
      analyser.getByteTimeDomainData(time);
      let rms = 0;
      for (let i = 0; i < time.length; i += 1) {
        const centered = (time[i] - 128) / 128;
        rms += centered * centered;
      }
      rms = Math.sqrt(rms / time.length);

      const current = gainNode.gain.value;
      if (rms < 0.035) {
        gainNode.gain.value = Math.min(MAX_GAIN, current * 1.035);
      } else if (rms < TARGET_RMS) {
        gainNode.gain.value = Math.min(MAX_GAIN, current * 1.012);
      } else if (rms > 0.28) {
        gainNode.gain.value = Math.max(MIN_GAIN, current * 0.96);
      }

      const voiceEnd = Math.max(8, Math.floor(freq.length * 0.42));
      const bars = Array.from({ length: BAR_COUNT }, (_, i) => {
        const idx = Math.min(voiceEnd - 1, Math.floor((i / BAR_COUNT) * voiceEnd));
        const neighbour = Math.min(voiceEnd - 1, idx + 1);
        const freqLevel = (freq[idx] + freq[neighbour]) / 510;
        const sample = time[Math.floor((i / BAR_COUNT) * time.length)];
        const wave = Math.abs((sample - 128) / 128);
        return Math.max(0.06, Math.min(1, freqLevel * 0.85 + wave * 0.45 + rms * 0.9));
      });
      setLevels(bars);
      raf = requestAnimationFrame(tick);
    };
    tick();

    analyserCleanupRef.current = () => {
      cancelAnimationFrame(raf);
      source.disconnect();
      compressor.disconnect();
      gainNode.disconnect();
      void audioCtx.close();
      stream.getTracks().forEach((track) => track.stop());
    };
  }, [stopAnalyser]);

  useEffect(() => {
    const win = window as unknown as {
      SpeechRecognition?: new () => RecognitionInstance;
      webkitSpeechRecognition?: new () => RecognitionInstance;
    };
    const Ctor = win.SpeechRecognition || win.webkitSpeechRecognition;
    setSupported(Boolean(Ctor));
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
    recognition.onerror = () => {
      if (!wantListenRef.current) {
        setListening(false);
        stopAnalyser();
      }
    };
    recognition.onend = () => {
      setInterim('');
      if (wantListenRef.current) {
        try {
          recognition.start();
        } catch {
          /* already started */
        }
      } else {
        setListening(false);
        stopAnalyser();
      }
    };
    recognitionRef.current = recognition;
    return () => {
      wantListenRef.current = false;
      recognition.abort();
      stopAnalyser();
    };
  }, [stopAnalyser]);

  const start = useCallback(async () => {
    wantListenRef.current = true;
    setListening(true);
    try {
      await startAnalyser();
    } catch {
      /* permission denied — dictation can still try; equalizer stays visible */
    }
    try {
      recognitionRef.current?.start();
    } catch {
      /* already started or unsupported */
    }
  }, [startAnalyser]);

  const stop = useCallback(() => {
    wantListenRef.current = false;
    recognitionRef.current?.stop();
    setListening(false);
    setInterim('');
    stopAnalyser();
  }, [stopAnalyser]);

  return { listening, interim, levels, supported, start, stop };
}

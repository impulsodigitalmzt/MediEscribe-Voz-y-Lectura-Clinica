import { useCallback, useEffect, useRef, useState } from 'react';

const BAR_COUNT = 28;

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
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const audioCtx = new AudioContext();
    if (audioCtx.state === 'suspended') await audioCtx.resume();
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.35;
    const source = audioCtx.createMediaStreamSource(stream);
    source.connect(analyser);
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
      const bars = Array.from({ length: BAR_COUNT }, (_, i) => {
        const idx = Math.min(freq.length - 1, Math.floor((i / BAR_COUNT) * freq.length * 0.55));
        const freqLevel = freq[idx] / 255;
        const wave = Math.abs((time[Math.floor((i / BAR_COUNT) * time.length)] - 128) / 128);
        return Math.max(0.07, Math.min(1, freqLevel * 0.55 + wave * 0.7 + rms * 1.15));
      });
      setLevels(bars);
      raf = requestAnimationFrame(tick);
    };
    tick();
    analyserCleanupRef.current = () => {
      cancelAnimationFrame(raf);
      source.disconnect();
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
    if (!recognitionRef.current) return;
    wantListenRef.current = true;
    setListening(true);
    try {
      await startAnalyser();
    } catch {
      /* permission denied — dictation can still try */
    }
    try {
      recognitionRef.current.start();
    } catch {
      /* already started */
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

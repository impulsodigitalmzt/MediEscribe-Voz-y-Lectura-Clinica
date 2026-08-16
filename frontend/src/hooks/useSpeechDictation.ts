import { useCallback, useEffect, useRef, useState } from 'react';

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
  const recognitionRef = useRef<RecognitionInstance | null>(null);
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;

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
    recognition.onerror = () => setListening(false);
    recognition.onend = () => {
      setListening(false);
      setInterim('');
    };
    recognitionRef.current = recognition;
    return () => recognition.abort();
  }, []);

  const start = useCallback(() => {
    if (!recognitionRef.current) return;
    try {
      recognitionRef.current.start();
      setListening(true);
    } catch {
      setListening(true);
    }
  }, []);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    setListening(false);
    setInterim('');
  }, []);

  return { listening, interim, supported, start, stop };
}

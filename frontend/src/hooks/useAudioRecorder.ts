/**
 * useAudioRecorder — Web Speech API real-time transcription.
 *
 * Uses the browser's built-in SpeechRecognition (Chrome/Edge) for free,
 * zero-latency, no-API-key live transcription. Sends recognised text
 * segments to the backend over WebSocket as JSON (not audio binary).
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import type { TranscriptSegment, RecordingState } from '../types';
import api from '../services/api';

// Full Web Speech API type declarations (not in all TS DOM lib versions)
interface ISpeechRecognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: ISpeechRecognitionEvent) => void) | null;
  onerror: ((event: ISpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}

interface ISpeechRecognitionEvent {
  resultIndex: number;
  results: ISpeechRecognitionResultList;
}

interface ISpeechRecognitionResultList {
  length: number;
  item(index: number): ISpeechRecognitionResult;
  [index: number]: ISpeechRecognitionResult;
}

interface ISpeechRecognitionResult {
  isFinal: boolean;
  length: number;
  item(index: number): ISpeechRecognitionAlternative;
  [index: number]: ISpeechRecognitionAlternative;
}

interface ISpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface ISpeechRecognitionErrorEvent {
  error: string;
  message: string;
}

interface ISpeechRecognitionConstructor {
  new (): ISpeechRecognition;
}

// Extend Window to include webkit-prefixed variant
declare global {
  interface Window {
    SpeechRecognition?: ISpeechRecognitionConstructor;
    webkitSpeechRecognition?: ISpeechRecognitionConstructor;
  }
}

// BCP-47 language code map
const LANG_MAP: Record<string, string> = {
  en: 'en-US',
  es: 'es-ES',
  fr: 'fr-FR',
  pt: 'pt-PT',
  ar: 'ar-SA',
  zh: 'zh-CN',
  hi: 'hi-IN',
  sw: 'sw-KE',
};

interface UseAudioRecorderOptions {
  encounterId: string;
  language?: string;
  onTranscriptSegment?: (segment: TranscriptSegment) => void;
  onError?: (error: string) => void;
}

interface UseAudioRecorderReturn {
  state: RecordingState;
  segments: TranscriptSegment[];
  isSupported: boolean;
  startRecording: (encounterIdOverride?: string) => Promise<void>;
  stopRecording: () => void;
  pauseRecording: () => void;
  resumeRecording: () => void;
}

export function useAudioRecorder({
  encounterId,
  language,
  onTranscriptSegment,
  onError,
}: UseAudioRecorderOptions): UseAudioRecorderReturn {
  const [state, setState] = useState<RecordingState>({
    isRecording: false,
    isPaused: false,
    elapsedSeconds: 0,
    isConnected: false,
  });
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);

  const encounterIdRef = useRef(encounterId);
  encounterIdRef.current = encounterId;
  const recognitionRef = useRef<ISpeechRecognition | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const segCountRef = useRef(0);
  const isPausedRef = useRef(false);

  const isSupported =
    typeof window !== 'undefined' &&
    (typeof window.SpeechRecognition !== 'undefined' ||
      typeof window.webkitSpeechRecognition !== 'undefined');

  const startTimer = useCallback(() => {
    if (timerRef.current) return;
    timerRef.current = setInterval(() => {
      setState((prev) => ({ ...prev, elapsedSeconds: prev.elapsedSeconds + 1 }));
    }, 1000);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      stopTimer();
      recognitionRef.current?.stop();
      wsRef.current?.close();
    };
  }, [stopTimer]);

  const sendSegment = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      segCountRef.current += 1;
      const langCode = language?.split('-')[0] || 'es';
      const segment: TranscriptSegment = {
        sequence: segCountRef.current,
        speaker: 'physician',
        content: text.trim(),
        timestamp_start: 0,
        timestamp_end: 0,
        language: langCode,
        confidence: 1.0,
      };
      setSegments((prev) => [...prev, segment]);
      onTranscriptSegment?.(segment);

      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: 'transcript_text',
            text: text.trim(),
            speaker: 'physician',
            language: langCode,
            confidence: 1.0,
          })
        );
      }
    },
    [language, onTranscriptSegment]
  );

  const startRecording = useCallback(async (encounterIdOverride?: string) => {
    if (!isSupported) {
      onError?.('Live recording requires Chrome or Edge. Please use the manual text input tab instead.');
      return;
    }
    const activeEncounterId = encounterIdOverride || encounterIdRef.current;
    if (!activeEncounterId) {
      onError?.('Identifica al paciente antes de grabar.');
      return;
    }

    try {
      // Connect WebSocket for persisting text segments
      const wsUrl = api.getWsUrl(activeEncounterId);
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      ws.onopen = () => {
        setState((prev) => ({ ...prev, isConnected: true }));
        ws.send(JSON.stringify({ type: 'config', mode: 'web_speech' }));
      };
      ws.onerror = () => onError?.('WebSocket connection error.');
      ws.onclose = () => setState((prev) => ({ ...prev, isConnected: false }));

      // Instantiate SpeechRecognition
      const SpeechRecognitionCtor =
        window.SpeechRecognition ?? window.webkitSpeechRecognition;
      if (!SpeechRecognitionCtor) {
        onError?.('SpeechRecognition not available in this browser.');
        return;
      }

      const recognition = new SpeechRecognitionCtor();
      recognitionRef.current = recognition;

      if (language) {
        recognition.lang = LANG_MAP[language] ?? language;
      } else if (typeof navigator !== 'undefined' && navigator.language) {
        recognition.lang = navigator.language;
      }
      recognition.continuous = true;
      recognition.interimResults = false; // Final results only — avoids duplicate partial segments
      recognition.maxAlternatives = 1;

      // Track the last sent text to avoid duplicates after auto-restart
      let lastSentText = '';

      recognition.onresult = (event: ISpeechRecognitionEvent) => {
        if (isPausedRef.current) return;
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (result.isFinal) {
            const text = result[0].transcript.trim();
            // Skip if empty, too short, or duplicate of last sent
            if (!text || text.length < 3) continue;
            if (text === lastSentText) continue;
            lastSentText = text;
            sendSegment(text);
          }
        }
      };

      recognition.onerror = (event: ISpeechRecognitionErrorEvent) => {
        if (event.error === 'no-speech' || event.error === 'aborted') return;
        onError?.(`Microphone error: ${event.error}. Check permissions and try again.`);
      };

      // Auto-restart after silence (browser stops after ~60s no speech)
      recognition.onend = () => {
        if (!isPausedRef.current && recognitionRef.current === recognition) {
          try { recognition.start(); } catch { /* already started */ }
        }
      };

      recognition.start();
      setState({ isRecording: true, isPaused: false, elapsedSeconds: 0, isConnected: true });
      isPausedRef.current = false;
      startTimer();
    } catch (err) {
      onError?.(err instanceof Error ? err.message : 'Failed to start recording');
    }
  }, [isSupported, language, onError, sendSegment, startTimer]);

  const stopRecording = useCallback(() => {
    isPausedRef.current = false;
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'stop' }));
      setTimeout(() => wsRef.current?.close(), 500);
    }
    stopTimer();
    setState((prev) => ({ ...prev, isRecording: false, isPaused: false, isConnected: false }));
  }, [stopTimer]);

  const pauseRecording = useCallback(() => {
    isPausedRef.current = true;
    recognitionRef.current?.stop();
    stopTimer();
    setState((prev) => ({ ...prev, isPaused: true }));
  }, [stopTimer]);

  const resumeRecording = useCallback(() => {
    isPausedRef.current = false;
    try { recognitionRef.current?.start(); } catch { /* ok */ }
    startTimer();
    setState((prev) => ({ ...prev, isPaused: false }));
  }, [startTimer]);

  return { state, segments, isSupported, startRecording, stopRecording, pauseRecording, resumeRecording };
}

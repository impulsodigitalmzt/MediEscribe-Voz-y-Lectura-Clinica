import { FileText, Loader2, Mic, Square, Upload } from 'lucide-react';
import { useRef } from 'react';
import { useSpeechDictation } from '../../hooks/useSpeechDictation';
import VoiceEqualizer from './VoiceEqualizer';

type Props = {
  dictado: string;
  onDictado: (value: string) => void;
  audioFile: File | null;
  onAudioFile: (file: File | null) => void;
  generating: boolean;
  onGenerateText: (texto: string) => void;
  onGenerateAudio: () => void;
  onRecordingStart?: () => void;
};

export default function VoiceDictationPanel({
  dictado, onDictado, audioFile, onAudioFile, generating, onGenerateText, onGenerateAudio, onRecordingStart,
}: Props) {
  const dictadoRef = useRef(dictado);
  dictadoRef.current = dictado;
  const { listening, interim, levels, supported, start, stop } = useSpeechDictation((chunk) => {
    const current = dictadoRef.current;
    onDictado(current ? `${current.trim()} ${chunk}` : chunk);
  });

  const textoCaja = listening && interim ? `${dictado}${dictado ? ' ' : ''}${interim}` : dictado;

  const handleStart = () => {
    onRecordingStart?.();
    void start();
  };

  const procesarNota = (texto: string) => {
    onGenerateText(texto.trim());
  };

  const handleStopAndProcess = () => {
    const texto = textoCaja;
    if (texto !== dictado) onDictado(texto);
    stop();
    window.setTimeout(() => {
      procesarNota(dictadoRef.current || texto);
    }, 350);
  };

  const handleGenerarTexto = () => {
    const texto = textoCaja;
    if (listening) {
      if (texto !== dictado) onDictado(texto);
      stop();
      window.setTimeout(() => procesarNota(dictadoRef.current || texto), 350);
      return;
    }
    procesarNota(texto);
  };

  return (
    <section className="card p-4 sm:p-5 space-y-3 no-print">
      <h2 className="text-sm font-semibold text-slate-800">Editor de nota — dictado y texto</h2>
      <p className="text-sm text-slate-600">
        Dicte con el micrófono, pegue la transcripción o cargue un audio. Al detener, la IA llena la nota NOM-004.
      </p>

      <div className="flex flex-col sm:flex-row gap-3">
        {supported ? (
          <button
            type="button"
            className={
              listening
                ? 'btn-danger py-3.5 px-6 text-base font-semibold shadow-lg shadow-red-600/30 min-h-[52px] voice-record-btn is-recording'
                : 'btn-primary py-3.5 px-6 text-base font-semibold shadow-lg shadow-teal-600/30 min-h-[52px] voice-record-btn'
            }
            onClick={listening ? handleStopAndProcess : handleStart}
            disabled={generating}
          >
            {listening ? <Square className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            {listening ? 'Detener y redactar nota' : 'Dictar por voz'}
          </button>
        ) : (
          <span className="text-sm text-slate-500">El dictado en vivo requiere Chrome o Edge.</span>
        )}
        <label className="btn-secondary py-3.5 px-6 text-sm font-medium cursor-pointer min-h-[52px]">
          <Upload className="w-4 h-4" />
          {audioFile ? audioFile.name : 'Subir audio'}
          <input
            type="file"
            accept="audio/*,.mp3,.wav,.m4a,.ogg,.webm,.flac"
            className="hidden"
            onChange={(e) => onAudioFile(e.target.files?.[0] ?? null)}
          />
        </label>
      </div>

      {listening && (
        <div className="rounded-xl border-2 border-red-400 bg-red-50 px-4 py-4 dark-recording-banner">
          <div className="flex items-center gap-2 mb-3">
            <span className="recording-dot" />
            <p className="text-sm font-semibold text-red-700">Grabando — las barras se mueven con su voz</p>
            <span className="ml-auto text-xs font-medium text-red-600">Micrófono activo</span>
          </div>
          <VoiceEqualizer levels={levels} />
        </div>
      )}

      <textarea
        value={textoCaja}
        onChange={(e) => onDictado(e.target.value)}
        placeholder="Dictado o transcripción de la consulta..."
        className="w-full min-h-[120px] p-3 rounded-lg border border-slate-200 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-teal-500"
      />
      <div className="flex flex-wrap gap-2 items-center">
        <button type="button" className="btn-secondary py-2 px-4 text-sm" disabled={!audioFile || generating} onClick={onGenerateAudio}>
          {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mic className="w-3.5 h-3.5" />}
          Audio → nota
        </button>
        <button
          type="button"
          className="btn-primary py-2.5 px-5 text-sm font-semibold"
          disabled={generating}
          onClick={handleGenerarTexto}
        >
          {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
          {generating ? 'Redactando nota…' : 'Generar desde texto'}
        </button>
      </div>
    </section>
  );
}

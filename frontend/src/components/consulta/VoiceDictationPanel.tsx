import { FileText, Loader2, Mic, Square, Upload } from 'lucide-react';
import { useRef } from 'react';
import { useSpeechDictation } from '../../hooks/useSpeechDictation';

type Props = {
  dictado: string;
  onDictado: (value: string) => void;
  audioFile: File | null;
  onAudioFile: (file: File | null) => void;
  generating: boolean;
  onGenerateText: () => void;
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

  const handleStart = () => {
    onRecordingStart?.();
    void start();
  };

  return (
    <section className="card p-4 sm:p-5 space-y-3 no-print">
      <h2 className="text-sm font-semibold text-slate-800">Editor de nota — dictado y texto</h2>
      <p className="text-sm text-slate-600">
        Dicte con el micrófono, pegue la transcripción o cargue un audio. La IA redacta la nota sobre el expediente.
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
            onClick={listening ? stop : handleStart}
          >
            {listening ? <Square className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            {listening ? 'Detener grabación' : 'Dictar por voz'}
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
            <p className="text-sm font-semibold text-red-700">Grabando — hable con naturalidad</p>
            <span className="ml-auto text-xs font-medium text-red-600">Micrófono activo</span>
          </div>
          <div className="voice-wave" aria-hidden="true">
            {levels.map((level, index) => (
              <span
                key={index}
                style={{ height: `${Math.round(10 + level * 54)}px` }}
              />
            ))}
          </div>
        </div>
      )}

      <textarea
        value={listening && interim ? `${dictado}${dictado ? ' ' : ''}${interim}` : dictado}
        onChange={(e) => onDictado(e.target.value)}
        placeholder="Dictado o transcripción de la consulta..."
        className="w-full min-h-[120px] p-3 rounded-lg border border-slate-200 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-teal-500"
      />
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary py-1.5 px-3 text-xs" disabled={!audioFile || generating} onClick={onGenerateAudio}>
          {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mic className="w-3.5 h-3.5" />}
          Audio → nota
        </button>
        <button type="button" className="btn-primary py-1.5 px-3 text-xs" disabled={generating || dictado.trim().length < 20} onClick={onGenerateText}>
          {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
          Generar desde texto
        </button>
      </div>
    </section>
  );
}

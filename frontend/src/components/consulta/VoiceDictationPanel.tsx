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
};

export default function VoiceDictationPanel({
  dictado, onDictado, audioFile, onAudioFile, generating, onGenerateText, onGenerateAudio,
}: Props) {
  const dictadoRef = useRef(dictado);
  dictadoRef.current = dictado;
  const { listening, interim, supported, start, stop } = useSpeechDictation((chunk) => {
    const current = dictadoRef.current;
    onDictado(current ? `${current.trim()} ${chunk}` : chunk);
  });

  return (
    <section className="card p-4 sm:p-5 space-y-3 no-print">
      <h2 className="text-sm font-semibold text-slate-800">Editor de nota — dictado y texto</h2>
      <p className="text-xs text-slate-500">
        Dicte con el micrófono, pegue la transcripción o cargue un audio. La IA redacta la nota sobre el expediente.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {supported ? (
          <button
            type="button"
            className={listening ? 'btn-danger py-1.5 px-3 text-xs' : 'btn-secondary py-1.5 px-3 text-xs'}
            onClick={listening ? stop : start}
          >
            {listening ? <Square className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
            {listening ? 'Detener dictado' : 'Dictar por voz'}
          </button>
        ) : (
          <span className="text-[11px] text-slate-400">El dictado en vivo requiere Chrome o Edge.</span>
        )}
        <label className="btn-secondary py-1.5 px-3 text-xs cursor-pointer">
          <Upload className="w-3.5 h-3.5" />
          {audioFile ? audioFile.name : 'Subir audio'}
          <input
            type="file"
            accept="audio/*,.mp3,.wav,.m4a,.ogg,.webm,.flac"
            className="hidden"
            onChange={(e) => onAudioFile(e.target.files?.[0] ?? null)}
          />
        </label>
      </div>
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

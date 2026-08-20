import { FileText, Loader2, Mic, Shield, Square, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
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
  const [showWaves, setShowWaves] = useState(false);
  const [mostrarDictado, setMostrarDictado] = useState(false);
  const { listening, interim, levelsRef, micLive, supported, start, stop } = useSpeechDictation((chunk) => {
    const current = dictadoRef.current;
    onDictado(current ? `${current.trim()} ${chunk}` : chunk);
  });

  useEffect(() => {
    if (listening) setShowWaves(true);
  }, [listening]);

  const capturing = showWaves || listening;
  const textoCaja = capturing && interim ? `${dictado}${dictado ? ' ' : ''}${interim}` : dictado;

  const handleStart = () => {
    setShowWaves(true);
    onRecordingStart?.();
    void start();
  };

  const procesarNota = (texto: string) => {
    onGenerateText(texto.trim());
  };

  const handleStopAndProcess = () => {
    const texto = textoCaja;
    if (texto !== dictado) onDictado(texto);
    setShowWaves(false);
    stop();
    window.setTimeout(() => {
      procesarNota(dictadoRef.current || texto);
    }, 350);
  };

  const handleGenerarTexto = () => {
    const texto = textoCaja;
    if (capturing) {
      if (texto !== dictado) onDictado(texto);
      setShowWaves(false);
      stop();
      window.setTimeout(() => procesarNota(dictadoRef.current || texto), 350);
      return;
    }
    procesarNota(texto);
  };

  return (
    <section className="card p-4 sm:p-5 space-y-3 no-print">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">Copiloto de dictado</h2>
          <p className="text-sm text-slate-600">
            Dicte, pegue texto o suba audio. La IA sintetiza SOAP (no copia el dictado) y ordena vitales, CIE-10 y receta.
          </p>
        </div>
        <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-teal-800 bg-teal-50 border border-teal-200 rounded-full px-2 py-1">
          <Shield className="w-3 h-3" /> Minimización LFPDPPP
        </span>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <button
          type="button"
          className={
            capturing
              ? 'btn-danger py-3.5 px-6 text-base font-semibold shadow-lg shadow-red-600/30 min-h-[52px] voice-record-btn is-recording'
              : 'btn-primary py-3.5 px-6 text-base font-semibold shadow-lg shadow-teal-600/30 min-h-[52px] voice-record-btn'
          }
          onClick={capturing ? handleStopAndProcess : handleStart}
          disabled={generating}
        >
          {capturing ? <Square className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
          {capturing ? 'Detener y redactar SOAP' : 'Dictar por voz'}
        </button>
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

      {capturing ? (
        <div className="rounded-xl border-2 border-teal-400 bg-teal-950/5 p-3 space-y-2">
          <p className="text-xs font-semibold text-teal-800">
            {micLive ? 'Micrófono con señal · ondas en tiempo real' : 'Escuchando · hable cerca del micrófono'}
          </p>
          <VoiceEqualizer levelsRef={levelsRef} live={micLive} />
          {!supported ? (
            <p className="text-xs text-amber-800">
              Este navegador no transcribe en vivo. Las ondas confirman el micrófono; use Chrome o Edge, o suba un archivo para Whisper.
            </p>
          ) : null}
        </div>
      ) : null}

      <details
        className="rounded-xl border border-slate-200 bg-slate-50 p-3"
        open={mostrarDictado || capturing}
        onToggle={(e) => setMostrarDictado((e.target as HTMLDetailsElement).open)}
      >
        <summary className="text-xs font-semibold text-slate-600 cursor-pointer">
          Dictado crudo (dato sensible · oculto por defecto)
        </summary>
        <textarea
          value={textoCaja}
          onChange={(e) => onDictado(e.target.value)}
          placeholder="El texto bruto se usa solo para sintetizar la nota. No se muestra en el resumen SOAP."
          className="mt-2 w-full min-h-[120px] p-3 rounded-lg border border-slate-200 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white"
        />
      </details>
      <div className="flex flex-wrap gap-2 items-center">
        <button type="button" className="btn-secondary py-2 px-4 text-sm" disabled={!audioFile || generating} onClick={onGenerateAudio}>
          {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mic className="w-3.5 h-3.5" />}
          Audio → SOAP
        </button>
        <button
          type="button"
          className="btn-primary py-2.5 px-5 text-sm font-semibold"
          disabled={generating}
          onClick={handleGenerarTexto}
        >
          {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
          {generating ? 'Sintetizando nota…' : 'Generar SOAP desde texto'}
        </button>
      </div>
    </section>
  );
}

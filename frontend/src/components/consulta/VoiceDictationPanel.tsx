import { FileText, Loader2, Mic, Shield, Square, Upload } from 'lucide-react';
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { useSpeechDictation } from '../../hooks/useSpeechDictation';

type Props = {
  dictado: string;
  onDictado: (value: string) => void;
  audioFile: File | null;
  onAudioFile: (file: File | null) => void;
  generating: boolean;
  onGenerateText: (texto: string) => void;
  onGenerateAudio: (file?: File) => void;
  onRecordingStart?: () => void;
};

export default function VoiceDictationPanel({
  dictado, onDictado, audioFile, onAudioFile, generating, onGenerateText, onGenerateAudio, onRecordingStart,
}: Props) {
  const dictadoRef = useRef(dictado);
  dictadoRef.current = dictado;
  const [showWaves, setShowWaves] = useState(false);
  const { listening, interim, supported, start, stop } = useSpeechDictation((chunk) => {
    const current = dictadoRef.current;
    onDictado(current ? `${current.trim()} ${chunk}` : chunk);
  });

  useEffect(() => {
    if (listening) setShowWaves(true);
  }, [listening]);

  const capturing = showWaves || listening;
  const textoCaja = capturing && interim ? `${dictado}${dictado ? ' ' : ''}${interim}` : dictado;

  const handleStart = async () => {
    console.log('[dictado] clic en Dictar por voz — activando escucha');
    setShowWaves(true);
    try {
      onRecordingStart?.();
    } catch (err) {
      console.error('[dictado] onRecordingStart falló:', err);
    }
    try {
      await start();
      console.log('[dictado] escucha activa');
    } catch (err) {
      console.error('[dictado] start() rechazado:', err);
    }
  };

  const handleStopAndProcess = async () => {
    console.log('[dictado] clic en Detener — cerrando micrófono');
    const texto = textoCaja;
    if (texto !== dictado) onDictado(texto);
    setShowWaves(false);
    const file = await stop();
    if (file) {
      onAudioFile(file);
      onGenerateAudio(file);
      return;
    }
    onGenerateText(dictadoRef.current || texto);
  };

  const handleMicClick = () => {
    console.log('[dictado] clic en botón de micrófono, capturing=', capturing);
    if (capturing) {
      void handleStopAndProcess();
      return;
    }
    void handleStart();
  };

  const handleGenerarSoap = (event?: MouseEvent<HTMLButtonElement>) => {
    event?.preventDefault();
    event?.stopPropagation();
    const texto = (textoCaja || dictadoRef.current || '').trim();
    console.log('Iniciando generación SOAP para texto:', texto);
    if (!texto) {
      console.warn('[SOAP] El clic sí se registró, pero el borrador está vacío. No hay fetch.');
      onGenerateText(texto);
      return;
    }
    if (capturing) {
      void handleStopAndProcess();
      return;
    }
    onGenerateText(texto);
  };

  useEffect(() => {
    console.info('[SOAP] Botón "Generar SOAP desde texto" montado (id=btn-generar-soap-texto).');
  }, []);

  return (
    <section className="card p-4 sm:p-5 space-y-3 no-print relative z-20">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">Copiloto de dictado</h2>
          <p className="text-sm text-slate-600">
            El borrador muestra en vivo lo que capta el micrófono. La IA solo pasa a SOAP lo que sea clínicamente pertinente.
          </p>
        </div>
        <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-teal-800 bg-teal-50 border border-teal-200 rounded-full px-2 py-1">
          <Shield className="w-3 h-3" /> Minimización LFPDPPP
        </span>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            className={
              capturing
                ? 'btn-secondary py-3.5 px-6 text-base font-medium min-h-[52px] voice-record-btn is-listening'
                : 'btn-primary py-3.5 px-6 text-base font-semibold shadow-lg shadow-teal-600/30 min-h-[52px] voice-record-btn'
            }
            onClick={handleMicClick}
            aria-pressed={capturing}
          >
            {capturing ? <Square className="w-4 h-4" /> : <Mic className="w-5 h-5" />}
            {capturing ? 'Detener y redactar SOAP' : 'Dictar por voz'}
          </button>
          {capturing ? (
            <span
              className="voice-listen-dot"
              role="status"
              aria-live="polite"
              aria-label="Escucha activa"
              title="Escucha activa"
            />
          ) : null}
        </div>
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
      {capturing && !supported ? (
        <p className="text-[11px] text-slate-500">
          Use Chrome o Edge para dictado en vivo. El audio se envía a Whisper de todos modos.
        </p>
      ) : null}

      <label className="block space-y-1.5">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-600">
          Borrador / transcripción
        </span>
        <textarea
          value={textoCaja}
          onChange={(e) => onDictado(e.target.value)}
          placeholder="Lo que dicte o escriba aparece aquí. Puede editarlo antes de generar el SOAP."
          className="w-full min-h-[140px] p-3 rounded-lg border border-slate-200 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white"
          aria-label="Borrador de transcripción"
        />
      </label>
      <div className="flex flex-wrap gap-2 items-center">
        <button type="button" className="btn-secondary py-2 px-4 text-sm" disabled={!audioFile || generating} onClick={() => onGenerateAudio()}>
          {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mic className="w-3.5 h-3.5" />}
          Audio → SOAP
        </button>
        <button
          type="button"
          id="btn-generar-soap-texto"
          className="btn-primary py-2.5 px-5 text-sm font-semibold relative z-20"
          aria-busy={generating}
          onClick={handleGenerarSoap}
        >
          {generating ? <Loader2 className="w-4 h-4 animate-spin pointer-events-none" /> : <FileText className="w-4 h-4 pointer-events-none" />}
          {generating ? 'Sintetizando nota…' : 'Generar SOAP desde texto'}
        </button>
      </div>
    </section>
  );
}

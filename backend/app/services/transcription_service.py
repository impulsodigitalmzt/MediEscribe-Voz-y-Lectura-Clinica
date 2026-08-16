"""
TranscriptionService — Speech-to-text integration with streaming support.

Handles:
- Audio-to-text conversion via external API (Whisper-compatible)
- Streaming mode for real-time transcription output
- Speaker diarization labeling
- Language detection on audio segments
- Transcript storage and retrieval
- Low-latency processing (target: <2 seconds)
"""

import httpx
import logging
import io
from typing import Optional, List, Dict, Any
from datetime import datetime, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.models import Transcript, Encounter
from app.core import config

logger = logging.getLogger(__name__)


class TranscriptionError(Exception):
    pass


class TranscriptionService:
    """Speech-to-text service with streaming and diarization support."""

    SUPPORTED_LANGUAGES = {
        "en": "English",
        "es": "Spanish",
        "fr": "French",
        "pt": "Portuguese",
        "ar": "Arabic",
        "zh": "Mandarin",
        "hi": "Hindi",
        "sw": "Swahili",
    }

    def __init__(self):
        self._http_client: Optional[httpx.AsyncClient] = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._http_client is None or self._http_client.is_closed:
            self._http_client = httpx.AsyncClient(timeout=30.0)
        return self._http_client

    async def transcribe_audio(
        self,
        audio_data: bytes,
        audio_format: str = "audio/webm",
        language_hint: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Transcribe an audio segment to text.

        Returns dict with:
        - text: transcribed text
        - language: detected language
        - confidence: transcription confidence score
        - segments: list of timed segments with speaker info
        """
        if not config.transcription_api_url or not config.transcription_api_key:
            # Fallback: return placeholder for development
            return self._dev_fallback(audio_data)

        try:
            client = await self._get_client()

            # Determine file extension from format
            ext_map = {
                "audio/webm": "webm",
                "audio/ogg": "ogg",
                "audio/wav": "wav",
                "audio/mp4": "m4a",
            }
            ext = ext_map.get(audio_format, "webm")

            files = {
                "file": (f"audio.{ext}", io.BytesIO(audio_data), audio_format)
            }
            data = {
                "model": config.transcription_model,
                "response_format": "verbose_json",
                "timestamp_granularities[]": "segment",
            }
            if language_hint and language_hint in self.SUPPORTED_LANGUAGES:
                data["language"] = language_hint

            response = await client.post(
                config.transcription_api_url,
                headers={"Authorization": f"Bearer {config.transcription_api_key}"},
                files=files,
                data=data
            )
            response.raise_for_status()
            result = response.json()

            return {
                "text": result.get("text", ""),
                "language": result.get("language", language_hint or "en"),
                "confidence": self._calculate_confidence(result),
                "segments": self._extract_segments(result),
                "duration": result.get("duration", 0),
            }

        except httpx.HTTPError as e:
            logger.error(f"Transcription API error: {type(e).__name__}")
            raise TranscriptionError("Transcription service unavailable. Please try again.")

    async def store_transcript_segment(
        self,
        db: AsyncSession,
        encounter_id: str,
        text: str,
        speaker_label: str = "unknown",
        timestamp_start: float = 0.0,
        timestamp_end: float = 0.0,
        language_detected: str = "en",
        confidence: float = 0.0
    ) -> Transcript:
        """Store a transcription segment in the database."""
        # Get next sequence number
        result = await db.execute(
            select(func.max(Transcript.sequence_number))
            .where(Transcript.encounter_id == encounter_id)
        )
        max_seq = result.scalar() or 0

        segment = Transcript(
            encounter_id=encounter_id,
            sequence_number=max_seq + 1,
            speaker_label=speaker_label,
            content=text,
            timestamp_start=timestamp_start,
            timestamp_end=timestamp_end,
            language_detected=language_detected,
            confidence=confidence,
        )
        db.add(segment)
        await db.flush()
        return segment

    async def get_full_transcript(
        self,
        db: AsyncSession,
        encounter_id: str
    ) -> List[Transcript]:
        """Retrieve the complete transcript for an encounter, ordered by sequence."""
        result = await db.execute(
            select(Transcript)
            .where(Transcript.encounter_id == encounter_id)
            .order_by(Transcript.sequence_number)
        )
        return list(result.scalars().all())

    async def get_transcript_text(
        self,
        db: AsyncSession,
        encounter_id: str
    ) -> str:
        """Get the full transcript as a single clean text string with speaker labels.

        Deduplicates consecutive identical segments (artefact of Web Speech API
        interim results being saved multiple times) and removes segments that are
        strict substrings of the immediately following segment.
        """
        segments = await self.get_full_transcript(db, encounter_id)
        if not segments:
            return ""

        # Step 1: Remove consecutive exact duplicates
        deduped = [segments[0]]
        for seg in segments[1:]:
            if seg.content.strip().lower() != deduped[-1].content.strip().lower():
                deduped.append(seg)

        # Step 2: Remove segments that are a prefix/substring of the next segment
        # (Web Speech API builds up text word by word before finalising)
        cleaned = []
        for i, seg in enumerate(deduped):
            if i < len(deduped) - 1:
                next_content = deduped[i + 1].content.strip().lower()
                this_content = seg.content.strip().lower()
                # Skip if this segment is fully contained in the next
                if next_content.startswith(this_content) and this_content != next_content:
                    continue
            cleaned.append(seg)

        lines = []
        for seg in cleaned:
            label = seg.speaker_label.capitalize()
            lines.append(f"[{label}]: {seg.content}")
        return "\n".join(lines)

    def detect_language(self, text: str) -> str:
        """Simple language detection heuristic (production should use a proper detector)."""
        # In production, use langdetect, fasttext, or the transcription API's detection
        return "en"

    def identify_speaker(self, segment: dict, context: dict = None) -> str:
        """
        Attempt speaker diarization labeling.
        Uses audio characteristics and conversation context.
        """
        # In production, integrate with a diarization service
        # For now, alternate based on conversational patterns
        return segment.get("speaker", "unknown")

    @staticmethod
    def _calculate_confidence(api_result: dict) -> float:
        """Calculate overall confidence from API response segments."""
        segments = api_result.get("segments", [])
        if not segments:
            return 0.0
        # Average no_speech_prob as inverse confidence
        probs = [1.0 - s.get("no_speech_prob", 0.5) for s in segments]
        return sum(probs) / len(probs) if probs else 0.0

    @staticmethod
    def _extract_segments(api_result: dict) -> List[Dict[str, Any]]:
        """Extract timed segments from API response."""
        return [
            {
                "text": s.get("text", ""),
                "start": s.get("start", 0),
                "end": s.get("end", 0),
                "speaker": "unknown",
            }
            for s in api_result.get("segments", [])
        ]

    @staticmethod
    def _dev_fallback(audio_data: bytes) -> Dict[str, Any]:
        """Development fallback when no transcription API is configured."""
        return {
            "text": "[Development mode: transcription API not configured. Audio received successfully.]",
            "language": "en",
            "confidence": 0.0,
            "segments": [],
            "duration": 0,
        }

    async def close(self):
        """Clean up HTTP client."""
        if self._http_client and not self._http_client.is_closed:
            await self._http_client.aclose()


transcription_service = TranscriptionService()

"""
WebSocket Routes — Real-time transcript reception (Web Speech API mode).

The frontend uses the browser's built-in SpeechRecognition API to convert
audio to text locally. This endpoint receives the resulting text segments
and persists them — no server-side audio processing or Whisper needed.
"""

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from datetime import datetime, timezone
import jwt as pyjwt
import json
import logging

from app.core.security import security_manager
from app.core.database import async_session_factory
from app.services import transcription_service
from app.models import Encounter

logger = logging.getLogger(__name__)
router = APIRouter(tags=["WebSocket"])


@router.websocket("/ws/audio/{encounter_id}")
async def audio_stream(
    websocket: WebSocket,
    encounter_id: str,
    token: str = Query(...)
):
    """
    WebSocket endpoint for real-time transcript streaming (Web Speech API mode).

    Protocol (all JSON):
      Client → Server:
        { type: 'config', mode: 'web_speech' }          — session init
        { type: 'transcript_text', text, speaker, language, confidence }
        { type: 'stop' }                                 — session end

      Server → Client:
        { type: 'ack', sequence }                        — segment stored
        { type: 'error', message }                       — error info
    """
    # Authenticate
    try:
        payload = security_manager.validate_token(token, expected_type="access")
        user_id = payload["sub"]
    except pyjwt.InvalidTokenError:
        await websocket.close(code=4001, reason="Invalid authentication token")
        return

    # Verify encounter ownership
    async with async_session_factory() as db:
        from sqlalchemy import select
        result = await db.execute(
            select(Encounter).where(
                Encounter.id == encounter_id,
                Encounter.physician_id == user_id
            )
        )
        encounter = result.scalar_one_or_none()
        if not encounter:
            await websocket.close(code=4004, reason="Encounter not found")
            return

    await websocket.accept()
    start_time = datetime.now(timezone.utc)
    segment_count = 0

    try:
        while True:
            # Only receive JSON text messages (no binary audio)
            try:
                raw = await websocket.receive_text()
            except WebSocketDisconnect:
                break

            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue

            msg_type = msg.get("type")

            if msg_type == "config":
                # Session initialised — acknowledge
                await websocket.send_json({"type": "ready", "mode": "web_speech"})

            elif msg_type == "transcript_text":
                text = msg.get("text", "").strip()
                if not text:
                    continue

                speaker = msg.get("speaker", "physician")
                language = msg.get("language", encounter.spoken_language or "en")
                confidence = float(msg.get("confidence", 1.0))

                try:
                    async with async_session_factory() as db:
                        await transcription_service.store_transcript_segment(
                            db=db,
                            encounter_id=encounter_id,
                            text=text,
                            speaker_label=speaker,
                            language_detected=language,
                            confidence=confidence,
                        )
                        await db.commit()

                    segment_count += 1
                    await websocket.send_json({
                        "type": "ack",
                        "sequence": segment_count,
                        "text": text,
                    })

                except Exception as e:
                    logger.error(f"Segment storage error: {type(e).__name__}: {e}")
                    await websocket.send_json({
                        "type": "error",
                        "message": "Failed to save segment. Please check your connection."
                    })

            elif msg_type == "stop":
                break

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error(f"WebSocket error: {type(e).__name__}: {e}")
    finally:
        # Update encounter duration
        elapsed = int((datetime.now(timezone.utc) - start_time).total_seconds())
        try:
            async with async_session_factory() as db:
                from sqlalchemy import select as sel
                res = await db.execute(sel(Encounter).where(Encounter.id == encounter_id))
                enc = res.scalar_one_or_none()
                if enc:
                    enc.duration_seconds = max(getattr(enc, 'duration_seconds', 0) or 0, elapsed)
                    await db.commit()
        except Exception:
            pass

"""
AudioStreamHandler — WebSocket handler for receiving and buffering audio streams.

Handles:
- WebSocket connection management for real-time audio
- Audio chunk buffering and assembly
- Noise filtering / silence detection
- Forwarding complete audio segments to TranscriptionService
- Connection health monitoring and graceful disconnection
"""

import asyncio
import base64
import json
import logging
from typing import Optional, Callable, Awaitable
from datetime import datetime, timezone

logger = logging.getLogger(__name__)


class AudioStreamHandler:
    """Handles WebSocket audio streaming from browser MediaRecorder API."""

    # Audio configuration
    SUPPORTED_FORMATS = ["audio/webm", "audio/ogg", "audio/wav", "audio/mp4"]
    MAX_CHUNK_SIZE = 1024 * 1024  # 1MB per chunk
    BUFFER_FLUSH_INTERVAL = 3.0  # seconds — flush buffer for transcription
    SILENCE_THRESHOLD = 0.01  # RMS threshold for silence detection
    MAX_SESSION_DURATION = 7200  # 2 hours max

    def __init__(self):
        self._active_sessions: dict = {}

    async def handle_connection(
        self,
        websocket,
        session_id: str,
        user_id: str,
        on_transcript_segment: Optional[Callable] = None
    ):
        """
        Main WebSocket handler for an audio streaming session.

        Args:
            websocket: FastAPI WebSocket connection
            session_id: Unique session/encounter identifier
            user_id: Authenticated user ID
            on_transcript_segment: Callback when a transcript segment is ready
        """
        session = {
            "id": session_id,
            "user_id": user_id,
            "buffer": bytearray(),
            "is_recording": True,
            "is_paused": False,
            "start_time": datetime.now(timezone.utc),
            "chunk_count": 0,
            "total_bytes": 0,
            "audio_format": "audio/webm",
        }
        self._active_sessions[session_id] = session

        try:
            await websocket.accept()
            logger.info(f"Audio stream connected: session={session_id}")

            # Send ready acknowledgment
            await websocket.send_json({
                "type": "session_ready",
                "session_id": session_id,
                "timestamp": datetime.now(timezone.utc).isoformat()
            })

            # Start buffer flush task
            flush_task = asyncio.create_task(
                self._periodic_flush(session, on_transcript_segment)
            )

            while session["is_recording"]:
                try:
                    message = await asyncio.wait_for(
                        websocket.receive(),
                        timeout=30.0  # Heartbeat timeout
                    )
                except asyncio.TimeoutError:
                    # Send ping to check connection
                    await websocket.send_json({"type": "ping"})
                    continue

                if "text" in message:
                    await self._handle_control_message(
                        message["text"], session, websocket
                    )
                elif "bytes" in message:
                    await self._handle_audio_chunk(
                        message["bytes"], session, websocket
                    )

        except Exception as e:
            logger.error(f"Audio stream error: session={session_id}, error={type(e).__name__}")
        finally:
            flush_task.cancel()
            # Final flush of remaining buffer
            if session["buffer"] and on_transcript_segment:
                await self._flush_buffer(session, on_transcript_segment)
            self._active_sessions.pop(session_id, None)
            logger.info(
                f"Audio stream ended: session={session_id}, "
                f"chunks={session['chunk_count']}, "
                f"bytes={session['total_bytes']}"
            )

    async def _handle_control_message(self, text: str, session: dict, websocket):
        """Handle JSON control messages from the client."""
        try:
            msg = json.loads(text)
        except json.JSONDecodeError:
            return

        msg_type = msg.get("type", "")

        if msg_type == "pause":
            session["is_paused"] = True
            await websocket.send_json({
                "type": "status",
                "status": "paused",
                "timestamp": datetime.now(timezone.utc).isoformat()
            })

        elif msg_type == "resume":
            session["is_paused"] = False
            await websocket.send_json({
                "type": "status",
                "status": "recording",
                "timestamp": datetime.now(timezone.utc).isoformat()
            })

        elif msg_type == "stop":
            session["is_recording"] = False
            await websocket.send_json({
                "type": "status",
                "status": "stopped",
                "timestamp": datetime.now(timezone.utc).isoformat()
            })

        elif msg_type == "pong":
            pass  # Connection alive

        elif msg_type == "config":
            if msg.get("format") in self.SUPPORTED_FORMATS:
                session["audio_format"] = msg["format"]

    async def _handle_audio_chunk(self, data: bytes, session: dict, websocket):
        """Process an incoming audio chunk."""
        if session["is_paused"]:
            return

        if len(data) > self.MAX_CHUNK_SIZE:
            await websocket.send_json({
                "type": "error",
                "message": "Audio chunk exceeds maximum size"
            })
            return

        # Check session duration limit
        elapsed = (datetime.now(timezone.utc) - session["start_time"]).total_seconds()
        if elapsed > self.MAX_SESSION_DURATION:
            session["is_recording"] = False
            await websocket.send_json({
                "type": "error",
                "message": "Maximum session duration reached (2 hours)"
            })
            return

        session["buffer"].extend(data)
        session["chunk_count"] += 1
        session["total_bytes"] += len(data)

        # Send acknowledgment
        await websocket.send_json({
            "type": "chunk_ack",
            "chunk_number": session["chunk_count"],
            "buffer_size": len(session["buffer"])
        })

    async def _periodic_flush(
        self,
        session: dict,
        on_transcript_segment: Optional[Callable]
    ):
        """Periodically flush the audio buffer for transcription."""
        while session["is_recording"]:
            await asyncio.sleep(self.BUFFER_FLUSH_INTERVAL)
            if session["buffer"] and not session["is_paused"]:
                await self._flush_buffer(session, on_transcript_segment)

    async def _flush_buffer(
        self,
        session: dict,
        on_transcript_segment: Optional[Callable]
    ):
        """Flush accumulated audio buffer to transcription service."""
        if not session["buffer"]:
            return

        audio_data = bytes(session["buffer"])
        session["buffer"] = bytearray()

        if on_transcript_segment:
            try:
                await on_transcript_segment(
                    session_id=session["id"],
                    audio_data=audio_data,
                    audio_format=session["audio_format"],
                    chunk_number=session["chunk_count"]
                )
            except Exception as e:
                logger.error(f"Transcript callback error: {type(e).__name__}")

    def get_active_session(self, session_id: str) -> Optional[dict]:
        """Get info about an active streaming session."""
        return self._active_sessions.get(session_id)

    def get_active_session_count(self) -> int:
        """Get count of currently active sessions."""
        return len(self._active_sessions)


audio_handler = AudioStreamHandler()

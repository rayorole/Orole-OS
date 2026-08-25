import { useCallback, useEffect, useRef, useState } from "react";
import { createVoiceLoop, type VoiceState } from "../lib/voice";

const STATE_LABEL: Record<VoiceState, string> = {
  idle: "Hold to talk",
  recording: "Listening… release to send",
  transcribing: "Transcribing…",
  thinking: "Hermes is thinking…",
  speaking: "Speaking…",
  error: "Error",
};

export function PushToTalk() {
  const [state, setState] = useState<VoiceState>("idle");
  const [detail, setDetail] = useState<string>();
  const [transcript, setTranscript] = useState("");
  const [reply, setReply] = useState("");
  const loopRef = useRef<ReturnType<typeof createVoiceLoop> | null>(null);

  useEffect(() => {
    loopRef.current = createVoiceLoop({
      onState: (s, d) => {
        setState(s);
        setDetail(d);
      },
      onTranscript: setTranscript,
      onReply: (text) => setReply(text),
    });
    return () => {
      // Release mic if unmounted mid-recording
      if (state === "recording") void loopRef.current?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const down = useCallback(() => {
    void loopRef.current?.start();
  }, []);
  const up = useCallback(() => {
    void loopRef.current?.stop();
  }, []);

  // Space bar push-to-talk
  useEffect(() => {
    const kd = (e: KeyboardEvent) => {
      if (e.code === "Space" && !e.repeat && !(e.target as HTMLElement)?.closest("input,textarea")) {
        e.preventDefault();
        down();
      }
    };
    const ku = (e: KeyboardEvent) => {
      if (e.code === "Space") up();
    };
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    return () => {
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
    };
  }, [down, up]);

  return (
    <div className="voice-panel">
      <button
        className={`ptt-btn ${state}`}
        onPointerDown={down}
        onPointerUp={up}
        onPointerLeave={up}
        disabled={state !== "idle" && state !== "recording"}
        aria-label="Push to talk"
      >
        <span className="ptt-icon">{state === "recording" ? "●" : "🎙"}</span>
        <span className="ptt-label">{STATE_LABEL[state]}</span>
      </button>
      {state === "error" && <p className="voice-error" role="alert">{detail ?? "Something went wrong"}</p>}
      {transcript && (
        <p className="voice-transcript">
          <strong>You:</strong> {transcript}
        </p>
      )}
      {reply && (
        <p className="voice-reply">
          <strong>Hermes:</strong> {reply}
        </p>
      )}
    </div>
  );
}

type Props = {
  levels: number[];
};

export default function VoiceEqualizer({ levels }: Props) {
  const bars = levels.length ? levels : Array.from({ length: 32 }, () => 0.12);
  return (
    <div
      role="status"
      aria-label="Micrófono activo, nivel de audio"
      style={{
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        gap: 3,
        height: 96,
        padding: "8px 4px",
        borderRadius: 12,
        background: "rgba(127, 29, 29, 0.35)",
        border: "2px solid #f87171",
      }}
    >
      {bars.map((level, index) => {
        const loud = level > 0.55;
        const height = Math.max(8, Math.round(10 + level * 78));
        return (
          <span
            key={index}
            style={{
              display: "inline-block",
              width: 5,
              height,
              borderRadius: 99,
              background: loud
                ? "linear-gradient(to top, #991b1b, #fca5a5)"
                : "linear-gradient(to top, #0f766e, #5eead4)",
              boxShadow: loud ? "0 0 10px rgba(252, 165, 165, 0.7)" : "0 0 8px rgba(45, 212, 191, 0.55)",
              transition: "height 50ms linear",
            }}
          />
        );
      })}
    </div>
  );
}

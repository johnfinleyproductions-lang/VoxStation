"use client";

interface StatusBarProps {
  status: {
    voice: boolean;
    ollama: boolean;
    rag: boolean;
  };
}

export function StatusBar({ status }: StatusBarProps) {
  return (
    <div className="flex items-center gap-4 px-4 py-1.5 border-t border-[var(--border)] bg-[var(--surface)]">
      <StatusDot label="Voice Service" active={status.voice} />
      <StatusDot label="Ollama" active={status.ollama} />
      <StatusDot label="RAG" active={status.rag} />
      <div className="ml-auto text-[10px] text-[var(--muted)]">
        Framestation 395 &middot; RTX PRO 4500
      </div>
    </div>
  );
}

function StatusDot({ label, active }: { label: string; active: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <div
        className={`w-1.5 h-1.5 rounded-full ${
          active ? "bg-emerald-400" : "bg-[var(--muted)]"
        }`}
      />
      <span className="text-[10px] text-[var(--muted)]">{label}</span>
    </div>
  );
}

import { useState, useEffect, useCallback } from "react";

interface EditorProps {
  content: string;
  onSave: (content: string) => Promise<void>;
}

export function Editor({ content, onSave }: EditorProps) {
  const [value, setValue] = useState(content);
  const [saving, setSaving] = useState(false);
  const dirty = value !== content;

  useEffect(() => {
    setValue(content);
  }, [content]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await onSave(value);
    } finally {
      setSaving(false);
    }
  }, [value, onSave]);

  // Ctrl/Cmd+S to save
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (dirty) void handleSave();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [dirty, handleSave]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-neutral-200 px-3 py-1.5">
        <button
          type="button"
          disabled={!dirty || saving}
          onClick={() => void handleSave()}
          className="rounded bg-blue-600 px-3 py-1 text-xs text-white disabled:opacity-40"
        >
          {saving ? "Saving..." : "Save"}
        </button>
        {dirty && (
          <span className="text-xs text-amber-600">unsaved changes</span>
        )}
      </div>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        spellCheck={false}
        className="flex-1 resize-none bg-white p-3 font-mono text-sm leading-relaxed outline-none"
      />
    </div>
  );
}

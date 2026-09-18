"use client";

import type { FormEvent, KeyboardEvent } from "react";
import { memo, useCallback, useEffect, useRef, useState } from "react";

type Role = "user" | "assistant";
type Message = { id: string; role: Role; content: string; reasoning?: string; error?: boolean };
type Settings = {
  systemPrompt: string; temperature: number; topP: number; maxTokens: number;
  enableThinking: boolean; thinkingBudget: number; topK: number; minP: number;
  repetitionPenalty: number; presencePenalty: number; frequencyPenalty: number;
  stream: boolean;
};

const DEFAULTS: Settings = {
  systemPrompt: "", temperature: 0, topP: 1, maxTokens: 2048,
  enableThinking: false, thinkingBudget: 1024, topK: 0, minP: 0,
  repetitionPenalty: 1, presencePenalty: 0, frequencyPenalty: 0,
  stream: true,
};
const SETTINGS_STORAGE_KEY = "model-settings";

function loadSettings(): Settings {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? "null");
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) return DEFAULTS;

    return Object.fromEntries(Object.entries(DEFAULTS).map(([key, fallback]) => {
      const value = (stored as Record<string, unknown>)[key];
      return [key, typeof value === typeof fallback ? value : fallback];
    })) as Settings;
  } catch {
    return DEFAULTS;
  }
}
const id = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.map((item) => typeof item === "string" ? item :
    item && typeof item === "object" && "text" in item ? String(item.text ?? "") : "").join("");
}

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [settings, setSettings] = useState(loadSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [saved, setSaved] = useState(true);
  const firstSave = useRef(true);
  const [confirmReset, setConfirmReset] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [model, setModel] = useState("");
  const [online, setOnline] = useState<boolean | null>(null);
  const [copied, setCopied] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const conversationRef = useRef<HTMLElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const closeSettingsRef = useRef<HTMLButtonElement>(null);
  const shortcutsButtonRef = useRef<HTMLButtonElement>(null);
  const closeShortcutsRef = useRef<HTMLButtonElement>(null);
  const pinRef = useRef<string | null>(null);
  const regenerateRef = useRef<() => void>(() => {});
  const regenerate = useCallback(() => regenerateRef.current(), []);

  useEffect(() => {
    if (firstSave.current) { firstSave.current = false; return; }
    setSaved(false);
    const timer = window.setTimeout(() => {
      try { localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings)); }
      catch { /* Keep settings usable when browser storage is unavailable. */ }
      setSaved(true);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [settings]);
  useEffect(() => {
    function flush() {
      try { localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings)); }
      catch { /* Keep settings usable when browser storage is unavailable. */ }
    }
    function onVisibility() { if (document.visibilityState === "hidden") flush(); }
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [settings]);
  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    let active = true; let timer = 0;
    async function probe() {
      let nextModel = "";
      try {
        const response = await fetch("/api/models", { cache: "no-store" });
        if (!response.ok) throw new Error();
        const data = await response.json();
        nextModel = data?.data?.[0]?.id ?? "";
      } catch { /* An unreachable service is simply an unavailable model. */ }
      if (!active) return;
      setModel(nextModel);
      setOnline(Boolean(nextModel));
      timer = window.setTimeout(probe, 5000);
    }
    void probe();
    return () => { active = false; window.clearTimeout(timer); };
  }, []);

  useEffect(() => {
    const container = conversationRef.current;
    const targetId = pinRef.current; pinRef.current = null;
    if (!container || !targetId) return;
    const target = container.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(targetId)}"]`);
    if (!target) return;
    const offset = parseFloat(getComputedStyle(container).paddingTop) || 0;
    const delta = target.getBoundingClientRect().top - container.getBoundingClientRect().top;
    container.scrollTo({ top: Math.max(0, container.scrollTop + delta - offset), behavior: "smooth" });
  }, [messages]);
  useEffect(() => {
    const el = textareaRef.current; if (!el) return;
    el.style.height = "0px"; el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [input]);
  useEffect(() => {
    document.body.style.overflow = settingsOpen || shortcutsOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [settingsOpen, shortcutsOpen]);
  useEffect(() => {
    if (settingsOpen) closeSettingsRef.current?.focus(); else textareaRef.current?.focus();
    if (!settingsOpen) setConfirmReset(false);
  }, [settingsOpen]);
  useEffect(() => {
    if (shortcutsOpen) closeShortcutsRef.current?.focus();
  }, [shortcutsOpen]);
  useEffect(() => {
    if (!confirmReset) return;
    const timer = window.setTimeout(() => setConfirmReset(false), 3500);
    return () => window.clearTimeout(timer);
  }, [confirmReset]);
  useEffect(() => {
    if (!settingsOpen && !shortcutsOpen) return;
    function closeOnEscape(event: globalThis.KeyboardEvent) {
      if (shortcutsOpen && event.key === "Tab") {
        event.preventDefault();
        closeShortcutsRef.current?.focus();
        return;
      }
      if (event.key !== "Escape" && event.key !== "Esc" && event.code !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (shortcutsOpen) {
        setShortcutsOpen(false);
        window.setTimeout(() => shortcutsButtonRef.current?.focus());
      } else {
        setSettingsOpen(false);
      }
    }
    document.addEventListener("keydown", closeOnEscape, true);
    return () => document.removeEventListener("keydown", closeOnEscape, true);
  }, [settingsOpen, shortcutsOpen]);
  useEffect(() => {
    function handleShortcut(event: globalThis.KeyboardEvent) {
      const target = event.target;
      const editing = target instanceof HTMLElement && (target.isContentEditable || target.matches("input, textarea, select"));
      if (event.key === "?" && !event.metaKey && !event.ctrlKey && !event.altKey && !editing) {
        event.preventDefault();
        setSettingsOpen(false);
        setShortcutsOpen(true);
        return;
      }
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === ",") {
        event.preventDefault();
        setSettingsOpen((open) => !open);
      } else if (key === "k") {
        event.preventDefault();
        clear();
      }
    }
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [messages.length]);

  const updateAssistant = (messageId: string, patch: Partial<Message>) =>
    setMessages((current) => current.map((message) => message.id === messageId ? { ...message, ...patch } : message));
  const update = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setSettings((current) => ({ ...current, [key]: value }));

  async function complete(conversation: Message[], pin: "user" | "reply" = "user") {
    if (!model || generating) return;
    const assistantId = id();
    const controller = new AbortController(); abortRef.current = controller;
    setGenerating(true);
    pinRef.current = pin === "reply" ? assistantId : conversation[conversation.length - 1]?.id ?? null;
    setMessages([...conversation, { id: assistantId, role: "assistant", content: "" }]);

    const apiMessages: { role: string; content: string }[] = conversation.map(({ role, content }) => ({ role, content }));
    if (settings.systemPrompt.trim()) apiMessages.unshift({ role: "system", content: settings.systemPrompt.trim() });
    const body = {
      model, messages: apiMessages, stream: settings.stream,
      max_tokens: settings.maxTokens, temperature: settings.temperature,
      top_p: settings.topP, top_k: settings.topK, min_p: settings.minP,
      repetition_penalty: settings.repetitionPenalty,
      presence_penalty: settings.presencePenalty,
      frequency_penalty: settings.frequencyPenalty,
      seed: Date.now() % 2_147_483_648,
      enable_thinking: settings.enableThinking,
      ...(settings.enableThinking ? { thinking_budget: settings.thinkingBudget } : {}),
    };

    try {
      const response = await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body), signal: controller.signal,
      });
      if (!response.ok) throw new Error((await response.text()) || `Request failed (${response.status})`);

      if (!settings.stream) {
        const data = await response.json(); const reply = data?.choices?.[0]?.message;
        updateAssistant(assistantId, { content: textOf(reply?.content), reasoning: textOf(reply?.reasoning_content ?? reply?.reasoning) });
      } else {
        if (!response.body) throw new Error("The service returned no data stream");
        const reader = response.body.getReader(); const decoder = new TextDecoder();
        let buffer = "", content = "", reasoning = "";
        while (true) {
          const { value, done } = await reader.read();
          buffer += decoder.decode(value, { stream: !done });
          const lines = buffer.split(/\r?\n/); buffer = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim(); if (!trimmed.startsWith("data:")) continue;
            const payload = trimmed.slice(5).trim(); if (!payload || payload === "[DONE]") continue;
            try {
              const delta = JSON.parse(payload)?.choices?.[0]?.delta;
              content += textOf(delta?.content);
              reasoning += textOf(delta?.reasoning_content ?? delta?.reasoning);
              updateAssistant(assistantId, { content, reasoning });
            } catch { /* Ignore incomplete events without losing the stream. */ }
          }
          if (done) break;
        }
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setMessages((current) => current.filter((message) => message.id !== assistantId || message.content));
        return;
      }
      updateAssistant(assistantId, { content: `There was a problem connecting to the model: ${error instanceof Error ? error.message : "Unknown error"}`, error: true });
    } finally { setGenerating(false); abortRef.current = null; }
  }

  function send() {
    const value = input.trim(); if (!value || generating || !model) return;
    setInput("");
    void complete([...messages.filter((message) => !message.error), { id: id(), role: "user", content: value }]);
  }
  function submit(event: FormEvent) { event.preventDefault(); send(); }
  function keydown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Escape" && generating) { event.preventDefault(); abortRef.current?.abort(); }
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    if (event.metaKey || event.ctrlKey) {
      event.preventDefault();
      const target = event.currentTarget;
      const { selectionStart, selectionEnd, value } = target;
      target.value = `${value.slice(0, selectionStart)}\n${value.slice(selectionEnd)}`;
      target.selectionStart = target.selectionEnd = selectionStart + 1;
      setInput(target.value);
    } else {
      event.preventDefault();
      send();
    }
  }
  function clear() { abortRef.current?.abort(); setMessages([]); setInput(""); textareaRef.current?.focus(); }
  const copy = useCallback(async (text: string, copyId: string) => {
    try {
      await navigator.clipboard.writeText(text); setCopied(copyId);
      window.setTimeout(() => setCopied(""), 1400);
    } catch { /* Clipboard can be unavailable; keep the UI responsive. */ }
  }, []);
  regenerateRef.current = () => {
    if (generating) return;
    const index = messages.findLastIndex((message) => message.role === "user");
    if (index >= 0) void complete(messages.slice(0, index + 1), "reply");
  };

  const modelLabel = model ? model.split("/").filter(Boolean).pop() : "Connecting";
  const hasUnsavedSettings = !saved;
  return (
    <main className="app-shell">
      <div className="ambient ambient-one" /><div className="ambient ambient-two" />
      <header className="topbar">
        <div className="brand"><span className="brand-mark">Q</span><div><strong>Quiet</strong><span className="model-line" title={online === false ? "Model service unavailable" : model || "Connecting to model"}><i className={`status-dot ${online === false ? "offline" : ""}`} />{online === false ? "Model offline" : modelLabel}</span></div></div>
        <div className="top-actions">
          {messages.length > 0 && <button className="text-button" type="button" onClick={clear} aria-keyshortcuts="Control+K Meta+K" title="Clear conversation (⌘/Ctrl K)">Clear</button>}
          <button className="shortcuts-button" type="button" ref={shortcutsButtonRef} onClick={() => setShortcutsOpen(true)} aria-label="View keyboard shortcuts" aria-haspopup="dialog" aria-keyshortcuts="?" title="Keyboard shortcuts (?)">?</button>
          <button className="settings-button" type="button" onClick={() => setSettingsOpen(true)} aria-label={hasUnsavedSettings ? "Open model settings, unsaved changes" : "Open model settings"} aria-keyshortcuts="Control+, Meta+," title={hasUnsavedSettings ? "Open model settings (unsaved changes, ⌘/Ctrl ,)" : "Open model settings (⌘/Ctrl ,)"}><span className="tune-icon" aria-hidden="true"><i /><i /><i /></span>SET{hasUnsavedSettings && <i className="tuned-dot" aria-hidden="true" />}</button>
        </div>
      </header>

      <section className={`conversation ${messages.length ? "active" : ""}`} ref={conversationRef}>
        {messages.length === 0 ? <div className="empty-state">
          <div className="orb"><span /></div>
        </div> : <div className="message-list">
          {messages.map((message, index) => <MessageItem key={message.id} message={message} isLast={index === messages.length - 1} generating={generating} copied={copied === message.id || copied.startsWith(`${message.id}:`) ? copied : ""} copy={copy} regenerate={regenerate} />)}
        </div>}
      </section>

      <p className="sr-only" aria-live="polite">{generating ? "Generating response" : ""}</p>

      <div className="composer-wrap"><form className="composer" onSubmit={submit}>
        <textarea ref={textareaRef} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={keydown} spellCheck={false} autoComplete="off" enterKeyHint="send" placeholder={online === false ? "Model service unavailable" : generating ? "Generating, press Esc to stop…" : "Type a message…"} rows={1} aria-label="Chat message" />
        {generating ? <button className="send-button stop" type="button" onClick={() => abortRef.current?.abort()} aria-label="Stop generating" title="Stop generating (Esc)"><span /></button> : <button className="send-button" type="submit" disabled={!input.trim() || !model} aria-label="Send message" title="Send message (Enter)">↑</button>}
      </form></div>

      {shortcutsOpen && <div className="shortcuts-layer" role="presentation">
        <button className="shortcuts-backdrop" type="button" tabIndex={-1} aria-label="Close keyboard shortcuts" onClick={() => { setShortcutsOpen(false); shortcutsButtonRef.current?.focus(); }} />
        <section className="shortcuts-dialog" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title">
          <div className="shortcuts-header"><div><span>QUICK KEYS</span><h2 id="shortcuts-title">Keyboard Shortcuts</h2></div><button className="close-button" type="button" ref={closeShortcutsRef} onClick={() => { setShortcutsOpen(false); shortcutsButtonRef.current?.focus(); }} aria-label="Close" aria-keyshortcuts="Escape" title="Close (Esc)">×</button></div>
          <dl className="shortcut-list">
            <div><dt>Send message</dt><dd><kbd>Enter</kbd></dd></div>
            <div><dt>Insert line break</dt><dd><kbd>⌘/Ctrl</kbd><kbd>Enter</kbd></dd></div>
            <div><dt>Stop generating</dt><dd><kbd>Esc</kbd></dd></div>
            <div><dt>Clear conversation</dt><dd><kbd>⌘/Ctrl</kbd><kbd>K</kbd></dd></div>
            <div><dt>Model settings</dt><dd><kbd>⌘/Ctrl</kbd><kbd>,</kbd></dd></div>
            <div><dt>Shortcut help</dt><dd><kbd>?</kbd></dd></div>
          </dl>
        </section>
      </div>}

      {settingsOpen && <div className="settings-layer" role="presentation">
        <button className="settings-backdrop" type="button" aria-label="Close model settings" onClick={() => setSettingsOpen(false)} />
        <aside className="settings-panel" role="dialog" aria-modal="true" aria-label="Model settings">
          <div className="panel-header"><h2>Model Settings</h2><button className="close-button" type="button" ref={closeSettingsRef} onClick={() => setSettingsOpen(false)} aria-label="Close" aria-keyshortcuts="Escape" title="Close (Esc)">×</button></div>
          <div className="panel-scroll">
            <label className="field"><span>System Prompt</span><textarea value={settings.systemPrompt} onChange={(e) => update("systemPrompt", e.target.value)} placeholder="For example: Keep answers accurate and concise." rows={4} /></label>
            <Toggle label="Streaming" hint="Display model output as it is generated" checked={settings.stream} change={(stream) => update("stream", stream)} />
            <Range label="Temperature" value={settings.temperature} min={0} max={2} step={0.05} change={(temperature) => update("temperature", temperature)} />
            <Range label="Top P" value={settings.topP} min={0} max={1} step={0.05} change={(topP) => update("topP", topP)} />
            <NumberInput label="Max Tokens" value={settings.maxTokens} min={1} max={32768} change={(maxTokens) => update("maxTokens", maxTokens)} />
            <Toggle label="Thinking" hint="Show reasoning in a collapsible section" checked={settings.enableThinking} change={(enableThinking) => update("enableThinking", enableThinking)} />
            <NumberInput label="Thinking Budget" value={settings.thinkingBudget} min={1} max={32768} disabled={!settings.enableThinking} change={(thinkingBudget) => update("thinkingBudget", thinkingBudget)} />
            <NumberInput label="Top K" value={settings.topK} min={0} max={1000} change={(topK) => update("topK", topK)} />
            <Range label="Min P" value={settings.minP} min={0} max={1} step={0.01} change={(minP) => update("minP", minP)} />
            <NumberInput label="Repetition Penalty" value={settings.repetitionPenalty} min={0} max={2} step={0.05} change={(repetitionPenalty) => update("repetitionPenalty", repetitionPenalty)} />
            <NumberInput label="Presence Penalty" value={settings.presencePenalty} min={-2} max={2} step={0.05} change={(presencePenalty) => update("presencePenalty", presencePenalty)} />
            <NumberInput label="Frequency Penalty" value={settings.frequencyPenalty} min={-2} max={2} step={0.05} change={(frequencyPenalty) => update("frequencyPenalty", frequencyPenalty)} />
          </div>
          <div className="panel-footer">
            <button className={`reset-button ${confirmReset ? "confirming" : ""}`} type="button" onClick={() => { if (confirmReset) { setSettings(DEFAULTS); setConfirmReset(false); } else setConfirmReset(true); }}>{confirmReset ? "Confirm reset?" : "Restore defaults"}</button>
            <span className={`save-state ${saved ? "saved" : ""}`} aria-live="polite">{saved ? "Saved" : "Saving…"}</span>
          </div>
        </aside>
      </div>}
    </main>
  );
}

const MessageItem = memo(function MessageItem({ message, isLast, generating, copied, copy, regenerate }:
  { message: Message; isLast: boolean; generating: boolean; copied: string; copy: (text: string, copyId: string) => void; regenerate: () => void }) {
  return <article className={`message ${message.role} ${message.error ? "error" : ""}`} data-message-id={message.id} aria-busy={generating && isLast}>
    <div className="message-role">{message.role === "user" ? "You" : "Q"}</div>
    <div className="message-body">
      {message.reasoning && <details className="reasoning"><summary>{generating && isLast && !message.content ? "Thinking…" : "Reasoning"}</summary><div>{message.reasoning}</div></details>}
      {message.content ? <div className="message-content"><Content text={message.content} id={message.id} copy={copy} copied={copied} /></div> : <div className="thinking-indicator" aria-label="Generating"><span /><span /><span /></div>}
      {message.content && <div className="message-tools"><button type="button" onClick={() => void copy(message.content, message.id)}>{copied === message.id ? "Copied" : "Copy"}</button>{message.role === "assistant" && isLast && !generating && <button type="button" onClick={regenerate}>Regenerate</button>}</div>}
    </div>
  </article>;
});
function Content({ text, id, copy, copied }: { text: string; id: string; copy: (text: string, copyId: string) => void; copied: string }) {
  return <>{text.split("```").map((part, index) => {
    if (index % 2 === 0) return <span key={index}>{part.split(/(`[^`\n]+`)/g).map((piece, position) =>
      piece.length > 2 && piece.startsWith("`") && piece.endsWith("`") ? <code key={position}>{piece.slice(1, -1)}</code> : piece)}</span>;
    const [, lang = "", body] = part.match(/^([a-zA-Z0-9+#-]*)\r?\n([\s\S]*)$/) ?? [];
    const code = lang ? body : part;
    const codeId = `${id}:${index}`;
    return <pre key={index} className={`code-block${lang ? " with-lang" : ""}`}>
      {lang && <span className="code-lang">{lang}</span>}
      <button type="button" className="code-copy" onClick={() => copy(code, codeId)}>{copied === codeId ? "Copied" : "Copy"}</button>
      <code>{code}</code>
    </pre>;
  })}</>;
}
function Toggle({ label, hint, checked, change }: { label: string; hint: string; checked: boolean; change: (value: boolean) => void }) {
  return <label className="toggle-field"><span><strong>{label}</strong><small>{hint}</small></span><input type="checkbox" checked={checked} onChange={(e) => change(e.target.checked)} /><i aria-hidden="true" /></label>;
}
function Range({ label, value, min, max, step, change }: { label: string; value: number; min: number; max: number; step: number; change: (value: number) => void }) {
  return <label className="range-field"><span><strong>{label}</strong><output>{value}</output></span><input type="range" value={value} min={min} max={max} step={step} onChange={(e) => change(Number(e.target.value))} /></label>;
}
function NumberInput({ label, value, min, max, step = 1, disabled = false, change }: { label: string; value: number; min: number; max: number; step?: number; disabled?: boolean; change: (value: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return <label className={`number-field ${disabled ? "disabled" : ""}`}><strong>{label}</strong><input type="number" value={draft ?? String(value)} min={min} max={max} step={step} disabled={disabled}
    onChange={(e) => {
      setDraft(e.target.value);
      const next = Number(e.target.value);
      if (e.target.value !== "" && Number.isFinite(next)) change(Math.min(Math.max(next, min), max));
    }}
    onBlur={() => setDraft(null)} /></label>;
}

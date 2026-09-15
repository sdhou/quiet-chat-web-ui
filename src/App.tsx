"use client";

import type { FormEvent, KeyboardEvent } from "react";
import { useEffect, useRef, useState } from "react";

type Role = "user" | "assistant";
type Message = { id: string; role: Role; content: string; reasoning?: string; error?: boolean };
type Settings = {
  systemPrompt: string; temperature: number; topP: number; maxTokens: number;
  enableThinking: boolean; thinkingBudget: number; topK: number; minP: number;
  repetitionPenalty: number; presencePenalty: number; frequencyPenalty: number;
  seed: number; stream: boolean;
};

const DEFAULTS: Settings = {
  systemPrompt: "", temperature: 0, topP: 1, maxTokens: 2048,
  enableThinking: false, thinkingBudget: 1024, topK: 0, minP: 0,
  repetitionPenalty: 1, presencePenalty: 0, frequencyPenalty: 0,
  seed: 0, stream: true,
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
  const [saved, setSaved] = useState(true);
  const [confirmReset, setConfirmReset] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [model, setModel] = useState("");
  const [online, setOnline] = useState<boolean | null>(null);
  const [copied, setCopied] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const closeSettingsRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
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
  useEffect(() => {
    let active = true; let timer = 0;
    async function probe() {
      try {
        const response = await fetch("/api/models", { cache: "no-store" });
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (!active) return;
        setModel(data?.data?.[0]?.id ?? ""); setOnline(true);
      } catch {
        if (!active) return;
        setOnline(false); timer = window.setTimeout(probe, 5000);
      }
    }
    void probe();
    return () => { active = false; window.clearTimeout(timer); };
  }, []);

  useEffect(() => {
    const el = endRef.current;
    if (el && el.getBoundingClientRect().top < window.innerHeight + 80) {
      el.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [messages]);
  useEffect(() => {
    const el = textareaRef.current; if (!el) return;
    el.style.height = "0px"; el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [input]);
  useEffect(() => {
    document.body.style.overflow = settingsOpen ? "hidden" : "";
    if (settingsOpen) closeSettingsRef.current?.focus(); else textareaRef.current?.focus();
    if (!settingsOpen) setConfirmReset(false);
    return () => { document.body.style.overflow = ""; };
  }, [settingsOpen]);
  useEffect(() => {
    if (!confirmReset) return;
    const timer = window.setTimeout(() => setConfirmReset(false), 3500);
    return () => window.clearTimeout(timer);
  }, [confirmReset]);
  useEffect(() => {
    if (!settingsOpen) return;
    function closeOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape" && event.key !== "Esc" && event.code !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setSettingsOpen(false);
    }
    document.addEventListener("keydown", closeOnEscape, true);
    return () => document.removeEventListener("keydown", closeOnEscape, true);
  }, [settingsOpen]);
  useEffect(() => {
    function handleShortcut(event: globalThis.KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === ",") {
        event.preventDefault();
        setSettingsOpen((open) => !open);
      } else if (key === "k") {
        event.preventDefault();
        abortRef.current?.abort();
        setMessages([]);
        setInput("");
        textareaRef.current?.focus();
      }
    }
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  const updateAssistant = (messageId: string, patch: Partial<Message>) =>
    setMessages((current) => current.map((message) => message.id === messageId ? { ...message, ...patch } : message));
  const update = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setSettings((current) => ({ ...current, [key]: value }));

  async function complete(conversation: Message[]) {
    if (!model || generating) return;
    const assistantId = id();
    const controller = new AbortController(); abortRef.current = controller;
    setGenerating(true);
    setMessages([...conversation, { id: assistantId, role: "assistant", content: "" }]);

    const apiMessages: { role: string; content: string }[] = conversation.map(({ role, content }) => ({ role, content }));
    if (settings.systemPrompt.trim()) apiMessages.unshift({ role: "system", content: settings.systemPrompt.trim() });
    const body = {
      model, messages: apiMessages, stream: settings.stream,
      max_tokens: settings.maxTokens, temperature: settings.temperature,
      top_p: settings.topP, top_k: settings.topK, min_p: settings.minP,
      repetition_penalty: settings.repetitionPenalty,
      presence_penalty: settings.presencePenalty,
      frequency_penalty: settings.frequencyPenalty, seed: settings.seed,
      enable_thinking: settings.enableThinking,
      ...(settings.enableThinking ? { thinking_budget: settings.thinkingBudget } : {}),
    };

    try {
      const response = await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body), signal: controller.signal,
      });
      if (!response.ok) throw new Error((await response.text()) || `请求失败 (${response.status})`);

      if (!settings.stream) {
        const data = await response.json(); const reply = data?.choices?.[0]?.message;
        updateAssistant(assistantId, { content: textOf(reply?.content), reasoning: textOf(reply?.reasoning_content ?? reply?.reasoning) });
      } else {
        if (!response.body) throw new Error("服务未返回数据流");
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
      updateAssistant(assistantId, { content: `连接模型时出现问题：${error instanceof Error ? error.message : "未知错误"}`, error: true });
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
  function regenerate() {
    if (generating) return;
    const index = messages.findLastIndex((message) => message.role === "user");
    if (index >= 0) void complete(messages.slice(0, index + 1));
  }
  async function copy(message: Message) {
    await navigator.clipboard.writeText(message.content); setCopied(message.id);
    window.setTimeout(() => setCopied(""), 1400);
  }

  const modelLabel = model ? model.split("/").filter(Boolean).pop() : "正在连接";
  return (
    <main className="app-shell">
      <div className="ambient ambient-one" /><div className="ambient ambient-two" />
      <header className="topbar">
        <div className="brand"><span className="brand-mark">Q</span><div><strong>Quiet</strong><span className="model-line" title={model || "正在连接模型"}><i className={`status-dot ${online === false ? "offline" : ""}`} />{online === false ? "模型离线" : modelLabel}</span></div></div>
        <div className="top-actions">
          {messages.length > 0 && <button className="text-button" type="button" onClick={clear} aria-keyshortcuts="Control+K Meta+K" title="清空对话（⌘/Ctrl K）">清空</button>}
          <button className="settings-button" type="button" onClick={() => setSettingsOpen(true)} aria-label="打开模型参数" aria-keyshortcuts="Control+, Meta+," title="打开模型参数（⌘/Ctrl ,）"><span className="tune-icon" aria-hidden="true"><i /><i /><i /></span>参数</button>
        </div>
      </header>

      <section className={`conversation ${messages.length ? "active" : ""}`}>
        {messages.length === 0 ? <div className="empty-state">
          <div className="orb"><span /></div>
        </div> : <div className="message-list" aria-live="polite">
          {messages.map((message, index) => <article className={`message ${message.role} ${message.error ? "error" : ""}`} key={message.id} aria-busy={generating && index === messages.length - 1}>
            <div className="message-role">{message.role === "user" ? "你" : "Q"}</div>
            <div className="message-body">
              {message.reasoning && <details className="reasoning"><summary>思考过程</summary><div>{message.reasoning}</div></details>}
              {message.content ? <div className="message-content">{message.content}</div> : <div className="thinking-indicator" aria-label="正在生成"><span /><span /><span /></div>}
              {message.role === "assistant" && message.content && <div className="message-tools"><button type="button" onClick={() => void copy(message)}>{copied === message.id ? "已复制" : "复制"}</button>{index === messages.length - 1 && !generating && <button type="button" onClick={regenerate}>重新生成</button>}</div>}
            </div>
          </article>)}<div ref={endRef} />
        </div>}
      </section>

      <div className="composer-wrap"><form className="composer" onSubmit={submit}>
        <textarea ref={textareaRef} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={keydown} placeholder={online === false ? "模型服务未连接" : "输入消息…"} rows={1} disabled={online === false} aria-label="聊天消息" />
        {generating ? <button className="send-button stop" type="button" onClick={() => abortRef.current?.abort()} aria-label="停止生成" title="停止生成（Esc）"><span /></button> : <button className="send-button" type="submit" disabled={!input.trim() || !model} aria-label="发送消息" title="发送消息（Enter）">↑</button>}
      </form><p className="composer-note">
        <span><kbd>Enter</kbd>发送 · <kbd>⌘/Ctrl</kbd><kbd>Enter</kbd>换行</span>
        <span><kbd>⌘/Ctrl</kbd><kbd>,</kbd>参数</span>
        <span><kbd>⌘/Ctrl</kbd><kbd>K</kbd>清空</span>
        <span><kbd>Esc</kbd>{generating ? "停止生成" : "关闭面板"}</span>
      </p></div>

      {settingsOpen && <div className="settings-layer" role="presentation">
        <button className="settings-backdrop" type="button" aria-label="关闭模型参数" onClick={() => setSettingsOpen(false)} />
        <aside className="settings-panel" role="dialog" aria-modal="true" aria-label="模型参数">
          <div className="panel-header"><h2>模型参数</h2><button className="close-button" type="button" ref={closeSettingsRef} onClick={() => setSettingsOpen(false)} aria-label="关闭" aria-keyshortcuts="Escape" title="关闭（Esc）">×</button></div>
          <div className="panel-scroll">
            <label className="field"><span>System Prompt</span><textarea value={settings.systemPrompt} onChange={(e) => update("systemPrompt", e.target.value)} placeholder="例如：回答保持准确、简洁。" rows={4} /></label>
            <Toggle label="流式输出" hint="实时显示模型生成内容" checked={settings.stream} change={(stream) => update("stream", stream)} />
            <Range label="Temperature" value={settings.temperature} min={0} max={2} step={0.05} change={(temperature) => update("temperature", temperature)} />
            <Range label="Top P" value={settings.topP} min={0} max={1} step={0.05} change={(topP) => update("topP", topP)} />
            <NumberInput label="Max Tokens" value={settings.maxTokens} min={1} max={32768} change={(maxTokens) => update("maxTokens", maxTokens)} />
            <Toggle label="Thinking" hint="显示可折叠的思考内容" checked={settings.enableThinking} change={(enableThinking) => update("enableThinking", enableThinking)} />
            <NumberInput label="Thinking Budget" value={settings.thinkingBudget} min={1} max={32768} disabled={!settings.enableThinking} change={(thinkingBudget) => update("thinkingBudget", thinkingBudget)} />
            <NumberInput label="Top K" value={settings.topK} min={0} max={1000} change={(topK) => update("topK", topK)} />
            <Range label="Min P" value={settings.minP} min={0} max={1} step={0.01} change={(minP) => update("minP", minP)} />
            <NumberInput label="Repetition Penalty" value={settings.repetitionPenalty} min={0} max={2} step={0.05} change={(repetitionPenalty) => update("repetitionPenalty", repetitionPenalty)} />
            <NumberInput label="Presence Penalty" value={settings.presencePenalty} min={-2} max={2} step={0.05} change={(presencePenalty) => update("presencePenalty", presencePenalty)} />
            <NumberInput label="Frequency Penalty" value={settings.frequencyPenalty} min={-2} max={2} step={0.05} change={(frequencyPenalty) => update("frequencyPenalty", frequencyPenalty)} />
            <NumberInput label="Seed" value={settings.seed} min={0} max={2147483647} change={(seed) => update("seed", seed)} />
          </div>
          <div className="panel-footer">
            <button className={`reset-button ${confirmReset ? "confirming" : ""}`} type="button" onClick={() => { if (confirmReset) { setSettings(DEFAULTS); setConfirmReset(false); } else setConfirmReset(true); }}>{confirmReset ? "确认恢复？" : "恢复默认"}</button>
            <span className={`save-state ${saved ? "saved" : ""}`} aria-live="polite">{saved ? "已保存" : "保存中…"}</span>
          </div>
        </aside>
      </div>}
    </main>
  );
}

function Toggle({ label, hint, checked, change }: { label: string; hint: string; checked: boolean; change: (value: boolean) => void }) {
  return <label className="toggle-field"><span><strong>{label}</strong><small>{hint}</small></span><input type="checkbox" checked={checked} onChange={(e) => change(e.target.checked)} /><i aria-hidden="true" /></label>;
}
function Range({ label, value, min, max, step, change }: { label: string; value: number; min: number; max: number; step: number; change: (value: number) => void }) {
  return <label className="range-field"><span><strong>{label}</strong><output>{value}</output></span><input type="range" value={value} min={min} max={max} step={step} onChange={(e) => change(Number(e.target.value))} /></label>;
}
function NumberInput({ label, value, min, max, step = 1, disabled = false, change }: { label: string; value: number; min: number; max: number; step?: number; disabled?: boolean; change: (value: number) => void }) {
  return <label className={`number-field ${disabled ? "disabled" : ""}`}><strong>{label}</strong><input type="number" value={value} min={min} max={max} step={step} disabled={disabled} onChange={(e) => { const next = Number(e.target.value); if (Number.isFinite(next)) change(Math.min(Math.max(next, min), max)); }} /></label>;
}

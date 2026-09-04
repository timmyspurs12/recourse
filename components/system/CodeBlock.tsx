"use client";

import { useCallback, useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import { cx } from "@/lib/format";

type TokenType =
  | "plain"
  | "keyword"
  | "string"
  | "number"
  | "comment"
  | "punct"
  | "key"
  | "boolean";

interface Token {
  text: string;
  type: TokenType;
}

const KEYWORDS =
  /^(const|let|var|await|async|function|return|import|export|from|type|interface|new|if|else|for|of|try|catch|throw|as|void|null|undefined)$/;

const PATTERN = new RegExp(
  [
    "(\\/\\/[^\\n]*)", // line comment
    "(\\/\\*[\\s\\S]*?\\*\\/)", // block comment
    "(\"(?:[^\"\\\\]|\\\\.)*\"|'(?:[^'\\\\]|\\\\.)*'|`(?:[^`\\\\]|\\\\.)*`)", // string
    "(\\b\\d+(?:\\.\\d+)?\\b)", // number
    "([A-Za-z_$][\\w$]*)", // identifier
    "([{}\\[\\]().,;:=><+\\-*/?|&!])", // punctuation
  ].join("|"),
  "g",
);

function tokenize(code: string): Token[] {
  const tokens: Token[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  PATTERN.lastIndex = 0;

  while ((match = PATTERN.exec(code)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ text: code.slice(lastIndex, match.index), type: "plain" });
    }
    const [text] = match;
    let type: TokenType = "plain";

    if (match[1] || match[2]) type = "comment";
    else if (match[3]) {
      const after = code.slice(match.index + text.length).match(/^\s*:/);
      type = after ? "key" : "string";
    } else if (match[4]) type = "number";
    else if (match[5]) {
      if (KEYWORDS.test(text)) type = "keyword";
      else if (text === "true" || text === "false") type = "boolean";
      else type = "plain";
    } else if (match[6]) type = "punct";

    tokens.push({ text, type });
    lastIndex = match.index + text.length;
  }

  if (lastIndex < code.length) {
    tokens.push({ text: code.slice(lastIndex), type: "plain" });
  }
  return tokens;
}

const TOKEN_CLASS: Record<TokenType, string> = {
  plain: "text-fg",
  keyword: "text-fg-muted",
  string: "text-protected/85",
  number: "text-pending/85",
  comment: "text-fg-faint italic",
  punct: "text-fg-dim",
  key: "text-fg-muted",
  boolean: "text-pending/85",
};

export function CodeBlock({
  code,
  language = "typescript",
  filename,
  caption,
  showLineNumbers = false,
  className,
}: {
  code: string;
  language?: string;
  filename?: string;
  caption?: string;
  showLineNumbers?: boolean;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const tokens = useMemo(() => tokenize(code), [code]);
  const lines = code.split("\n").length;

  const copy = useCallback(() => {
    void navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    });
  }, [code]);

  return (
    <figure className={cx("border border-line bg-surface", className)}>
      <figcaption className="flex items-center justify-between gap-3 border-b border-line px-3 py-2">
        <span className="mono-label truncate">{filename ?? language}</span>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1.5 border border-transparent px-1.5 py-1 font-mono text-[10px] tracking-[0.14em] text-fg-faint uppercase transition-colors hover:border-line hover:text-fg-muted"
        >
          {copied ? <Check className="size-3 text-pass" aria-hidden /> : <Copy className="size-3" aria-hidden />}
          {copied ? "Copied" : "Copy"}
        </button>
      </figcaption>
      <div className="overflow-x-auto">
        <pre className="flex min-w-full px-3 py-3 text-[12px] leading-[1.7] sm:px-4 sm:text-[13px]">
          {showLineNumbers ? (
            <span
              aria-hidden
              className="mr-4 shrink-0 select-none text-right font-mono text-fg-faint tabular-nums"
            >
              {Array.from({ length: lines }, (_, i) => String(i + 1).padStart(2, "0")).join("\n")}
            </span>
          ) : null}
          <code className="font-mono">
            {tokens.map((token, index) => (
              <span key={index} className={TOKEN_CLASS[token.type]}>
                {token.text}
              </span>
            ))}
          </code>
        </pre>
      </div>
      {caption ? (
        <p className="border-t border-line px-3 py-2 text-xs leading-relaxed text-fg-dim sm:px-4">
          {caption}
        </p>
      ) : null}
    </figure>
  );
}

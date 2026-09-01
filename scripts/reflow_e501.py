#!/usr/bin/env python3
"""One-shot E501 reflow helper (line-length 100) for the Co-op backend.

Safety model: transformations only move tokens onto new lines (never delete
or reorder them), and every edited file is re-compiled afterwards. The full
pytest suite is the final gate.

Handlers, in order:
  A. whole-line comments                  -> word-wrap, preserving indent
  B. whole-line triple-quoted docstrings  -> implicit concatenation
  C. `from X import a, b, c`              -> parenthesised import
  D. decorator with args                  -> one argument per line
  E. call/constructor with keyword args   -> one argument per line
  F. chained `.method(...)` calls         -> parenthesised, split at dots
Lines matching nothing are reported for manual follow-up.
"""
from __future__ import annotations

import ast
import json
import re
import sys

WIDTH = 100
RUFF_JSON = sys.argv[1] if len(sys.argv) > 1 else "/tmp/e501.json"


def wrap_words(indent: str, words: list[str], width: int) -> list[str]:
    lines, cur = [], indent
    for w in words:
        if len(cur) + (1 if cur != indent else 0) + len(w) <= width:
            cur += ("" if cur == indent else " ") + w
        else:
            lines.append(cur)
            cur = indent + w
    lines.append(cur)
    return lines


def handler_a(indent: str, text: str) -> list[str] | None:
    stripped = text.strip()
    if not stripped.startswith("#"):
        return None
    body = stripped[1:].lstrip()
    return wrap_words(indent + "# ", body.split(), WIDTH)


def handler_b(indent: str, text: str) -> list[str] | None:
    """Whole-line triple-quoted string (docstring) -> word-wrapped concat."""
    stripped = text.strip()
    for q in ('"""', "'''"):
        if stripped.startswith(q):
            m = re.fullmatch(re.escape(q) + r"(.*)" + re.escape(q) + r"\s*", stripped)
            if not m or q in m.group(1):
                return None
            words = m.group(1).split()
            out, cur = [], indent + q
            for w in words:
                if len(cur) + 1 + len(w) + len(q) <= WIDTH:
                    cur += ("" if cur == indent + q else " ") + w
                else:
                    out.append(cur + q)
                    cur = indent + q + " " + w
            out.append(cur + q)
            return out
    return None


def handler_c(indent: str, text: str) -> list[str] | None:
    m = re.match(r"^(from\s+\S+\s+import\s+)(.+)$", text.strip())
    if not m:
        return None
    names = [n.strip() for n in m.group(2).split(",")]
    if len(names) <= 1:
        return None
    lines = [f"{indent}{m.group(1)}("]
    for n in names:
        lines.append(f"{indent}    {n},")
    lines.append(f"{indent})")
    return lines


def handler_d(indent: str, text: str) -> list[str] | None:
    if not text.strip().startswith("@"):
        return None
    m = re.match(r"^(@\S+\()(.+)\)\s*$", text.strip())
    if not m:
        return None
    args = split_args(m.group(2))
    if len(args) <= 1:
        return None
    return [f"{indent}{m.group(1)}"] + [f"{indent}    {a}," for a in args] + [f"{indent})"]


def handler_s4(indent: str, text: str) -> list[str] | None:
    """Continuation line that starts with a bracket: split its top-level
    items one per line."""
    stripped = text.strip()
    if not stripped or stripped[0] not in "([":
        return None
    open_ch, close_ch = stripped[0], ")" if stripped[0] == "(" else "]"
    depth = 0
    close_at = -1
    for i, ch in enumerate(stripped):
        if ch in "([":
            depth += 1
        elif ch in ")]":
            depth -= 1
            if depth == 0:
                close_at = i
                break
    if close_at == -1:
        return None
    inner = stripped[1:close_at]
    tail = stripped[close_at + 1 :]
    # refuse comprehensions: `for n, d in rows` has top-level commas that
    # are not item separators
    depth = 0
    for i, ch in enumerate(inner):
        if ch in "([":
            depth += 1
        elif ch in ")]":
            depth -= 1
        elif depth == 0 and inner[i : i + 5] == " for ":
            return None
    items = split_args(inner)
    if len(items) <= 1:
        return None
    lines = [f"{indent}{open_ch}"]
    for it in items:
        if len(indent + "    " + it + ",") > WIDTH:
            return None
        lines.append(f"{indent}    {it},")
    last = f"{indent}{close_ch}{tail}"
    if len(last) > WIDTH:
        return None
    lines.append(last)
    return lines


def handler_s1(indent: str, text: str) -> list[str] | None:
    """Long line where the overflow is a trailing comment -> comment above."""
    depth = 0
    in_str = None
    best = -1
    i = 0
    while i < len(text) - 1:
        ch = text[i]
        if in_str:
            if ch == "\\":
                i += 2
                continue
            if ch == in_str:
                in_str = None
            i += 1
            continue
        if ch in "\"'":
            in_str = ch
        elif ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth -= 1
        elif ch == "#" and depth == 0 and text[i - 1] == " ":
            best = i
        i += 1
    if best == -1:
        return None
    code = text[:best].rstrip()
    comment = text[best + 1 :].strip()
    if not comment:
        return None
    return [indent + "# " + comment, code]


def _split_raw(raw: str, handle_braces: bool) -> list[str] | None:
    """Split a string literal's CONTENT into <=80-char chunks at word
    boundaries. F-string brace groups must be atomic and simple
    (no spaces, no quotes, no backslashes, no escaped braces) or refuse."""
    chunks, cur, i = [], [], 0
    n = len(raw)
    while i < n:
        ch = raw[i]
        if handle_braces and ch == "{":
            j = i + 1
            depth = 1
            while j < n and depth:
                if raw[j] == "{":
                    depth += 1
                elif raw[j] == "}":
                    depth -= 1
                j += 1
            if depth:
                return None
            group = raw[i:j]
            if any(c in group for c in (" ", '"', "'", "\\")) or "{{" in raw or "}}" in raw:
                return None
            tok = group
            i = j
        elif ch == "\\":
            return None
        elif ch.isspace():
            i += 1
            continue
        else:
            j = i
            while j < n and not raw[j].isspace() and raw[j] != "{" and raw[j] != "\\":
                j += 1
            if j == i:
                j = i + 1
            tok = raw[i:j]
            i = j
        if len(" ".join(cur + [tok])) > 80:
            if cur:
                chunks.append(" ".join(cur))
            cur = [tok]
        else:
            cur.append(tok)
    if cur:
        chunks.append(" ".join(cur))
    return chunks or None


def handler_s2(indent: str, text: str) -> list[str] | None:
    """Long line whose overflow is a long string literal -> implicit
    concatenation (requires the string to sit inside an open bracket)."""
    depth = 0
    i = 0
    n = len(text)
    while i < n:
        ch = text[i]
        if ch in "([{":
            depth += 1
            i += 1
            continue
        if ch in ")]}":
            depth -= 1
            i += 1
            continue
        if ch in "\"'":
            quote = ch
            start = i
            j = i - 1
            while j >= 0 and text[j] in "frbuFRBU":
                j -= 1
            start = j + 1
            j = i + 1
            while j < n and text[j] != quote:
                if text[j] == "\\":
                    j += 2
                else:
                    j += 1
            if j >= n:
                return None  # unterminated here (multi-line triple quote)
            end = j + 1
            raw = text[i + 1 : j]
            is_f = "f" in text[start:i].lower()
            chunks = _split_raw(raw, is_f)
            if chunks is None or len(chunks) <= 1 or depth <= 0:
                i = end
                continue
            prefix = text[start:i]
            cont_indent = indent + "    "
            pieces = [prefix + quote + chunks[0] + quote]
            for c in chunks[1:]:
                pieces.append(cont_indent + prefix + quote + c + quote)
            if any(len(p) > WIDTH for p in pieces):
                i = end
                continue
            if len(text[:start] + pieces[0]) > WIDTH:
                i = end
                continue
            out = [text[:start] + pieces[0]]
            out.extend(pieces[1:-1])
            out.append(pieces[-1] + text[end:])
            if any(len(o) > WIDTH for o in out):
                i = end
                continue
            return out
        i += 1
    return None


def handler_s3(indent: str, text: str) -> list[str] | None:
    """`assert (long-expr).attr op val` -> parenthesised continuation."""
    stripped = text.strip()
    if not stripped.startswith("assert "):
        return None
    m = re.match(r"^assert \((.+)\)(.*)$", stripped)
    if not m:
        return None
    inner, tail = m.group(1), m.group(2)
    if len(indent + "    " + inner) > WIDTH or len(indent + ")" + tail) > WIDTH:
        return None
    return [f"{indent}assert (", f"{indent}    {inner}", f"{indent}){tail}"]


def handler_e(indent: str, text: str) -> list[str] | None:
    """`prefix = Name(args)` where the final call sits at the line's end."""
    stripped = text.strip()
    if any(stripped.startswith(p) for p in ("def ", "if ", "elif ", "for ", "while ")):
        return None
    m = re.match(r"^(.*?[=(]\s*)(\w[\w.]*)(\(.+\))$", stripped)
    if not m:
        return None
    call = m.group(3)
    depth = 0
    for pos, ch in enumerate(call):
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth -= 1
            if depth == 0 and pos != len(call) - 1:
                # the call closed mid-line -> trailing tokens follow
                # (ternaries, `or ...`, chained calls) — not ours to reflow
                return None
    if depth != 0:
        return None
    inner = call[1:-1]
    args = split_args(inner)
    if len(args) <= 1:
        return None
    if any(len(indent + "    " + a + ",") > WIDTH for a in args):
        return None
    return [f"{indent}{m.group(1)}{m.group(2)}("] + [f"{indent}    {a}," for a in args] + [f"{indent})"]


def is_chain_piece(p: str) -> bool:
    """A chain continuation must be exactly `.name` or `.name(...)` — nothing
    else at the top level (rejects ternaries, operators, comparisons)."""
    if not p.startswith("."):
        return False
    m = re.match(r"^\.([A-Za-z_]\w*)", p)
    if not m:
        return False
    after = p[1 + len(m.group(1)) :]
    if after == "":
        return True
    if not after.startswith("("):
        return False
    depth = 0
    for i, ch in enumerate(after):
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth -= 1
            if ch == ")" and depth == 0 and i == len(after) - 1:
                return True
            if depth < 0:
                return False
    return False


def handler_f(indent: str, text: str) -> list[str] | None:
    """Chained `.method(...)` calls after `=` -> fully parenthesised, split
    at top-level dots (semantically identical, always valid)."""
    stripped = text.strip()
    depth = 0
    eq = -1
    dots: list[int] = []
    i = 0
    while i < len(stripped):
        ch = stripped[i]
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth -= 1
        elif ch == "=" and depth == 0 and eq == -1 and (i + 1 >= len(stripped) or stripped[i + 1] != "="):
            eq = i
        elif ch == "." and depth == 0 and eq != -1:
            dots.append(i)
        i += 1
    if eq == -1 or len(dots) < 2:
        return None
    head = stripped[: eq + 1].rstrip() + " "
    tail = stripped[eq + 1 :].strip()
    # dots relative to tail
    tail_dots = []
    depth = 0
    for j, ch in enumerate(tail):
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth -= 1
        elif ch == "." and depth == 0:
            tail_dots.append(j)
    if len(tail_dots) < 2:
        return None
    pieces = [tail[: tail_dots[0]]]
    for a, b in zip(tail_dots, tail_dots[1:]):
        pieces.append(tail[a : b])
    pieces.append(tail[tail_dots[-1] :])
    if not all(is_chain_piece(p) for p in pieces[1:]):
        return None
    if any(len(indent + "    " + p) > WIDTH for p in pieces):
        return None
    lines = [f"{indent}{head}("]
    for p in pieces:
        lines.append(f"{indent}    {p}")
    lines.append(f"{indent})")
    return lines


def split_args(s: str) -> list[str]:
    parts, depth, cur = [], 0, ""
    for ch in s:
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append(cur.strip())
            cur = ""
        else:
            cur += ch
    if cur.strip():
        parts.append(cur.strip())
    return parts


def reflow(path: str, targets: set[int]) -> tuple[list[str], list[tuple[str, int, str]]]:
    with open(path) as f:
        lines = f.readlines()
    out: list[str] = []
    manual: list[tuple[str, int, str]] = []
    for i, line in enumerate(lines):
        ln = i + 1
        if ln in targets and len(line.rstrip("\n")) > WIDTH:
            indent = line[: len(line) - len(line.lstrip())]
            text = line.rstrip("\n")
            result = None
            for h in (
                handler_a,
                handler_b,
                handler_c,
                handler_d,
                handler_e,
                handler_f,
                handler_s1,
                handler_s2,
                handler_s3,
                handler_s4,
            ):
                result = h(indent, text)
                if result is not None:
                    break
            if result is None:
                manual.append((path, ln, text[:110]))
                result = [text]
            out.extend(result)
        else:
            out.append(line.rstrip("\n"))
    return out, manual


def main() -> int:
    with open(RUFF_JSON) as f:
        data = json.load(f)
    targets: dict[str, set[int]] = {}
    for item in data:
        if item.get("code") != "E501":
            continue
        targets.setdefault(item["filename"], set()).add(item["location"]["row"])

    manual_all: list[tuple[str, int, str]] = []
    for path, rows in targets.items():
        new_lines, manual = reflow(path, rows)
        manual_all.extend(manual)
        src = "\n".join(new_lines) + "\n"
        ast.parse(src)
        with open(path, "w") as f:
            f.write(src)
        print(f"reflowed {path} ({len(rows)} lines)")
    print(f"\nMANUAL follow-ups: {len(manual_all)}")
    for path, ln, text in manual_all:
        print(f"  {path}:{ln}: {text}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

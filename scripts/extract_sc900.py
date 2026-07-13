#!/usr/bin/env python3
"""Extract SC-900 question blocks from the source PDF text layer."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import pdfplumber


QUESTION_RE = re.compile(r"(?m)^Question:\s*(\d+)(?:\s+Exam\s+Heist)?\s*$")


def clean(value: str) -> str:
    value = value.replace("\u00a0", " ").replace("\u202f", " ")
    value = re.sub(r"(?m)^Exam\s+Heist\s*$", "", value)
    value = re.sub(r"[ \t]+\n", "\n", value)
    value = re.sub(r"\n{3,}", "\n\n", value)
    return value.strip()


def split_block(block: str) -> tuple[str, str, str, str]:
    block = clean(re.sub(r"\[\[PAGE:\d+\]\]", "\n", block))
    explanation_match = re.search(r"(?m)^Explanation:\s*$", block)
    answer_match = re.search(r"(?m)^Answer:\s*(.*)$", block)

    prompt_end = min(
        (
            match.start()
            for match in (answer_match, explanation_match)
            if match
        ),
        default=len(block),
    )
    prompt = clean(block[:prompt_end])

    answer = ""
    if answer_match:
        answer_end = explanation_match.start() if explanation_match else len(block)
        answer = clean(answer_match.group(1) + "\n" + block[answer_match.end():answer_end])

    explanation = ""
    if explanation_match:
        explanation = clean(block[explanation_match.end():])

    if prompt.startswith("HOTSPOT"):
        source_type = "hotspot"
        prompt = clean(re.sub(r"^HOTSPOT\s*-?\s*", "", prompt))
    elif prompt.startswith("DRAG DROP"):
        source_type = "drag-drop"
        prompt = clean(re.sub(r"^DRAG DROP\s*-?\s*", "", prompt))
    elif "Select and Place:" in prompt:
        source_type = "drag-drop"
    else:
        source_type = "choice"

    return prompt, answer, explanation, source_type


def extract(pdf_path: Path) -> list[dict]:
    parts: list[str] = []
    with pdfplumber.open(pdf_path) as pdf:
        for page_number, page in enumerate(pdf.pages, 1):
            text = page.extract_text(
                x_tolerance=2,
                y_tolerance=3,
                layout=False,
                use_text_flow=False,
            ) or ""
            parts.append(f"\n[[PAGE:{page_number}]]\n{clean(text)}\n")

    stream = "".join(parts)
    matches = list(QUESTION_RE.finditer(stream))
    questions: list[dict] = []
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(stream)
        block = stream[match.end():end]
        pages = sorted({int(value) for value in re.findall(r"\[\[PAGE:(\d+)\]\]", block)})
        previous_pages = list(re.finditer(r"\[\[PAGE:(\d+)\]\]", stream[: match.start()]))
        marker_page = int(previous_pages[-1].group(1)) if previous_pages else 1
        prompt, answer, explanation, source_type = split_block(block)
        questions.append(
            {
                "id": int(match.group(1)),
                "pages": sorted(set([marker_page, *pages])),
                "sourceType": source_type,
                "prompt": prompt,
                "answer": answer,
                "explanation": explanation,
            }
        )
    return sorted(questions, key=lambda item: item["id"])


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("Usage: extract_sc900.py INPUT.pdf OUTPUT.json")
    questions = extract(Path(sys.argv[1]))
    Path(sys.argv[2]).write_text(
        json.dumps(questions, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    ids = {question["id"] for question in questions}
    print(f"Extracted {len(questions)} questions")
    print(f"Missing IDs: {sorted(set(range(1, 255)) - ids)}")


if __name__ == "__main__":
    main()

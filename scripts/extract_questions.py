#!/usr/bin/env python3
"""Extract AB-900 question blocks from the source PDF's text layer."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import pdfplumber


QUESTION_RE = re.compile(r"(?m)^Question:\s*(\d+)(?:\s+Exam\s+Heist)?\s*$")


def clean_text(value: str) -> str:
    value = value.replace("\u00a0", " ").replace("\u202f", " ")
    value = value.replace("\t", " ")
    value = re.sub(r"[ ]+\n", "\n", value)
    value = re.sub(r"\n{3,}", "\n\n", value)
    return value.strip()


def extract(pdf_path: Path) -> list[dict]:
    stream_parts: list[str] = []
    page_offsets: list[tuple[int, int, int]] = []
    cursor = 0

    with pdfplumber.open(pdf_path) as pdf:
        for page_number, page in enumerate(pdf.pages, 1):
            text = page.extract_text(
                x_tolerance=2,
                y_tolerance=3,
                layout=False,
                use_text_flow=False,
            ) or ""
            text = clean_text(text)
            part = f"\n[[PAGE:{page_number}]]\n{text}\n"
            stream_parts.append(part)
            page_offsets.append((cursor, cursor + len(part), page_number))
            cursor += len(part)

    stream = "".join(stream_parts)
    matches = list(QUESTION_RE.finditer(stream))
    questions: list[dict] = []

    for index, match in enumerate(matches):
        number = int(match.group(1))
        end = matches[index + 1].start() if index + 1 < len(matches) else len(stream)
        block = stream[match.end():end]
        pages = sorted({int(p) for p in re.findall(r"\[\[PAGE:(\d+)\]\]", block)})
        marker_page = next(
            page for start, stop, page in page_offsets if start <= match.start() < stop
        )
        pages = sorted(set([marker_page, *pages]))
        block = clean_text(re.sub(r"\[\[PAGE:\d+\]\]", "\n", block))
        # Repeated branding at the top-right of every question.
        block = re.sub(r"(?m)^Exam\s+Heist\s*$", "", block)
        block = clean_text(block)

        answer_match = re.search(r"(?m)^Answer:[ \t]*(.*)$", block)
        explanation_match = re.search(r"(?m)^Explanation:[ \t]*(.*)$", block)

        if answer_match:
            prompt = clean_text(block[:answer_match.start()])
            answer_start = answer_match.end()
            answer_end = explanation_match.start() if explanation_match else len(block)
            answer = clean_text(answer_match.group(1) + "\n" + block[answer_start:answer_end])
        else:
            prompt = block
            answer = ""

        if explanation_match:
            explanation = clean_text(
                explanation_match.group(1) + "\n" + block[explanation_match.end():]
            )
        else:
            explanation = ""

        # Remove footer branding occasionally interleaved into extracted text.
        cleaned_fields = []
        for value in (prompt, answer, explanation):
            value = re.sub(r"(?m)^Exam\s*$", "", value)
            value = re.sub(r"(?m)^Heist\s*$", "", value)
            cleaned_fields.append(clean_text(value))
        prompt, answer, explanation = cleaned_fields

        questions.append(
            {
                "id": number,
                "pages": pages,
                "prompt": prompt,
                "answer": answer,
                "explanation": explanation,
            }
        )

    questions.sort(key=lambda item: item["id"])
    return questions


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("Usage: extract_questions.py INPUT.pdf OUTPUT.json")
    questions = extract(Path(sys.argv[1]))
    Path(sys.argv[2]).write_text(
        json.dumps(questions, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"Extracted {len(questions)} questions")
    missing = sorted(set(range(1, 90)) - {q["id"] for q in questions})
    print(f"Missing question numbers: {missing}")


if __name__ == "__main__":
    main()

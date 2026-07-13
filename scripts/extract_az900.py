#!/usr/bin/env python3
"""Extract the AZ-900 question stream from the PDF text layer.

The PDF stores normal question text as selectable text, but keeps hotspot and
drag-and-drop answer areas in page images. This script preserves question/page
boundaries so OCR-derived image text can be merged in a later pass.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import pdfplumber


QUESTION_RE = re.compile(r"(?m)^QUESTION\s+(\d+)\s*$")
HEADER_FOOTER_RE = re.compile(
    r"(?m)^(?:https://www\.mycleverly\.com(?:/course/q/search/\?q=azure)?|"
    r"20019535C3F31C49C9E768B2921390F7)\s*$"
)


def clean(value: str) -> str:
    value = value.replace("\u00a0", " ").replace("\u202f", " ")
    value = HEADER_FOOTER_RE.sub("", value)
    value = re.sub(r"[ \t]+\n", "\n", value)
    value = re.sub(r"\n{3,}", "\n\n", value)
    return value.strip()


def split_block(block: str) -> tuple[str, str, str, str]:
    """Return prompt, answer, section, explanation from a question block."""
    block = clean(re.sub(r"\[\[PAGE:\d+\]\]", "\n", block))
    section_match = re.search(r"(?m)^Section:\s*(.*)$", block)
    explanation_match = re.search(r"(?m)^Explanation(?:/Reference)?:\s*$", block)
    correct_match = re.search(r"(?m)^Correct Answer:\s*(.*)$", block)

    prompt_end = min(
        (
            match.start()
            for match in (correct_match, section_match, explanation_match)
            if match
        ),
        default=len(block),
    )
    prompt = clean(block[:prompt_end])

    answer = ""
    if correct_match:
        answer_end = min(
            (
                match.start()
                for match in (section_match, explanation_match)
                if match and match.start() > correct_match.start()
            ),
            default=len(block),
        )
        answer = clean(
            correct_match.group(1)
            + "\n"
            + block[correct_match.end() : answer_end]
        )

    section = clean(section_match.group(1)) if section_match else ""
    explanation = ""
    if explanation_match:
        explanation = clean(block[explanation_match.end() :])
        explanation = re.sub(r"(?m)^Explanation:\s*", "", explanation, count=1).strip()

    return prompt, answer, section, explanation


def extract(pdf_path: Path) -> list[dict]:
    page_parts: list[str] = []
    with pdfplumber.open(pdf_path) as pdf:
        for page_number, page in enumerate(pdf.pages, 1):
            text = page.extract_text(
                x_tolerance=2,
                y_tolerance=3,
                layout=False,
                use_text_flow=False,
            ) or ""
            page_parts.append(f"\n[[PAGE:{page_number}]]\n{clean(text)}\n")

    stream = "".join(page_parts)
    matches = list(QUESTION_RE.finditer(stream))
    questions: list[dict] = []
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(stream)
        block = stream[match.end() : end]
        pages = sorted({int(value) for value in re.findall(r"\[\[PAGE:(\d+)\]\]", block)})
        marker_page_match = list(re.finditer(r"\[\[PAGE:(\d+)\]\]", stream[: match.start()]))
        marker_page = int(marker_page_match[-1].group(1)) if marker_page_match else 1
        pages = sorted(set([marker_page, *pages]))
        prompt, answer, section, explanation = split_block(block)
        question_type = prompt.splitlines()[0] if prompt.splitlines() else ""
        if question_type in {"HOTSPOT", "DRAG DROP"}:
            prompt = clean("\n".join(prompt.splitlines()[1:]))
        else:
            question_type = "CHOICE"
        questions.append(
            {
                "id": int(match.group(1)),
                "pages": pages,
                "sourceType": question_type.lower().replace(" ", "-"),
                "prompt": prompt,
                "answer": answer,
                "section": section,
                "explanation": explanation,
            }
        )

    return sorted(questions, key=lambda item: item["id"])


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("Usage: extract_az900.py INPUT.pdf OUTPUT.json")
    questions = extract(Path(sys.argv[1]))
    Path(sys.argv[2]).write_text(
        json.dumps(questions, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    ids = {question["id"] for question in questions}
    print(f"Extracted {len(questions)} questions")
    print(f"Missing IDs: {sorted(set(range(1, 209)) - ids)}")
    print(f"Duplicate IDs: {len(questions) - len(ids)}")


if __name__ == "__main__":
    main()

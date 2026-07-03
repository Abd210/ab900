#!/usr/bin/env python3
"""Create exact prompt and answer-review crops from rendered PDF pages."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import pdfplumber
from PIL import Image


def page_image_path(page_dir: Path, page_number: int) -> Path:
    candidates = [
        page_dir / f"page-{page_number:02d}.jpg",
        page_dir / f"page-{page_number:03d}.jpg",
        page_dir / f"page-{page_number}.jpg",
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    raise FileNotFoundError(f"No rendered image for page {page_number}")


def save_region(
    page_dir: Path,
    output_dir: Path,
    page_number: int,
    top: float,
    bottom: float,
    pdf_width: float,
    pdf_height: float,
    label: str,
) -> str | None:
    image_path = page_image_path(page_dir, page_number)
    with Image.open(image_path) as image:
        scale_x = image.width / pdf_width
        scale_y = image.height / pdf_height
        y0 = max(0, int((top - 9) * scale_y))
        y1 = min(image.height, int((bottom + 6) * scale_y))
        if y1 - y0 < 20:
            return None
        x0 = max(0, int(17 * scale_x))
        x1 = min(image.width, int((pdf_width - 17) * scale_x))
        crop = image.crop((x0, y0, x1, y1))
        name = f"{label}-p{page_number:02d}.jpg"
        output_dir.mkdir(parents=True, exist_ok=True)
        crop.save(output_dir / name, "JPEG", quality=88, optimize=True)
        return name


def main() -> None:
    if len(sys.argv) != 5:
        raise SystemExit(
            "Usage: crop_question_source.py INPUT.pdf PAGE_DIR OUTPUT_DIR MANIFEST.json"
        )
    pdf_path = Path(sys.argv[1])
    page_dir = Path(sys.argv[2])
    output_dir = Path(sys.argv[3])
    manifest_path = Path(sys.argv[4])

    with pdfplumber.open(pdf_path) as pdf:
        page_words = [
            page.extract_words(x_tolerance=2, y_tolerance=3, use_text_flow=False)
            for page in pdf.pages
        ]
        markers: list[dict] = []
        for page_index, words in enumerate(page_words):
            for index, word in enumerate(words):
                if word["text"] != "Question:":
                    continue
                nearby = [
                    item
                    for item in words[index + 1:index + 5]
                    if abs(item["top"] - word["top"]) < 3
                ]
                number_item = next(
                    (item for item in nearby if re.fullmatch(r"\d+", item["text"])), None
                )
                if number_item:
                    markers.append(
                        {
                            "id": int(number_item["text"]),
                            "page": page_index,
                            "top": float(word["top"]),
                        }
                    )
        markers.sort(key=lambda item: item["id"])

        manifest: list[dict] = []
        for index, marker in enumerate(markers):
            question_id = marker["id"]
            next_marker = (
                markers[index + 1]
                if index + 1 < len(markers)
                else {"page": len(pdf.pages), "top": 0.0}
            )
            start_page = marker["page"]
            end_page = next_marker["page"]
            end_top = next_marker["top"]

            answer_position: tuple[int, float] | None = None
            for page_index in range(start_page, min(end_page + 1, len(pdf.pages))):
                lower = marker["top"] if page_index == start_page else 0
                upper = (
                    end_top
                    if page_index == end_page and end_page < len(pdf.pages)
                    else float(pdf.pages[page_index].height)
                )
                for word in page_words[page_index]:
                    if (
                        word["text"] == "Answer:"
                        and lower < float(word["top"]) < upper
                    ):
                        answer_position = (page_index, float(word["top"]))
                        break
                if answer_position:
                    break

            if answer_position is None:
                answer_position = (end_page, end_top)

            prompt_files: list[str] = []
            for page_index in range(start_page, answer_position[0] + 1):
                page = pdf.pages[page_index]
                top = marker["top"] if page_index == start_page else 0
                bottom = (
                    answer_position[1]
                    if page_index == answer_position[0]
                    else float(page.height)
                )
                filename = save_region(
                    page_dir,
                    output_dir,
                    page_index + 1,
                    top,
                    bottom,
                    float(page.width),
                    float(page.height),
                    f"q{question_id:03d}-prompt",
                )
                if filename:
                    prompt_files.append(filename)

            review_files: list[str] = []
            last_page = min(end_page, len(pdf.pages) - 1)
            for page_index in range(start_page, last_page + 1):
                page = pdf.pages[page_index]
                top = marker["top"] if page_index == start_page else 0
                bottom = (
                    end_top
                    if page_index == end_page and end_page < len(pdf.pages)
                    else float(page.height)
                )
                filename = save_region(
                    page_dir,
                    output_dir,
                    page_index + 1,
                    top,
                    bottom,
                    float(page.width),
                    float(page.height),
                    f"q{question_id:03d}-review",
                )
                if filename:
                    review_files.append(filename)

            manifest.append(
                {
                    "id": question_id,
                    "promptImages": prompt_files,
                    "reviewImages": review_files,
                }
            )

    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"Created source crops for {len(manifest)} questions")


if __name__ == "__main__":
    main()

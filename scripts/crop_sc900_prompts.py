#!/usr/bin/env python3
"""Create answer-safe SC-900 source screenshots for each question."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import pdfplumber
from PIL import Image


def rendered_page(page_dir: Path, page_number: int) -> Path:
    for name in (
        f"page-{page_number:03d}.jpg",
        f"page-{page_number:02d}.jpg",
        f"page-{page_number}.jpg",
    ):
        candidate = page_dir / name
        if candidate.exists():
            return candidate
    raise FileNotFoundError(f"Rendered page {page_number} was not found")


def trim_whitespace(image: Image.Image, padding: int = 12) -> Image.Image | None:
    grayscale = image.convert("L")
    bbox = grayscale.point(lambda value: 255 if value < 246 else 0).getbbox()
    if not bbox:
        return None
    left, top, right, bottom = bbox
    left = max(0, left - padding)
    top = max(0, top - padding)
    right = min(image.width, right + padding)
    bottom = min(image.height, bottom + padding)
    if right - left < 40 or bottom - top < 30:
        return None
    return image.crop((left, top, right, bottom))


def content_density(image: Image.Image) -> float:
    grayscale = image.convert("L")
    dark = sum(grayscale.histogram()[:180])
    return dark / max(1, image.width * image.height)


def useful_screenshots(output_dir: Path, filenames: list[str]) -> list[str]:
    if len(filenames) == 1:
        return filenames
    keep = []
    for filename in filenames:
        path = output_dir / filename
        with Image.open(path) as image:
            width, height = image.size
            density = content_density(image)
        if density < 0.002 or height < 70:
            path.unlink(missing_ok=True)
            continue
        keep.append(filename)
    return keep or filenames


BOILERPLATE_RE = re.compile(
    r"^(?:Question:\s*\d+|Question:\s*\d+\s*-?\s*Select the answer that correctly completes the sentence\.?|"
    r"Question:\s*\d+\s*HOTSPOT.*|Exam|Heist|Exam\s+Heist|HOTSPOT\s*-?|DRAG\s+DROP\s*-?|"
    r"Select the answer that correctly completes the sentence\.?|Hot Area:?|"
    r"Answer Area|NOTE:.*|For each of the following statements.*|"
    r"To answer,.*|Each correct.*)$",
    re.IGNORECASE,
)


def meaningful_text(words: list[dict], top: float, bottom: float) -> str:
    lines = []
    for word in words:
        word_top = float(word["top"])
        if top <= word_top <= bottom:
            text = str(word["text"]).strip()
            if text and not BOILERPLATE_RE.match(text):
                lines.append(text)
    return re.sub(r"\s+", " ", " ".join(lines)).strip()


def global_position(page_index: int, top: float, page_height: float) -> float:
    return page_index * page_height + top


def main() -> None:
    if len(sys.argv) != 5:
        raise SystemExit(
            "Usage: crop_sc900_prompts.py INPUT.pdf PAGE_DIR OUTPUT_DIR MANIFEST.json"
        )

    pdf_path = Path(sys.argv[1])
    page_dir = Path(sys.argv[2])
    output_dir = Path(sys.argv[3])
    manifest_path = Path(sys.argv[4])
    output_dir.mkdir(parents=True, exist_ok=True)

    with pdfplumber.open(pdf_path) as pdf:
        page_words = [
            page.extract_words(x_tolerance=2, y_tolerance=3, use_text_flow=False)
            for page in pdf.pages
        ]

        markers: list[dict] = []
        for page_index, words in enumerate(page_words):
            for word_index, word in enumerate(words):
                if word["text"] != "Question:":
                    continue
                number = next(
                    (
                        candidate
                        for candidate in words[word_index + 1 : word_index + 5]
                        if re.fullmatch(r"\d+", candidate["text"])
                        and abs(float(candidate["top"]) - float(word["top"])) < 4
                    ),
                    None,
                )
                if not number:
                    continue
                markers.append(
                    {
                        "id": int(number["text"]),
                        "page": page_index,
                        "top": float(word["top"]),
                        "position": float(word["doctop"]),
                    }
                )

        markers.sort(key=lambda item: item["position"])
        manifest = []

        for index, marker in enumerate(markers):
            stop_position = (
                markers[index + 1]["position"]
                if index + 1 < len(markers)
                else float("inf")
            )
            answer_marker = None
            for page_index in range(
                marker["page"],
                min(
                    len(pdf.pages),
                    markers[index + 1]["page"] + 1
                    if index + 1 < len(markers)
                    else len(pdf.pages),
                ),
            ):
                for word in page_words[page_index]:
                    position = float(word["doctop"])
                    if not marker["position"] < position < stop_position:
                        continue
                    if word["text"].startswith("Answer:"):
                        answer_marker = {
                            "page": page_index,
                            "top": float(word["top"]),
                            "position": position,
                        }
                        break
                if answer_marker:
                    break

            if not answer_marker:
                raise ValueError(f"Could not find the Answer marker for question {marker['id']}")

            filenames = []
            filename_usefulness = {}
            for page_index in range(marker["page"], answer_marker["page"] + 1):
                page = pdf.pages[page_index]
                pdf_top = marker["top"] - 8 if page_index == marker["page"] else 12
                pdf_bottom = (
                    answer_marker["top"] - 8
                    if page_index == answer_marker["page"]
                    else float(page.height) - 12
                )
                if pdf_bottom - pdf_top < 18:
                    continue

                with Image.open(rendered_page(page_dir, page_index + 1)) as source:
                    scale_x = source.width / float(page.width)
                    scale_y = source.height / float(page.height)
                    crop = source.crop(
                        (
                            int(28 * scale_x),
                            max(0, int(pdf_top * scale_y)),
                            min(source.width, int((float(page.width) - 28) * scale_x)),
                            min(source.height, int(pdf_bottom * scale_y)),
                        )
                    )
                    crop = trim_whitespace(crop)
                    if crop is None:
                        continue
                    filename = f"q{marker['id']:03d}-source-{len(filenames) + 1:02d}.jpg"
                    crop.save(output_dir / filename, "JPEG", quality=88, optimize=True)
                    filenames.append(filename)
                    has_meaningful_text = bool(
                        meaningful_text(page_words[page_index], pdf_top, pdf_bottom)
                    )
                    # Some cross-page hotspot answer areas are image-backed and
                    # their text layer appears below the Answer marker. Keep
                    # visually dense continuation crops even when text extraction
                    # cannot see their content.
                    filename_usefulness[filename] = has_meaningful_text or (
                        page_index != marker["page"] and content_density(crop) > 0.015
                    )

            if not filenames:
                raise ValueError(f"Question {marker['id']} produced no screenshots")
            filenames = useful_screenshots(output_dir, filenames)
            if len(filenames) > 1:
                filtered = []
                for filename in filenames:
                    if filename_usefulness.get(filename, True):
                        filtered.append(filename)
                    else:
                        (output_dir / filename).unlink(missing_ok=True)
                filenames = filtered or filenames
            manifest.append({"id": marker["id"], "images": filenames})

    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"Created {sum(len(item['images']) for item in manifest)} screenshots")
    print(f"Covered {len(manifest)} questions")


if __name__ == "__main__":
    main()

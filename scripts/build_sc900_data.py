#!/usr/bin/env python3
"""Build native SC-900 quiz interactions from PDF text and OCR boxes."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from PIL import Image


PAGE_RE = re.compile(r"page-(\d+)\.(?:jpg|jpeg|png)$", re.IGNORECASE)

FALLBACK_SINGLE_ANSWERS = {
    32: "is stored on a local device only",
    55: "managed identity",
    132: "authentication",
    144: "Azure Key Vault",
    145: "Microsoft Defender for Cloud",
    152: "Microsoft 365 compliance center",
    157: "Compliance score",
    161: "Assessments",
    170: "access and application control",
    172: "Federation",
    174: "is tied to the lifecycle of the resource that uses it",
    179: "a security principal",
    188: "object",
    193: "after",
    248: "provides the ability to collect security data from an entire estate, analyze the data, and deliver security insights",
    252: "retention label",
}

FALLBACK_FIELD_ITEMS = {
    109: (
        ["Action", "Investigate", "Triage"],
        [
            ("Review and filter alerts", "Triage"),
            ("Create cases in the Case dashboard", "Investigate"),
            ("Send a reminder of corporate policies to users", "Action"),
        ],
    ),
    117: (
        ["Threat Explorer", "Threat Trackers", "Anti-phishing protection"],
        [
            ("Provides intelligence on prevailing cybersecurity issues", "Threat Trackers"),
            ("Provides real-time reports to identify and analyze recent threats", "Threat Explorer"),
            ("Detects impersonation attempts", "Anti-phishing protection"),
        ],
    ),
    128: (
        ["Data", "Identities", "Networks"],
        [
            ("Must be segmented", "Networks"),
            ("Must be verified by using strong authentication", "Identities"),
            ("Must be classified, labeled, and encrypted based on its attributes", "Data"),
        ],
    ),
    129: (
        ["Corrective", "Detective", "Preventative"],
        [
            ("Use encryption to protect data at rest", "Preventative"),
            ("Actively monitor systems to identify irregularities that might represent risks", "Detective"),
        ],
    ),
    155: (
        ["Action", "Investigate", "Triage"],
        [
            ("Review and filter alerts", "Triage"),
            ("Create cases in the Case dashboard", "Investigate"),
            ("Send a reminder of corporate policies to users", "Action"),
        ],
    ),
    194: (
        ["Device", "Location", "Sign-in risk", "User risk"],
        [
            ("The probability that an identity or account is compromised", "User risk"),
            ("The probability that an authentication request isn't authorized by the identity owner", "Sign-in risk"),
        ],
    ),
}

FALLBACK_MATRIX_ANSWERS = {
    133: ["Yes", "Yes", "No"],
    137: ["Yes", "No", "Yes"],
    139: ["Yes", "No", "Yes"],
    151: ["No", "Yes", "Yes"],
    156: ["Yes", "Yes", "No"],
    164: ["No", "No", "Yes"],
    166: ["No", "Yes", "No"],
    169: ["No", "No", "Yes"],
    171: ["Yes", "No", "Yes"],
    175: ["Yes", "No", "No"],
    177: ["No", "Yes", "No"],
    183: ["No", "No", "Yes"],
    184: ["No", "Yes", "Yes"],
    187: ["No", "No", "Yes"],
    191: ["Yes", "Yes", "No"],
    196: ["Yes", "Yes", "Yes"],
    200: ["Yes", "Yes", "No"],
    207: ["Yes", "Yes", "Yes"],
    211: ["Yes", "No", "Yes"],
    217: ["Yes", "Yes", "No"],
    227: ["No", "Yes", "Yes"],
    233: ["Yes", "No", "No"],
    240: ["Yes", "Yes", "No"],
    246: ["Yes", "No", "No"],
    249: ["Yes", "No", "Yes"],
}


def clean(value: str) -> str:
    value = value.replace("\u2019", "'").replace("\u2014", "-").replace("\u2013", "-")
    value = re.sub(r"\s+", " ", value)
    return value.strip(" .:-")


def norm(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.lower())


def parse_choice(prompt: str, answer: str) -> tuple[str, dict, str]:
    matches = list(re.finditer(r"(?m)^([A-F])\.\s*(.*)$", prompt))
    options = []
    for index, match in enumerate(matches):
        stop = matches[index + 1].start() if index + 1 < len(matches) else len(prompt)
        label = clean(match.group(2) + "\n" + prompt[match.end():stop])
        options.append({"id": match.group(1), "label": label})
    if not options:
        raise ValueError("choice item has no options")
    stem = clean(prompt[: matches[0].start()])
    answer_ids = list(clean(answer).replace(" ", ""))
    if not answer_ids:
        raise ValueError("choice item has no answer key")
    interaction = {
        "type": "multi" if len(answer_ids) > 1 else "single",
        "options": options,
        "correct": answer_ids if len(answer_ids) > 1 else answer_ids[0],
    }
    return stem, interaction, "; ".join(answer_ids)


def page_number(file_name: str) -> int:
    match = PAGE_RE.search(file_name)
    if not match:
        raise ValueError(f"Unexpected page file name: {file_name}")
    return int(match.group(1))


def ocr_stream(pages: list[dict]) -> tuple[str, dict[int, str]]:
    parts = []
    for page in sorted(pages, key=lambda item: page_number(item["file"])):
        lines = sorted(page["boxes"], key=lambda box: (box["y"], box["x"]))
        parts.append("\n".join(box["text"] for box in lines))
    stream = "\n".join(parts)
    matches = list(re.finditer(r"(?m)^Question:\s*(\d+)", stream))
    blocks = {}
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(stream)
        blocks[int(match.group(1))] = stream[match.end():end]
    return stream, blocks


def question_regions(pages: list[dict]) -> dict[int, tuple[float, float]]:
    markers = []
    for page in pages:
        number = page_number(page["file"])
        height = page["height"]
        for box in page["boxes"]:
            match = re.match(r"Question:\s*(\d+)", box["text"])
            if match:
                markers.append(
                    {
                        "id": int(match.group(1)),
                        "pos": (number - 1) * height + box["y"],
                    }
                )
    markers.sort(key=lambda item: item["pos"])
    regions = {}
    for index, marker in enumerate(markers):
        stop = markers[index + 1]["pos"] if index + 1 < len(markers) else float("inf")
        regions[marker["id"]] = (marker["pos"], stop)
    return regions


def green_components(image_path: Path) -> list[tuple[int, int, int, int]]:
    image = Image.open(image_path).convert("RGB")
    pixels = image.load()
    width, height = image.size
    seen: set[tuple[int, int]] = set()
    components: list[tuple[int, int, int, int]] = []

    def is_green(x: int, y: int) -> bool:
        r, g, b = pixels[x, y]
        return g > 145 and 80 < r < 235 and 80 < b < 235 and g - r > 10 and g >= b

    for y in range(height):
        for x in range(width):
            if (x, y) in seen or not is_green(x, y):
                continue
            stack = [(x, y)]
            seen.add((x, y))
            xs = []
            ys = []
            while stack:
                cx, cy = stack.pop()
                xs.append(cx)
                ys.append(cy)
                for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                    if (
                        0 <= nx < width
                        and 0 <= ny < height
                        and (nx, ny) not in seen
                        and is_green(nx, ny)
                    ):
                        seen.add((nx, ny))
                        stack.append((nx, ny))
            if len(xs) >= 50:
                components.append((min(xs), min(ys), max(xs), max(ys)))
    return components


def selected_texts(
    question_id: int,
    pages: list[dict],
    page_dir: Path,
    regions: dict[int, tuple[float, float]],
) -> list[str]:
    start, stop = regions[question_id]
    selections: list[tuple[float, str]] = []
    for page in pages:
        number = page_number(page["file"])
        page_offset = (number - 1) * page["height"]
        if page_offset + page["height"] < start or page_offset > stop:
            continue
        for x1, y1, x2, y2 in green_components(page_dir / page["file"]):
            global_mid = page_offset + (y1 + y2) / 2
            if not start < global_mid < stop:
                continue
            if x2 < 900:
                nearby = [
                    box
                    for box in page["boxes"]
                    if abs((box["y"] + box["height"] / 2) - ((y1 + y2) / 2)) < 32
                    and box["x"] < 850
                ]
                if nearby:
                    text = clean(" ".join(box["text"] for box in sorted(nearby, key=lambda b: b["x"])))
                    if text:
                        selections.append((global_mid, text))
    output = []
    for _, text in sorted(selections):
        if not output or norm(output[-1]) != norm(text):
            output.append(text)
    return output


def matrix_answers(question: dict, block: str, pages: list[dict], page_dir: Path, regions: dict[int, tuple[float, float]]) -> list[str]:
    if question["id"] in FALLBACK_MATRIX_ANSWERS:
        return FALLBACK_MATRIX_ANSWERS[question["id"]]

    raw_answer = question.get("answer", "")
    raw_tokens = re.findall(r"\b(Yes|No)\b", raw_answer, re.IGNORECASE)
    if len(raw_tokens) >= 3:
        return [value.title() for value in raw_tokens[:3]]
    compact_raw = re.search(r"\b([YN]{3})\b", raw_answer, re.IGNORECASE)
    if compact_raw:
        return ["Yes" if value.upper() == "Y" else "No" for value in compact_raw.group(1)]

    answers = [
        value.title()
        for value in re.findall(
            r"(?:Box\s*)?\d+\)?\s*[:.-]\s*(Yes|No)\b",
            question["explanation"],
            re.IGNORECASE,
        )
    ]
    if len(answers) >= 3:
        return answers[:3]
    compact = re.search(r"\b([YN]{3})\b", question["explanation"], re.IGNORECASE)
    if compact:
        return ["Yes" if value.upper() == "Y" else "No" for value in compact.group(1)]
    line_answers = [
        line.title()
        for line in re.findall(r"(?im)^\s*(yes|no)\s*\.?\s*$", question["explanation"])
    ]
    if len(line_answers) >= 3:
        return line_answers[:3]
    sentence_answers = [
        value.title()
        for value in re.findall(r"(?im)^\s*(Yes|No)\s*[.-]", question["explanation"])
    ]
    if len(sentence_answers) >= 3:
        return sentence_answers[:3]

    start, stop = regions[question["id"]]
    radio_hits = []
    for page in pages:
        number = page_number(page["file"])
        page_offset = (number - 1) * page["height"]
        if page_offset + page["height"] < start or page_offset > stop:
            continue
        for x1, y1, x2, y2 in green_components(page_dir / page["file"]):
            global_mid = page_offset + (y1 + y2) / 2
            if start < global_mid < stop and x1 > 1000 and (x2 - x1) < 90 and (y2 - y1) < 90:
                radio_hits.append((global_mid, "Yes" if (x1 + x2) / 2 < 1260 else "No"))
    deduped = []
    last_y = None
    for y, value in sorted(radio_hits):
        if last_y is not None and abs(y - last_y) < 24:
            continue
        deduped.append(value)
        last_y = y
    if len(deduped) >= 3:
        return deduped[:3]
    raise ValueError(f"Question {question['id']}: could not resolve matrix answers")


def matrix_statements(block: str) -> list[str]:
    before_answer = block.split("Answer:", 1)[0]
    area = before_answer.rsplit("Answer Area", 1)[-1]
    lines = [
        clean(line)
        for line in area.splitlines()
        if clean(line)
        and clean(line) not in {"Statements", "Yes", "No", "Hot Area", "Exam Heist"}
        and not clean(line).startswith(("HOTSPOT", "For each", "NOTE"))
    ]
    if len(lines) == 3:
        return lines
    if len(lines) > 3 and len(lines) % 3 == 0:
        chunk_size = len(lines) // 3
        return [
            clean(" ".join(lines[index : index + chunk_size]))
            for index in range(0, len(lines), chunk_size)
        ]
    while len(lines) > 3:
        merge_index = next(
            (
                index
                for index in range(len(lines) - 1)
                if lines[index + 1][:1].islower()
            ),
            len(lines) - 2,
        )
        lines[merge_index] = clean(f"{lines[merge_index]} {lines[merge_index + 1]}")
        del lines[merge_index + 1]
    if len(lines) == 3:
        return lines
    statements = []
    current = ""
    for line in lines:
        if not current:
            current = line
        elif current.endswith((".", "?", ")")):
            statements.append(current)
            current = line
        else:
            current = f"{current} {line}"
    if current:
        statements.append(current)
    if len(statements) != 3:
        text = " ".join(lines)
        statements = [
            item.strip()
            for item in re.split(r"(?<=[.?!])\s+(?=[A-Z])", text)
            if item.strip()
        ]
    if len(statements) != 3:
        raise ValueError(f"expected 3 matrix statements, got {len(statements)}")
    return statements


def option_candidates(block: str) -> list[str]:
    area = block.split("Answer:", 1)[0].split("Answer Area", 1)[-1]
    lines = [
        clean(line)
        for line in area.splitlines()
        if clean(line)
        and clean(line) not in {"Hot Area", "Answer Area", "Exam Heist"}
        and not clean(line).startswith(("HOTSPOT", "Select the answer"))
    ]
    candidates = []
    for line in lines:
        if len(line) > 90 or line.endswith(","):
            continue
        if line.lower().startswith(("is used", "provides ", "including ", "between ", "when users ")):
            continue
        candidates.append(line)
    return candidates


def resolve_single_answer(question: dict, candidates: list[str], selected: list[str]) -> str:
    if question["id"] in FALLBACK_SINGLE_ANSWERS:
        return FALLBACK_SINGLE_ANSWERS[question["id"]]

    letter_key = clean(question.get("answer", ""))
    if re.fullmatch(r"[A-F]", letter_key):
        option_pool = candidates[-4:] if len(candidates) >= 4 else candidates
        index = ord(letter_key) - ord("A")
        if index < len(option_pool):
            return option_pool[index]

    explanation = question["explanation"]
    explicit = re.search(r"(?:Answer|answer is|correct answer is)\s*[:,-]\s*([^.\n]+)", explanation, re.IGNORECASE)
    if explicit:
        explicit_value = norm(explicit.group(1))
        for candidate in candidates:
            if norm(candidate) in explicit_value or explicit_value in norm(candidate):
                return candidate
    explanation_start = norm(explanation[:160])
    starting_matches = [
        candidate
        for candidate in candidates
        if norm(candidate) and explanation_start.startswith(norm(candidate))
    ]
    if starting_matches:
        return max(starting_matches, key=lambda value: len(norm(value)))
    scored = sorted(
        ((len(norm(candidate)), candidate) for candidate in candidates if norm(candidate) and norm(candidate) in norm(explanation)),
        reverse=True,
    )
    if scored:
        return scored[0][1]
    stems = {
        "authenticated": "authentication",
        "authorized": "authorization",
        "encrypted": "encryption",
        "encrypting": "encryption",
    }
    explanation_norm = norm(explanation)
    for candidate in candidates:
        stem = stems.get(candidate.lower())
        if stem and norm(stem) in explanation_norm:
            return candidate
    if selected:
        selected_norms = [norm(value) for value in selected]
        selected_matches = [
            candidate
            for candidate in candidates
            if any(
                norm(candidate) == selected_norm
                or norm(candidate) in selected_norm
                or selected_norm in norm(candidate)
                for selected_norm in selected_norms
            )
        ]
        if selected_matches:
            return max(selected_matches, key=lambda value: len(norm(value)))
        return selected[0]
    raise ValueError(f"Question {question['id']}: could not resolve hotspot answer")


def drag_interaction(question: dict, block: str) -> tuple[dict, str]:
    if question["id"] in FALLBACK_FIELD_ITEMS:
        options, pairs = FALLBACK_FIELD_ITEMS[question["id"]]
        return (
            {
                "type": "fields",
                "fields": [
                    {"label": label, "options": options, "correct": correct}
                    for label, correct in pairs
                ],
            },
            "; ".join(correct for _, correct in pairs),
        )

    answer_area = block.split("Answer:", 1)[-1].split("Explanation:", 1)[0]
    box_answers = re.findall(r"Box\s*\d+\s*:\s*([^-:\n]+)", question["explanation"], re.IGNORECASE)
    lines = [clean(line) for line in answer_area.splitlines() if clean(line)]
    lines = [line for line in lines if line not in {"Action Subcategories", "Answer Area", "Services", "Steps", "Features", "Pillars", "Conditional access signals"}]

    if question["id"] == 178:
        options = [line for line in lines if "service" in line.lower() or "datacenter" in line.lower() or "iaas" in line.lower()]
        ordered = options[-4:]
        return (
            {
                "type": "fields",
                "fields": [
                    {"label": f"Position {index + 1}", "options": options, "correct": value}
                    for index, value in enumerate(ordered)
                ],
            },
            "; ".join(ordered),
        )

    corrects = [clean(value) for value in box_answers]
    pairs = []
    if not corrects:
        for line in question["explanation"].splitlines():
            if " - " in line:
                left, right = line.split(" - ", 1)
                if clean(left) and clean(right):
                    corrects.append(clean(left))
                    pairs.append((clean(right), clean(left)))
    if not pairs:
        descriptions = []
        for line in lines:
            if line in corrects or line.endswith(("subcategories", "Pillar", "Service")):
                continue
            if len(line) > 18:
                descriptions.append(line)
        for index, correct in enumerate(corrects):
            label = descriptions[index] if index < len(descriptions) else f"Item {index + 1}"
            pairs.append((label, correct))
    options = sorted(set(corrects or [line for line in lines if len(line) < 40]))
    if not pairs:
        raise ValueError(f"Question {question['id']}: could not resolve drag/drop")
    return (
        {
            "type": "fields",
            "fields": [
                {"label": label, "options": options, "correct": correct}
                for label, correct in pairs
            ],
        },
        "; ".join(correct for _, correct in pairs),
    )


def build(
    raw_path: Path,
    ocr_path: Path,
    page_dir: Path,
    manifest_path: Path | None = None,
) -> list[dict]:
    raw = json.loads(raw_path.read_text(encoding="utf-8"))
    pages = json.loads(ocr_path.read_text(encoding="utf-8"))
    _, blocks = ocr_stream(pages)
    regions = question_regions(pages)
    source_images = {}
    if manifest_path:
        source_images = {
            item["id"]: [
                f"public/source/sc/questions/{filename}"
                for filename in item["images"]
            ]
            for item in json.loads(manifest_path.read_text(encoding="utf-8"))
        }
    output = []

    for question in raw:
        question_id = question["id"]
        source_type = question["sourceType"]
        block = blocks.get(question_id, "")
        prompt = question["prompt"]

        if source_type == "choice":
            prompt, interaction, answer = parse_choice(prompt, question["answer"])
        elif source_type == "drag-drop":
            interaction, answer = drag_interaction(question, block)
            prompt = clean(prompt.split("Select and Place:", 1)[0])
        elif "For each of the following statements" in prompt:
            statements = matrix_statements(block)
            answers = matrix_answers(question, block, pages, page_dir, regions)
            interaction = {"type": "matrix", "statements": statements, "correct": answers}
            answer = "; ".join(answers)
            prompt = clean(re.sub(r"Hot Area:\s*$", "", prompt))
        else:
            candidates = option_candidates(block)
            selected = selected_texts(question_id, pages, page_dir, regions)
            correct = resolve_single_answer(question, candidates, selected)
            options = [{"id": candidate, "label": candidate} for candidate in candidates if candidate]
            if not any(norm(item["id"]) == norm(correct) for item in options):
                options.append({"id": correct, "label": correct})
            interaction = {"type": "single", "options": options, "correct": correct}
            answer = correct
            prompt = clean(re.sub(r"Hot Area:\s*$", "", prompt))

        explanation = question["explanation"] or "No explanation was printed in the source PDF."
        output.append(
            {
                "id": question_id,
                "kind": interaction["type"],
                "prompt": prompt,
                "answer": answer,
                "explanation": explanation,
                "sourceType": source_type,
                "sourceImages": source_images.get(question_id, []),
                "interaction": interaction,
            }
        )
    return output


def main() -> None:
    if len(sys.argv) not in (5, 6):
        raise SystemExit(
            "Usage: build_sc900_data.py RAW.json OCR_BOXES.json PAGE_DIR OUTPUT.json [SOURCE_MANIFEST.json]"
        )
    output = build(
        Path(sys.argv[1]),
        Path(sys.argv[2]),
        Path(sys.argv[3]),
        Path(sys.argv[5]) if len(sys.argv) == 6 else None,
    )
    Path(sys.argv[4]).write_text(
        json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    counts = {
        kind: sum(item["kind"] == kind for item in output)
        for kind in ("single", "multi", "matrix", "fields")
    }
    print(f"Wrote {len(output)} questions to {sys.argv[4]}")
    print(f"Interaction counts: {counts}")


if __name__ == "__main__":
    main()

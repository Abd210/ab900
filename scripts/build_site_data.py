#!/usr/bin/env python3
"""Combine extracted text, exact source crops, and the verified answer key."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path


HOTSPOT_KEYS: dict[int, str] = {
    1: "Yes, Yes, Yes",
    2: "time-bound role activation",
    4: "provide control over how users can access cloud apps",
    5: "accountability",
    6: "the Microsoft Authenticator app",
    9: "Yes, Yes, No",
    10: "a Site Member",
    12: "Site",
    14: "activate the role",
    16: "Microsoft Defender XDR",
    17: "Require multifactor authentication (MFA) for administrative roles",
    19: "View all the users in the Microsoft Entra tenant",
    20: "Yes, Yes, Yes",
    21: "adding a public DNS record",
    22: "No, Yes, No",
    24: "Yes, Yes, Yes",
    28: "Microsoft Graph",
    29: "No, No, Yes",
    30: "No, Yes, No",
    31: "The Microsoft 365 admin center; A billing policy",
    32: "users who are not assigned a Microsoft 365 Copilot license",
    33: "No, Yes, Yes",
    34: "manage a Teams Rooms device",
    38: "Microsoft Defender XDR",
    40: "Yes, Yes, No",
    41: "Data access governance",
    42: "No, Yes, Yes",
    43: "eDiscovery",
    44: "Yes, Yes, Yes",
    45: "Data Loss Prevention; DSPM for AI",
    47: "DSPM for AI",
    51: "eDiscovery",
    53: "Information Protection; Data Loss Prevention",
    55: "Privacy: Public; Restricted site access: configure Group1",
    57: "Yes, No, Yes",
    58: "a sensitivity label",
    59: "Restricted SharePoint Search",
    60: "Yes, Yes, No",
    63: "Content explorer",
    64: "Yes, Yes, No",
    68: "No, Yes, Yes",
    69: "Yes, Yes, Yes",
    70: "Yes, No, Yes",
    72: "the Microsoft 365 admin center",
    73: "No, Yes, No",
    74: "Yes, Yes, Yes",
    75: "the Researcher agent",
    77: "Microsoft SharePoint files",
    80: "the Change history report",
    83: "Yes, Yes, No",
    85: "Yes, Yes, Yes",
    86: "Copilot > Agents and Connectors",
}


ALIASES: dict[int, list[str]] = {
    6: ["microsoft authenticator", "authenticator app"],
    10: ["site member", "member"],
    12: ["site", "sharepoint site"],
    16: ["defender xdr"],
    17: ["require mfa for administrative roles", "mfa for admins"],
    19: ["view all users", "view users"],
    21: ["public dns record", "dns record"],
    28: ["graph", "microsoft graph"],
    31: [
        "microsoft 365 admin center billing policy",
        "m365 admin center billing policy",
    ],
    32: ["not assigned a copilot license", "unlicensed users"],
    34: ["teams rooms device", "manage teams room"],
    38: ["defender xdr"],
    41: ["data access governance report"],
    43: ["ediscovery"],
    45: ["dlp dspm for ai", "data loss prevention dspm"],
    47: ["dspm", "dspm for ai"],
    51: ["ediscovery"],
    53: ["information protection dlp"],
    55: ["public restricted site access group1", "restricted site access group1"],
    58: ["sensitivity label"],
    59: ["restricted sharepoint search"],
    63: ["content explorer", "data explorer"],
    72: ["microsoft 365 admin center", "m365 admin center"],
    75: ["researcher", "researcher agent"],
    77: ["sharepoint files", "microsoft sharepoint files"],
    80: ["change history", "change history report"],
    86: ["agents connectors", "copilot agents connectors", "connectors"],
}


def parse_options(prompt: str) -> list[dict]:
    matches = list(re.finditer(r"(?m)^([A-F])\.[ \t]*(.*)$", prompt))
    options: list[dict] = []
    for index, match in enumerate(matches):
        stop = matches[index + 1].start() if index + 1 < len(matches) else len(prompt)
        value = (match.group(2) + "\n" + prompt[match.end():stop]).strip()
        value = re.sub(r"\s+", " ", value)
        options.append({"id": match.group(1), "label": value})
    return options


def main() -> None:
    if len(sys.argv) != 4:
        raise SystemExit(
            "Usage: build_site_data.py QUESTIONS.raw.json CROPS.json OUTPUT.json"
        )
    raw_questions = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    crops = {
        item["id"]: item
        for item in json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
    }

    output = []
    for item in raw_questions:
        question_id = item["id"]
        answer = item["answer"].strip() or HOTSPOT_KEYS.get(question_id, "")
        if not answer:
            raise ValueError(f"No answer key for question {question_id}")

        options = parse_options(item["prompt"])
        is_letter_key = bool(re.fullmatch(r"[A-F]+", answer))
        if options and is_letter_key:
            kind = "multi" if len(answer) > 1 else "single"
        else:
            kind = "text"

        crop = crops[question_id]
        output.append(
            {
                "id": question_id,
                "kind": kind,
                "prompt": item["prompt"],
                "options": options,
                "answer": answer,
                "aliases": ALIASES.get(question_id, []),
                "explanation": item["explanation"],
                "promptImages": [
                    f"public/source/questions/{name}" for name in crop["promptImages"]
                ],
                "reviewImages": [
                    f"public/source/questions/{name}" for name in crop["reviewImages"]
                ],
            }
        )

    output_path = Path(sys.argv[3])
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"Wrote {len(output)} questions to {output_path}")
    print(
        "Kinds:",
        {
            kind: sum(1 for question in output if question["kind"] == kind)
            for kind in ("single", "multi", "text")
        },
    )


if __name__ == "__main__":
    main()

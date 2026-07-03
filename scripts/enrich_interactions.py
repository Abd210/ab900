#!/usr/bin/env python3
"""Replace image-driven AB-900 hotspots with native interactive question data."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path


def completion(stem: str, options: list[str], answer: str) -> dict:
    return {"type": "single", "stem": stem, "options": options, "correct": answer}


def matrix(statements: list[str], answers: list[str]) -> dict:
    return {"type": "matrix", "statements": statements, "correct": answers}


def fields(items: list[tuple[str, list[str], str]]) -> dict:
    return {
        "type": "fields",
        "fields": [
            {"label": label, "options": options, "correct": answer}
            for label, options, answer in items
        ],
    }


HOTSPOTS: dict[int, dict] = {
    1: matrix(
        [
            "You can use Search & intelligence in the Microsoft 365 admin center.",
            "You can use Audit in the Microsoft Defender portal.",
            "You can use Audit in the Microsoft Purview portal.",
        ],
        ["Yes", "Yes", "Yes"],
    ),
    2: completion(
        "Microsoft Entra Privileged Identity Management (PIM) provides…",
        [
            "restricted access to Microsoft 365 services.",
            "the lifecycle management of users.",
            "the management of enterprise applications.",
            "time-bound role activation.",
        ],
        "time-bound role activation.",
    ),
    4: completion(
        "Conditional Access policies…",
        [
            "are configured by using the Microsoft Defender portal.",
            "are applied only to on-premises resources.",
            "provide control over how users can access cloud apps.",
            "require a Microsoft Exchange mailbox.",
        ],
        "provide control over how users can access cloud apps.",
    ),
    5: completion(
        "The Microsoft responsible AI principle of ___ requires the oversight of AI systems to ensure that humans remain in control.",
        [
            "accountability",
            "inclusiveness",
            "privacy and security",
            "reliability and safety",
            "transparency",
        ],
        "accountability",
    ),
    6: completion(
        "User5 receives a number-matching sign-in notification on a mobile device. User5 is using ___ for multifactor authentication (MFA).",
        [
            "email OTP",
            "the Microsoft Authenticator app",
            "SMS",
            "a Temporary Access Pass",
        ],
        "the Microsoft Authenticator app",
    ),
    9: matrix(
        [
            "Microsoft Defender for Office 365 provides protection from phishing and malware attacks.",
            "Microsoft Defender for Identity monitors identities in Active Directory domains.",
            "Microsoft Defender Vulnerability Management provides protection for software as a service (SaaS) applications.",
        ],
        ["Yes", "Yes", "No"],
    ),
    10: {
        "type": "single",
        "context": [
            "Site owners: Global Administrator — Full control",
            "Site members: Everyone except external users — Edit",
            "Site visitors: None",
        ],
        "stem": "After a new internal user named User1 is created, User1 is ___ Site1.",
        "options": [
            "a site visitor of",
            "a site owner of",
            "a site member of",
            "prevented from accessing",
        ],
        "correct": "a site member of",
    },
    12: completion(
        "From the SharePoint admin center, you can create a…",
        ["server.", "user.", "site.", "role."],
        "site.",
    ),
    14: completion(
        "In Microsoft Entra Privileged Identity Management (PIM), an administrator has made you eligible for the User Administrator role. Before you can create a user account, you must…",
        [
            "activate the role.",
            "install the Microsoft Authenticator app.",
            "request a license.",
            "update your location information.",
        ],
        "activate the role.",
    ),
    16: completion(
        "___ is a unified enterprise suite that coordinates detection, prevention, investigation, and response across endpoints, identities, email, and applications.",
        [
            "Microsoft Defender XDR",
            "Microsoft Entra Conditional Access",
            "Microsoft Entra ID Protection",
            "Microsoft Purview",
        ],
        "Microsoft Defender XDR",
    ),
    17: {
        "type": "single",
        "context": [
            "Do not expire passwords — 8/8 points",
            "Use least privileged administrative roles — 1/1 point",
            "Enable policy to block legacy authentication — 0.73/8 points",
            "Require multifactor authentication for administrative roles — 0/10 points",
        ],
        "stem": "Resolving which recommendation will improve the Identity Secure Score the most?",
        "options": [
            "Do not expire passwords",
            "Use least privileged administrative roles",
            "Enable policy to block legacy authentication",
            "Require multifactor authentication for administrative roles",
        ],
        "correct": "Require multifactor authentication for administrative roles",
    },
    19: {
        "type": "single",
        "context": ["John is assigned the User role (no admin center access)."],
        "stem": "What can John do?",
        "options": [
            "view all the users in the Microsoft Entra tenant",
            "view all the content in Microsoft SharePoint sites",
            "read all the content in Microsoft Exchange mailboxes",
            "perform eDiscovery of Microsoft 365 Copilot prompts",
        ],
        "correct": "view all the users in the Microsoft Entra tenant",
    },
    20: matrix(
        [
            "You can use a Microsoft Entra security group to assign permissions to Microsoft Entra ID resources.",
            "You can use a Microsoft Entra security group to assign Microsoft 365 licenses.",
            "You can use a Microsoft Entra security group to assign permissions to Microsoft Exchange mailboxes.",
        ],
        ["Yes", "Yes", "Yes"],
    ),
    21: completion(
        "When you need to add a domain to a Microsoft 365 subscription, you must verify the domain by…",
        [
            "adding a public DNS record.",
            "confirming your business address.",
            "uploading a certificate.",
            "uploading a webpage.",
        ],
        "adding a public DNS record.",
    ),
    22: matrix(
        [
            "Zero Trust requires an Azure subscription.",
            "Zero Trust is a security strategy, not a specific product.",
            "From the Microsoft 365 admin center, you can enable Zero Trust for your organization.",
        ],
        ["No", "Yes", "No"],
    ),
    24: matrix(
        [
            "A site member of a Microsoft SharePoint site can invite users to access the content in the site.",
            "A site owner of a Microsoft SharePoint site can add Microsoft 365 groups as site members.",
            "A site owner of a Microsoft SharePoint site can remove another site owner from the site.",
        ],
        ["Yes", "Yes", "Yes"],
    ),
    28: completion(
        "___ includes signals such as collaboration history, document relevance, and communication frequency, which influence Microsoft 365 Copilot responses.",
        [
            "Microsoft Copilot Studio",
            "Microsoft Graph",
            "Microsoft Purview",
            "Microsoft Viva Insights",
        ],
        "Microsoft Graph",
    ),
    29: matrix(
        [
            "Prompts and responses issued by users in Microsoft 365 Copilot are used by Microsoft to train models.",
            "Content retrieved by using Microsoft Graph is used by Microsoft to train models.",
            "Microsoft 365 Copilot honors the security permissions in your Microsoft 365 subscription.",
        ],
        ["No", "No", "Yes"],
    ),
    30: matrix(
        [
            "Users can use Microsoft 365 Copilot anonymously.",
            "Administrators can allow the self-service purchase of Microsoft 365 Copilot licenses.",
            "Microsoft 365 Copilot licenses can be assigned to Microsoft Entra ID guest users from other organizations.",
        ],
        ["No", "Yes", "No"],
    ),
    31: fields(
        [
            (
                "Portal",
                [
                    "The Microsoft 365 admin center",
                    "The Microsoft Entra admin center",
                    "The Microsoft Purview portal",
                ],
                "The Microsoft 365 admin center",
            ),
            (
                "Feature",
                ["An auto-claim policy", "A billing policy", "A Copilot connector"],
                "A billing policy",
            ),
        ]
    ),
    32: completion(
        "In the Microsoft 365 admin center, the Credits used metric in the Copilot credits report shows the total credits used by users in your organization that ___ and are interacting with work-grounded agents in Microsoft 365 Copilot Chat.",
        [
            "use Microsoft Teams",
            "are external to your organization",
            "are assigned a Microsoft 365 Copilot license",
            "are NOT assigned a Microsoft 365 Copilot license",
        ],
        "are NOT assigned a Microsoft 365 Copilot license",
    ),
    33: matrix(
        [
            "Users that are assigned a Microsoft 365 E5 license can create Microsoft 365 Copilot agents grounded in the web.",
            "Users must be assigned a Microsoft 365 Copilot license to use the Analyst agent.",
            "Users can use a natural language prompt to create a Microsoft 365 Copilot agent.",
        ],
        ["No", "Yes", "Yes"],
    ),
    34: completion(
        "From the Microsoft Teams admin center, you can…",
        [
            "assign a Teams license to a user.",
            "deploy the Teams client.",
            "manage a Teams Rooms device.",
            "prevent users from creating teams.",
        ],
        "manage a Teams Rooms device.",
    ),
    38: completion(
        "You can use ___ to review threat indicators correlated across email, identity, and device incidents in a single view.",
        [
            "Microsoft Defender for Office 365",
            "Microsoft Defender XDR",
            "Microsoft Purview Compliance Manager",
            "Microsoft Purview Data Loss Prevention",
        ],
        "Microsoft Defender XDR",
    ),
    40: matrix(
        [
            "Microsoft Purview Compliance Manager provides a risk-based compliance score to help you understand your compliance posture.",
            "Microsoft Purview Compliance Manager provides step-by-step guidance to remediate compliance issues.",
            "Compliance Manager is part of Microsoft Defender.",
        ],
        ["Yes", "Yes", "No"],
    ),
    41: completion(
        "Which report should you use in the SharePoint admin center to identify files shared with external users?",
        [
            "Agent insights",
            "App insights",
            "Change history",
            "Data access governance",
            "OneDrive accounts",
            "Site policy comparison",
        ],
        "Data access governance",
    ),
    42: matrix(
        [
            "For administrators to use SharePoint Advanced Management, all users in the organization need a Microsoft 365 Copilot license.",
            "SharePoint Advanced Management can help restrict Microsoft 365 Copilot from accessing Microsoft SharePoint content.",
            "SharePoint Advanced Management is available as a standalone license for organizations without Microsoft 365 Copilot.",
        ],
        ["No", "Yes", "Yes"],
    ),
    43: completion(
        "The HR department requests a copy of all recent files modified by User1. Which Microsoft Purview solution should you use?",
        [
            "Audit",
            "Communication Compliance",
            "Compliance Manager",
            "Data Lifecycle Management",
            "Data Loss Prevention",
            "DSPM for AI",
            "eDiscovery",
            "Information Protection",
            "Insider Risk Management",
        ],
        "eDiscovery",
    ),
    44: matrix(
        [
            "Microsoft Purview DSPM for AI can provide insight into ChatGPT usage.",
            "Microsoft Purview DSPM for AI can provide insight into Microsoft 365 Copilot usage.",
            "Microsoft Purview DSPM for AI can block users from using Microsoft 365 Copilot.",
        ],
        ["Yes", "Yes", "Yes"],
    ),
    45: fields(
        [
            (
                "Prevent users from sharing PII",
                [
                    "Communication Compliance",
                    "Data Loss Prevention",
                    "DSPM for AI",
                    "Information Protection",
                    "Insider Risk Management",
                ],
                "Data Loss Prevention",
            ),
            (
                "Use machine learning to train a model",
                [
                    "Communication Compliance",
                    "Data Loss Prevention",
                    "DSPM for AI",
                    "Information Protection",
                    "Insider Risk Management",
                ],
                "DSPM for AI",
            ),
        ]
    ),
    47: completion(
        "You can use the ___ Microsoft Purview solution to detect Microsoft 365 Copilot prompts that contain sensitive information.",
        [
            "Data Lifecycle Management",
            "DSPM for AI",
            "Information Barriers",
            "Information Protection",
        ],
        "DSPM for AI",
    ),
    51: completion(
        "You can use the ___ Microsoft Purview solution to find all content that relates to the term “Project Falcon” in emails exchanged by two users.",
        ["Audit", "Data Catalog", "eDiscovery", "Insider Risk Management"],
        "eDiscovery",
    ),
    53: fields(
        [
            (
                "Discover and classify sensitive data across multiple platforms",
                [
                    "Communication Compliance",
                    "Data Loss Prevention",
                    "Information Protection",
                    "Insider Risk Management",
                ],
                "Information Protection",
            ),
            (
                "Block users from sharing intellectual property with external users",
                [
                    "Communication Compliance",
                    "Data Loss Prevention",
                    "Information Protection",
                    "Insider Risk Management",
                ],
                "Data Loss Prevention",
            ),
        ]
    ),
    55: fields(
        [
            ("Privacy", ["Private", "Public"], "Public"),
            (
                "Restricted site access",
                ["Not set", "Configure Group1"],
                "Configure Group1",
            ),
        ]
    ),
    57: matrix(
        [
            "Microsoft 365 Copilot honors Microsoft Purview sensitivity labels.",
            "Microsoft 365 Copilot ignores Microsoft Purview data loss prevention (DLP) policies.",
            "Microsoft 365 Copilot honors existing Microsoft 365 permissions.",
        ],
        ["Yes", "No", "Yes"],
    ),
    58: completion(
        "Microsoft Purview sensitivity labels can be applied to…",
        [
            "Azure Blob Storage.",
            "Microsoft 365 Copilot conversations.",
            "Microsoft SharePoint sites.",
        ],
        "Microsoft SharePoint sites.",
    ),
    59: completion(
        "Restricted SharePoint Search enables you to restrict ___ access to Microsoft SharePoint sites without preventing users from accessing files and content to which they have permission.",
        [
            "administrator",
            "guest user",
            "Microsoft 365 Copilot",
            "Microsoft Purview eDiscovery",
        ],
        "Microsoft 365 Copilot",
    ),
    60: matrix(
        [
            "A sensitivity label can be applied to a Microsoft SharePoint site.",
            "A sensitivity label can be applied to an email message in Microsoft Exchange.",
            "A sensitivity label can be applied to Windows 11 devices.",
        ],
        ["Yes", "Yes", "No"],
    ),
    63: completion(
        "From the Microsoft Purview portal, you can use Data explorer to…",
        [
            "create and manage privacy policies.",
            "perform searches for content in mailboxes and sites.",
            "identify sensitive information and where it is located.",
            "review the effectiveness of your data loss prevention (DLP) policies.",
        ],
        "identify sensitive information and where it is located.",
    ),
    64: matrix(
        [
            "A Communication Compliance policy can detect inappropriate text in Microsoft Teams messages.",
            "A Communication Compliance policy can detect offensive language in Microsoft 365 Copilot prompts.",
            "A Communication Compliance policy can be used to retain email messages for 10 years.",
        ],
        ["Yes", "Yes", "No"],
    ),
    68: matrix(
        [
            "The Microsoft 365 Copilot usage report can be used to view Copilot prompts submitted by users.",
            "The Microsoft 365 Copilot usage report shows the total number of unique users in your organization that are assigned Microsoft 365 Copilot licenses.",
            "The Microsoft 365 Copilot usage report shows the Copilot usage of each individual Microsoft 365 app.",
        ],
        ["No", "Yes", "Yes"],
    ),
    69: matrix(
        [
            "From the Copilot Prompt Gallery, you can modify a saved prompt.",
            "From the Copilot Prompt Gallery, you can share a saved prompt to a Microsoft Teams team.",
            "You can create a shared link for a prompt that was NOT saved to the Copilot Prompt Gallery.",
        ],
        ["Yes", "Yes", "Yes"],
    ),
    70: matrix(
        [
            "Administrators can remove a specific Copilot agent from all users.",
            "From the Microsoft 365 admin center, administrators can configure the prompts of a Copilot agent.",
            "Administrators can deploy Copilot agents to specific users.",
        ],
        ["Yes", "No", "Yes"],
    ),
    72: completion(
        "If a user shares a Microsoft 365 Copilot agent, you can use ___ to block users from using the agent.",
        [
            "Microsoft Foundry",
            "Microsoft Copilot Studio",
            "the Microsoft 365 admin center",
            "the Power Apps portal",
        ],
        "the Microsoft 365 admin center",
    ),
    73: matrix(
        [
            "To use Microsoft 365 Copilot Chat to reason over web data, you need a Microsoft 365 Copilot license.",
            "To use the Researcher agent in Microsoft 365 Copilot, you need a Microsoft 365 Copilot license.",
            "To add an agent in the Microsoft 365 Copilot app, you need a Microsoft 365 Copilot license.",
        ],
        ["No", "Yes", "No"],
    ),
    74: matrix(
        [
            "Microsoft 365 Copilot only surfaces organizational data for which individual users have permissions.",
            "Microsoft 365 Copilot uses the same underlying controls for data access as other Microsoft 365 services.",
            "Microsoft 365 Copilot can use connectors to retrieve information from third-party data sources.",
        ],
        ["Yes", "Yes", "Yes"],
    ),
    75: completion(
        "In Microsoft 365 Copilot, you should use ___ to perform multi-step reasoning over unstructured data.",
        ["a notebook", "Chat", "the Analyst agent", "the Researcher agent"],
        "the Researcher agent",
    ),
    77: completion(
        "Microsoft 365 Copilot retrieves data from ___ by using Microsoft Graph.",
        [
            "Azure OpenAI",
            "external users",
            "Microsoft SharePoint files",
            "web searchers",
        ],
        "Microsoft SharePoint files",
    ),
    80: completion(
        "Which report should you use in the SharePoint admin center to identify changes made by a site administrator to Site1 settings?",
        [
            "Agent insights",
            "App insights",
            "Change history",
            "Data access governance",
            "OneDrive accounts",
            "Site policy comparison",
        ],
        "Change history",
    ),
    83: matrix(
        [
            "Microsoft Purview Communication Compliance can detect offensive text in images stored in Microsoft SharePoint sites.",
            "Microsoft Purview Communication Compliance anonymizes user identities by default during investigations.",
            "Microsoft Purview Communication Compliance adds a disclaimer to all monitored communications.",
        ],
        ["Yes", "Yes", "No"],
    ),
    85: matrix(
        [
            "Administrators can block specific websites from being used by Microsoft 365 Copilot.",
            "Administrators can block Microsoft 365 Copilot from using web search when responding to user prompts.",
            "Administrators can block access to the Researcher agent while allowing access to the Analyst agent.",
        ],
        ["Yes", "Yes", "Yes"],
    ),
    86: {
        "type": "multi",
        "stem": "Which settings should you configure in the Microsoft 365 admin center so users can use an external system as a knowledge source for custom Copilot agents?",
        "options": ["Agents", "Connectors", "Search", "Billing & usage", "Settings"],
        "correct": ["Agents", "Connectors"],
    },
}


def clean_prompt(prompt: str, strip_choices: bool = False) -> str:
    if strip_choices:
        prompt = re.split(r"(?m)^[A-F]\.[ \t]*", prompt, maxsplit=1)[0]
    lines = [
        line.strip()
        for line in prompt.replace("HOTSPOT", "").splitlines()
        if line.strip() and line.strip() != "-"
    ]
    return "\n".join(lines)


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("Usage: enrich_interactions.py INPUT.json OUTPUT.json")

    questions = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    for question in questions:
        question.pop("promptImages", None)
        question.pop("reviewImages", None)
        question["prompt"] = clean_prompt(
            question["prompt"], strip_choices=question["id"] not in HOTSPOTS
        )
        question["sourceType"] = "text"

        if question["id"] in HOTSPOTS:
            interaction = HOTSPOTS[question["id"]]
            question["interaction"] = interaction
            question["kind"] = interaction["type"]
            correct = (
                [field["correct"] for field in interaction["fields"]]
                if interaction["type"] == "fields"
                else interaction["correct"]
            )
            if isinstance(correct, list):
                question["answer"] = "; ".join(correct)
            else:
                question["answer"] = correct
        else:
            interaction_type = question["kind"]
            correct = (
                list(question["answer"])
                if interaction_type == "multi"
                else question["answer"]
            )
            question["interaction"] = {
                "type": interaction_type,
                "options": question["options"],
                "correct": correct,
            }

        question.pop("options", None)
        question.pop("aliases", None)

    missing = sorted(set(range(1, 90)) - {q["id"] for q in questions})
    if missing:
        raise ValueError(f"Missing questions: {missing}")
    if sum(1 for q in questions if q["interaction"]["type"] == "text"):
        raise ValueError("Unconverted text questions remain")

    Path(sys.argv[2]).write_text(
        json.dumps(questions, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"Wrote {len(questions)} fully interactive questions")


if __name__ == "__main__":
    main()

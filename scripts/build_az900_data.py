#!/usr/bin/env python3
"""Merge AZ-900 PDF text and page-image OCR into native quiz interactions."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path


SENTENCE_ITEMS = {
    3: (
        "When you are implementing a Software as a Service (SaaS) solution, you are responsible for…",
        ["configuring high availability", "defining scalability rules", "installing the SaaS solution", "configuring the SaaS solution"],
        "configuring the SaaS solution",
    ),
    5: (
        "An organization that hosts its infrastructure ___ no longer requires a data center.",
        ["in a private cloud", "in a hybrid cloud", "on a Hyper-V host", "in the public cloud"],
        "in the public cloud",
    ),
    7: (
        "When planning to migrate a public website to Azure, you must plan to…",
        ["deploy a VPN", "pay monthly usage costs", "pay to transfer all website data to Azure", "reduce the number of website connections"],
        "pay monthly usage costs",
    ),
    17: (
        "Azure Site Recovery provides ___ for virtual machines.",
        ["fault tolerance", "disaster recovery", "elasticity", "high availability"],
        "fault tolerance",
    ),
    19: (
        "An Azure web app that queries an on-premises Microsoft SQL server is an example of a ___ cloud.",
        ["hybrid", "multi-vendor", "private", "public"],
        "hybrid",
    ),
    35: (
        "Azure Cosmos DB is an example of a ___ offering.",
        ["platform as a service (PaaS)", "infrastructure as a service (IaaS)", "serverless", "software as a service (SaaS)"],
        "platform as a service (PaaS)",
    ),
    41: (
        "To ensure VM1 cannot connect to the other virtual machines, VM1 must…",
        ["be deployed to a separate virtual network", "run a different operating system", "be deployed to a separate resource group", "have two network interfaces"],
        "be deployed to a separate virtual network",
    ),
    42: (
        "To delegate permissions to several Azure virtual machines simultaneously, deploy them…",
        ["to the same Azure region", "with the same ARM template", "to the same resource group", "to the same availability zone"],
        "to the same resource group",
    ),
    57: (
        "You create a new Azure subscription. The existing virtual machines…",
        ["cannot be moved to it", "can be moved to it", "can be moved only if they are in one resource group", "can be moved only if they run Windows Server 2016"],
        "can be moved to it",
    ),
    68: (
        "Data stored in the Archive access tier of an Azure Storage account…",
        ["can be accessed at any time with AzCopy", "can only be read with Azure Backup", "must be restored before access", "must be rehydrated before access"],
        "must be rehydrated before access",
    ),
    80: (
        "___ provide a common platform for deploying objects to cloud infrastructure and implementing consistency.",
        ["Azure policies", "Resource groups", "Azure Resource Manager templates", "Management groups"],
        "Azure Resource Manager templates",
    ),
    120: (
        "After creating a virtual machine, modify the ___ to allow TCP port 8080 connections.",
        ["network security group (NSG)", "virtual network gateway", "virtual network", "route table"],
        "network security group (NSG)",
    ),
    126: (
        "From ___ you can see which user turned off a specific virtual machine during the last 14 days.",
        ["Azure Access Control (IAM)", "Azure Event Hubs", "Azure Activity Log", "Azure Service Health"],
        "Azure Activity Log",
    ),
    134: (
        "You can enable just-in-time (JIT) VM access by using…",
        ["Azure Bastion", "Azure Firewall", "Azure Front Door", "Azure Security Center"],
        "Azure Security Center",
    ),
    139: (
        "If resource group RG1 has a delete lock, ___ can delete RG1.",
        ["only a global administrator", "the lock must be removed before an administrator", "an Azure policy must be modified before an administrator", "an Azure tag must be added before an administrator"],
        "the lock must be removed before an administrator",
    ),
    154: (
        "Your company implements ___ to automatically watermark Word documents containing credit card information.",
        ["Azure policies", "DDoS Protection", "Azure Information Protection", "Azure AD Identity Protection"],
        "Azure Information Protection",
    ),
    155: (
        "After a policy disallows virtual networks in RG1, the existing VNET1…",
        ["is deleted automatically", "moves automatically", "continues to function normally", "becomes read-only"],
        "continues to function normally",
    ),
    159: (
        "The ___ explains what data Microsoft processes, how it processes it, and why.",
        ["Microsoft Online Services Privacy Statement", "Microsoft Online Services Terms", "Microsoft Online Service Level Agreement", "Online Subscription Agreement for Microsoft Azure"],
        "Microsoft Online Services Privacy Statement",
    ),
    160: (
        "___ is the process of verifying a user's credentials.",
        ["Authorization", "Authentication", "Federation", "Ticketing"],
        "Authentication",
    ),
    161: (
        "An Azure Policy initiative is a…",
        ["collection of policy definitions", "collection of policy definition assignments", "group of Azure Blueprint definitions", "group of RBAC role assignments"],
        "collection of policy definitions",
    ),
    162: (
        "___ let organizations manage the compliance of Azure resources across multiple subscriptions.",
        ["Resource groups", "Management groups", "Azure policies", "Azure App Service plans"],
        "Azure policies",
    ),
    166: (
        "An Azure service is available to all Azure customers when it is in…",
        ["public preview", "private preview", "development", "an Enterprise Agreement subscription"],
        "public preview",
    ),
    173: (
        "After your Azure trial expires, you are unable to…",
        ["create additional Azure AD users", "start an existing Azure virtual machine", "access data stored in Azure", "access the Azure portal"],
        "start an existing Azure virtual machine",
    ),
    178: (
        "The composite SLA for an app with 99.95% and 99.99% component SLAs is…",
        ["the product of both SLAs, about 99.94%", "the lower SLA, 99.95%", "the higher SLA, 99.99%", "the difference, 0.04%"],
        "the product of both SLAs, about 99.94%",
    ),
    188: (
        "If an Azure resource has an extended service outage, Microsoft will…",
        ["refund your bank account", "migrate it to another subscription", "credit your Azure account", "send an Azure coupon"],
        "credit your Azure account",
    ),
    207: (
        "All Azure services in public preview are…",
        ["provided without documentation", "configurable only with Azure CLI", "excluded from Service Level Agreements", "configurable only from the Azure portal"],
        "excluded from Service Level Agreements",
    ),
}


MATRIX_STATEMENT_OVERRIDES = {
    1: [
        "A PaaS solution hosting Azure web apps provides full control of the host operating systems.",
        "A PaaS solution hosting Azure web apps can scale the platform automatically.",
        "A PaaS solution hosting Azure web apps provides development services for adding application features.",
    ],
    2: [
        "Azure provides flexibility between capital expenditure (CapEx) and operational expenditure (OpEx).",
        "If you create two Azure virtual machines that use the B2S size, each virtual machine will always generate the same monthly costs.",
        "When an Azure virtual machine is stopped, you continue to pay storage costs associated with the virtual machine.",
    ],
    22: [
        "To implement a hybrid cloud model, a company must first have a private cloud.",
        "A company can extend its internal computing resources by using a hybrid cloud.",
        "In a public cloud model, only guest users at your company can access cloud resources.",
    ],
    25: [
        "Azure pay-as-you-go pricing is an example of CapEx.",
        "Azure Reserved VM Instances are an example of OpEx.",
        "Deploying your own datacenter is an example of CapEx.",
    ],
    39: [
        "An Azure subscription can have multiple account administrators.",
        "An Azure subscription can be managed only by using a Microsoft account.",
        "An Azure resource group can contain multiple Azure subscriptions.",
    ],
    53: [
        "An Azure subscription can be associated with multiple Azure Active Directory (Azure AD) tenants.",
        "You can change the Azure Active Directory (Azure AD) tenant associated with an Azure subscription.",
        "When an Azure subscription expires, its associated Azure Active Directory (Azure AD) tenant is deleted automatically.",
    ],
    67: [
        "All Azure resources deployed to a resource group must use the same Azure region.",
        "If you assign a tag to a resource group, every Azure resource in that resource group receives the same tag.",
        "If you give a user permission to manage a resource group, the user can manage every Azure resource in that group.",
    ],
    112: [
        "Azure Advisor can list Azure virtual machines protected by Azure Backup.",
        "Implementing Azure Advisor security recommendations decreases your company's secure score.",
        "Microsoft support requires Azure Advisor security recommendations to be implemented within 30 days.",
    ],
    176: [
        "An Azure free account has a spending limit.",
        "An Azure free account has a 2-TB upload limit.",
        "An Azure free account can contain an unlimited number of web apps.",
    ],
    185: [
        "Storing 1 TB in Azure Blob Storage always costs the same in every Azure region.",
        "With a general-purpose v2 account, you are charged only for stored data.",
        "Data transfer between storage accounts in different Azure regions is free.",
    ],
    196: [
        "With Azure Reservations, you pay less for virtual machines than with pay-as-you-go pricing.",
        "If you create two Azure virtual machines that use the B2S size, each virtual machine will always generate the same monthly costs.",
        "When an Azure virtual machine is stopped, you continue to pay storage costs associated with the virtual machine.",
    ],
}


MATRIX_ANSWER_OVERRIDES = {
    23: ["No", "No", "Yes"],
    38: ["Yes", "No", "Yes"],
    39: ["No", "Yes", "No"],
    73: ["No", "No", "No"],
    135: ["Yes", "No", "Yes"],
    136: ["Yes", "Yes", "Yes"],
    144: ["No", "No", "Yes"],
    158: ["Yes", "Yes", "No"],
    163: ["Yes", "Yes", "Yes"],
    164: ["Yes", "No", "Yes"],
    165: ["No", "Yes", "Yes"],
    183: ["Yes", "No", "No"],
}


def fields(items: list[tuple[str, list[str], str]]) -> dict:
    return {
        "type": "fields",
        "fields": [
            {"label": label, "options": options, "correct": correct}
            for label, options, correct in items
        ],
    }


SPECIAL_ITEMS = {
    13: fields([
        ("Azure virtual machines", ["Infrastructure as a service (IaaS)", "Platform as a service (PaaS)", "Software as a service (SaaS)"], "Infrastructure as a service (IaaS)"),
        ("Azure SQL Database", ["Infrastructure as a service (IaaS)", "Platform as a service (PaaS)", "Software as a service (SaaS)"], "Platform as a service (PaaS)"),
    ]),
    48: {"type": "single", "options": ["https://portal.azure.com", "https://admin.azure.com", "https://azurewebsites.com", "https://www.microsoft.com"], "correct": "https://portal.azure.com"},
    50: {"type": "single", "options": ["Virtual network gateway", "Local network gateway", "Application gateway", "Route table"], "correct": "Local network gateway"},
    62: {"type": "single", "options": ["Containers (Blob storage)", "File shares", "Tables", "Queues"], "correct": "Containers (Blob storage)"},
    65: {"type": "single", "options": ["Azure Cosmos DB", "Azure SQL Database", "Azure Database for MySQL", "Azure Cache for Redis"], "correct": "Azure Cosmos DB"},
    69: fields([
        ("Minimum virtual machines", ["1", "2", "3"], "2"),
        ("Minimum availability zones", ["1", "2", "3"], "2"),
    ]),
    79: fields([
        ("Computer1 - Windows 10", ["Azure CLI and portal", "Portal and PowerShell", "Azure CLI and PowerShell", "Azure CLI, portal, and PowerShell"], "Azure CLI, portal, and PowerShell"),
        ("Computer2 - Ubuntu", ["Azure CLI and portal", "Portal and PowerShell", "Azure CLI and PowerShell", "Azure CLI, portal, and PowerShell"], "Azure CLI, portal, and PowerShell"),
        ("Computer3 - macOS Mojave", ["Azure CLI and portal", "Portal and PowerShell", "Azure CLI and PowerShell", "Azure CLI, portal, and PowerShell"], "Azure CLI, portal, and PowerShell"),
    ]),
    96: {"type": "single", "options": ["Cloud Shell (>_)", "Notifications (bell)", "Settings (gear)", "Help (?)"], "correct": "Cloud Shell (>_)"},
    102: {"type": "single", "options": ["Monitor", "Advisor", "Help + support / Service Health", "Cost Management + Billing"], "correct": "Help + support / Service Health"},
    105: fields([
        ("Monitor Azure service health", ["Monitor", "Subscriptions", "Marketplace", "Advisor"], "Monitor"),
        ("Browse virtual machine images", ["Monitor", "Subscriptions", "Marketplace", "Advisor"], "Marketplace"),
        ("View security recommendations", ["Monitor", "Subscriptions", "Marketplace", "Advisor"], "Advisor"),
    ]),
    132: fields([
        ("Monitor threats using sensors", ["Azure Monitor", "Azure Security Center", "Azure Advanced Threat Protection (ATP)", "Azure AD Identity Protection"], "Azure Advanced Threat Protection (ATP)"),
        ("Enforce MFA based on a condition", ["Azure Monitor", "Azure Security Center", "Azure Advanced Threat Protection (ATP)", "Azure AD Identity Protection"], "Azure AD Identity Protection"),
    ]),
    150: {"type": "single", "options": ["Deployments", "Policies", "Properties", "Locks"], "correct": "Locks"},
    181: {"type": "single", "options": ["Advisor", "Security Center", "Cost Management + Billing", "Help + support"], "correct": "Help + support"},
    200: {"type": "single", "options": ["(Maximum available minutes - downtime) / maximum available minutes × 100", "Downtime / maximum available minutes × 100", "Maximum available minutes / downtime × 100", "(Maximum available minutes - downtime) / 1,440"], "correct": "(Maximum available minutes - downtime) / maximum available minutes × 100"},
}


MATCH_ITEMS = {
    21: (
        ["Fault tolerance", "Disaster recovery", "Dynamic scalability", "Low latency"],
        [
            ("A service remains available after a component failure.", "Fault tolerance"),
            ("A service can be recovered after a failure.", "Disaster recovery"),
            ("Compute resources are added when demand increases.", "Dynamic scalability"),
            ("A service can be accessed quickly over the internet.", "Low latency"),
        ],
    ),
    28: (
        ["Hybrid cloud", "Private cloud", "Public cloud"],
        [
            ("No required capital expenditure.", "Public cloud"),
            ("Provides complete control over security.", "Private cloud"),
            ("Provides a choice of on-premises or cloud resources.", "Hybrid cloud"),
        ],
    ),
    81: (
        ["Azure Machine Learning", "Azure IoT Hub", "Azure Bot Service", "Azure Functions"],
        [
            ("Provides a digital assistant with speech support.", "Azure Bot Service"),
            ("Uses past training to make high-probability predictions.", "Azure Machine Learning"),
            ("Provides serverless computing.", "Azure Functions"),
            ("Processes data from millions of sensors.", "Azure IoT Hub"),
        ],
    ),
    83: (
        ["Azure Functions", "Azure App Service", "Azure virtual machines", "Azure Container Instances"],
        [
            ("Provides operating system virtualization.", "Azure virtual machines"),
            ("Provides portable environments for virtualized apps.", "Azure Container Instances"),
            ("Builds, deploys, and scales web apps.", "Azure App Service"),
            ("Provides a platform for serverless code.", "Azure Functions"),
        ],
    ),
    87: (
        ["Azure Databricks", "Azure Functions", "Azure App Service", "Azure Application Insights"],
        [
            ("Provides a platform for serverless code.", "Azure Functions"),
            ("Provides big-data analysis for machine learning.", "Azure Databricks"),
            ("Detects and diagnoses anomalies in web apps.", "Azure Application Insights"),
            ("Hosts web apps.", "Azure App Service"),
        ],
    ),
    103: (
        ["Azure Advisor", "Azure Cognitive Services", "Azure Application Insights", "Azure DevOps"],
        [
            ("An integrated solution for code deployment.", "Azure DevOps"),
            ("Provides recommendations to improve an Azure environment.", "Azure Advisor"),
            ("Builds intelligent AI applications with simplified APIs.", "Azure Cognitive Services"),
            ("Monitors web applications.", "Azure Application Insights"),
        ],
    ),
    104: (
        ["Azure HDInsight", "Azure Data Lake Analytics", "Azure Synapse Analytics", "Azure SQL Database"],
        [
            ("A managed relational cloud database.", "Azure SQL Database"),
            ("Runs complex MPP queries across relational data.", "Azure Synapse Analytics"),
            ("Runs massively parallel transformation across petabytes.", "Azure Data Lake Analytics"),
            ("Open-source distributed processing of big-data clusters.", "Azure HDInsight"),
        ],
    ),
    114: (
        ["Azure Machine Learning", "Azure Synapse Analytics", "Azure IoT Hub", "Azure Functions"],
        [
            ("Provides a cloud-based enterprise data warehouse.", "Azure Synapse Analytics"),
            ("Uses past training to make high-probability predictions.", "Azure Machine Learning"),
            ("Provides serverless computing.", "Azure IoT Hub"),
            ("Processes data from millions of sensors.", "Azure Functions"),
        ],
    ),
    146: (
        ["Azure Government", "GDPR", "ISO", "NIST"],
        [
            ("Defines international standards across industries.", "ISO"),
            ("Defines standards used by the United States government.", "NIST"),
            ("A European policy regulating privacy and data protection.", "GDPR"),
            ("A dedicated public cloud for US government agencies.", "Azure Government"),
        ],
    ),
}

SOURCE_CONFLICT_NOTES = {
    17: (
        "Source note: The PDF's green answer area selects “fault tolerance.” "
        "Its accompanying explanation describes Azure Site Recovery behavior "
        "that is commonly categorized as disaster recovery."
    ),
    73: (
        "Source note: The PDF's green answer area selects No for all three "
        "statements, while the printed explanation labels Box 3 as Yes."
    ),
    114: (
        "Source note: The PDF's answer image maps Azure IoT Hub to serverless "
        "computing and Azure Functions to sensor processing. This mapping is "
        "reproduced exactly here even though the service descriptions appear reversed."
    ),
}


def clean_ocr_line(value: str) -> str:
    value = re.sub(r"\bO\b", "", value)
    value = re.sub(r"\s+", " ", value)
    return value.strip(" *")


def parse_options(prompt: str) -> tuple[str, list[dict]]:
    matches = list(re.finditer(r"(?m)^([A-F])\.\s*(.*)$", prompt))
    options = []
    for index, match in enumerate(matches):
        stop = matches[index + 1].start() if index + 1 < len(matches) else len(prompt)
        label = re.sub(r"\s+", " ", match.group(2) + "\n" + prompt[match.end() : stop]).strip()
        label = re.sub(r"\b[lI]aaS\b", "IaaS", label)
        options.append({"id": match.group(1), "label": label})
    stem = prompt[: matches[0].start()].strip() if matches else prompt
    return stem, options


def ocr_blocks(items: list[dict]) -> dict[int, str]:
    stream = "\n".join(item["text"] for item in items)
    matches = list(re.finditer(r"(?m)^QUESTION\s+(\d+)\s*$", stream))
    return {
        int(match.group(1)): stream[
            match.end() : matches[index + 1].start() if index + 1 < len(matches) else len(stream)
        ]
        for index, match in enumerate(matches)
    }


def matrix_interaction(question: dict, block: str) -> dict:
    question_id = question["id"]
    before_answer = block.split("Correct Answer:", 1)[0]
    area = before_answer.rsplit("Answer Area", 1)[-1]
    ignored = {"Statements", "Yes", "No", "V"}
    lines = [
        clean_ocr_line(line)
        for line in area.splitlines()
        if line.strip()
        and line.strip() not in ignored
        and not line.startswith(("http", "Hot Area:", "NOTE:", "For each"))
    ]
    text = " ".join(line for line in lines if line)
    statements = [
        value.strip()
        for value in re.split(r"(?<=[.?!•])\s+(?=[A-Z0-9])", text)
        if value.strip()
    ]
    statements = MATRIX_STATEMENT_OVERRIDES.get(question_id, statements)

    answers = [
        value.title()
        for value in re.findall(
            r"Box\s*\d+\s*:\s*(Yes|No)", question["explanation"], re.IGNORECASE
        )
    ]
    answers = MATRIX_ANSWER_OVERRIDES.get(question_id, answers)
    if len(statements) != 3 or len(answers) != 3:
        raise ValueError(
            f"Question {question_id}: expected 3 matrix rows, got "
            f"{len(statements)} statements and {len(answers)} answers"
        )
    return {"type": "matrix", "statements": statements, "correct": answers}


def main() -> None:
    if len(sys.argv) not in (4, 5):
        raise SystemExit(
            "Usage: build_az900_data.py RAW.json OCR.json OUTPUT.json [SOURCE_MANIFEST.json]"
        )
    raw = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    ocr = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
    blocks = ocr_blocks(ocr)
    source_images = {}
    if len(sys.argv) == 5:
        source_images = {
            item["id"]: [
                f"public/source/az/questions/{filename}"
                for filename in item["images"]
            ]
            for item in json.loads(Path(sys.argv[4]).read_text(encoding="utf-8"))
        }
    output = []

    for question in raw:
        question_id = question["id"]
        source_type = question["sourceType"]
        prompt = re.sub(
            r"(?:\n|\s)*(?:Hot Area:|Select and Place:)\s*$",
            "",
            question["prompt"],
        ).strip()

        if source_type == "choice":
            stem, options = parse_options(prompt)
            answer_ids = list(question["answer"])
            interaction = {
                "type": "multi" if len(answer_ids) > 1 else "single",
                "options": options,
                "correct": answer_ids if len(answer_ids) > 1 else answer_ids[0],
            }
            prompt = stem
            answer = "; ".join(answer_ids)
        elif question_id in SENTENCE_ITEMS:
            stem, options, correct = SENTENCE_ITEMS[question_id]
            interaction = {"type": "single", "options": options, "correct": correct}
            prompt = stem
            answer = correct
        elif question_id in SPECIAL_ITEMS:
            interaction = SPECIAL_ITEMS[question_id]
            answer = (
                "; ".join(field["correct"] for field in interaction["fields"])
                if interaction["type"] == "fields"
                else interaction["correct"]
            )
        elif question_id in MATCH_ITEMS:
            options, matches = MATCH_ITEMS[question_id]
            interaction = fields(
                [(description, options, correct) for description, correct in matches]
            )
            answer = "; ".join(correct for _, correct in matches)
        elif source_type == "hotspot" and "For each of the following statements" in prompt:
            interaction = matrix_interaction(question, blocks[question_id])
            answer = "; ".join(interaction["correct"])
        else:
            raise ValueError(f"Unhandled question {question_id} ({source_type})")

        explanation = (
            question["explanation"]
            or "No explanation was printed in the source PDF."
        )
        if question_id in SOURCE_CONFLICT_NOTES:
            explanation = f"{SOURCE_CONFLICT_NOTES[question_id]}\n\n{explanation}"

        output.append(
            {
                "id": question_id,
                "kind": interaction["type"],
                "prompt": prompt,
                "answer": answer,
                "explanation": explanation,
                "section": question["section"],
                "sourceType": source_type,
                "sourceImages": source_images.get(question_id, []),
                "interaction": interaction,
            }
        )

    Path(sys.argv[3]).write_text(
        json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    counts = {
        kind: sum(item["kind"] == kind for item in output)
        for kind in ("single", "multi", "matrix", "fields")
    }
    print(f"Wrote {len(output)} questions to {sys.argv[3]}")
    print(f"Interaction counts: {counts}")


if __name__ == "__main__":
    main()

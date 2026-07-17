#!/usr/bin/env python3
"""Build the AI-901 website question bank from extracted PDF text and OCR."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path


AI_OVERRIDES = {
    2: ("single", "When using the OpenAI Responses API and a vision-enabled model, you can include an image in a request by providing the image as", ["a base64-encoded image data", "a CSV file attachment", "an MP4 video stream", "a shared access signature (SAS) token"], "a base64-encoded image data"),
    4: ("matrix", ["System prompts can be used to authorize users.", "A system prompt is used to reduce tokens per minute (TPM).", "A system prompt guides the behavior of a generative AI model."], ["No", "No", "Yes"]),
    6: ("matrix", ["Voice Live returns only transcribed text.", "Voice Live requires you to separately implement speech to text and text to speech services.", "Voice Live combines speech to text, reasoning, and text to speech into a single conversational experience."], ["No", "No", "Yes"]),
    7: ("fields", [("SpeechRecognizer method", ["recognizer.recognize_once()", "recognizer.speak_text_async(\"Ready\")", "recognizer.start_continuous_recognition()", "recognizer.start_keyword_recognition()"], "recognizer.recognize_once()")]),
    9: ("fields", [("audio_config value", ["AudioOutputConfig(filename=\"output.wav\")", "AudioOutputConfig(stream)", "AudioStreamFormat(wave_stream_format=AudioStreamWaveFormat.PCM)"], "AudioOutputConfig(filename=\"output.wav\")")]),
    10: ("single", "To define an agent's role and behaviors, you must configure a ____ for the agent.", ["deployment slot", "embedding index", "fine-tuning job", "system prompt"], "system prompt"),
    11: ("fields", [("poller result call", ["get_results", "result", "status", "wait"], "result")]),
    12: ("fields", [("base_url subdomain", ["gpt-4.1-mini", "my-mini-gpt", "project1", "resource1"], "resource1"), ("model", ["gpt-4.1-mini", "my-mini-gpt", "project1", "resource1"], "my-mini-gpt")]),
    13: ("matrix", ["An AI generative model is retrained before performing each user request.", "An AI agent responds by copying and pasting answers stored in a database.", "An AI agent uses a generative AI model to establish actions based on user input."], ["No", "No", "Yes"]),
    14: ("fields", [("Evaluating model outputs to ensure that decisions are NOT biased against specific demographic groups", ["Accountability", "Fairness", "Inclusiveness", "Privacy and security", "Reliability and safety", "Transparency"], "Fairness"), ("Encrypting sensitive customer data and restricting system access to authorized personnel", ["Accountability", "Fairness", "Inclusiveness", "Privacy and security", "Reliability and safety", "Transparency"], "Privacy and security"), ("Informing users when they are interacting with an AI system and explaining the system's capabilities and limitations", ["Accountability", "Fairness", "Inclusiveness", "Privacy and security", "Reliability and safety", "Transparency"], "Transparency"), ("Testing AI systems under different conditions to reduce unexpected failures", ["Accountability", "Fairness", "Inclusiveness", "Privacy and security", "Reliability and safety", "Transparency"], "Reliability and safety")]),
    15: ("matrix", ["Generating a response to a user prompt occurs during the inference stage.", "A generative AI model generates responses by copying stored documents directly from the model's training data.", "A generative AI model produces output by predicting the next token based on patterns learned from the model's training data."], ["Yes", "No", "Yes"]),
    17: ("single", "Information extraction solutions that detect and read text in scanned documents and images rely on", ["computer vision", "image generation", "sentiment analysis", "speech synthesis"], "computer vision"),
    19: ("matrix", ["Human-in-the-loop practices provide accountability for AI-generated decisions.", "Deploying an AI system to a production environment eliminates the need for ongoing monitoring.", "Disclosing the team that designed and deployed an AI system provides accountability for the system's output."], ["Yes", "No", "No"]),
    21: ("single", "Ensuring that human reviewers oversee AI-generated decisions and remain responsible for the final output is an example of the Microsoft responsible AI principle of", ["accountability", "fairness", "privacy and security", "transparency"], "accountability"),
    23: ("matrix", ["The Temperature parameter can be set before deploying a model.", "During inference, the model name is used to route requests to a specific deployment.", "After a model is deployed, both code and testing tools can be used to interact with the model."], ["No", "No", "Yes"]),
    24: ("single", "Evaluating model outcomes across demographic groups to reduce bias is an example of the Microsoft responsible AI principle of", ["accountability", "fairness", "privacy and security", "transparency"], "fairness"),
    25: ("single", "The Microsoft responsible AI principle of transparency requires that AI systems", ["be explainable to users", "protect sensitive user data", "reduce bias in decisions", "require human oversight"], "be explainable to users"),
    27: ("single", "An AI workload that produces new content based on user input is an example of", ["content understanding", "generative AI", "information extraction", "text analysis"], "generative AI"),
    28: ("matrix", ["Fairness can be achieved by focusing solely on improving the overall accuracy of an AI model.", "Evaluating AI system outputs to identify and reduce bias across demographic groups supports fairness.", "Ensuring fairness for an AI system means that all users always receive the same output from the system."], ["No", "Yes", "No"]),
    29: ("single", "When content is submitted to Azure Content Understanding in Foundry Tools, the analysis is", ["synchronous", "asynchronous", "returned only as unstructured plain text", "limited to optical character recognition (OCR)-only processing"], "asynchronous"),
    31: ("matrix", ["Azure Content Understanding in Foundry Tools can analyze only PDF documents.", "Azure Content Understanding in Foundry Tools results are returned in the JSON format.", "Azure Content Understanding in Foundry Tools can extract structured fields from documents and forms by using optical character recognition (OCR) to read text."], ["No", "Yes", "Yes"]),
    32: ("matrix", ["In Microsoft Foundry Agent Service, setting tool_choice to auto for an agent enables the agent to decide whether to call a tool.", "In Microsoft Foundry Agent Service, setting tool_choice to none for an agent means that the model decides whether to call a tool.", "In Microsoft Foundry Agent Service, setting tool_choice to required for an agent ensures that the agent must call one or more tools during each run."], ["Yes", "No", "Yes"]),
    34: ("single", "____ defines which fields to extract when analyzing content by using Azure Content Understanding in Foundry Tools.", ["A keyword list", "Optical character recognition (OCR)-only processing", "A schema", "A synchronous API call"], "A schema"),
    36: ("matrix", ["In the Foundry playground, you can upload a local image and include text in the same message when prompting a multimodal model.", "When using the OpenAI Responses API and a vision-enabled model, images can be provided only as base64-encoded image data.", "Prompts that include images require deploying a text-only model because multimodal capabilities are handled by the application layer."], ["Yes", "No", "No"]),
    38: ("fields", [("text content block type", ["input_image", "input_text", "input_url", "output_image", "output_text"], "input_text"), ("image content block type", ["input_image", "input_text", "input_url", "output_image", "output_text"], "input_image")]),
    41: ("single", "After deploying a vision-enabled GPT model in Microsoft Foundry, you can configure an application to send requests to the", ["endpoint of the model", "evaluation pipeline of model", "Foundry playground", "training dataset of the model"], "endpoint of the model"),
    43: ("matrix", ["In the new Microsoft Foundry portal, you must fine-tune a model before you can deploy the model.", "In the new Microsoft Foundry portal, you can test a model from the model catalog only after you deploy the model.", "In the new Microsoft Foundry portal, you can deploy a model from the model catalog only after retraining the model."], ["No", "Yes", "No"]),
    45: ("fields", [("Scanned invoices", ["audio analyzer", "document analyzer", "image analyzer", "video analyzer"], "document analyzer"), ("Voicemail recordings", ["audio analyzer", "document analyzer", "image analyzer", "video analyzer"], "audio analyzer")]),
    49: ("matrix", ["Evaluators in Microsoft Foundry replace the need for configuring token limits.", "Evaluators in Microsoft Foundry can assess the quality and safety of responses generated by a generative AI model.", "Evaluators in Microsoft Foundry can retrain a deployed generative AI model automatically when quality issues are detected."], ["No", "Yes", "No"]),
    50: ("single", "The ____ is used for comparing and deploying a wide range of models for generative AI development in Microsoft Foundry.", ["Model catalog", "Monitor page", "Service endpoints page", "Solution templates page"], "Model catalog"),
}


def clean(value: str) -> str:
    value = value.replace("\u200b", "").replace("OpenAl", "OpenAI").replace("Al ", "AI ")
    value = value.replace("APis", "APIs").replace("APl", "API")
    value = re.sub(r"[ \t]+\n", "\n", value)
    return re.sub(r"\n{3,}", "\n\n", value).strip()


def choice_question(question: dict) -> dict:
    prompt = clean(question["prompt"])
    lines = prompt.splitlines()
    option_start = next((i for i, line in enumerate(lines) if re.match(r"^[A-Z]\.\s+", line)), None)
    if option_start is None:
        raise ValueError(f"Question {question['id']} has no choices")

    stem = clean("\n".join(lines[:option_start]))
    options = []
    current = None
    for line in lines[option_start:]:
        match = re.match(r"^([A-Z])\.\s+(.*)", line)
        if match:
            if current:
                options.append(current)
            current = {"id": match.group(1), "label": match.group(2).strip()}
        elif current:
            current["label"] += " " + line.strip()
    if current:
        options.append(current)

    answer = clean(question["answer"]).replace(" ", "")
    correct = list(answer) if len(answer) > 1 else answer
    return {
        "type": "multi" if isinstance(correct, list) else "single",
        "stem": stem,
        "options": options,
        "correct": correct,
    }


def override_interaction(question_id: int) -> dict:
    item = AI_OVERRIDES[question_id]
    if item[0] == "single":
        _, stem, options, correct = item
        return {
            "type": "single",
            "stem": stem,
            "options": [{"id": option, "label": option} for option in options],
            "correct": correct,
        }
    if item[0] == "matrix":
        _, statements, correct = item
        return {"type": "matrix", "statements": statements, "correct": correct}
    _, fields = item
    return {
        "type": "fields",
        "fields": [
            {"label": label, "options": options, "correct": correct}
            for label, options, correct in fields
        ],
    }


def main() -> None:
    if len(sys.argv) != 4:
        raise SystemExit("Usage: build_ai901_data.py RAW.json MANIFEST.json OUTPUT.json")

    raw_path = Path(sys.argv[1])
    manifest_path = Path(sys.argv[2])
    output_path = Path(sys.argv[3])

    raw_questions = json.loads(raw_path.read_text(encoding="utf-8"))
    manifest = {
        item["id"]: [f"public/source/ai/questions/{name}" for name in item["images"]]
        for item in json.loads(manifest_path.read_text(encoding="utf-8"))
    }

    questions = []
    for question in raw_questions:
        qid = question["id"]
        is_override = qid in AI_OVERRIDES
        interaction = override_interaction(qid) if is_override else choice_question(question)
        answer = (
            "; ".join(interaction["correct"])
            if interaction["type"] == "matrix"
            else "; ".join(field["correct"] for field in interaction["fields"])
            if interaction["type"] == "fields"
            else "; ".join(interaction["correct"])
            if interaction["type"] == "multi"
            else interaction["correct"]
        )
        source_type = "hotspot" if "HOTSPOT" in question["prompt"] else "drag-drop" if "DRAG DROP" in question["prompt"] else "text"
        questions.append(
            {
                "id": qid,
                "kind": interaction["type"],
                "prompt": clean(question["prompt"]),
                "answer": answer,
                "explanation": clean(question["explanation"]),
                "sourceType": source_type,
                "sourceImages": manifest.get(qid, []),
                "interaction": interaction,
                "category": "Azure AI Fundamentals",
            }
        )

    ids = {q["id"] for q in questions}
    if ids != set(range(1, 53)):
        raise ValueError(f"Unexpected question IDs: {sorted(set(range(1, 53)) - ids)}")
    missing_images = [q["id"] for q in questions if not q["sourceImages"]]
    if missing_images:
        raise ValueError(f"Questions missing source images: {missing_images}")

    output_path.write_text(json.dumps(questions, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {len(questions)} AI-901 questions to {output_path}")


if __name__ == "__main__":
    main()

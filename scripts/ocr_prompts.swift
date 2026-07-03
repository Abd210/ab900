import Foundation
import Vision
import ImageIO

struct OCRItem: Codable {
    let file: String
    let text: String
}

func recognize(_ url: URL) throws -> String {
    guard
        let source = CGImageSourceCreateWithURL(url as CFURL, nil),
        let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
    else {
        throw NSError(domain: "OCR", code: 1, userInfo: [NSLocalizedDescriptionKey: "Cannot load \(url.path)"])
    }

    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    request.recognitionLanguages = ["en-US"]

    let handler = VNImageRequestHandler(cgImage: image, options: [:])
    try handler.perform([request])

    let observations = (request.results ?? []).sorted { left, right in
        let verticalDifference = abs(left.boundingBox.midY - right.boundingBox.midY)
        if verticalDifference > 0.012 {
            return left.boundingBox.midY > right.boundingBox.midY
        }
        return left.boundingBox.minX < right.boundingBox.minX
    }

    return observations.compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
}

guard CommandLine.arguments.count == 3 else {
    fputs("Usage: ocr_prompts.swift INPUT_DIR OUTPUT.json\n", stderr)
    exit(2)
}

let input = URL(fileURLWithPath: CommandLine.arguments[1])
let output = URL(fileURLWithPath: CommandLine.arguments[2])
let files = try FileManager.default.contentsOfDirectory(
    at: input,
    includingPropertiesForKeys: nil,
    options: [.skipsHiddenFiles]
)
.filter { $0.lastPathComponent.contains("-prompt-") && $0.pathExtension.lowercased() == "jpg" }
.sorted { $0.lastPathComponent < $1.lastPathComponent }

var results: [OCRItem] = []
for (index, file) in files.enumerated() {
    let text = try recognize(file)
    results.append(OCRItem(file: file.lastPathComponent, text: text))
    if (index + 1) % 20 == 0 {
        fputs("Processed \(index + 1)/\(files.count)\n", stderr)
    }
}

let encoder = JSONEncoder()
encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
try encoder.encode(results).write(to: output)
print("Wrote OCR for \(results.count) prompt images")

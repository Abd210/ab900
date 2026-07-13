import Foundation
import Vision
import ImageIO

struct OCRLine: Codable {
    let text: String
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

struct OCRPage: Codable {
    let file: String
    let lines: [OCRLine]
}

func recognize(_ url: URL) throws -> [OCRLine] {
    guard
        let source = CGImageSourceCreateWithURL(url as CFURL, nil),
        let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
    else {
        throw NSError(
            domain: "OCR",
            code: 1,
            userInfo: [NSLocalizedDescriptionKey: "Cannot load \(url.path)"]
        )
    }

    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    request.recognitionLanguages = ["en-US"]
    try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])

    return (request.results ?? []).compactMap { observation in
        guard let text = observation.topCandidates(1).first?.string else {
            return nil
        }
        let box = observation.boundingBox
        return OCRLine(
            text: text,
            x: box.minX,
            y: box.minY,
            width: box.width,
            height: box.height
        )
    }
}

guard CommandLine.arguments.count == 3 else {
    fputs("Usage: ocr_layout.swift INPUT_DIR OUTPUT.json\n", stderr)
    exit(2)
}

let input = URL(fileURLWithPath: CommandLine.arguments[1])
let output = URL(fileURLWithPath: CommandLine.arguments[2])
let files = try FileManager.default.contentsOfDirectory(
    at: input,
    includingPropertiesForKeys: nil,
    options: [.skipsHiddenFiles]
)
.filter { ["jpg", "jpeg", "png"].contains($0.pathExtension.lowercased()) }
.sorted { $0.lastPathComponent.localizedStandardCompare($1.lastPathComponent) == .orderedAscending }

var pages: [OCRPage] = []
for (index, file) in files.enumerated() {
    pages.append(OCRPage(file: file.lastPathComponent, lines: try recognize(file)))
    if (index + 1) % 20 == 0 {
        fputs("Processed \(index + 1)/\(files.count)\n", stderr)
    }
}

let encoder = JSONEncoder()
encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
try encoder.encode(pages).write(to: output)
print("Wrote positioned OCR for \(pages.count) pages")

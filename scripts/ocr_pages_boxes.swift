import Foundation
import Vision
import ImageIO

struct OCRBox: Codable {
    let text: String
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

struct OCRPage: Codable {
    let file: String
    let width: Int
    let height: Int
    let boxes: [OCRBox]
}

func recognize(_ url: URL) throws -> OCRPage {
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

    let handler = VNImageRequestHandler(cgImage: image, options: [:])
    try handler.perform([request])

    let boxes = (request.results ?? [])
        .compactMap { observation -> OCRBox? in
            guard let text = observation.topCandidates(1).first?.string else {
                return nil
            }
            let box = observation.boundingBox
            return OCRBox(
                text: text,
                x: box.minX * Double(image.width),
                y: (1.0 - box.maxY) * Double(image.height),
                width: box.width * Double(image.width),
                height: box.height * Double(image.height)
            )
        }
        .sorted { left, right in
            let verticalDifference = abs((left.y + left.height / 2) - (right.y + right.height / 2))
            if verticalDifference > 12 {
                return left.y < right.y
            }
            return left.x < right.x
        }

    return OCRPage(
        file: url.lastPathComponent,
        width: image.width,
        height: image.height,
        boxes: boxes
    )
}

guard CommandLine.arguments.count == 3 else {
    fputs("Usage: ocr_pages_boxes.swift INPUT_DIR OUTPUT.json\n", stderr)
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

var results: [OCRPage] = []
for (index, file) in files.enumerated() {
    results.append(try recognize(file))
    if (index + 1) % 20 == 0 {
        fputs("Processed \(index + 1)/\(files.count)\n", stderr)
    }
}

let encoder = JSONEncoder()
encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
try encoder.encode(results).write(to: output)
print("Wrote OCR boxes for \(results.count) pages")

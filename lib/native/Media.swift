import Foundation
import Vision
import PDFKit
import AppKit

struct TextPart: Codable { let text: String; let locator: String }
struct Output: Codable { let parts: [TextPart] }
enum MediaError: LocalizedError {
    case unavailable(String)
    var errorDescription: String? { if case .unavailable(let text) = self { return text }; return nil }
}
@main struct BuddyMedia {
    static func recognize(_ image: CGImage, locator: String) throws -> TextPart {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.recognitionLanguages = ["zh-Hans", "zh-Hant", "en-US"]
        request.usesLanguageCorrection = true
        try VNImageRequestHandler(cgImage: image).perform([request])
        return TextPart(text: (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n"), locator: locator)
    }
    static func ocr(_ url: URL) throws -> [TextPart] {
        if url.pathExtension.lowercased() == "pdf" {
            guard let document = PDFDocument(url: url) else { throw MediaError.unavailable("无法打开 PDF") }
            return try (0..<document.pageCount).map { index in
                guard let page = document.page(at: index) else { throw MediaError.unavailable("PDF 页面缺失") }
                let bounds = page.bounds(for: .mediaBox)
                let image = page.thumbnail(of: CGSize(width: bounds.width * 2, height: bounds.height * 2), for: .mediaBox)
                guard let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { throw MediaError.unavailable("PDF 页面不能渲染") }
                return try recognize(cg, locator: "page=\(index + 1)")
            }
        }
        guard let image = NSImage(contentsOf: url), let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { throw MediaError.unavailable("无法打开图片") }
        return [try recognize(cg, locator: "image=1")]
    }
    static func main() {
        do {
            let args = CommandLine.arguments
            guard args.count == 3, args[1] == "ocr" else { throw MediaError.unavailable("用法：BuddyMedia ocr 文件") }
            let url = URL(fileURLWithPath: args[2])
            let parts = try ocr(url)
            print(String(data: try JSONEncoder().encode(Output(parts: parts)), encoding: .utf8)!)
        } catch { FileHandle.standardError.write(Data(error.localizedDescription.utf8)); exit(1) }
    }
}

import Foundation
import Vision
import PDFKit
import AppKit
import AVFoundation
import Speech

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
    @available(macOS 26.0, *)
    static func transcribe(_ url: URL, localeName: String) async throws -> [TextPart] {
        let audio = try AVAudioFile(forReading: url)
        guard audio.length > 0 else { throw MediaError.unavailable("音频没有有效采样，无法转写") }
        FileHandle.standardError.write(Data("正在准备本地语音资源…\n".utf8))
        guard SpeechTranscriber.isAvailable, let locale = await SpeechTranscriber.supportedLocale(equivalentTo: Locale(identifier: localeName)) else { throw MediaError.unavailable("本机不支持选定语言的本地转写") }
        let transcriber = SpeechTranscriber(locale: locale, preset: .transcription)
        if let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) { try await request.downloadAndInstall() }
        FileHandle.standardError.write(Data("正在本地转写音频…\n".utf8))
        let analyzer = SpeechAnalyzer(modules: [transcriber])
        guard let format = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [transcriber]) else { throw MediaError.unavailable("系统未提供可用的语音格式") }
        try await analyzer.prepareToAnalyze(in: format)
        let results = Task { () throws -> [TextPart] in
            var parts: [TextPart] = []
            for try await result in transcriber.results {
                let start = CMTimeGetSeconds(result.range.start)
                let end = CMTimeGetSeconds(CMTimeRangeGetEnd(result.range))
                parts.append(TextPart(text: String(result.text.characters), locator: String(format: "time=%.3f-%.3f", start, end)))
            }
            return parts
        }
        do {
            let converter = AVAudioConverter(from: audio.processingFormat, to: format)
            let sequence = AsyncThrowingStream<AnalyzerInput, Error>(unfolding: {
                if audio.framePosition >= audio.length { return nil }
                guard let input = AVAudioPCMBuffer(pcmFormat: audio.processingFormat, frameCapacity: 4096) else { throw MediaError.unavailable("无法创建音频缓冲区") }
                try audio.read(into: input)
                if input.frameLength == 0 { return nil }
                if input.format == format { return AnalyzerInput(buffer: input) }
                guard let converter, let output = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(ceil(Double(input.frameLength) * format.sampleRate / input.format.sampleRate) + 32)) else { throw MediaError.unavailable("无法转换音频格式") }
                var supplied = false
                var conversionError: NSError?
                let status = converter.convert(to: output, error: &conversionError) { _, inputStatus in
                    if supplied { inputStatus.pointee = .noDataNow; return nil }
                    supplied = true; inputStatus.pointee = .haveData; return input
                }
                if status == .error { throw conversionError ?? MediaError.unavailable("音频格式转换失败") as NSError }
                return AnalyzerInput(buffer: output)
            })
            _ = try await analyzer.analyzeSequence(sequence)
            try await analyzer.finalizeAndFinishThroughEndOfInput()
            return try await results.value
        } catch { results.cancel(); await analyzer.cancelAndFinishNow(); throw error }
    }
    static func main() async {
        do {
            let args = CommandLine.arguments
            guard args.count >= 3 else { throw MediaError.unavailable("用法：BuddyMedia ocr|transcribe 文件 [语言]") }
            let url = URL(fileURLWithPath: args[2])
            let parts: [TextPart]
            if args[1] == "ocr" { parts = try ocr(url) }
            else if args[1] == "transcribe" {
                if #available(macOS 26.0, *) { parts = try await transcribe(url, localeName: args.count > 3 ? args[3] : "zh-CN") }
                else { throw MediaError.unavailable("本地音视频转写需要 macOS 26；此系统仍可使用文件、OCR 和其他来源") }
            } else { throw MediaError.unavailable("未知操作") }
            print(String(data: try JSONEncoder().encode(Output(parts: parts)), encoding: .utf8)!)
        } catch { FileHandle.standardError.write(Data(error.localizedDescription.utf8)); exit(1) }
    }
}

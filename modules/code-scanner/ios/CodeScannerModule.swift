import ExpoModulesCore

/// Stub until the iOS wave, which uses VisionKit's DataScannerViewController
/// (spec §3). Resolves `unavailable` so the rest of S0 runs on iOS.
public class CodeScannerModule: Module {
  public func definition() -> ModuleDefinition {
    Name("CodeScanner")

    AsyncFunction("scan") { () -> [String: Any] in
      return ["outcome": "unavailable", "reason": "failed"]
    }

    Function("prepare") {}
  }
}

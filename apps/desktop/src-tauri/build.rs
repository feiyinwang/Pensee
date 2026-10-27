use std::process::Command;

fn main() {
    link_clang_runtime();
    tauri_build::build()
}

/// whisper.cpp's Metal code checks the macOS version at run time
/// (`@available`). Built for an older macOS than the one it checks for
/// (`minimumSystemVersion` sets the release build's deployment target), each
/// check becomes a call to `__isPlatformVersionAtLeast`, which lives in clang's
/// runtime library. rustc links with `-nodefaultlibs`, which leaves that
/// library out, so the release build fails to link; it's added here.
fn link_clang_runtime() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("macos") {
        return;
    }
    let output = Command::new("clang")
        .arg("--print-resource-dir")
        .output()
        .expect("clang is needed to find its runtime library (Xcode command line tools)");
    let dir = String::from_utf8(output.stdout).expect("clang printed a path that isn't UTF-8");
    println!("cargo:rustc-link-search=native={}/lib/darwin", dir.trim());
    println!("cargo:rustc-link-lib=static=clang_rt.osx");
}

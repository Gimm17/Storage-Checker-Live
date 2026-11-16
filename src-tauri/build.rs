fn main() {
    println!("cargo:rerun-if-changed=app.manifest");
    let mut windows = tauri_build::WindowsAttributes::new();
    windows = windows.app_manifest(include_str!("app.manifest"));
    let attrs = tauri_build::Attributes::new().windows_attributes(windows);
    tauri_build::try_build(attrs).expect("failed to run tauri_build");
}

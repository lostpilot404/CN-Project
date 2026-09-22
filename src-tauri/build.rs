use std::env;
use std::path::PathBuf;
use std::process::Command;

fn main() {
    tauri_build::build();

    let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let target_env = env::var("CARGO_CFG_TARGET_ENV").unwrap_or_default();

    if target_os == "windows" && target_env == "gnu" {
        let manifest_src = PathBuf::from("windows_manifest.rc");
        let out_dir = PathBuf::from(env::var("OUT_DIR").unwrap());
        let manifest_obj = out_dir.join("windows_manifest.o");

        let windres_cmd = if PathBuf::from(r"C:\msys64\ucrt64\bin\windres.exe").exists() {
            r"C:\msys64\ucrt64\bin\windres.exe"
        } else {
            "windres"
        };

        let status = Command::new(windres_cmd)
            .arg("-i")
            .arg(&manifest_src)
            .arg("-o")
            .arg(&manifest_obj)
            .arg("-O")
            .arg("coff")
            .status();

        if let Ok(s) = status {
            if s.success() {
                println!("cargo:rustc-link-arg={}", manifest_obj.display());
            }
        }
        println!("cargo:rerun-if-changed=windows_manifest.rc");
        println!("cargo:rerun-if-changed=windows_manifest.xml");
    }
}

fn main() {
    #[cfg(windows)]
    {
        let mut res = winres::Winres::new();
        res.set_manifest(
            r#"<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
<trustInfo xmlns="urn:schemas-microsoft-com:asm.v3">
  <security>
    <requestedPrivileges>
      <requestedExecutionLevel level="requireAdministrator" uiAccess="false"/>
    </requestedPrivileges>
  </security>
</trustInfo>
</assembly>"#,
        );
        let _ = res.compile();
    }
    tauri_build::build()
}

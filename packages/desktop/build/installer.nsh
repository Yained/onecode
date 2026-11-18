; OneCode desktop NSIS hooks (included early by electron-builder).
;
; Constraints (learned the hard way — CI treats makensis warnings as errors):
; 1) Do NOT use LogicLib ${If} inside Functions/macros that expand at include-time
;    before LogicLib is loaded → "Invalid command: ${If}".
; 2) Do NOT reference APP_EXECUTABLE_FILENAME / UNINSTALL_FILENAME / INSTALL_REGISTRY_KEY
;    here — they are !define'd later in common.nsh / multiUser. Use PRODUCT_FILENAME /
;    APP_GUID (passed as -D) instead.
; 3) Do NOT define Function un.* unless BUILD_UNINSTALLER is set. The installer compile
;    pass includes this file but does not call WriteUninstaller → warning 6020
;    "Uninstaller script code found but WriteUninstaller never used".
;
!define ONECODE_DESKTOP_DIR "onecode_desktop"
!define ONECODE_INSTALL_MARKER "onecode-desktop-install.marker"
!define ONECODE_APP_EXE "${PRODUCT_FILENAME}.exe"
!define ONECODE_UNINSTALL_EXE "Uninstall ${PRODUCT_FILENAME}.exe"
!define ONECODE_INSTALL_REG_KEY "Software\${APP_GUID}"
; Stamped by scripts/prebuild.ts (do not !include a sibling — makensis temp dir has only this file).
!define ONECODE_INSTALL_IDENTITY "1.14.50"

; ---------------------------------------------------------------------------
; Installer-only
; ---------------------------------------------------------------------------
!ifndef BUILD_UNINSTALLER

; Abort if the setup EXE is running from $INSTDIR or a subdirectory of $INSTDIR.
; Safe: EXE in D:\onecode_win while installing to D:\onecode_win\onecode_desktop
; (all files land under the nested folder; the parent-held EXE is not removed).
; Unsafe: EXE inside the install tree (upgrade deletes files under INSTDIR first).
; Drive roots like D:\ are allowed. Must run BEFORE old files are removed.
Function OneCodeEnsureSafeInstallLocation
  StrCmp $INSTDIR "" allow_location 0

  StrCpy $R0 "$EXEDIR"
  StrCpy $R1 "$R0" "" -1
  StrCmp $R1 "\" 0 exedir_ready
    StrLen $R2 $R0
    IntCmp $R2 3 exedir_ready exedir_ready strip_slash
    strip_slash:
      IntOp $R2 $R2 - 1
      StrCpy $R0 "$R0" $R2
  exedir_ready:

  StrCpy $R5 "$INSTDIR"
  StrCpy $R1 "$R5" "" -1
  StrCmp $R1 "\" 0 instdir_ready
    StrLen $R2 $R5
    IntCmp $R2 3 instdir_ready instdir_ready strip_inst_slash
    strip_inst_slash:
      IntOp $R2 $R2 - 1
      StrCpy $R5 "$R5" $R2
  instdir_ready:

  ; Same folder as install target — EXE would be deleted/locked during upgrade
  StrCmp $R0 $R5 reject_overlap 0

  ; EXE under INSTDIR\... — also unsafe
  StrCpy $R3 "$R5\"
  StrLen $R2 $R3
  StrCpy $R4 "$R0" $R2
  StrCmp $R4 $R3 reject_overlap allow_location

  reject_overlap:
    IfSilent silent_reject
      MessageBox MB_ICONSTOP|MB_OK "安装前检查未通过。$\r$\n$\r$\n请勿从安装目录或其子目录运行安装包。$\r$\n否则升级可能先删除旧文件，随后因文件占用无法完成安装。$\r$\n$\r$\n请将安装包复制到安装目录之外后再运行，例如：$\r$\n  · 桌面$\r$\n  · 安装目录的父文件夹（如 D:\onecode_win）$\r$\n  · 下载文件夹$\r$\n$\r$\n安装包当前位置：$\r$\n$EXEDIR$\r$\n目标安装目录：$\r$\n$INSTDIR"
    silent_reject:
    SetErrorLevel 1603
    Abort
  allow_location:
FunctionEnd

Function .onVerifyInstDir
  StrLen $0 "\${ONECODE_DESKTOP_DIR}"
  StrCpy $1 "$INSTDIR" "" -$0
  StrCmp $1 "\${ONECODE_DESKTOP_DIR}" ensure_safe 0
    StrCpy $INSTDIR "$INSTDIR\${ONECODE_DESKTOP_DIR}"
  ensure_safe:
  Call OneCodeEnsureSafeInstallLocation
FunctionEnd

!macro customInit
  ; Upgrade: INSTDIR / registry location known early — fail before removing old files.
  Call OneCodeEnsureSafeInstallLocation

  SetRegView 64
  ReadRegStr $R9 HKCU "${ONECODE_INSTALL_REG_KEY}" InstallLocation
  StrCmp $R9 "" 0 have_reg_loc
    ReadRegStr $R9 HKLM "${ONECODE_INSTALL_REG_KEY}" InstallLocation
  have_reg_loc:
  StrCmp $R9 "" init_done 0
    StrCpy $R8 "$INSTDIR"
    StrCpy $INSTDIR "$R9"
    Call OneCodeEnsureSafeInstallLocation
    StrCpy $INSTDIR "$R8"
  init_done:
!macroend

!endif

!macro customInstall
  ; Unique token per install/upgrade so the app always re-prompts for data-root config.
  System::Call 'kernel32::GetSystemTimeAsFileTime(*l.r9)'
  FileOpen $0 "$INSTDIR\${ONECODE_INSTALL_MARKER}" w
  FileWrite $0 "appId=${APP_ID}$\r$\n"
  FileWrite $0 "dir=$INSTDIR$\r$\n"
  FileWrite $0 "exe=${ONECODE_APP_EXE}$\r$\n"
  FileWrite $0 "installToken=$9$\r$\n"
  FileWrite $0 "version=${ONECODE_INSTALL_IDENTITY}$\r$\n"
  FileClose $0
!macroend

; ---------------------------------------------------------------------------
; Uninstaller-only functions (compiled only when BUILD_UNINSTALLER is defined)
; ---------------------------------------------------------------------------
!ifdef BUILD_UNINSTALLER

Function un.OneCodeAbort
  ; $R9 = message
  IfSilent silentAbort
    MessageBox MB_ICONSTOP|MB_OK "OneCode uninstall aborted.$\r$\n$\r$\n$R9$\r$\n$\r$\nOnly uninstall from the original install folder (or Apps & features)."
  silentAbort:
  SetErrorLevel 1603
  Quit
FunctionEnd

Function un.OneCodeNormalizeInstDir
  StrCpy $R8 "$INSTDIR"
  StrCpy $R0 "$R8" "" -1
  StrCmp $R0 "\" 0 norm_done
    StrLen $R1 $R8
    IntCmp $R1 3 norm_done norm_done strip_slash
    strip_slash:
      IntOp $R1 $R1 - 1
      StrCpy $R8 "$R8" $R1
  norm_done:
  StrCpy $INSTDIR "$R8"
FunctionEnd

Function un.OneCodeNormalizeRegDir
  StrCpy $R0 "$R4" "" -1
  StrCmp $R0 "\" 0 reg_norm_done
    StrLen $R1 $R4
    IntCmp $R1 3 reg_norm_done reg_norm_done reg_strip
    reg_strip:
      IntOp $R1 $R1 - 1
      StrCpy $R4 "$R4" $R1
  reg_norm_done:
FunctionEnd

Function un.OneCodeValidateInstDir
  Call un.OneCodeNormalizeInstDir

  StrCmp $R8 "" 0 check_len
    StrCpy $R9 "Install directory is empty."
    Call un.OneCodeAbort
  check_len:

  StrLen $R7 $R8
  IntCmp $R7 3 check_root_bad check_root_bad check_suffix
  check_root_bad:
    StrCpy $R9 "Refusing to uninstall from a drive root:$\r$\n$R8"
    Call un.OneCodeAbort
  check_suffix:

  StrLen $R6 "\${ONECODE_DESKTOP_DIR}"
  StrCpy $R5 "$R8" "" -$R6
  StrCmp $R5 "\${ONECODE_DESKTOP_DIR}" check_system 0
    StrCpy $R9 "Install path must end with \${ONECODE_DESKTOP_DIR}:$\r$\n$R8"
    Call un.OneCodeAbort
  check_system:

  StrCmp $R8 $WINDIR system_bad 0
  StrCmp $R8 $SYSDIR system_bad 0
  StrCmp $R8 $PROGRAMFILES system_bad 0
  StrCmp $R8 $PROGRAMFILES64 system_bad 0
  StrCmp $R8 $TEMP system_bad 0
  StrCmp $R8 $DESKTOP system_bad 0
  StrCmp $R8 $PROFILE system_bad 0
  StrCmp $R8 $APPDATA system_bad 0
  StrCmp $R8 $LOCALAPPDATA system_bad 0
  StrCmp $R8 $SMPROGRAMS system_bad check_exe
  system_bad:
    StrCpy $R9 "Refusing to uninstall a system or profile directory:$\r$\n$R8"
    Call un.OneCodeAbort
  check_exe:

  IfFileExists "$R8\${ONECODE_APP_EXE}" check_marker 0
    StrCpy $R9 "OneCode executable not found:$\r$\n$R8\${ONECODE_APP_EXE}"
    Call un.OneCodeAbort
  check_marker:

  IfFileExists "$R8\${ONECODE_INSTALL_MARKER}" check_reg 0
    StrCpy $R9 "Install marker missing. This does not look like an official OneCode install."
    Call un.OneCodeAbort
  check_reg:

  SetRegView 64
  ReadRegStr $R4 HKCU "${ONECODE_INSTALL_REG_KEY}" InstallLocation
  StrCmp $R4 "" 0 have_reg
    ReadRegStr $R4 HKLM "${ONECODE_INSTALL_REG_KEY}" InstallLocation
  have_reg:
  Call un.OneCodeNormalizeRegDir

  StrCmp $R4 "" 0 check_reg_match
    StrCpy $R9 "No InstallLocation registry entry found."
    Call un.OneCodeAbort
  check_reg_match:

  StrCmp $R4 $R8 check_uninstaller 0
    StrCpy $R9 "Install directory does not match registry InstallLocation.$\r$\nDir: $R8$\r$\nRegistry: $R4"
    Call un.OneCodeAbort
  check_uninstaller:

  IfFileExists "$R8\${ONECODE_UNINSTALL_EXE}" validate_ok 0
    StrCpy $R9 "Uninstaller is not in the install folder.$\r$\nExpected:$\r$\n$R8\${ONECODE_UNINSTALL_EXE}$\r$\n$\r$\nDo not move Uninstall.exe; use Apps & features or the copy inside the install folder."
    Call un.OneCodeAbort
  validate_ok:
FunctionEnd

; Same location guard for the uninstaller EXE (must not run from inside INSTDIR while deleting it).
Function un.OneCodeEnsureSafeUninstallLocation
  StrCmp $INSTDIR "" un_allow 0

  StrCpy $R0 "$EXEDIR"
  StrCpy $R1 "$R0" "" -1
  StrCmp $R1 "\" 0 un_exedir_ready
    StrLen $R2 $R0
    IntCmp $R2 3 un_exedir_ready un_exedir_ready un_strip
    un_strip:
      IntOp $R2 $R2 - 1
      StrCpy $R0 "$R0" $R2
  un_exedir_ready:

  StrLen $R2 $R0
  IntCmp $R2 3 un_allow un_allow un_check

  un_check:
  StrCmp $INSTDIR $R0 un_reject 0
  StrCpy $R3 "$R0\"
  StrLen $R2 $R3
  StrCpy $R4 "$INSTDIR" $R2
  StrCmp $R4 $R3 un_reject un_allow

  un_reject:
    StrCpy $R9 "Uninstaller is running from the install directory (or its parent).$\r$\nMove/copy Uninstall.exe elsewhere, or uninstall from Apps & features.$\r$\n$\r$\nUninstaller:$\r$\n$EXEDIR$\r$\nInstall dir:$\r$\n$INSTDIR"
    Call un.OneCodeAbort
  un_allow:
FunctionEnd

!endif ; BUILD_UNINSTALLER

; Macros are only !insertmacro'd in the correct builder phase.
!macro customUnInit
  Call un.OneCodeValidateInstDir
  Call un.OneCodeEnsureSafeUninstallLocation
!macroend

!macro customRemoveFiles
  Call un.OneCodeValidateInstDir
  Call un.OneCodeEnsureSafeUninstallLocation

  ${if} ${isUpdated}
    CreateDirectory "$PLUGINSDIR\old-install"
    Push ""
    Call un.atomicRMDir
    Pop $R0
    ${if} $R0 != 0
      DetailPrint "File is busy, aborting: $R0"
      Push ""
      Call un.restoreFiles
      Pop $R0
      Abort `Can't rename "$INSTDIR" to "$PLUGINSDIR\old-install".`
    ${endif}
  ${endif}

  SetOutPath $TEMP
  Call un.OneCodeValidateInstDir
  RMDir /r "$INSTDIR"
!macroend

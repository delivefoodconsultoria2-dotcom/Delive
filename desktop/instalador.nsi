; Instalador do TrafgFood para Windows (gerado por scripts/build-exe.sh com makensis).
; Instala só para o usuário atual: não pede senha de administrador.
Unicode true
Target amd64-unicode
!include "MUI2.nsh"
!include "FileFunc.nsh"

!ifndef VERSAO
  !define VERSAO "1.0.0"
!endif
!define NOME "TrafgFood"
!define EMPRESA "Delivefood Consultoria"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\TrafgFood"

Name "${NOME}"
OutFile "${SAIDA}"
InstallDir "$LOCALAPPDATA\Programs\TrafgFood"
InstallDirRegKey HKCU "Software\TrafgFood" "Pasta"
RequestExecutionLevel user
SetCompressor /SOLID lzma
BrandingText "${EMPRESA}"

VIProductVersion "${VERSAO}.0"
VIAddVersionKey /LANG=1046 "ProductName" "${NOME}"
VIAddVersionKey /LANG=1046 "CompanyName" "${EMPRESA}"
VIAddVersionKey /LANG=1046 "FileDescription" "Instalador do ${NOME}"
VIAddVersionKey /LANG=1046 "FileVersion" "${VERSAO}"
VIAddVersionKey /LANG=1046 "ProductVersion" "${VERSAO}"
VIAddVersionKey /LANG=1046 "LegalCopyright" "${EMPRESA}"

!define MUI_ICON "${PASTA}\trafgfood.ico"
!define MUI_UNICON "${PASTA}\trafgfood.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Instalar o TrafgFood"
!define MUI_WELCOMEPAGE_TEXT "Tráfego pago Meta e Google Ads para restaurantes, da Delivefood Consultoria.$\r$\n$\r$\nDepois de instalar, abra o TrafgFood e coloque as suas chaves em Configurações."
!define MUI_FINISHPAGE_RUN "$INSTDIR\TrafgFood.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Abrir o TrafgFood agora"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "PortugueseBR"

Section "TrafgFood (obrigatório)" SecApp
  SectionIn RO
  ; Fecha a versão aberta antes de atualizar.
  nsExec::Exec 'taskkill /im TrafgFood.exe /f'
  Sleep 800
  SetOutPath "$INSTDIR"
  File /r "${PASTA}\*.*"
  WriteUninstaller "$INSTDIR\Desinstalar TrafgFood.exe"

  CreateDirectory "$SMPROGRAMS\TrafgFood"
  CreateShortcut "$SMPROGRAMS\TrafgFood\TrafgFood.lnk" "$INSTDIR\TrafgFood.exe" "" "$INSTDIR\trafgfood.ico"
  CreateShortcut "$SMPROGRAMS\TrafgFood\Desinstalar TrafgFood.lnk" "$INSTDIR\Desinstalar TrafgFood.exe"

  WriteRegStr HKCU "Software\TrafgFood" "Pasta" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "${NOME}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion" "${VERSAO}"
  WriteRegStr HKCU "${UNINST_KEY}" "Publisher" "${EMPRESA}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\trafgfood.ico"
  WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" '"$INSTDIR\Desinstalar TrafgFood.exe"'
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  WriteRegDWORD HKCU "${UNINST_KEY}" "EstimatedSize" $0
SectionEnd

Section "Atalho na área de trabalho" SecDesk
  CreateShortcut "$DESKTOP\TrafgFood.lnk" "$INSTDIR\TrafgFood.exe" "" "$INSTDIR\trafgfood.ico"
SectionEnd

Section "Ligar junto com o Windows" SecStartup
  CreateShortcut "$SMSTARTUP\TrafgFood.lnk" "$INSTDIR\TrafgFood.exe" "--segundo-plano" "$INSTDIR\trafgfood.ico"
SectionEnd

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SecApp} "O programa TrafgFood."
  !insertmacro MUI_DESCRIPTION_TEXT ${SecDesk} "Ícone do TrafgFood na área de trabalho."
  !insertmacro MUI_DESCRIPTION_TEXT ${SecStartup} "Deixa o TrafgFood ligado em segundo plano sempre que o computador ligar."
!insertmacro MUI_FUNCTION_DESCRIPTION_END

Section "Uninstall"
  nsExec::Exec 'taskkill /im TrafgFood.exe /f'
  Sleep 800
  Delete "$DESKTOP\TrafgFood.lnk"
  Delete "$SMSTARTUP\TrafgFood.lnk"
  RMDir /r "$SMPROGRAMS\TrafgFood"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "${UNINST_KEY}"
  DeleteRegKey HKCU "Software\TrafgFood"
  ; As lojas, o histórico e as chaves em %APPDATA%\TrafgFood são mantidos.
SectionEnd

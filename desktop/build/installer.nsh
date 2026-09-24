!include "nsDialogs.nsh"
!include "LogicLib.nsh"

!macro MCS_REMOVE_SERVICE service
  nsExec::ExecToLog 'sc.exe stop "${service}"'
  Pop $0
  nsExec::ExecToLog 'sc.exe delete "${service}"'
  Pop $0
!macroend

!ifndef BUILD_UNINSTALLER
Var MCSMaintenancePage
Var MCSMaintenanceInstall
Var MCSMaintenanceRepair
Var MCSMaintenanceUninstall
Var MCSMaintenanceMode
Var MCSExistingInstallDir
Var MCSServicePage
Var MCSInstallMMA2
Var MCSInstallSimulator
Var MCSInstallReplicator
Var MCSStartServices
Var MCSInstallMMA2State
Var MCSInstallSimulatorState
Var MCSInstallReplicatorState
Var MCSStartServicesState
Var MCSRuntimeRoot
Var MCSCurrentUserChoice
Var MCSAllUsersChoice
Var MCSLaunchingOwner
Var MCSSettingsScope
Var MCSSettingsOwner
Var MCSPreviousSettingsOwner

!macro customHeader
  RequestExecutionLevel user
!macroend

!macro customInit
  StrCpy $MCSMaintenanceMode "install"
  StrCpy $MCSExistingInstallDir ""
  StrCpy $MCSInstallMMA2State ${BST_CHECKED}
  StrCpy $MCSInstallSimulatorState ${BST_CHECKED}
  StrCpy $MCSInstallReplicatorState ${BST_CHECKED}
  StrCpy $MCSStartServicesState ${BST_CHECKED}
  ReadRegStr $MCSExistingInstallDir HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
  InitPluginsDir
  File /oname=$PLUGINSDIR\mcs-settings-access.exe "${BUILD_RESOURCES_DIR}\..\bin\mcs-settings-access.exe"
  ${If} ${UAC_IsInnerInstance}
    !insertmacro UAC_AsUser_GetGlobalVar $MCSLaunchingOwner
  ${Else}
    nsExec::ExecToStack '"$PLUGINSDIR\mcs-settings-access.exe" -mode current-user'
    Pop $0
    Pop $MCSLaunchingOwner
    ${If} $0 != 0
      MessageBox MB_ICONSTOP|MB_OK "Could not detect the current Windows user."
      Abort
    ${EndIf}
    ${IfNot} ${UAC_IsAdmin}
      !insertmacro UAC_RunElevated
      ${If} $0 != 0
        MessageBox MB_ICONSTOP|MB_OK "Setup requires administrator approval to configure backend services."
      ${EndIf}
      Quit
    ${EndIf}
  ${EndIf}
  ${IfNot} ${UAC_IsAdmin}
    Abort
  ${EndIf}
  ${If} $MCSLaunchingOwner == ""
    MessageBox MB_ICONSTOP|MB_OK "Could not preserve the launching Windows account."
    Abort
  ${EndIf}
  ReadRegStr $MCSSettingsScope HKLM "Software\MCS Modbus Toolkit" "SettingsScope"
  ReadRegStr $MCSPreviousSettingsOwner HKLM "Software\MCS Modbus Toolkit" "SettingsOwnerSID"
  StrCpy $MCSSettingsOwner $MCSPreviousSettingsOwner
  ${If} $MCSSettingsScope != "all"
    StrCpy $MCSSettingsScope "current"
  ${EndIf}
  ${If} $MCSSettingsOwner == ""
    StrCpy $MCSSettingsOwner $MCSLaunchingOwner
  ${EndIf}

  ${If} $MCSExistingInstallDir != ""
    StrCpy $MCSMaintenanceMode "repair"
    StrCpy $INSTDIR $MCSExistingInstallDir
    IfSilent mcs_service_defaults_ready 0
    StrCpy $MCSInstallMMA2State ${BST_UNCHECKED}
    StrCpy $MCSInstallSimulatorState ${BST_UNCHECKED}
    StrCpy $MCSInstallReplicatorState ${BST_UNCHECKED}

    nsExec::ExecToStack 'sc.exe query "MCS-MMA2"'
    Pop $0
    Pop $1
    ${If} $0 == 0
      StrCpy $MCSInstallMMA2State ${BST_CHECKED}
    ${EndIf}

    nsExec::ExecToStack 'sc.exe query "MCS-Simulator"'
    Pop $0
    Pop $1
    ${If} $0 == 0
      StrCpy $MCSInstallSimulatorState ${BST_CHECKED}
    ${EndIf}

    nsExec::ExecToStack 'sc.exe query "MCS-Replicator"'
    Pop $0
    Pop $1
    ${If} $0 == 0
      StrCpy $MCSInstallReplicatorState ${BST_CHECKED}
    ${EndIf}
mcs_service_defaults_ready:
  ${EndIf}
!macroend

!macro customWelcomePage
  Page custom MCSMaintenancePageCreate MCSMaintenancePageLeave
!macroend

!macro customPageAfterChangeDir
  Page custom MCSServicePageCreate MCSServicePageLeave
  Page custom MCSSettingsPageCreate MCSSettingsPageLeave
!macroend

Function MCSSettingsPageCreate
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}
  ${NSD_CreateLabel} 0 0 100% 18u "Who will use this installation?"
  Pop $0
  ${NSD_CreateRadioButton} 0 36u 100% 16u "Current user"
  Pop $MCSCurrentUserChoice
  ${NSD_CreateRadioButton} 0 64u 100% 16u "All users"
  Pop $MCSAllUsersChoice
  ${If} $MCSSettingsScope == "all"
    ${NSD_Check} $MCSAllUsersChoice
  ${Else}
    ${NSD_Check} $MCSCurrentUserChoice
  ${EndIf}
  ${NSD_CreateLabel} 0 102u 100% 60u "Current user allows only your Windows account to change settings. All users allows local Windows users to change settings. Backend services remain system-wide in both modes."
  Pop $0
  nsDialogs::Show
FunctionEnd

Function MCSSettingsPageLeave
  ${NSD_GetState} $MCSAllUsersChoice $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $MCSSettingsScope "all"
    StrCpy $MCSSettingsOwner "S-1-5-32-545"
  ${Else}
    StrCpy $MCSSettingsScope "current"
    StrCpy $MCSSettingsOwner $MCSLaunchingOwner
  ${EndIf}
FunctionEnd

Function MCSMaintenancePageCreate
  nsDialogs::Create 1018
  Pop $MCSMaintenancePage
  ${If} $MCSMaintenancePage == error
    Abort
  ${EndIf}

  ${If} $MCSExistingInstallDir == ""
    ${NSD_CreateLabel} 0 0 100% 14u "MCS Modbus Toolkit Setup"
    Pop $0
    CreateFont $1 "$(^Font)" "10" "700"
    SendMessage $0 ${WM_SETFONT} $1 1

    ${NSD_CreateLabel} 0 22u 100% 28u "MCS Modbus Toolkit is not installed on this computer."
    Pop $0

    ${NSD_CreateRadioButton} 0 60u 100% 14u "Install MCS Modbus Toolkit"
    Pop $MCSMaintenanceInstall
    ${NSD_Check} $MCSMaintenanceInstall

    ${NSD_CreateLabel} 0 90u 100% 44u "Setup will install the desktop application and let you choose which backend runtimes are registered as Windows services."
    Pop $0
  ${Else}
    ${NSD_CreateLabel} 0 0 100% 14u "MCS Modbus Toolkit Maintenance"
    Pop $0
    CreateFont $1 "$(^Font)" "10" "700"
    SendMessage $0 ${WM_SETFONT} $1 1

    ${NSD_CreateLabel} 0 22u 100% 34u "An existing installation was detected at:$\r$\n$MCSExistingInstallDir"
    Pop $0

    ${NSD_CreateRadioButton} 0 66u 100% 14u "Repair / reconfigure the existing installation"
    Pop $MCSMaintenanceRepair
    ${NSD_Check} $MCSMaintenanceRepair

    ${NSD_CreateRadioButton} 0 90u 100% 14u "Uninstall MCS Modbus Toolkit"
    Pop $MCSMaintenanceUninstall

    ${NSD_CreateLabel} 0 120u 100% 48u "Repair reinstalls the application files and lets you review the backend service selection. Existing runtime configuration is preserved. Uninstall runs the installed Windows uninstaller."
    Pop $0
  ${EndIf}

  nsDialogs::Show
FunctionEnd

Function MCSMaintenancePageLeave
  ${If} $MCSExistingInstallDir == ""
    StrCpy $MCSMaintenanceMode "install"
    Return
  ${EndIf}

  ${NSD_GetState} $MCSMaintenanceUninstall $0
  ${If} $0 == ${BST_CHECKED}
    IfFileExists "$MCSExistingInstallDir\Uninstall ${PRODUCT_NAME}.exe" mcs_uninstaller_found 0
    MessageBox MB_ICONSTOP|MB_OK "The installed uninstaller could not be found at:$\r$\n$MCSExistingInstallDir\Uninstall ${PRODUCT_NAME}.exe$\r$\n$\r$\nChoose Repair to restore the installation first."
    Abort

mcs_uninstaller_found:
    HideWindow
    ExecWait '"$MCSExistingInstallDir\Uninstall ${PRODUCT_NAME}.exe" /allusers' $0
    ${If} $0 != 0
      ShowWindow $HWNDPARENT ${SW_SHOW}
      MessageBox MB_ICONSTOP|MB_OK "Uninstall returned exit code $0."
      Abort
    ${EndIf}
    Quit
  ${EndIf}

  StrCpy $MCSMaintenanceMode "repair"
  StrCpy $INSTDIR $MCSExistingInstallDir
FunctionEnd

Function MCSServicePageCreate
  ${If} $MCSMaintenanceMode == "repair"
    ; Repair always targets the detected installation even if the directory page
    ; was changed manually while walking through the assisted installer.
    StrCpy $INSTDIR $MCSExistingInstallDir
  ${EndIf}

  nsDialogs::Create 1018
  Pop $MCSServicePage
  ${If} $MCSServicePage == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 14u "Service Configuration"
  Pop $0
  CreateFont $1 "$(^Font)" "10" "700"
  SendMessage $0 ${WM_SETFONT} $1 1

  ${NSD_CreateLabel} 0 18u 100% 22u "Choose which MCS backend runtimes Windows will run as services. Electron remains a normal desktop application."
  Pop $0

  ${NSD_CreateCheckbox} 0 48u 100% 12u "MMA2 - shared Modbus memory appliance"
  Pop $MCSInstallMMA2

  ${NSD_CreateCheckbox} 0 68u 100% 12u "Simulator runtime"
  Pop $MCSInstallSimulator

  ${NSD_CreateCheckbox} 0 88u 100% 12u "Replicator runtime"
  Pop $MCSInstallReplicator

  ${If} $MCSMaintenanceMode == "repair"
    ; Preserve the currently installed service selection by default. The operator
    ; may still check or uncheck services while repairing/reconfiguring.
    nsExec::ExecToStack 'sc.exe query "MCS-MMA2"'
    Pop $0
    Pop $1
    ${If} $0 == 0
      ${NSD_Check} $MCSInstallMMA2
    ${EndIf}

    nsExec::ExecToStack 'sc.exe query "MCS-Simulator"'
    Pop $0
    Pop $1
    ${If} $0 == 0
      ${NSD_Check} $MCSInstallSimulator
    ${EndIf}

    nsExec::ExecToStack 'sc.exe query "MCS-Replicator"'
    Pop $0
    Pop $1
    ${If} $0 == 0
      ${NSD_Check} $MCSInstallReplicator
    ${EndIf}
  ${Else}
    ${NSD_Check} $MCSInstallMMA2
    ${NSD_Check} $MCSInstallSimulator
    ${NSD_Check} $MCSInstallReplicator
  ${EndIf}

  ${NSD_CreateCheckbox} 0 116u 100% 12u "Start selected services after installation"
  Pop $MCSStartServices
  ${NSD_Check} $MCSStartServices

  ${NSD_CreateLabel} 0 142u 100% 30u "Service names: MCS-MMA2, MCS-Simulator, MCS-Replicator. Startup type: Automatic."
  Pop $0

  nsDialogs::Show
FunctionEnd

Function MCSServicePageLeave
  ${NSD_GetState} $MCSInstallMMA2 $MCSInstallMMA2State
  ${NSD_GetState} $MCSInstallSimulator $MCSInstallSimulatorState
  ${NSD_GetState} $MCSInstallReplicator $MCSInstallReplicatorState
  ${NSD_GetState} $MCSStartServices $MCSStartServicesState
FunctionEnd

!macro MCS_REQUIRE_SUCCESS action
  ${If} $0 != 0
    MessageBox MB_ICONSTOP|MB_OK "${action} failed with exit code $0. Installation cannot continue."
    Abort
  ${EndIf}
!macroend

!macro MCS_NSSM service executable
  ; Use NSSM only to create a missing service. All persistent service parameters
  ; are written directly afterward so upgrades never depend on NSSM's CLI parser.
  nsExec::ExecToStack 'sc.exe query "${service}"'
  Pop $0
  Pop $1

  ${If} $0 == 0
    nsExec::ExecToLog 'sc.exe stop "${service}"'
    Pop $0
  ${Else}
    nsExec::ExecToLog '"$INSTDIR\resources\bin\nssm.exe" install "${service}" "$INSTDIR\resources\bin\${executable}"'
    Pop $0
    !insertmacro MCS_REQUIRE_SUCCESS "Installing ${service} service"
  ${EndIf}

  ; NSSM reads these values from the service Parameters key at each start.
  WriteRegExpandStr HKLM "SYSTEM\CurrentControlSet\Services\${service}\Parameters" "Application" "$INSTDIR\resources\bin\${executable}"
  WriteRegExpandStr HKLM "SYSTEM\CurrentControlSet\Services\${service}\Parameters" "AppDirectory" "$MCSRuntimeRoot"
  CreateDirectory "$MCSRuntimeRoot\logs"
  WriteRegExpandStr HKLM "SYSTEM\CurrentControlSet\Services\${service}\Parameters" "AppStdout" "$MCSRuntimeRoot\logs\${service}.stdout.log"
  WriteRegExpandStr HKLM "SYSTEM\CurrentControlSet\Services\${service}\Parameters" "AppStderr" "$MCSRuntimeRoot\logs\${service}.stderr.log"
  WriteRegDWORD HKLM "SYSTEM\CurrentControlSet\Services\${service}\Parameters" "AppRotateFiles" 1
  WriteRegDWORD HKLM "SYSTEM\CurrentControlSet\Services\${service}\Parameters" "AppRotateOnline" 1
  WriteRegDWORD HKLM "SYSTEM\CurrentControlSet\Services\${service}\Parameters" "AppRotateBytes" 1048576
  DeleteRegValue HKLM "SYSTEM\CurrentControlSet\Services\${service}\Parameters" "AppParameters"
  DeleteRegValue HKLM "SYSTEM\CurrentControlSet\Services\${service}\Parameters" "AppEnvironment"
  DeleteRegValue HKLM "SYSTEM\CurrentControlSet\Services\${service}\Parameters" "AppEnvironmentExtra"
  WriteRegDWORD HKLM "SYSTEM\CurrentControlSet\Services\${service}\Parameters" "AppRestartDelay" 3000
  WriteRegStr HKLM "SYSTEM\CurrentControlSet\Services\${service}\Parameters\AppExit" "" "Restart"

  nsExec::ExecToLog 'sc.exe config "${service}" start= auto'
  Pop $0
  !insertmacro MCS_REQUIRE_SUCCESS "Configuring ${service} automatic startup"
!macroend

!macro customInstall
  ${If} $MCSSettingsOwner == ""
    MessageBox MB_ICONSTOP|MB_OK "Could not determine installation access."
    Abort
  ${EndIf}
  SetShellVarContext all
  ReadEnvStr $MCSRuntimeRoot "ProgramData"
  ${If} $MCSRuntimeRoot == ""
    StrCpy $MCSRuntimeRoot "$LOCALAPPDATA"
  ${EndIf}
  StrCpy $MCSRuntimeRoot "$MCSRuntimeRoot\MCS Modbus Toolkit\runtime"
  CreateDirectory "$MCSRuntimeRoot"
  CreateDirectory "$MCSRuntimeRoot\config"
  CreateDirectory "$MCSRuntimeRoot\config\mma2"

  IfFileExists "$MCSRuntimeRoot\config\mma2\config.yaml" mma2_config_ready 0
  FileOpen $1 "$MCSRuntimeRoot\config\mma2\config.yaml" w
  FileWrite $1 "{}$\r$\n"
  FileClose $1
mma2_config_ready:

  nsExec::ExecToStack '"$PLUGINSDIR\mcs-settings-access.exe" -mode grant -config "$MCSRuntimeRoot\config" -owner "$MCSSettingsOwner" -previous "$MCSPreviousSettingsOwner" -scope "$MCSSettingsScope"'
  Pop $0
  Pop $2
  ${If} $0 != 0
    MessageBox MB_ICONSTOP|MB_OK "Settings permissions failed:$\r$\n$2"
    Abort
  ${EndIf}
  ClearErrors
  WriteRegStr HKLM "Software\MCS Modbus Toolkit" "SettingsScope" "$MCSSettingsScope"
  WriteRegStr HKLM "Software\MCS Modbus Toolkit" "SettingsOwnerSID" "$MCSSettingsOwner"
  ${If} ${Errors}
    MessageBox MB_ICONSTOP|MB_OK "Could not save the settings owner for future upgrades."
    Abort
  ${EndIf}

  IfFileExists "$INSTDIR\resources\bin\nssm.exe" +3 0
  MessageBox MB_ICONSTOP|MB_OK "NSSM was not packaged. Place nssm.exe in electron\bin and rebuild the installer."
  Abort

  ${If} $MCSInstallMMA2State == ${BST_CHECKED}
    IfFileExists "$INSTDIR\resources\bin\mma2-supervisor.exe" +3 0
    MessageBox MB_ICONSTOP|MB_OK "mma2-supervisor.exe was not packaged. Rebuild the installer."
    Abort

    !insertmacro MCS_NSSM "MCS-MMA2" "mma2-supervisor.exe"
  ${Else}
    !insertmacro MCS_REMOVE_SERVICE "MCS-MMA2"
  ${EndIf}

  ${If} $MCSInstallSimulatorState == ${BST_CHECKED}
    !insertmacro MCS_NSSM "MCS-Simulator" "modbus-simulator-runtime.exe"
    ${If} $MCSInstallMMA2State == ${BST_CHECKED}
      nsExec::ExecToLog 'sc.exe config "MCS-Simulator" depend= "MCS-MMA2"'
      Pop $0
      !insertmacro MCS_REQUIRE_SUCCESS "Configuring MCS-Simulator dependency"
    ${Else}
      DeleteRegValue HKLM "SYSTEM\CurrentControlSet\Services\MCS-Simulator" "DependOnService"
    ${EndIf}
  ${Else}
    !insertmacro MCS_REMOVE_SERVICE "MCS-Simulator"
  ${EndIf}

  ${If} $MCSInstallReplicatorState == ${BST_CHECKED}
    !insertmacro MCS_NSSM "MCS-Replicator" "modbus-replicator-runtime.exe"
    ${If} $MCSInstallMMA2State == ${BST_CHECKED}
      nsExec::ExecToLog 'sc.exe config "MCS-Replicator" depend= "MCS-MMA2"'
      Pop $0
      !insertmacro MCS_REQUIRE_SUCCESS "Configuring MCS-Replicator dependency"
    ${Else}
      DeleteRegValue HKLM "SYSTEM\CurrentControlSet\Services\MCS-Replicator" "DependOnService"
    ${EndIf}
  ${Else}
    !insertmacro MCS_REMOVE_SERVICE "MCS-Replicator"
  ${EndIf}

  ${If} $MCSStartServicesState == ${BST_CHECKED}
    ${If} $MCSInstallMMA2State == ${BST_CHECKED}
      nsExec::ExecToLog 'sc.exe start "MCS-MMA2"'
      Pop $0
    ${EndIf}
    ${If} $MCSInstallSimulatorState == ${BST_CHECKED}
      nsExec::ExecToLog 'sc.exe start "MCS-Simulator"'
      Pop $0
    ${EndIf}
    ${If} $MCSInstallReplicatorState == ${BST_CHECKED}
      nsExec::ExecToLog 'sc.exe start "MCS-Replicator"'
      Pop $0
    ${EndIf}
  ${EndIf}
!macroend
!endif

!macro customUnWelcomePage
  !insertmacro MUI_UNPAGE_WELCOME
!macroend

!macro customUnInstall
  !insertmacro MCS_REMOVE_SERVICE "MCS-Replicator"
  !insertmacro MCS_REMOVE_SERVICE "MCS-Simulator"
  !insertmacro MCS_REMOVE_SERVICE "MCS-MMA2"
!macroend
